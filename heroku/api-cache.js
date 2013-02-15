var https = require("https"),
    url = require("url"),
    queue = require("queue-async"),
    cache = require("./zip-lru-cache"),
    secret = require("./secret");

module.exports = function(options) {
  var commitById = {},
      userCache = cache({max: options["user-cache-size"], maxAge: options["user-max-age"]}),
      gistCache = cache({max: options["gist-cache-size"], maxAge: options["gist-max-age"]}),
      fileCache = cache({max: options["file-cache-size"], maxAge: options["file-max-age"], maxLength: options["file-max-size"]}),
      userCallbacksByKey = {},
      gistCallbacksByKey = {},
      fileCallbacksByKey = {};

  function getGist(id, commit, callback) {
    if (arguments.length < 3) callback = commit, commit = null;

    // If this gist is already known (and a text file), it might be cached.
    var inferredSha = commit || commitById[id];
    if (inferredSha) return void gistCache.get(id + "/" + inferredSha, function(error, gist) {
      if (gist) return void callback(null, gist);
      fetchGist(id, commit, callback);
    });

    // Otherwise, this gist must require fetching.
    fetchGist(id, commit, callback);
  }

  function fetchGist(id, commit, callback) {

    // If we haven't seen this gist before, we don't know the master SHA yet.
    var key = id + (commit ? "/" + commit : "");

    // If this gist is already being fetched, add to the callback queue.
    var callbacks = gistCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = gistCallbacksByKey[key] = [callback];

    // Otherwise, time to fetch a new gist!
    https.get({
      host: "api.github.com",
      path: "/gists/" + key + "?client_id=" + secret.id + "&client_secret=" + secret.secret
    }, function(response) {
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
              return void callbackAll(e, null);
            }

            // Save the current master version.
            if (!commit) commit = commitById[id] = gist.history[0].version;

            // Promote text files to the file cache.
            // Binary files are not encoded correctly, and must be fetched separately.
            var q = queue(), files = {};
            for (var name in gist.files) {
              var file = gist.files[name],
                  sha = file.raw_url.split("/").filter(function(s) { return /^[0-9a-f]{40}$/.test(s); })[0];
              files[name] = {language: file.language, type: file.type, filename: file.filename, size: file.size, sha: sha};
              if (text(file.type)) q.defer(fileCache.set, id + "/" + sha + "/" + name, file.content);
            }

            // Strip the unneeded parts form the gist for memory efficiency
            q.defer(gistCache.set, id + "/" + commit, gist = {
              history: [{version: commit}],
              files: files,
              updated_at: gist.updated_at,
              description: gist.description,
              user: gist.user ? {login: gist.user.login} : {login: "anonymous"},
              id: gist.id
            });

            q.await(function(error) { callbackAll(null, gist); });
          });
    }).on("error", callbackAll);

    function callbackAll(error, gist) {
      var copy = callbacks.slice(); callbacks = null; // defensive copy
      delete gistCallbacksByKey[key];
      copy.forEach(function(callback) { try { callback(error, gist); } catch (ignore) {} });
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
          type = gistFile.type,
          date = new Date(gist.updated_at);

      // If this file is already cached, return it.
      fileCache.get(id + "/" + sha + "/" + name, function(error, file) {
        if (file) return void callback(null, gist, file, type, date);
        fetchFile(gist.user.login, id, sha, name, function(error, file) {
          callback(error, gist, file, type, date);
        });
      });
    });
  }

  function fetchFile(username, id, sha, name, callback) {
    var key = id + "/" + sha + "/" + name;

    // If this file is already being requested, add to the callback queue.
    var callbacks = fileCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = fileCallbacksByKey[key] = [callback];

    // Otherwise, fetch the file.
    https.get({
      host: "gist.github.com",
      path: "/" + username + "/" + id + "/raw/" + sha + "/" + name + "?client_id=" + secret.id + "&client_secret=" + secret.secret
    }, function(response) {
      var file = [];
      response
          .on("data", function(chunk) { file.push(chunk); })
          .on("end", function() {
            var s = response.statusCode;
            if ((s < 200 || s > 300) && s !== 304) return void callbackAll(s, null);
            fileCache.set(key, file = Buffer.concat(file), function(error) {
              callbackAll(null, file);
            });
          });
    }).on("error", callbackAll);

    function callbackAll(error, file) {
      var copy = callbacks.slice(); callbacks = null; // defensive copy
      delete fileCallbacksByKey[key];
      copy.forEach(function(callback) { try { callback(error, file); } catch (ignore) {} });
    }
  }

  function getUser(login, page, callback) {

    // If this user is already cached, return it.
    userCache.get(login + "/" + page, function(error, gists) {
      if (gists) return void callback(null, gists);
      fetchUser(login, page, callback);
    });
  }

  function fetchUser(login, page, callback) {
    var key = login + "/" + page;

    // If this user is already being requested, add to the callback queue.
    var callbacks = userCallbacksByKey[key];
    if (callbacks) return void callbacks.push(callback);
    callbacks = userCallbacksByKey[key] = [callback];

    // Otherwise, time to fetch a new user page!
    https.get({
      host: "api.github.com",
      path: "/users/" + login + "/gists?page=" + page + "&client_id=" + secret.id + "&client_secret=" + secret.secret
    }, function(response) {
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
              return void callbackAll(e, null);
            }

            // Strip the unneeded parts form the gist for memory efficiency.
            gists = gists
                .map(function(gist) {
                  return {
                    id: gist.id,
                    description: gist.description,
                    updated_at: gist.updated_at
                  };
                });

            userCache.set(key, gists, function(error) {
              callbackAll(error, gists);
            });
          });
    }).on("error", callbackAll);

    function callbackAll(error, gists) {
      var copy = callbacks.slice(); callbacks = null; // defensive copy
      delete userCallbacksByKey[key];
      copy.forEach(function(callback) { try { callback(error, gists); } catch (ignore) {} });
    }
  }

  return {
    gist: getGist,
    file: getFile,
    user: getUser,
    status: function() {
      return {
        "user-size": userCache.size(),
        "gist-size": gistCache.size(),
        "file-size": fileCache.size()
      };
    }
  };
};

function text(type) {
  return /(^text\/)|(^application\/(javascript|json)$)|(^image\/svg$)|(\+xml$)/.test(type);
}
