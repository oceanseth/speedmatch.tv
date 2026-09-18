// Apex redirect: speedmatch.tv -> https://www.speedmatch.tv
//
// Route53 cannot publish a CNAME at the zone apex, and InstaCloud's
// custom-hostname validation requires one, so the apex is served by a
// dedicated CloudFront distribution whose viewer-request function answers
// every request with a 301 to www. The www host stays on InstaCloud
// untouched.
//
// State is local (terraform.tfstate, gitignored). Apply from this directory
// with credentials for the account that owns hosted zone Z0550806TJYCD5L1YCK.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

// CloudFront requires ACM certificates in us-east-1.
provider "aws" {
  region = "us-east-1"
}

locals {
  apex_domain = "speedmatch.tv"
  www_domain  = "www.speedmatch.tv"
  zone_id     = "Z0550806TJYCD5L1YCK"

  // Fixed Route53 alias zone id for any CloudFront distribution.
  cloudfront_zone_id = "Z2FDTNDATAQYW2"

  // AWS-managed CachingOptimized policy; contents never vary, and the
  // function short-circuits before the origin anyway.
  caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
}

resource "aws_acm_certificate" "apex" {
  domain_name       = local.apex_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "apex_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.apex.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = local.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "apex" {
  certificate_arn         = aws_acm_certificate.apex.arn
  validation_record_fqdns = [for r in aws_route53_record.apex_cert_validation : r.fqdn]
}

resource "aws_cloudfront_function" "redirect_to_www" {
  name    = "speedmatch-apex-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  comment = "301 speedmatch.tv -> https://www.speedmatch.tv, preserving path and query"
  code    = file("${path.module}/redirect.js")
}

resource "aws_cloudfront_distribution" "apex_redirect" {
  enabled         = true
  comment         = "speedmatch.tv apex 301 -> www"
  aliases         = [local.apex_domain]
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true

  // Never reached: the viewer-request function answers every request.
  // CloudFront still requires a syntactically valid origin.
  origin {
    domain_name = local.www_domain
    origin_id   = "unused-www-passthrough"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id = "unused-www-passthrough"
    // allow-all so plain-HTTP requests get the 301 directly instead of an
    // extra hop through CloudFront's own HTTP->HTTPS redirect.
    viewer_protocol_policy = "allow-all"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.caching_optimized_policy_id
    compress               = false

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.redirect_to_www.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.apex.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

// allow_overwrite: the zone currently holds hand-created A/AAAA records
// pinned to InstaCloud's edge IPs; these aliases replace them.
resource "aws_route53_record" "apex_a" {
  zone_id         = local.zone_id
  name            = local.apex_domain
  type            = "A"
  allow_overwrite = true

  alias {
    name                   = aws_cloudfront_distribution.apex_redirect.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id         = local.zone_id
  name            = local.apex_domain
  type            = "AAAA"
  allow_overwrite = true

  alias {
    name                   = aws_cloudfront_distribution.apex_redirect.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}

output "distribution_domain" {
  value = aws_cloudfront_distribution.apex_redirect.domain_name
}

output "distribution_id" {
  value = aws_cloudfront_distribution.apex_redirect.id
}
