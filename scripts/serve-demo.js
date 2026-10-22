#!/usr/bin/env node
/**
 * Local preview server for the demo (binds 0.0.0.0 so it works in sandboxes/previews).
 * Run: npm run demo  →  http://localhost:8080
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'demo');
const PORT = Number(process.env.PORT) || 8080;

/* ============================================================================
 * سرور دمو — چرا؟
 * ----------------------------------------------------------------------------
 * مرورگرها برای فایل‌های local:// بعضی امکانات را محدود می‌کنند و بعضی
 * پلتفرم‌ها (مثل پیش‌نمایش‌های آنلاین) فقط HTTP را اجرا می‌کنند. این سرور
 * کوچک فقط پوشه‌ی demo را سرو می‌کند؛ چیز پیچیده‌ای ندارد.
 *
 * نکته‌ی امنیتی: مسیرها نرمال‌سازی می‌شوند تا کسی با ../ به بیرون پوشه نرسد.
 * ========================================================================== */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('CyrusAsha_UniversalRTL-1.0.0 demo → http://localhost:' + PORT);
});
