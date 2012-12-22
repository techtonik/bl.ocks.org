var zlib = require("zlib");

var lru = require("lru-cache");

// TODO don't gzip binary files

module.exports = function(options) {
  options.length = valueLength;
  var cache = lru(options),
      maxLength = options.maxLength || Infinity;
  return {
    size: function() {
      return cache.length;
    },
    get: function(key, callback) {
      var entry = cache.get(key);
      if (!entry) return void process.nextTick(callback);
      zlib.gunzip(entry.value, function(error, value) {
        if (!error && entry.type === "json") value = JSON.parse(value);
        callback(error, value);
      });
    },
    set: function(key, value, callback) {
      var type = typeof value === "string" ? "string"
          : value instanceof Buffer ? "buffer"
          : "json";
      zlib.gzip(type === "json" ? JSON.stringify(value) : value, function(error, value) {
        if (!error) value.length <= maxLength ? cache.set(key, {type: type, value: value}) : cache.del(key);
        callback(error);
      });
    },
    del: function(key) {
      cache.del(key);
    }
  };
};

function valueLength(entry) {
  return entry.value.length;
}
