/*
 * node-markdownblog 1.0
 * http://semu.mp/node-markdownblog.html
 *
 * (c) 2012 Sebastian Müller <c@semu.mp>
 * MIT license 
 */

/**
 * Require needed modules and define variables
 **/
var fs = require('fs'),
crypto = require('crypto'),
mongodb = require('mongodb').MongoClient,
BSON = require('mongodb').BSONPure,
app = {
  'meta':         {}, 
  'default':      {}, 
  'mapping':      {}, 
  'mongoConnectionString': "mongodb://127.0.0.1:27017/test",
  'md':           require('markdown').markdown, 
  'admin':        [], 
  'articlesPerPage': 10
}, 
exports = module.exports = app;

/** 
 * Set general meta information
 * @param string name
 * @param mixed value
 **/
exports.setMeta = function(name, value) { this.meta[name] = value; };

/**
 * Count words 
 * @param string s
 * @return intenger 
 **/
var countWords = function(s) { return !s ? 0 : (s.split(/^\s+$/).length === 2 ? 0 : 2 + s.split(/\s+/).length - s.split(/^\s+/).length - s.split(/\s+$/).length); };

/**
 * Calculate time to read
 * @param integer words
 * @return intenger 
 **/
var timeToRead = function(words) { return {'min': Math.floor(words / 200), 'sec': Math.floor(words % 200 / (200 / 60))}; };

/** 
 * Set default information
 * @param string name
 * @param mixed value
 **/
exports.setDefault = function(key, value) { this.default[key] = value; };

/** 
 * Get default information
 * @param string key
 * @return mixed
 **/
exports.getDefault = function(key) { return this.default[key]; };

/** 
 * Add admin login
 * @param object user
 **/
exports.addLogin = function(user) { app.admin.push(user); };

/** 
 * Set database connection details
 * @param string
 **/
 exports.setMongoConnectionString = function(conn) { app.mongoConnectionString = conn; };

/** 
 * Get current session
 * @return object
 **/
exports.getSession = function() { return {'valid': app.userIsAdmin, 'maxID': this.maxID+1}; };

/**
 * Check given login and run callback
 * @param string name
 * @param string password
 * @param function callback
 */
exports.checkLogin = function(name, password, callback) {
  var item = {'username': name, 'password': password};
  var found = null;
  for (var i = 0; i < app.admin.length; i++) {
    var cur = app.admin[i];
    if (cur.username == item.username && cur.password == item.password) {
      found = true; continue; }
  }
  return callback(!found);
};

exports.processMongoArticle = function(mongoItem) {
  var fullArticle = {
    // persisted properties
    idHex: mongoItem._id.toHexString(),
    slug: mongoItem.slug || "",
    name: mongoItem.name || "", // aka title!!
    md: mongoItem.md || "", // markdown source of post
    date:  mongoItem.date || new Date(),
    published: mongoItem.published != undefined ? mongoItem.published : false,
    tags: [], // array of { name: 'hello', url: 'hello' },

    // generated properties
    url: "/" + (mongoItem.slug || ""),
    html: mongoItem.html || "", // "usually" generated, but we store imported CBR and Blogger posts as html

    // things we don't yet support or use ...
    words: 1,
    readtime: 1,
    sources: [], 
  };

  var tags = [];
  if (mongoItem.tags) {
    for (var i=0; i<mongoItem.tags.length; i++) {
      tags.push({ 
        name: mongoItem.tags[i],
        url: mongoItem.tags[i], // ahem, urlify??
      });
    }
  }
  fullArticle.tags = tags;

  if (!fullArticle.html) {
    fullArticle.html = this.markdownToHTML(fullArticle.md);
  }

  return fullArticle;
};

var saveSlug = function(idHex, newSlug, collection) {
  var mongoId = {_id: new BSON.ObjectID(idHex)};
  collection.update(mongoId, { $set: { slug: newSlug } }, function(err) {
    if(err) { return console.dir(err); }
  });
};

/**
 * Check for a slug clash or empty slug & sort it out
 **/
var checkSlug = function(idHex, slug, collection) {
  // empty slug - make one!
  if (!slug) {
    var newSlug = "id-" + idHex;
    saveSlug(idHex, newSlug, collection);
  }

  // slug clash - add id!
  collection.find({ slug: slug }).count(function(err, count) {
      if(err) { return console.dir(err); }

      if (count > 1) {
        // clash!
        var newSlug = slug + "-" + idHex;
        saveSlug(idHex, newSlug, collection);
      }
  });
};

/** TODO
 * Update article in db
 * @param object data
 **/
