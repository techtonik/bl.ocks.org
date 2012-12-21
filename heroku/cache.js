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
      var inferredKey = id + "/" + inferredCommit, gist = findGist(inferredKey);
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
    }, response).on("error", callbackAll);

    function response(response) {
      var body = [];
      response
          .on("data", function(chunk) { body.push(chunk); })
          .on("end", function() {
            var s = response.statusCode;
            if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);

            // Parse the gist response.
            var gist;
            try {
              gist = JSON.parse(Buffer.concat(body).toString());
            } catch (e) {
              return callbackAll(e, null);
            }

            // Save the current master version.
            if (!commit) commit = commitById[id] = gist.history[0].version, inferredKey = id + "/" + commit;

            // Promote text files to the file cache.
            // Binary files are not encoded correctly, and must be fetched separately.
            var q = queue();
            for (var name in gist.files) {
              var file = gist.files[name];
              file.sha = file.raw_url.split("/").filter(function(s) { return /^[0-9a-f]{40}$/.test(s); })[0];
              if (text(file.type)) q.defer(saveFile, id + "/" + file.sha + "/" + name, file.content);
              delete file.content;
              delete file.raw_url;
            }

            // Strip the unneeded parts form the gist for memory efficiency;
            gist = {
              history: [{version: commit}],
              files: gist.files,
              updated_at: gist.updated_at,
              description: gist.description,
              user: gist.user ? {login: gist.user.login} : {login: "anonymous"},
              id: gist.id
            };

            q.defer(saveGist, inferredKey, gist);

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
      var sha = gist.files[name].sha,
          date = new Date(gist.updated_at);

      // If this file is already cached, return it.
      var key = id + "/" + sha + "/" + name, file = findFile(key);
      if (file) return void zlib.gunzip(file, function(error, file) { callback(error, file, date); });

      // If this file is already being requested, add to the callback queue.
      var callbacks = fileCallbacksByKey[key];
      if (callbacks) return void callbacks.push(callback);
      callbacks = fileCallbacksByKey[key] = [callback];

      // Otherwise, fetch the file.
      https.get({
        host: "gist.github.com",
        path: "/raw/" + key + "?client_id=" + secret.id + "&client_secret=" + secret.secret
      }, response).on("error", callbackAll);

      function response(response) {
        var body = [];
        response
            .on("data", function(chunk) { body.push(chunk); })
            .on("end", function() {
              var s = response.statusCode;
              if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);
              saveFile(key, file = Buffer.concat(body), function(error) {
                callbackAll(error, file);
              });
            });
      }

      function callbackAll(error, file) {
        delete fileCallbacksByKey[key];
        callbacks.forEach(function(callback) { try { callback(error, file, date); } catch (ignore) {} });
      }
    });
  }

  function getUser(login, page, callback) {

    // If this user is already cached, return it.
    var key = login + "/" + page, user = findUser(key);
    if (user) return void process.nextTick(function() { callback(null, user); });

    // If this user is already being requested, add to the callback queue.
    var callbacks = userCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = userCallbacksByKey[key] = [callback];

    // Otherwise, time to fetch a new user page!
    https.get({
      host: "api.github.com",
      path: "/users/" + login + "/gists?page=" + page + "&client_id=" + secret.id + "&client_secret=" + secret.secret
    }, response).on("error", callbackAll);

    function response(response) {
      var body = [];
      response
          .on("data", function(chunk) { body.push(chunk); })
          .on("end", function() {
            var s = response.statusCode;
            if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);

            // Parse the response.
            var gists;
            try {
              gists = JSON.parse(Buffer.concat(body).toString());
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

            saveUser(key, gists, function(error) {
              callbackAll(error, gists);
            });
          });
    }

    function callbackAll(error, gists) {
      delete userCallbacksByKey[key];
      callbacks.forEach(function(callback) { try { callback(error, gists); } catch (ignore) {} });
    }
  }

  function findGist(key) {
    return gistCache.get(key);
  }

  function saveGist(key, gist, callback) {
    gistCache.set(key, gist);
    process.nextTick(callback);
  }

  function findFile(key) {
    return fileCache.get(key);
  }

  function saveFile(key, file, callback) {
    zlib.gzip(file, function(error, file) {
      if (!error) file.length < fileMaxSize ? fileCache.set(key, file) : fileCache.del(key);
      callback(error);
    });
  }

  function findUser(key, maxAge) {
    return userCache.get(key);
  }

  function saveUser(key, user, callback) {
    userCache.set(key, user);
    process.nextTick(callback);
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
