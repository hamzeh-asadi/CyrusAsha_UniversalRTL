/*
 * Content-side settings bridge / پل تنظیمات در صفحه‌ی وب
 *
 * This script runs in the browser's isolated extension world. Built-in domains
 * come from the generated site list; custom domains are accepted only when the
 * user saved that exact HTTPS host in the popup.
 *
 * این کد در فضای جداشده‌ی افزونه اجرا می‌شود. دامنه‌های آماده از فهرست پروژه
 * می‌آیند؛ دامنه‌ی دلخواه فقط وقتی پذیرفته می‌شود که کاربر همان میزبان HTTPS را
 * در پنجره‌ی افزونه افزوده باشد.
 */
(function (global) {
  'use strict';

  var SITES = global.RTL_UNIVERSAL_SITES || [];
  var hostname = String(location.hostname || '').toLowerCase().replace(/\.$/, '');
  var builtInSite = null;

  for (var i = 0; i < SITES.length; i++) {
    if (SITES[i].hosts.indexOf(hostname) !== -1) {
      builtInSite = SITES[i];
      break;
    }
  }

  var SETTINGS_KEY = 'rtlUniversalSettings';
  var DEFAULTS = {
    enabled: true,
    mode: 'smart',
    inputs: true,
    monacoChatInput: true,
    sites: {},
    customSites: []
  };
  var extensionApi = getExtensionApi();
  var engine = global.RTLUniversal;

  /* Firefox exposes promise-based `browser`; Chrome uses callback-style
   * `chrome`. One source file supports both APIs. */
  function getExtensionApi() {
    if (typeof browser !== 'undefined' && browser.storage) return { api: browser, promise: true };
    if (typeof chrome !== 'undefined' && chrome.storage) return { api: chrome, promise: false };
    return null;
  }

  function readSettings() {
    if (!extensionApi) return Promise.resolve(null);
    if (extensionApi.promise) {
      return extensionApi.api.storage.local.get(SETTINGS_KEY).then(function (data) {
        return data[SETTINGS_KEY] || null;
      });
    }
    return new Promise(function (resolve, reject) {
      extensionApi.api.storage.local.get(SETTINGS_KEY, function (data) {
        var error = extensionApi.api.runtime && extensionApi.api.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(data[SETTINGS_KEY] || null);
      });
    });
  }

  function normalizeSettings(saved) {
    saved = saved && typeof saved === 'object' ? saved : {};
    var mode = ['smart', 'rtl', 'ltr'].indexOf(saved.mode) !== -1 ? saved.mode : DEFAULTS.mode;
    return {
      enabled: saved.enabled !== false,
      mode: mode,
      inputs: saved.inputs !== false,
      monacoChatInput: saved.monacoChatInput !== false,
      sites: saved.sites && typeof saved.sites === 'object' ? saved.sites : {},
      customSites: Array.isArray(saved.customSites) ? saved.customSites.filter(function (site) {
        return site && typeof site.host === 'string';
      }) : []
    };
  }

  function findCustomSite(settings) {
    for (var i = 0; i < settings.customSites.length; i++) {
      var site = settings.customSites[i];
      var host = String(site.host || '').toLowerCase().replace(/\.$/, '');
      if (host === hostname) return { id: 'custom:' + host, host: host };
    }
    return null;
  }

  function applySettings(saved) {
    if (!engine) return;
    var settings = normalizeSettings(saved);
    var currentSite = builtInSite || findCustomSite(settings);
    if (!currentSite) {
      // The user removed this custom domain while its tab was open.
      if (engine.config && engine.config.enabled) engine.disable();
      return;
    }

    var shouldEnable = settings.enabled && settings.sites[currentSite.id] !== false;
    var config = {
      mode: settings.mode,
      inputs: settings.inputs,
      monacoChatInput: settings.monacoChatInput
    };

    /* Keep the engine stopped while its settings are copied. If this is its
     * first start, enable() attaches the MutationObserver exactly once. */
    if (shouldEnable && !engine.config.enabled) {
      engine.setConfig(Object.assign({}, config, { enabled: false }));
      engine.enable();
    } else {
      engine.setConfig(Object.assign({}, config, { enabled: shouldEnable }));
    }
  }

  /* Storage failures fall back to the safe defaults without network access. */
  readSettings().then(applySettings).catch(function () { applySettings(DEFAULTS); });

  if (extensionApi && extensionApi.api.storage.onChanged) {
    extensionApi.api.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
      applySettings(changes[SETTINGS_KEY].newValue);
    });
  }
})(typeof window !== 'undefined' ? window : this);
