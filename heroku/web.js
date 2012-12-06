var fs = require("fs"),
    connect = require("connect"),
    send = require("send"),
    mime = require("mime"),
    url = require("url"),
    util = require("util"),
    formatDate = require("dateformat");

var cache = require("./cache")({
  "user-max-age": 1000 * 60 * 5, // five minutes
  "user-cache-size": 1 << 8, // 256
  "gist-max-age": 1000 * 60 * 5, // five minutes
  "gist-cache-size": 1 << 12, // 4096
  "file-max-size": 1 << 20, // 1M
  "file-cache-size": 1 << 28 // 256M
});

var server = connect()
    .use(connect.compress({filter: function(request, response) { return response.statusCode !== 304; }}))
    .use(connect.static("static"));

// Gist Redirect
// e.g., /0123456789/
// e.g., /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/((?:[0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?)\/$/.exec(u.pathname))) return next();
  response.writeHead(301, {"Location": "/" + r[1]});
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
  cache.gist(r[1], r[2], function(error, gist) {
    if (error) {
      response.writeHead(error === 404 ? 404 : 503, {"Content-Type": "text/plain"});
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var gistDate = new Date(gist.updated_at),
        content = null;

    // Return 304 not if-modified-since.
    var status = request.headers["if-modified-since"] && gistDate <= new Date(request.headers["if-modified-since"])
        ? 304
        : (content = JSON.stringify(gist), 200);

    response.writeHead(status, {
      "Cache-Control": "max-age=86400",
      "Content-Type": "application/json; charset=utf-8",
      "Expires": formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true),
      "Last-Modified": formatDate(gistDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true)
    });
    response.end(content);
  });
});

// Gist File Redirect
// e.g., /d/0123456789
// e.g., /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/((?:[0-9]+|[0-9a-f]{20})(?:\/[0-9a-f]{40})?)$/.exec(u.pathname))) return next();
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
  if (!(r = /^\/d\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?\/(.*)$/.exec(u.pathname))) return next();
  if (!r[3]) r[3] = "index.html";
  cache.file(r[1], r[2], r[3], function(error, content, contentDate) {
    if (error) {
      response.writeHead(error === 404 ? 404 : 503, {"Content-Type": "text/plain"});
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    // Return 304 not if-modified-since.
    var status = request.headers["if-modified-since"] && contentDate <= new Date(request.headers["if-modified-since"])
        ? (content = null, 304)
        : 200;

    response.writeHead(status, {
      "Cache-Control": "max-age=86400",
      "Content-Type": mime.lookup(r[3], "text/plain"), // TODO + "; charset=utf-8"
      "Expires": formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true),
      "Last-Modified": formatDate(contentDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true)
    });
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
  cache.user(r[1], +r[2], function(error, user, userDate) {
    if (error) {
      response.writeHead(error === 404 ? 404 : 503, {"Content-Type": "text/plain"});
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var content = null;

    // Return 304 not if-modified-since.
    var status = request.headers["if-modified-since"] && userDate <= new Date(request.headers["if-modified-since"])
        ? 304
        : (content = JSON.stringify(user), 200);

    response.writeHead(status, {
      "Cache-Control": "max-age=86400",
      "Content-Type": "application/json; charset=utf-8",
      "Expires": formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true),
      "Last-Modified": formatDate(userDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true)
    });
    response.end(content);
  });
});

server.listen(process.env.PORT || 5000);