exports.updateArticle = function(data, callback) {
  console.log('updateArticle', data);
  var articleUrl = "";

  var mongoId = data.idHex ? {_id: new BSON.ObjectID(data.idHex)} : null;

  var mongoRecord = {
    md: data.md || "",
    name: data.title || "",
    tags: data.tags ? data.tags.split(" ") : [],
    slug: data.slug || "id" + data.idHex,
    published: (data.published == "true"),
    modified: new Date(),
  };

  // update
  if (mongoId) {
    mongodb.connect(app.mongoConnectionString, function(err, db) {
      if(err) { return console.dir(err); }

      console.log('mongonected, saving ', mongoRecord);

      var collection = db.collection('cbr_content');
      collection.update(mongoId, { $set: mongoRecord }, function(err) {
        checkSlug(data.idHex, data.slug, collection);

        if (!err) {
          articleUrl = "/postid/" + data.idHex;
        }

        callback(articleUrl);
      });
    });
  }
};

/** TODO
 * Create new article
 **/
exports.createNewArticle = function(name, slug, callback) {
  console.log('createNewArticle', name, slug);
  var articleUrl = "";

  var mongoRecord = {
    md: "",
    name: name,
    slug: slug,
    date: new Date(),
  };

  // create
  mongodb.connect(app.mongoConnectionString, function(err, db) {
    if(err) { return console.dir(err); }

    console.log('mongonected, creating ', mongoRecord);

    var collection = db.collection('cbr_content');
    collection.insert(mongoRecord, function(err, docs) {
      if (docs.length == 1 && !err) {
        var doc = docs[0];
        var idHex = doc._id.toHexString();
        checkSlug(idHex, doc.slug, collection);
        articleUrl = "/postid/" + idHex;
      } 

      callback(articleUrl);
    });
  });

};

/**
 * Merge data with needed framework information for jade rendering
 * @param array data
 * @return array
 **/
exports.jadeData = function(data, req) {
  data['session'] = {'valid': req.isAdmin, 'maxID': this.maxID+1};
  data['meta'] = this.meta;
  
  // TODO could add default missing fields here

  return data;
};

/**
 * Create slug from string
 * @param string str
 * @return string
 **/
var toSlug = function(str) {
  str = str.replace(/^\s+|\s+$/g, '');
  str = str.toLowerCase();
  
  var from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
  var to   = "aaaaeeeeiiiioooouuuunc------";
  for (var i=0, l=from.length ; i<l ; i++) { 
    str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i)); }

  return str.replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');

  // TODO uniquify slug - if exists in db add a number

}; exports.toSlug = toSlug;

var getArticlesFromMongo = function(options, callback) {
  var query = options.query || {};
  var sort = options.sort || { date: -1 };
  var mongoOptions = options.mongoOptions || {};
  if (!options.includeDrafts) {
    query.published = true;
  }

  var items = [];
  var err = '';

  mongodb.connect(app.mongoConnectionString, function(err, db) {
    if(err) { return console.dir(err); callback(err, [])}

    var collection = db.collection('cbr_content');

    collection.find(query, mongoOptions).sort(sort).toArray(function(err, items) {
      callback(items, err);
    });
  });
};

/**  
 * Get article (async) by url slug
 * @param string slug
 **/
exports.getArticle = function(slug, includeUnpublished, callback) {
  var article = null;
  var err = '';
  var blogEngine = this;

  var options = { query: { slug: slug }, includeDrafts: includeUnpublished };

  getArticlesFromMongo(options, function(items, err) {
    if(err) { return console.dir(err); callback(article, err) };

    if (items[0]) {
      article = blogEngine.processMongoArticle(items[0]);
    }

    callback(article, err);
  });
};

/**  
 * Get article (async) by id
 * @param string slug
 **/
exports.getArticleById = function(idHex, includeUnpublished, callback) {
  var article = null;
  var err = '';
  var blogEngine = this;
  try {
    var options = { query: { _id: new BSON.ObjectID(idHex) }, includeDrafts: includeUnpublished };

    getArticlesFromMongo(options, function(items, err) {
      if(err) { return console.dir(err); callback(article, err) };

      if (items[0]) {
        article = blogEngine.processMongoArticle(items[0]);
      }

      callback(article, err);
    });
  }
  catch (err) {
    callback(article, err)
  }
};

/** TODO
 * Get articles by tag (async)
 * @param string $tap
 * @return array via callback
 **/
exports.getArticlesByTag = function(tag, includeUnpublished, callback) {
  var articles = [];
  var err = '';
  var blogEngine = this;

  var options = { query: { 'tags' : { $in: [tag] } }, includeDrafts: includeUnpublished };

  getArticlesFromMongo(options, function(items, err) {
    if(err) { return console.dir(err); callback(articles, err) };

      for (var i=0; i<items.length; i++) {
        articles.push(blogEngine.processMongoArticle(items[i]));
      }

    callback(articles, err);
  });
};

/** TODO
 * Get drafts
 * @return array
 **/
exports.getDrafts = function() {
  var data = [];
  
  return data;
};

/** 
 * Get articles
 * @return array via callback
 **/
