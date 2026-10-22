/*
 * CyrusAsha_UniversalRTL-1.0.0 browser-extension bootstrap / پیش‌راه‌انداز افزونه‌ی مرورگر
 *
 * The extension reads its saved switches asynchronously from browser storage.
 * Mark the engine as deferred first so it does not briefly change a page before
 * we know whether the user enabled this specific site.
 *
 * تنظیم‌های افزونه کمی بعد از حافظه‌ی مرورگر خوانده می‌شوند. این علامت به موتور
 * می‌گوید تا زمان رسیدن تنظیم‌ها شروع نشود؛ بنابراین صفحه حتی لحظه‌ای هم پچ
 * نمی‌شود اگر کاربر افزونه یا آن سایت را خاموش کرده باشد.
 */
(function (global) {
  'use strict';

  global.__RTL_UNIVERSAL_DEFER_START__ = true;
  global.__RTL_UNIVERSAL_CONFIG__ = {
    enabled: false,
    mode: 'smart',
    inputs: true,
    monacoChatInput: true
  };
})(typeof window !== 'undefined' ? window : this);
