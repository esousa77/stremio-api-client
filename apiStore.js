var EventEmitter = require('events');
var AddonCollection = require('stremio-addon-client').AddonCollection;
var officialAddons = require('stremio-official-addons');
var MemoryStorage = require('./lib/memoryStorage');
var ApiClient = require('./apiClient');

var ENDPOINT = 'https://api.strem.io';
var INTERRUPTED_ERROR_MESSAGE = 'request interrupted';

function ApiStore(options) {
    options = options || {}
    var endpoint = options.endpoint || ENDPOINT;
    var storage = options.storage || new MemoryStorage();
    var client = new ApiClient({ endpoint: endpoint, authKey: storage.getJSON('authKey') });
    
    var self = this;

    this.events = new EventEmitter();

    this.user = storage.getJSON('user');

    this.addons = new AddonCollection();
    this.addons.load(storage.getJSON('addons') || officialAddons);

    // only invoked when the user is certainly changed
    // call this with (null, nill) when logging out
    function userChange(authKey, user) {
        storage.setJSON('authKey', authKey);
        storage.setJSON('user', user);
        client = new ApiClient({ endpoint: endpoint, authKey: authKey });
        self.user = user;
        self.events.emit('user-change', user);
    }

    function addonsChange(descriptors, lastModified) {
        storage.setJSON('addons', descriptors);
        storage.setJSON('addonsLastModified', lastModified);
        self.addons.load(descriptors || officialAddons);
        self.events.emit('addons-change');
    }

    this.request = function(method, params) {
        var currentClient = client;
        return new Promise(function(resolve, reject) {
            currentClient.request(method, params)
                .then(function(resp) {
                    if (currentClient !== client) {
                        reject(new Error(INTERRUPTED_ERROR_MESSAGE));
                        return;
                    }

                    resolve(resp);
                })
                .catch(function(err) {
                    if (currentClient !== client) {
                        reject(new Error(INTERRUPTED_ERROR_MESSAGE));
                        return;
                    }

                    reject(err);
                });
        });
    };

    this.loginWithEmail = function(email, password) {
        return this.request('login', { email: email, password: password })
            .then(function(result) {
                userChange(result.authKey, result.user);
                addonsChange(null, null);
            });
    };

    this.register = function(email, password) {
        return this.request('register', { email: email, password: password })
            .then(function(result) {
                userChange(result.authKey, result.user);
                addonsChange(null, null);
            });
    };

    this.logout = function() {
        return this.request('logout')
            .then(function() {
                userChange(null, null);
                addonsChange(null, null);
            })
            .catch(function(err) {
                if (err && err.message !== INTERRUPTED_ERROR_MESSAGE) {
                    userChange(null, null);
                    addonsChange(null, null);
                }
            });
    };

    this.syncAddonCollection = function() {
        var params = { update: true, addFromURL: [] }
        var lastModified = storage.getJSON('addonsLastModified') || 0

        return this.request('addonCollectionGet', params)
            .then(function(resp) {
                if (!Array.isArray(resp.addons)) {
                    throw 'no resp.addons';
                }

                var newLastModified = new Date(resp.lastModified).getTime()
                if (resp.addons.length && newLastModified > lastModified) {
                    addonsChange(resp.addons, newLastModified);
                }
            })
    }
};

module.exports = ApiStore;
