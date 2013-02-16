var fs = require("fs"),
    url = require("url");

var connect = require("connect"),
    send = require("send"),
    formatDate = require("dateformat"),
    mu = require("mu2");

var gistHtml = mu.compileText(fs.readFileSync("templates/gist.html", "utf-8")),
    userHtml = mu.compileText(fs.readFileSync("templates/user.html", "utf-8")),
    userRss = mu.compileText(fs.readFileSync("templates/user.rss", "utf-8"));

var api = require("./api-cache")({
  "user-max-age": 1000 * 60 * 5, // five minutes
  "user-cache-size": 1 << 23, // 8M
  "gist-max-age": 1000 * 60 * 5, // five minutes
  "gist-cache-size": 1 << 24, // 16M
  "file-max-size": 1 << 19, // 512K
  "file-cache-size": 1 << 27 // 128M
});

var server = connect()
    .use(connect.compress())
    .use(connect.static("static"));

// Redirects from deprecated URL:
// /0123456789 -> /mbostock/0123456789
// /0123456789/ -> /mbostock/0123456789
// /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf -> /mbostock/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
// /0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/ -> /mbostock/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?(?:\/)?$/.exec(u.pathname))) return next();
  var id = r[1], sha = r[2], search = u.search || "";

  api.gist(id, sha, function(error, gist) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    response.statusCode = 301;
    response.setHeader("Location", "/" + gist.user.login + "/" + id + (sha ? "/" + sha : "") + search);
    response.end();
  });
});

// Redirects from deprecated URLs:
// /d/0123456789/ -> /mbostock/raw/0123456789/
// /d/0123456789 -> /mbostock/raw/0123456789/
// /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/ -> /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
// /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf -> /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
// /d/0123456789/file.ext -> /mbostock/raw/0123456789/file.ext
// /d/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/file.ext -> /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/file.ext
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/d\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?(\/.*)?$/.exec(u.pathname))) return next();
  var id = r[1], sha = r[2], file = r[3] && decodeURIComponent(r[3]) || "/", search = u.search || "";

  api.gist(id, sha, function(error, gist) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    response.statusCode = 301;
    response.setHeader("Location", "/" + gist.user.login + "/raw/" + id + (sha ? "/" + sha : "") + file + search);
    response.end();
  });
});

// Redirects for user listing:
// /mbostock/ -> /mbostock
// /mbostock/raw -> /mbostock
// /mbostock/raw/ -> /mbostock
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]+)\/(?:raw\/?)?$/.exec(u.pathname))) return next();
  var user = r[1], search = u.search || "";

  response.statusCode = 301;
  response.setHeader("Location", "/" + user + search);
  response.end();
});

// Redirect for user’s gist wrapper (at version or not):
// /mbostock/0123456789/ -> /mbostock/0123456789
// /mbostock/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/ -> /mbostock/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]+)\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?\/$/.exec(u.pathname))) return next();
  var user = r[1], id = r[2], sha = r[3], search = u.search || "";

  response.statusCode = 301;
  response.setHeader("Location", "/" + user + "/" + id + (sha ? "/" + sha : "") + search);
  response.end();
});

// Redirect for user’s raw gist index.html (at version or not):
// /mbostock/raw/0123456789 -> /mbostock/raw/0123456789/
// /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf -> /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]+)\/raw\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?$/.exec(u.pathname))) return next();
  var user = r[1], id = r[2], sha = r[3], search = u.search || "";

  response.statusCode = 301;
  response.setHeader("Location", "/" + user + "/raw/" + id + (sha ? "/" + sha : "") + "/" + search);
  response.end();
});

// User gist listing
// /mbostock
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)$/.exec(u.pathname))) return next();
  var login = r[1];

  api.user(login, 1, function(error, userGists, userDate) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    mu.render(userHtml, {
      username: login,
      json: JSON.stringify(userGists)
    }).pipe(response);
  });
});

// User gist listing JSON API
// /mbostock/1.json
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)\/([0-9]+)\.json$/.exec(u.pathname))) return next();
  var login = r[1],
      page = +r[2];

  api.user(login, page, function(error, userGists, userDate) {
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
        : (content = JSON.stringify(userGists), 200);

    response.setHeader("Cache-Control", "max-age=" + maxSeconds);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Expires", formatDate(new Date(Date.now() + maxSeconds * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(userDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.end(content);
  });
});

// User gist listing RSS API
// /mbostock.rss
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.rss$/.exec(u.pathname))) return next();
  var login = r[1];

  api.user(login, 1, function(error, userGists, userDate) {
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var maxSeconds = 60 * 5;
    response.setHeader("Cache-Control", "max-age=" + maxSeconds);
    response.setHeader("Content-Type", "text/xml; charset=utf-8");
    response.setHeader("Expires", formatDate(new Date(Date.now() + maxSeconds * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(userDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));

    // Return 304 not if-modified-since.
    if (request.headers["if-modified-since"] && userDate <= new Date(request.headers["if-modified-since"])) {
      response.statusCode = 304;
      response.end();
      return;
    }

    mu.render(userRss, {
      username: login,
      date: formatDate(userDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true),
      gists: userGists.map(function(gist) {
        return {
          id: gist.id,
          title: gist.description || gist.id,
          date: formatDate(gist.updated_at, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true)
        };
      })
    }).pipe(response);
  });
});

// User gist wrapper
// /mbostock/0123456789
// /mbostock/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?$/.exec(u.pathname))) return next();
  var login = r[1], id = r[2], sha = r[3];

  api.gist(id, sha, function(error, gist) {
    if (!error && gist.user.login !== login) error = 404;
    if (error) {
      response.statusCode = error === 404 ? 404 : 503;
      response.setHeader("Content-Type", "text/plain");
      response.end(error === 404 ? "File not found." : "Service unavailable.");
      if (error !== 404) console.trace(error);
      return;
    }

    var gistDate = new Date(gist.updated_at);

    response.setHeader("Cache-Control", "max-age=86400");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Expires", formatDate(new Date(Date.now() + 86400 * 1000), "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));
    response.setHeader("Last-Modified", formatDate(gistDate, "ddd, dd mmm yyyy HH:MM:ss 'GMT'", true));

    // Return 304 not if-modified-since.
    if (request.headers["if-modified-since"] && gistDate <= new Date(request.headers["if-modified-since"])) {
      response.statusCode = 304;
      response.end();
      return;
    }

    mu.render(gistHtml, {
      date: formatDate(gistDate, "mmmm d, yyyy"),
      gist: gist,
      index: "index.html" in gist.files,
      json: JSON.stringify(gist)
    }).pipe(response);
  });
});

// Gist raw file
// /mbostock/raw/0123456789/
// /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/
// /mbostock/raw/0123456789/file.ext
// /mbostock/raw/0123456789/d39b22ba1ca024287f98c221fd74f39a3f990cdf/file.ext
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (!(r = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)\/raw\/([0-9]+|[0-9a-f]{20})(?:\/([0-9a-f]{40}))?\/(.*)$/.exec(u.pathname))) return next();
  var login = r[1], id = r[2], sha = r[3], file = decodeURIComponent(r[4]) || "index.html";
  api.file(id, sha, file, function(error, gist, content, contentType, contentDate) {
    if (!error && gist.user.login !== login) error = 404;
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

// Status API
server.use(function(request, response, next) {
  var u = url.parse(request.url), r;
  if (u.pathname !== "/!status.json") return next();
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    cache: api.status(),
    memory: process.memoryUsage()
  }, null, 2));
});

server.listen(process.env.PORT || 5000);
