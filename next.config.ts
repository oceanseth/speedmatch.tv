import type { NextConfig } from "next";

// Baseline security headers (Opus, live-deploy check 2026-09-18). Bucket
// responses for user-uploaded chunks need their own nosniff independently
// of these — set there when the media routes land.
const securityHeaders = [
  // Stops the first-request downgrade; the Secure cookies only protect
  // requests that are already https.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Content sniffing on attacker-influenced bytes (user uploads) is the
  // exact case this exists for.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
