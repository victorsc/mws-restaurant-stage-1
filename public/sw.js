'use strict';

(function () {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function (resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function (value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function (prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function get() {
          return this[targetProp][prop];
        },
        set: function set(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function (prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function () {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', ['name', 'keyPath', 'multiEntry', 'unique']);

  proxyRequestMethods(Index, '_index', IDBIndex, ['get', 'getKey', 'getAll', 'getAllKeys', 'count']);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, ['openCursor', 'openKeyCursor']);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', ['direction', 'key', 'primaryKey', 'value']);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, ['update', 'delete']);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function (methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function () {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function () {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function (value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function () {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function () {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', ['name', 'keyPath', 'indexNames', 'autoIncrement']);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, ['put', 'add', 'delete', 'clear', 'get', 'getAll', 'getKey', 'getAllKeys', 'count']);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, ['openCursor', 'openKeyCursor']);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, ['deleteIndex']);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function (resolve, reject) {
      idbTransaction.oncomplete = function () {
        resolve();
      };
      idbTransaction.onerror = function () {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function () {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function () {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', ['objectStoreNames', 'mode']);

  proxyMethods(Transaction, '_tx', IDBTransaction, ['abort']);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function () {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', ['name', 'version', 'objectStoreNames']);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, ['deleteObjectStore', 'close']);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function () {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', ['name', 'version', 'objectStoreNames']);

  proxyMethods(DB, '_db', IDBDatabase, ['close']);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function (funcName) {
    [ObjectStore, Index].forEach(function (Constructor) {
      // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
      if (!(funcName in Constructor.prototype)) return;

      Constructor.prototype[funcName.replace('open', 'iterate')] = function () {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function () {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function (Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function (query, count) {
      var instance = this;
      var items = [];

      return new Promise(function (resolve) {
        instance.iterateCursor(query, function (cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function open(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      if (request) {
        request.onupgradeneeded = function (event) {
          if (upgradeCallback) {
            upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
          }
        };
      }

      return p.then(function (db) {
        return new DB(db);
      });
    },
    delete: function _delete(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
    module.exports.default = module.exports;
  } else {
    self.idb = exp;
  }
})();
'use strict';

function createDB() {
  return idb.open('restaurants-db', 1, function (upgradeDb) {
    if (!upgradeDb.objectStoreNames.contains('restaurants')) {
      upgradeDb.createObjectStore('restaurants', { keyPath: 'id' });
    }
    if (!upgradeDb.objectStoreNames.contains('reviews')) {
      var reviewsOS = upgradeDb.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
      reviewsOS.createIndex('restaurant_id', 'restaurant_id', { unique: false });
    }
    if (!upgradeDb.objectStoreNames.contains('outbox')) {
      upgradeDb.createObjectStore('outbox', { autoIncrement: true, keyPath: 'id' });
    }
  });
}

var restaurantDb = createDB();

function saveRestaurantsDataLocally(restaurants) {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('restaurants', 'readwrite');
    var store = tx.objectStore('restaurants');
    return Promise.all(restaurants.map(function (restaurant) {
      return store.put(restaurant);
    })).catch(function () {
      tx.abort();
      throw Error('Restaurants not added.');
    });
  });
}

function saveReviewsDataLocally(reviews) {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('reviews', 'readwrite');
    var store = tx.objectStore('reviews');
    return Promise.all(reviews.map(function (review) {
      return store.put(review);
    })).catch(function () {
      tx.abort();
      throw Error('Reviews not added.');
    });
  });
}

function getLocalRestaurantsData() {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('restaurants', 'readonly');
    var store = tx.objectStore('restaurants');
    return store.getAll();
  });
}

function getLocalReviewsData(id) {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('reviews', 'readonly');
    var store = tx.objectStore('reviews');
    var index = store.index('restaurant_id');
    return index.getAll(id);
  });
}

function putReviewInOutbox(review) {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('outbox', 'readwrite');
    return tx.objectStore('outbox').put(review);
  });
}

function getReviewsFromOutbox() {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('outbox', 'readonly');
    return tx.objectStore('outbox').getAll();
  });
}

function deleteReviewFromOutbox(id) {
  return restaurantDb.then(function (db) {
    var tx = db.transaction('outbox', 'readwrite');
    return tx.objectStore('outbox').delete(id);
  });
}
"use strict";

var restaurants = [];
for (var i = 1; i <= 10; i++) {
  restaurants.push("img/" + i + "_300.jpg");
  restaurants.push("img/" + i + "_800.jpg");
  restaurants.push("restaurant.html?id=" + i);
}

var urlsToCache = ['/', 'js/main.min.js', 'js/restaurant.min.js', 'css/styles.css'].concat(restaurants);

var CACHE_V1 = 'myCache';

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_V1).then(function (cache) {
    return cache.addAll(urlsToCache);
  }));
});

self.addEventListener('fetch', function (event) {
  event.respondWith(caches.match(event.request).then(function (response) {
    return response || fetch(event.request);
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (cacheNames) {
    return Promise.all(cacheNames.map(function (cacheName) {
      if (cacheName !== CACHE_V1) {
        return caches.delete(cacheName);
      }
    }));
  }));
});

self.addEventListener('sync', function (event) {
  console.log('im in the sync');
  if (event.tag == 'sendRestaurantReview') {
    event.waitUntil(getReviewsFromOutbox().then(function (reviews) {
      console.log('sending reviews');
      return Promise.all(reviews.map(function (review) {
        var headers = new Headers({ 'Content-Type': 'application/json' });
        var body = JSON.stringify(review);
        return fetch('http://localhost:1337/reviews/', {
          method: 'POST',
          headers: headers,
          body: body
        }).then(function (response) {
          console.log('review sent');
          return response.json();
        }).then(function (data) {
          if (data.result === 'success') {
            console.log('deleting reviews from idb');
            return deleteReviewFromOutbox(review.id);
          }
        });
      })).catch(function (err) {
        console.log(err);
      });
    }));
  }
});
//# sourceMappingURL=sw.js.map
