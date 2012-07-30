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
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+)\/$/.exec(u.href))) return next();
  response.writeHead(301, {"Location": "/" + r[1]});
  response.end();
});

// Gist
// e.g., /0123456789/
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+)$/.exec(u.href))) return next();
  send(request, "/gist.html").root("dynamic").pipe(response);
});

// Gist File Redirect
// e.g., /d/0123456789
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+)$/.exec(u.href))) return next();
  response.writeHead(301, {"Location": "/d/" + r[1] + "/"});
  response.end();
});

// Gist File
// e.g., /d/0123456789/index.html
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+)\/(.*)$/.exec(u.href))) return next();
  if (!r[2]) r[2] = "index.html";
  https.request({
    host: "raw.github.com",
    path: "/gist/" + r[1] + "/" + r[2],
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
      "Content-Type": mime.lookup(r[2], "text/plain") + "; charset=utf-8"
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
  if (!(r = /^\/(\w+)$/.exec(u.href))) return next();
  send(request, "/user.html").root("dynamic").pipe(response);
});

server.listen(process.env.PORT || 5000);

function merge(source, target) {
  var i = 1, n = arguments.length, K, k;
  while (++i < n) if ((k = (K = arguments[i]).toLowerCase()) in target) source[K] = target[k];
  return source;
}