exports.getArticles = function(pageNumber, includeUnpublished, callback) {
  pageNumber = pageNumber || 0;
  var articles = [];
  var err = '';
  var blogEngine = this;

  var options = { 
    includeDrafts: includeUnpublished,
    mongoOptions: { 
      limit: app.articlesPerPage,  
      skip: app.articlesPerPage * pageNumber
    },
  };

  getArticlesFromMongo(options, function(items, err) {
    if(err) { return console.dir(err); callback(articles, err) };

      for (var i=0; i<items.length; i++) {
        articles.push(blogEngine.processMongoArticle(items[i]));
      }

    callback(articles, err);
  });
};

/**
 * Parse markdown to HTML
 * @param string data
 * @return string
 **/
exports.markdownToHTML = function(data) {
  data = this.md.toHTML(data).replace(/<pre><code>/gi, '<pre>').replace(/<\/code><\/pre>/gi, '</pre>');
  data = data.replace(/<pre>/gi, '<pre class="prettyprint">').replace(/<p><img/g, '<p class="img"><img');
  data = data.replace(/\[\-MORE\-\]/gi, '');
  return data;
};

/** TODO
 * Get Tag cloud
 * @param integer max maximum font size
 * @param integer min minimum font size 
 * @return object
 **/
exports.getTagCloud = function(max, min) {
  var data = {}, numbers = [];

  var sizes = {};

  return sizes;
};

/*
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 */
 var dateFormat = function () {
  var token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
    timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
    timezoneClip = /[^-+\dA-Z]/g,
    pad = function (val, len) {
      val = String(val);
      len = len || 2;
      while (val.length < len) val = "0" + val;
      return val;
    };

  // Regexes and supporting functions are cached through closure
  return function (date, mask, utc) {
    var dF = dateFormat;

    // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
    if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
      mask = date;
      date = undefined;
    }

    // Passing date through Date applies Date.parse, if necessary
    date = date ? new Date(date) : new Date;
    if (isNaN(date)) throw SyntaxError("invalid date");

    mask = String(dF.masks[mask] || mask || dF.masks["default"]);

    // Allow setting the utc argument via the mask
    if (mask.slice(0, 4) == "UTC:") {
      mask = mask.slice(4);
      utc = true;
    }

    var _ = utc ? "getUTC" : "get",
      d = date[_ + "Date"](),
      D = date[_ + "Day"](),
      m = date[_ + "Month"](),
      y = date[_ + "FullYear"](),
      H = date[_ + "Hours"](),
      M = date[_ + "Minutes"](),
      s = date[_ + "Seconds"](),
      L = date[_ + "Milliseconds"](),
      o = utc ? 0 : date.getTimezoneOffset(),
      flags = {
        d:    d,
        dd:   pad(d),
        ddd:  dF.i18n.dayNames[D],
        dddd: dF.i18n.dayNames[D + 7],
        m:    m + 1,
        mm:   pad(m + 1),
        mmm:  dF.i18n.monthNames[m],
        mmmm: dF.i18n.monthNames[m + 12],
        yy:   String(y).slice(2),
        yyyy: y,
        h:    H % 12 || 12,
        hh:   pad(H % 12 || 12),
        H:    H,
        HH:   pad(H),
        M:    M,
        MM:   pad(M),
        s:    s,
        ss:   pad(s),
        l:    pad(L, 3),
        L:    pad(L > 99 ? Math.round(L / 10) : L),
        t:    H < 12 ? "a"  : "p",
        tt:   H < 12 ? "am" : "pm",
        T:    H < 12 ? "A"  : "P",
        TT:   H < 12 ? "AM" : "PM",
        Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
        o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
        S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
      };

    return mask.replace(token, function ($0) {
      return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
    });
  };
}();

// Some common format strings
dateFormat.masks = {
  "default":      "ddd mmm dd yyyy HH:MM:ss",
  shortDate:      "m/d/yy",
  mediumDate:     "mmm d, yyyy",
  longDate:       "mmmm d, yyyy",
  fullDate:       "dddd, mmmm d, yyyy",
  shortTime:      "h:MM TT",
  mediumTime:     "h:MM:ss TT",
  longTime:       "h:MM:ss TT Z",
  isoDate:        "yyyy-mm-dd",
  isoTime:        "HH:MM:ss",
  isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
  isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
  dayNames: [
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
  ],
  monthNames: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
  ]
};

/**
 * Add format() function to Dates
 **/
Date.prototype.format = function (mask, utc) { return dateFormat(this, mask, utc); };

/**
 * Add min() and max() functions to Arrays
 **/
Array.prototype.max = function() { return Math.max.apply(null, this) };
Array.prototype.min = function() { return Math.min.apply(null, this) };

/** 
 * Trim stringt
 * @param string str
 * @return strin
 **/
function trim(str) { return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '').replace(/ +(?= )/g,''); }

/**
 * Strip HTML tags from string
 * @param string input
 * @param string allowed
 * @return string
 **/
function strip_tags (input, allowed) {
  // https://raw.github.com/kvz/phpjs/master/functions/strings/strip_tags.js
  allowed = (((allowed || "") + "").toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join('');
  var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
  return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
    return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
  });
}