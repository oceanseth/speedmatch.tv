// CloudFront Function (cloudfront-js-2.0), viewer-request.
// Answers every apex request with a 301 to www, preserving path and query.
function handler(event) {
  var request = event.request;
  var qs = '';
  var keys = Object.keys(request.querystring);
  if (keys.length > 0) {
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var entry = request.querystring[key];
      if (entry.multiValue) {
        for (var j = 0; j < entry.multiValue.length; j++) {
          parts.push(key + '=' + entry.multiValue[j].value);
        }
      } else if (entry.value === '') {
        parts.push(key);
      } else {
        parts.push(key + '=' + entry.value);
      }
    }
    qs = '?' + parts.join('&');
  }
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: 'https://www.speedmatch.tv' + request.uri + qs },
      'cache-control': { value: 'max-age=3600' }
    }
  };
}
