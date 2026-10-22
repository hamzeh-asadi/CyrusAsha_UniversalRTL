/*
 * Dynamic site access / دسترسی پویا به سایت‌های دلخواه
 *
 * Custom domains are registered only after the user grants that exact HTTPS
 * host from the popup. No broad host permission is requested at installation.
 *
 * دامنه‌های دلخواه فقط پس از تأیید همان دامنه‌ی HTTPS در پنجره‌ی افزونه ثبت
 * می‌شوند؛ هنگام نصب، مجوز دسترسی همگانی به سایت‌ها درخواست نمی‌شود.
 */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'rtlUniversalSettings';
  var SCRIPT_ID = 'cyrusasha-universalrtl-custom-sites';
  var JS_FILES = ['site-config.js', 'bootstrap.js', 'rtl-engine.js', 'content.js'];
  var extensionApi = getExtensionApi();
  var syncQueue = Promise.resolve();

  function getExtensionApi() {
    if (typeof browser !== 'undefined' && browser.storage && browser.scripting) {
      return { root: browser, promise: true };
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.scripting) {
      return { root: chrome, promise: false };
    }
    return null;
  }

  function call(target, method, args) {
    if (!target || typeof target[method] !== 'function') {
      return Promise.reject(new Error('Missing extension API: ' + method));
    }
    if (extensionApi.promise) {
      try { return Promise.resolve(target[method].apply(target, args || [])); }
      catch (error) { return Promise.reject(error); }
    }
    return new Promise(function (resolve, reject) {
      var callback = function (result) {
        var lastError = extensionApi.root.runtime && extensionApi.root.runtime.lastError;
        if (lastError) reject(new Error(lastError.message));
        else resolve(result);
      };
      try { target[method].apply(target, (args || []).concat(callback)); }
      catch (error) { reject(error); }
    });
  }

  function normalizeHost(value) {
    var host = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host || host.length > 253 || host.indexOf('*') !== -1 || host.indexOf('/') !== -1) return null;
    if (host.charAt(0) === '[' || host.indexOf(':') !== -1) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host) &&
        !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && host !== 'localhost') return null;
    return host;
  }

  function getSettings() {
    return call(extensionApi.root.storage.local, 'get', [SETTINGS_KEY]).then(function (items) {
      return items && items[SETTINGS_KEY] && typeof items[SETTINGS_KEY] === 'object'
        ? items[SETTINGS_KEY] : {};
    });
  }

  function syncCustomSites() {
    if (!extensionApi) return Promise.resolve();
    var run = syncQueue.catch(function () {}).then(async function () {
      var settings = await getSettings();
      var existing = await call(extensionApi.root.scripting, 'getRegisteredContentScripts', [{ ids: [SCRIPT_ID] }]);
      if (existing && existing.length) {
        await call(extensionApi.root.scripting, 'unregisterContentScripts', [{ ids: [SCRIPT_ID] }]);
      }

      if (settings.enabled === false) return;
      var customSites = Array.isArray(settings.customSites) ? settings.customSites : [];
      var siteSwitches = settings.sites && typeof settings.sites === 'object' ? settings.sites : {};
      var matches = [];
      for (var i = 0; i < customSites.length; i++) {
        var host = normalizeHost(customSites[i] && customSites[i].host);
        if (!host) continue;
        var id = 'custom:' + host;
        if (siteSwitches[id] === false) continue;
        var pattern = 'https://' + host + '/*';
        var granted = await call(extensionApi.root.permissions, 'contains', [{ origins: [pattern] }]);
        if (granted && matches.indexOf(pattern) === -1) matches.push(pattern);
      }
      if (!matches.length) return;

      var registration = {
        id: SCRIPT_ID,
        matches: matches,
        js: JS_FILES,
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true
      };
      await call(extensionApi.root.scripting, 'registerContentScripts', [[registration]]);
    });
    syncQueue = run.catch(function (error) {
      try { console.warn('[CyrusAsha_UniversalRTL] Could not sync custom-site scripts:', error); }
      catch (ignored) { /* background logs are optional */ }
    });
    return syncQueue;
  }

  function addListener(event, callback) {
    if (event && typeof event.addListener === 'function') event.addListener(callback);
  }

  if (!extensionApi) return;
  addListener(extensionApi.root.runtime && extensionApi.root.runtime.onInstalled, syncCustomSites);
  addListener(extensionApi.root.runtime && extensionApi.root.runtime.onStartup, syncCustomSites);
  addListener(extensionApi.root.storage.onChanged, function (changes, areaName) {
    if (areaName === 'local' && changes && changes[SETTINGS_KEY]) syncCustomSites();
  });
  addListener(extensionApi.root.permissions && extensionApi.root.permissions.onAdded, syncCustomSites);
  addListener(extensionApi.root.permissions && extensionApi.root.permissions.onRemoved, syncCustomSites);

  // Expose a narrow hook for deterministic tests; it is not reachable from web pages.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeHost: normalizeHost, syncCustomSites: syncCustomSites, SCRIPT_ID: SCRIPT_ID };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
