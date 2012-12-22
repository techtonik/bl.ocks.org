var https = require("https"),
    url = require("url"),
    zlib = require("zlib"),
    queue = require("queue-async"),
    lru = require("lru-cache"),
    secret = require("./secret");

module.exports = function(options) {
  var commitById = {},
      fileMaxSize = options["file-max-size"] || Infinity,
      userCache = lru({max: options["user-cache-size"], maxAge: options["user-max-age"]}),
      gistCache = lru({max: options["gist-cache-size"], maxAge: options["gist-max-age"]}),
      fileCache = lru({max: options["file-cache-size"], maxAge: options["file-max-age"], length: function(d) { return d.length; }}),
      userCallbacksByKey = {},
      gistCallbacksByKey = {},
      fileCallbacksByKey = {};

  function getGist(id, commit, callback) {
    if (arguments.length < 3) callback = commit, commit = null;

    // If this gist is already known, it might be cached.
    var inferredCommit = commit || commitById[id];
    if (inferredCommit) {
      var inferredKey = id + "/" + inferredCommit, gist = gistCache.get(inferredKey);
      if (gist) return void process.nextTick(function() { callback(null, gist); });
    }

    // If we haven't seen this gist before, we don't know the master SHA yet.
    var key = id + (commit ? "/" + commit : "");

    // If this gist is already being requested, add to the callback queue.
    var callbacks = gistCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = gistCallbacksByKey[key] = [callback];

    // Otherwise, time to fetch a new gist!
    https.get({
      host: "api.github.com",
      path: "/gists/" + key + "?client_id=" + secret.id + "&client_secret=" + secret.secret
    }, respond).on("error", callbackAll);

    function respond(response) {
      var gist = [];
      response.setEncoding("utf-8");
      response
          .on("data", function(chunk) { gist.push(chunk); })
          .on("end", function() {
            var s = response.statusCode;
            if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);

            // Parse the gist response.
            try {
              gist = JSON.parse(gist.join(""));
            } catch (e) {
              return callbackAll(e, null);
            }

            // Save the current master version.
            if (!commit) commit = commitById[id] = gist.history[0].version, inferredKey = id + "/" + commit;

            // Promote text files to the file cache.
            // Binary files are not encoded correctly, and must be fetched separately.
            var q = queue(), files = {};
            for (var name in gist.files) {
              var file = gist.files[name],
                  sha = file.raw_url.split("/").filter(function(s) { return /^[0-9a-f]{40}$/.test(s); })[0];
              files[name] = {language: file.language, type: file.type, filename: file.filename, size: file.size, sha: sha};
              if (text(file.type)) q.defer(saveFile, id + "/" + sha + "/" + name, file.content);
            }

            // Strip the unneeded parts form the gist for memory efficiency;
            gistCache.set(inferredKey, gist = {
              history: [{version: commit}],
              files: files,
              updated_at: gist.updated_at,
              description: gist.description,
              user: gist.user ? {login: gist.user.login} : {login: "anonymous"},
              id: gist.id
            });

            q.await(function(error) { callbackAll(error, error == null ? gist : null); });
          });
    }

    function callbackAll(error, gist) {
      delete gistCallbacksByKey[key];
      callbacks.forEach(function(callback) { try { callback(error, gist); } catch (ignore) {} });
    }
  }

  function getFile(id, commit, name, callback) {
    if (arguments.length < 4) callback = name, name = commit, commit = null;

    // First fetch the gist.
    getGist(id, commit, function(error, gist) {
      if (error) return void callback(error, null);

      // I don't recommend using names with slashes in them.
      name = name.split("/").pop();

      // Check if the file exists before fetching its contents.
      if (!(name in gist.files)) return void callback(404, null);

      // Determine the SHA of the requested file.
      var gistFile = gist.files[name],
          sha = gistFile.sha,
          date = new Date(gist.updated_at);

      // If this file is already cached, return it.
      var key = id + "/" + sha + "/" + name, file = fileCache.get(key);
      if (file) return void zlib.gunzip(file, function(error, file) { callback(error, file, gistFile.type, date); });

      // If this file is already being requested, add to the callback queue.
      var callbacks = fileCallbacksByKey[key];
      if (callbacks) return void callbacks.push(callback);
      callbacks = fileCallbacksByKey[key] = [callback];

      // Otherwise, fetch the file.
      https.get({
        host: "gist.github.com",
        path: "/raw/" + key + "?client_id=" + secret.id + "&client_secret=" + secret.secret
      }, respond).on("error", callbackAll);

      function respond(response) {
        var file = [];
        response
            .on("data", function(chunk) { file.push(chunk); })
            .on("end", function() {
              var s = response.statusCode;
              if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);
              saveFile(key, file = Buffer.concat(file), function(error) {
                callbackAll(error, file);
              });
            });
      }

      function callbackAll(error, file) {
        delete fileCallbacksByKey[key];
        callbacks.forEach(function(callback) { try { callback(error, file, gistFile.type, date); } catch (ignore) {} });
      }
    });
  }

  function getUser(login, page, callback) {

    // If this user is already cached, return it.
    var key = login + "/" + page, user = userCache.get(key);
    if (user) return void process.nextTick(function() { callback(null, user); });

    // If this user is already being requested, add to the callback queue.
    var callbacks = userCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = userCallbacksByKey[key] = [callback];

    // Otherwise, time to fetch a new user page!
    https.get({
      host: "api.github.com",
      path: "/users/" + login + "/gists?page=" + page + "&client_id=" + secret.id + "&client_secret=" + secret.secret
    }, respond).on("error", callbackAll);

    function respond(response) {
      var gists = [];
      response.setEncoding("utf-8");
      response
          .on("data", function(chunk) { gists.push(chunk); })
          .on("end", function() {
            var s = response.statusCode;
            if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);

            // Parse the response.
            try {
              gists = JSON.parse(gists.join(""));
            } catch (e) {
              callbackAll(e, null);
            }

            // Strip the unneeded parts form the gist for memory efficiency.
            gists = gists
                .filter(function(gist) { return "index.html" in gist.files; })
                .map(function(gist) {
                  return {
                    id: gist.id,
                    description: gist.description,
                    updated_at: gist.updated_at,
                    has_thumbnail: "thumbnail.png" in gist.files
                  };
                });

            userCache.set(key, gists);
            callbackAll(null, gists);
          });
    }

    function callbackAll(error, gists) {
      delete userCallbacksByKey[key];
      callbacks.forEach(function(callback) { try { callback(error, gists); } catch (ignore) {} });
    }
  }

  function saveFile(key, buffer, callback) {
    zlib.gzip(buffer, function(error, zbuffer) {
      if (!error) zbuffer.length < fileMaxSize ? fileCache.set(key, zbuffer) : fileCache.del(key);
      callback(error);
    });
  }

  return {
    gist: getGist,
    file: getFile,
    user: getUser,
    status: function() {
      return {
        "user-size": userCache.length,
        "gist-size": gistCache.length,
        "file-size": fileCache.length
      };
    }
  };
};

function text(type) {
  return /(^text\/)|(^application\/(javascript|json)$)|(^image\/svg$)|(\+xml$)/.test(type);
}
