var connect = require("connect"),
    send = require("send"),
    mime = require("mime"),
    https = require("https"),
    url = require("url");

var server = connect()
    .use(connect.compress({filter: function(request, response) { return response.statusCode !== 304; }}))
    .use(connect.static("static"));

// Gist Redirect
// e.g., /0123456789/
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+|[0-9a-f]{20}(?:\/[0-9a-f]{40})?)\/$/.exec(u.pathname))) return next();
  response.writeHead(301, {"Location": "/" + r[1]});
  response.end();
});

// Gist
// e.g., /0123456789
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+|[0-9a-f]{20}(?:\/[0-9a-f]{40})?)$/.exec(u.pathname))) return next();
  send(request, "/gist.html").root("dynamic").pipe(response);
});

// Gist File Redirect
// e.g., /d/0123456789
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+|[0-9a-f]{20}(?:\/[0-9a-f]{40})?)$/.exec(u.pathname))) return next();
  response.writeHead(301, {"Location": "/d/" + r[1] + "/"});
  response.end();
});

// Gist File
// e.g., /d/0123456789/
// e.g., /d/0123456789/index.html
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/index.html
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+|[0-9a-f]{20}(\/[0-9a-f]{40})?)\/(.*)$/.exec(u.pathname))) return next();
  if (!r[3]) r[3] = "index.html";

  // Special-case for revision numbers. Since the revision number of the gist
  // does not match the revision number of the file, we have to fetch the
  // content via api.github.com rather than raw.github.com.
  if (r[2]) {
    https.get({
      host: "api.github.com",
      path: "/gists/" + r[1],
      headers: merge({
        "Accept-Charset": "utf-8"
      }, request.headers,
        "User-Agent"
      )
    }, function(apiResponse) {
      var body = [];
      apiResponse
          .on("data", function(chunk) { body.push(chunk); })
          .on("end", function() {
            try {
              var content = JSON.parse(body.join("")).files[r[3]].content;
              response.writeHead(200, merge({
                "Cache-Control": "public",
                "Content-Type": mime.lookup(r[3], "text/plain") + "; charset=utf-8"
              }, apiResponse.headers,
                "Date",
                "ETag",
                "Server"
              ));
            } catch (e) {
              response.writeHead(404, {"Content-Type": "text/plain"});
              content = "File not found.";
            }
            response.end(content);
          })
          .setEncoding("utf-8");
    });
    return;
  }

  https.request({
    host: "raw.github.com",
    path: "/gist/" + r[1] + "/" + r[3],
    method: request.method,
    headers: merge({
      "Accept-Charset": "utf-8"
    }, request.headers,
      "If-None-Match",
      "User-Agent"
    )
  }, function(apiResponse) {
    response.writeHead(response.statusCode = apiResponse.statusCode, merge({
      "Cache-Control": "public",
      "Content-Type": mime.lookup(r[3], "text/plain") + "; charset=utf-8"
    }, apiResponse.headers,
      "Date",
      "ETag",
      "Server"
    ));
    apiResponse.pipe(response);
  }).end();
});

// User Gists
// e.g., /mbostock
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([-\w]+)$/.exec(u.pathname))) return next();
  send(request, "/user.html").root("dynamic").pipe(response);
});

server.listen(process.env.PORT || 5000);

function merge(source, target) {
  var i = 1, n = arguments.length, K, k;
  while (++i < n) if ((k = (K = arguments[i]).toLowerCase()) in target) source[K] = target[k];
  return source;
}
