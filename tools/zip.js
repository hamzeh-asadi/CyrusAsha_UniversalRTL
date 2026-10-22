/**
 * Tiny dependency-free ZIP writer (deflate) — used to build the .vsix package.
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');

/* ============================================================================
 * CRC32 چیست؟
 * ----------------------------------------------------------------------------
 * هر فایل داخل ZIP یک «اثر انگشت» ۳۲بیتی دارد (CRC32) که برنامه‌ی بازکننده
 * با آن مطمئن می‌شود فایل سالم است. جدول زیر برای محاسبه‌ی سریع آن ساخته شده.
 * ========================================================================== */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/* ZIP تاریخ را در ۱۶ بیت برای تاریخ و ۱۶ بیت برای ساعت ذخیره می‌کند
 * (فرمت قدیمی MS-DOS). این تابع تاریخ امروز را به آن قالب تبدیل می‌کند. */
function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * entries: [{ name: 'extension/package.json', data: Buffer|string }]
 */
/* ============================================================================
 * createZip — ساخت یک فایل ZIP از یک فهرست فایل
 * ----------------------------------------------------------------------------
 * ورودی: [{ name: 'extension/package.json', data: Buffer|string }, ...]
 * خروجی: نوشتن فایل ZIP در outPath.
 *
 * ساختار هر فایل در ZIP:
 *   [هدر محلی][نام فایل][محتوای فشرده] … سپس در انتها «فهرست مرکزی» و EOCD.
 * فشرده‌سازی با الگوریتم deflate (همان zlib) انجام می‌شود.
 * ========================================================================== */
function createZip(entries, outPath) {
  const now = dosDateTime(new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0x0800, 6);          // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);                // version made by
    cen.writeUInt16LE(20, 6);                // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(now.time, 12);
    cen.writeUInt16LE(now.date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);                // extra
    cen.writeUInt16LE(0, 32);                // comment
    cen.writeUInt16LE(0, 34);                // disk
    cen.writeUInt16LE(0, 36);                // internal attrs
    cen.writeUInt32LE(0, 38);                // external attrs
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, eocd]));
  return outPath;
}

module.exports = { createZip, crc32 };
