var url = require("url");

var connect = require("connect"),
    send = require("send"),
    formatDate = require("dateformat");

var cache = require("./cache")({
  "user-max-age": 1000 * 60 * 5, // five minutes
  "user-cache-size": 1 << 8, // 256
  "gist-max-age": 1000 * 60 * 5, // five minutes
  "gist-cache-size": 1 << 11, // 2048
  "file-max-size": 1 << 19, // 512K
  "file-cache-size": 1 << 27 // 128M
});

var server = connect()
    .use(connect.compress())
    .use(connect.static("static"));

// Gist Redirect
// e.g., /0123456789/
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/((?:[0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?)\/$/.exec(u.pathname))) return next();
  var id = r[1];
  response.statusCode = 301;
  response.setHeader("Location", "/" + id);
  response.end();
});

// Gist
// e.g., /0123456789
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?$/.exec(u.pathname))) return next();
  send(request, "/gist.html").root("dynamic").pipe(response); // TODO embed gist into template response
});

// Gist API
// e.g., /0123456789.json
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf.json
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?\.json$/.exec(u.pathname))) return next();
  var id = r[1],
      sha = r[2];
  cache.gist(id, sha, function(error, gist) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var gistDate = new Date(gist.updated_at),
        content = null;

    // Return 304 not if-modified-since.
    response.statusCode = request.headers["if-modified-since"]
        && gistDate <= new Date(request.headers["if-modified-since"])
        ? 304
        : (content = JSON.stringify(gist), 200);

    response.setHeader("Cache-Control", "max-age=86400");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Expires", formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(gistDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.end(content);
  });
});

// Gist File Redirect
// e.g., /d/0123456789
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/((?:[0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?)$/.exec(u.pathname))) return next();
  var id = r[1];
  response.statusCode = 301;
  response.setHeader("Location", "/d/" + id + "/'");
  response.end();
});

// Gist File
// e.g., /d/0123456789/
// e.g., /d/0123456789/index.html
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/index.html
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?\/(.*)$/.exec(u.pathname))) return next();
  var id = r[1],
      sha = r[2],
      file = r[3] || "index.html";
  cache.file(id, sha, file, function(error, content, contentType, contentDate) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    // Return 304 not if-modified-since.
    response.statusCode = request.headers["if-modified-since"]
        && contentDate <= new Date(request.headers["if-modified-since"])
        ? (content = null, 304)
        : 200;

    response.setHeader("Cache-Control", "max-age=86400");
    response.setHeader("Content-Type", contentType); // TODO + "; charset=utf-8"
    response.setHeader("Expires", formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(contentDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.end(content);
  });
});

// User Gists
// e.g., /mbostock
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([-\w]+)$/.exec(u.pathname))) return next();
  send(request, "/user.html").root("dynamic").pipe(response);
});

// User Gists API
// e.g., /mbostock/1.json
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([-\w]+)\/([0-9]+)\.json$/.exec(u.pathname))) return next();
  var id = r[1],
      page = +r[2];
  cache.user(id, page, function(error, user, userDate) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var content = null,
        maxSeconds = page === 1 ? 60 * 5 : 60 * 60 * 24;

    // Return 304 not if-modified-since.
    response.statusCode = request.headers["if-modified-since"]
        && userDate <= new Date(request.headers["if-modified-since"])
        ? 304
        : (content = JSON.stringify(user), 200);

    response.setHeader("Cache-Control", "max-age=" + maxSeconds);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Expires", formatDate(new Date(Date.now() + maxSeconds * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(userDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.end(content);
  });
});

// Status API
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (u.pathname !== "/!status.json") return next();
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    cache: cache.status(),
    memory: process.memoryUsage()
  }, null, 2));
});

server.listen(process.env.PORT || 5000);
