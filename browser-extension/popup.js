/*
 * Popup behaviour / رفتار پنجره‌ی تنظیمات
 *
 * The popup stores only extension preferences and the exact HTTPS hosts the
 * user chose to add. Chat content is never stored or sent anywhere.
 *
 * پنجره فقط تنظیمات افزونه و میزبان‌های HTTPS انتخاب‌شده را ذخیره می‌کند؛
 * محتوای گفت‌وگو نه ذخیره می‌شود و نه جایی فرستاده می‌شود.
 */
(function () {
  'use strict';

  var SETTINGS_KEY = 'rtlUniversalSettings';
  var MAX_CUSTOM_SITES = 50;
  var SITES = window.RTL_UNIVERSAL_SITES || [];
  var STRINGS = {
    fa: {
      subtitle: 'راست‌چین هوشمند چت‌های وب',
      master: 'افزونه فعال است',
      masterOff: 'افزونه خاموش است',
      masterHint: 'برای سایت‌های انتخاب‌شده',
      modeLabel: 'حالت جهت‌دهی',
      smart: 'هوشمند — تشخیص از متن هر پیام',
      rtl: 'همه‌چیز راست‌چین',
      ltr: 'همه‌چیز چپ‌چین',
      sitesTitle: 'سایت‌های پشتیبانی‌شده',
      customTitle: 'افزودن سایت دلخواه',
      customHelp: 'دامنه یا نشانی HTTPS را وارد کن. مجوز فقط برای همان میزبان درخواست می‌شود و همه‌ی مسیرهای همان دامنه را شامل می‌شود.',
      customPlaceholder: 'https://chat.example.com',
      customInputLabel: 'دامنه یا نشانی HTTPS سایت دلخواه',
      addSite: 'افزودن',
      removeSite: 'حذف',
      enabledSite: 'فعال‌سازی این سایت',
      emptyCustom: 'هنوز سایتی اضافه نشده است.',
      invalidSite: 'دامنه یا نشانی معتبر وارد کن.',
      httpsOnly: 'فقط سایت‌های HTTPS پشتیبانی می‌شوند.',
      siteExists: 'این سایت از قبل در فهرست سایت‌ها وجود دارد.',
      permissionDenied: 'مجوز این دامنه داده نشد؛ سایت اضافه نشد.',
      permissionUnavailable: 'مرورگر API لازم برای مجوز سایت را ارائه نکرد.',
      addedCustom: 'سایت اضافه شد؛ صفحه را بارگذاری مجدد کن تا افزونه اجرا شود.',
      removedCustom: 'سایت حذف شد و مجوز دسترسی لغو شد.',
      removedPermissionLeft: 'سایت از فهرست افزونه حذف شد، اما مجوز مرورگر لغو نشد؛ دسترسی سایت را در تنظیمات افزونه بررسی کن.',
      tooManySites: 'حداکثر ۵۰ سایت دلخواه می‌توان افزود.',
      contactTitle: 'راه‌های ارتباط با سازنده',
      privacy: 'متن صفحه فقط برای تشخیص جهت روی دستگاه پردازش می‌شود؛ هیچ گفت‌وگویی ذخیره یا ارسال نمی‌شود.',
      saved: 'تنظیم ذخیره شد',
      failed: 'ذخیره‌ی تنظیم ناموفق بود؛ دوباره تلاش کن.'
    },
    en: {
      subtitle: 'Smart RTL for web AI chats',
      master: 'Extension is on',
      masterOff: 'Extension is off',
      masterHint: 'For selected websites',
      modeLabel: 'Direction mode',
      smart: 'Smart — detect each message',
      rtl: 'Force everything RTL',
      ltr: 'Force everything LTR',
      sitesTitle: 'Supported websites',
      customTitle: 'Add a custom site',
      customHelp: 'Enter an HTTPS domain or URL. Permission is requested only for that host and covers all paths on it.',
      customPlaceholder: 'https://chat.example.com',
      customInputLabel: 'HTTPS domain or URL for a custom site',
      addSite: 'Add',
      removeSite: 'Remove',
      enabledSite: 'Enable this site',
      emptyCustom: 'No custom sites added yet.',
      invalidSite: 'Enter a valid domain or URL.',
      httpsOnly: 'Only HTTPS websites are supported.',
      siteExists: 'This host is already in the website list.',
      permissionDenied: 'Permission was not granted; the site was not added.',
      permissionUnavailable: 'The browser does not expose the required site-permission API.',
      addedCustom: 'Site added. Reload the page for the extension to start.',
      removedCustom: 'Site removed and its host permission revoked.',
      removedPermissionLeft: 'The site was removed from the list, but the browser permission could not be revoked. Review the extension’s site access settings.',
      tooManySites: 'You can add up to 50 custom sites.',
      contactTitle: 'Contact the developer',
      privacy: 'Page text is processed locally only to determine direction; conversations are never stored or sent.',
      saved: 'Settings saved',
      failed: 'Could not save settings. Please try again.'
    }
  };
  var DEFAULTS = {
    enabled: true,
    mode: 'smart',
    inputs: true,
    monacoChatInput: true,
    language: defaultLanguage(),
    sites: {},
    customSites: []
  };
  var state = null;
  var api = getExtensionApi();

  function defaultLanguage() {
    return /^fa(?:-|$)/i.test(navigator.language || '') ? 'fa' : 'en';
  }

  function getExtensionApi() {
    if (typeof browser !== 'undefined' && browser.storage) return { root: browser, promise: true };
    if (typeof chrome !== 'undefined' && chrome.storage) return { root: chrome, promise: false };
    return null;
  }

  function getSavedSettings() {
    if (!api) return Promise.resolve(null);
    if (api.promise) {
      return api.root.storage.local.get(SETTINGS_KEY).then(function (items) {
        return items[SETTINGS_KEY] || null;
      });
    }
    return new Promise(function (resolve, reject) {
      api.root.storage.local.get(SETTINGS_KEY, function (items) {
        var error = api.root.runtime && api.root.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(items[SETTINGS_KEY] || null);
      });
    });
  }

  function saveSettings() {
    if (!api) return Promise.reject(new Error('storage API is unavailable'));
    var record = {};
    record[SETTINGS_KEY] = state;
    if (api.promise) return api.root.storage.local.set(record);
    return new Promise(function (resolve, reject) {
      api.root.storage.local.set(record, function () {
        var error = api.root.runtime && api.root.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve();
      });
    });
  }

  function normalizeHost(value) {
    var host = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host || host.length > 253 || host.indexOf('*') !== -1 || host.indexOf('/') !== -1 || host.indexOf(':') !== -1) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host) &&
        !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && host !== 'localhost') return null;
    return host;
  }

  function customSiteFromHost(host) {
    return { id: 'custom:' + host, host: host, origin: 'https://' + host, pattern: 'https://' + host + '/*' };
  }

  function isBuiltInHost(host) {
    var fullHostPattern = 'https://' + host + '/*';
    // Some built-in sites are intentionally restricted to one path (e.g. the
    // Grok route on x.com). Let users add that host explicitly for other paths.
    return SITES.some(function (site) {
      return site.hosts.indexOf(host) !== -1 && site.matches.indexOf(fullHostPattern) !== -1;
    });
  }

  function parseCustomSite(value) {
    var raw = String(value || '').trim();
    if (!raw) return { error: 'invalidSite' };
    var candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
    var url;
    try { url = new URL(candidate); }
    catch (e) { return { error: 'invalidSite' }; }
    if (url.protocol !== 'https:') return { error: 'httpsOnly' };
    if (url.username || url.password || (url.port && url.port !== '443')) return { error: 'invalidSite' };
    var host = normalizeHost(url.hostname);
    if (!host) return { error: 'invalidSite' };
    if (isBuiltInHost(host)) return { error: 'siteExists' };
    return { site: customSiteFromHost(host) };
  }

  function normalizeCustomSites(items) {
    if (!Array.isArray(items)) return [];
    var seen = Object.create(null);
    var result = [];
    items.forEach(function (item) {
      var host = normalizeHost(item && item.host);
      if (!host || isBuiltInHost(host) || seen[host]) return;
      seen[host] = true;
      result.push(customSiteFromHost(host));
    });
    return result;
  }

  function normalizeSettings(saved) {
    saved = saved && typeof saved === 'object' ? saved : {};
    return {
      enabled: saved.enabled !== false,
      mode: ['smart', 'rtl', 'ltr'].indexOf(saved.mode) !== -1 ? saved.mode : DEFAULTS.mode,
      inputs: saved.inputs !== false,
      monacoChatInput: saved.monacoChatInput !== false,
      language: saved.language === 'fa' || saved.language === 'en' ? saved.language : DEFAULTS.language,
      sites: saved.sites && typeof saved.sites === 'object' ? saved.sites : {},
      customSites: normalizeCustomSites(saved.customSites)
    };
  }

  function text(key) {
    return STRINGS[state.language][key] || key;
  }

  function applyLanguage() {
    var language = state.language;
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-text]').forEach(function (element) {
      element.textContent = text(element.getAttribute('data-text'));
    });
    document.getElementById('custom-site-input').placeholder = text('customPlaceholder');
    document.getElementById('custom-site-input').setAttribute('aria-label', text('customInputLabel'));
    document.getElementById('language-toggle').textContent = language === 'fa' ? 'EN' : 'فا';
    document.getElementById('language-toggle').setAttribute('aria-label', language === 'fa' ? 'Switch language to English' : 'تغییر زبان به فارسی');
  }

  function setNotice(message, isError) {
    var notice = document.getElementById('notice');
    notice.textContent = message || '';
    notice.classList.toggle('error', !!isError);
  }

  function renderSites() {
    var list = document.getElementById('site-list');
    list.textContent = '';
    document.getElementById('site-count').textContent = String(SITES.length);

    SITES.forEach(function (site) {
      var row = document.createElement('label');
      row.className = 'site-item';
      var label = document.createElement('span');
      label.textContent = site.label[state.language] || site.id;
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.sites[site.id] !== false;
      checkbox.setAttribute('aria-label', label.textContent);
      checkbox.addEventListener('change', function () {
        state.sites[site.id] = checkbox.checked;
        persist();
      });
      row.appendChild(label);
      row.appendChild(checkbox);
      list.appendChild(row);
    });
  }

  function renderCustomSites() {
    var list = document.getElementById('custom-site-list');
    list.textContent = '';
    document.getElementById('custom-site-count').textContent = String(state.customSites.length);
    if (!state.customSites.length) {
      var empty = document.createElement('div');
      empty.className = 'custom-empty';
      empty.textContent = text('emptyCustom');
      list.appendChild(empty);
      return;
    }

    state.customSites.forEach(function (site) {
      var row = document.createElement('div');
      row.className = 'custom-site-item';
      row.dataset.siteId = site.id;
      var host = document.createElement('span');
      host.className = 'custom-site-host';
      host.textContent = site.host;
      var label = document.createElement('label');
      label.className = 'switch';
      label.setAttribute('aria-label', text('enabledSite') + ': ' + site.host);
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.sites[site.id] !== false;
      checkbox.addEventListener('change', function () {
        state.sites[site.id] = checkbox.checked;
        persist();
      });
      var slider = document.createElement('span');
      slider.className = 'slider';
      label.appendChild(checkbox);
      label.appendChild(slider);
      var remove = document.createElement('button');
      remove.className = 'custom-site-remove';
      remove.type = 'button';
      remove.textContent = text('removeSite');
      remove.setAttribute('aria-label', text('removeSite') + ': ' + site.host);
      remove.addEventListener('click', function () { removeCustomSite(site); });
      row.appendChild(host);
      row.appendChild(label);
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function render() {
    applyLanguage();
    var enabled = document.getElementById('enabled');
    enabled.checked = state.enabled;
    document.getElementById('master-label').textContent = state.enabled ? text('master') : text('masterOff');
    document.getElementById('mode').value = state.mode;
    renderSites();
    renderCustomSites();
  }

  function persist() {
    setNotice('');
    saveSettings().then(function () {
      setNotice(text('saved'), false);
    }).catch(function () {
      setNotice(text('failed'), true);
    });
  }

  function requestHostPermission(pattern) {
    if (!api || !api.root.permissions || typeof api.root.permissions.request !== 'function') {
      return Promise.resolve(false);
    }
    if (api.promise) return api.root.permissions.request({ origins: [pattern] });
    return new Promise(function (resolve) {
      api.root.permissions.request({ origins: [pattern] }, function (granted) {
        var error = api.root.runtime && api.root.runtime.lastError;
        resolve(!error && !!granted);
      });
    });
  }

  function removeHostPermission(pattern) {
    if (!api || !api.root.permissions || typeof api.root.permissions.remove !== 'function') {
      return Promise.resolve(false);
    }
    if (api.promise) return api.root.permissions.remove({ origins: [pattern] });
    return new Promise(function (resolve) {
      api.root.permissions.remove({ origins: [pattern] }, function (removed) {
        var error = api.root.runtime && api.root.runtime.lastError;
        resolve(!error && !!removed);
      });
    });
  }

  function addCustomSite() {
    setNotice('');
    var parsed = parseCustomSite(document.getElementById('custom-site-input').value);
    if (parsed.error) {
      setNotice(text(parsed.error), true);
      return;
    }
    var site = parsed.site;
    if (state.customSites.some(function (item) { return item.host === site.host; })) {
      setNotice(text('siteExists'), true);
      return;
    }
    if (state.customSites.length >= MAX_CUSTOM_SITES) {
      setNotice(text('tooManySites'), true);
      return;
    }
    if (!api || !api.root.permissions) {
      setNotice(text('permissionUnavailable'), true);
      return;
    }

    var button = document.getElementById('add-custom-site');
    button.disabled = true;
    // Call permissions.request synchronously within the submit gesture.
    var request;
    try { request = requestHostPermission(site.pattern); }
    catch (error) { request = Promise.resolve(false); }
    Promise.resolve(request).then(function (granted) {
      if (!granted) {
        setNotice(text('permissionDenied'), true);
        return;
      }
      state.customSites.push(site);
      state.sites[site.id] = true;
      return saveSettings().then(function () {
        document.getElementById('custom-sites').open = true;
        document.getElementById('custom-site-input').value = '';
        renderCustomSites();
        setNotice(text('addedCustom'), false);
      }).catch(function () {
        state.customSites = state.customSites.filter(function (item) { return item.id !== site.id; });
        delete state.sites[site.id];
        removeHostPermission(site.pattern).catch(function () { /* best-effort permission rollback */ });
        renderCustomSites();
        setNotice(text('failed'), true);
      });
    }).catch(function () {
      setNotice(text('permissionDenied'), true);
    }).then(function () {
      button.disabled = false;
    });
  }

  function removeCustomSite(site) {
    var oldSites = state.customSites.slice();
    var oldSiteSetting = state.sites[site.id];
    state.customSites = state.customSites.filter(function (item) { return item.id !== site.id; });
    delete state.sites[site.id];
    setNotice('');
    saveSettings().then(function () {
      renderCustomSites();
      return removeHostPermission(site.pattern).then(function (removed) {
        setNotice(text(removed ? 'removedCustom' : 'removedPermissionLeft'), !removed);
      }).catch(function () {
        setNotice(text('removedPermissionLeft'), true);
      });
    }).catch(function () {
      state.customSites = oldSites;
      if (oldSiteSetting !== undefined) state.sites[site.id] = oldSiteSetting;
      renderCustomSites();
      setNotice(text('failed'), true);
    });
  }

  document.getElementById('enabled').addEventListener('change', function (event) {
    state.enabled = event.target.checked;
    render();
    persist();
  });
  document.getElementById('mode').addEventListener('change', function (event) {
    state.mode = event.target.value;
    persist();
  });
  document.getElementById('language-toggle').addEventListener('click', function () {
    state.language = state.language === 'fa' ? 'en' : 'fa';
    render();
    persist();
  });
  document.getElementById('custom-site-form').addEventListener('submit', function (event) {
    event.preventDefault();
    addCustomSite();
  });

  getSavedSettings().then(function (saved) {
    state = normalizeSettings(saved);
    render();
  }).catch(function () {
    state = normalizeSettings(null);
    render();
    setNotice(text('failed'), true);
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseCustomSite: parseCustomSite, normalizeSettings: normalizeSettings };
  }
})();
