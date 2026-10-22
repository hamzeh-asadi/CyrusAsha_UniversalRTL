/**
 * asar.js — خواندن و نوشتن فایل app.asar بدون هیچ کتابخانه‌ی خارجی
 * ============================================================================
 * app.asar چیست؟
 * ----------------------------------------------------------------------------
 * اپ‌های Electron یک فایل «آرشیو» به نام app.asar دارند که داخلش همه‌ی فایل‌های
 * برنامه (کد جاوااسکریپت، HTML، CSS…) بسته‌بندی شده است. ساختار آن ساده است:
 *
 *   ┌──────────────────────────────┐
 *   │ ۸ بایت هدر بیرونی            │  ← دو عدد ۳۲بیتی: [4][طول هدر داخلی]
 *   ├──────────────────────────────┤
 *   │ هدر داخلی (JSON درختی)       │  ← نام فایل‌ها + size + offset هر فایل
 *   ├──────────────────────────────┤
 *   │ محتوای فایل‌ها (پشت سر هم)    │  ← offset هر فایل از اینجا حساب می‌شود
 *   └──────────────────────────────┘
 *
 * مفهوم offset: فاصله‌ی بایتِ شروع فایل از ابتدای «ناحیه‌ی محتوا».
 * برای خواندن فایل شماره k:  از (هدر + offset) تا (هدر + offset + size).
 *
 * چرا خودمان نوشتیم؟ تا پچر بدون npm و بدون اینترنت هم کار کند.
 * سازگاری این پیاده‌سازی با کتابخانه‌ی رسمی @electron/asar در
 * test/asar.test.js تأیید شده است.
 *
 * License: MIT
 */'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB, same as Electron's asar integrity block size

/* ------------------------------------------------------------------ *
 * Pickle helpers (Chromium base::Pickle subset)
 * ------------------------------------------------------------------ */
/* همه‌ی عددهای ساختار ASAR باید مضرب ۴ باشند (alignment).
 * مثلاً ۵ → ۸ و ۱۲ → ۱۲. */
function align4(n) { return (n + 3) & ~3; }

/* تبدیل عدد به «varint» (عدد متغیرطول).
 * فعلاً در نسخه‌ی فعلی استفاده نمی‌شود اما برای سازگاری با نسخه‌های
 * آینده‌ی فرمت نگه داشته شده است. */
function encodeVarint(n) {
  const out = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n & 0x7f);
  return Buffer.from(out);
}

/* ساخت هدر ASAR از رشته‌ی JSON.
 * فرمت هدر در Chromium به شکل «Pickle» است: هر بخش با طول خودش شروع می‌شود.
 * اگر integrity داده شود، بلوک هش SHA-256 هم به هدر اضافه می‌شود
 * (Electron با آن مطمئن می‌شود فایل‌ها دستکاری نشده‌اند). */
function encodeHeader(jsonString, integrityObject) {
  const json = Buffer.from(jsonString, 'utf8');
  const jsonPad = align4(json.length);
  const stringPayload = 4 + jsonPad;
  let middleSize = 4 + stringPayload; // middle payload_size field + string pickle
  const middle = Buffer.alloc(4 + stringPayload);
  middle.writeUInt32LE(stringPayload, 0);       // payload size of the header pickle
  middle.writeUInt32LE(json.length, 4);         // string length
  json.copy(middle, 8);

  if (integrityObject) {
    const iStr = Buffer.from(JSON.stringify(integrityObject), 'utf8');
    const iPad = align4(iStr.length);
    const iPickle = Buffer.alloc(8 + iPad);
    iPickle.writeUInt32LE(4 + iPad, 0);         // payload size
    iPickle.writeUInt32LE(iStr.length, 4);      // string length
    iStr.copy(iPickle, 8);
    middleSize += iPickle.length;
    const both = Buffer.concat([middle, iPickle]);
    both.writeUInt32LE(middleSize - 4, 0);      // update middle payload size
    return finishHeader(both, middleSize);
  }
  return finishHeader(middle, middleSize);
}

/* دو لایه‌ی طول را به هدر اضافه می‌کند:
 *   [۴ بایت: طول کل هدر داخلی][۴ بایت: طول middle][middle]
 * این همان ساختاری است که Electron انتظار دارد. */
function finishHeader(middle, middleSize) {
  const outer = Buffer.alloc(8 + middleSize);
  outer.writeUInt32LE(4, 0);          // outer pickle: header size = 4
  outer.writeUInt32LE(middleSize, 4); // outer payload = middle buffer length
  middle.copy(outer, 8);
  return outer;
}

/* عکس encodeHeader: بایت‌های یک آرشیو را می‌گیرد و JSON هدر را برمی‌گرداند.
 * خروجی: { header, headerSize } — headerSize برای محاسبه‌ی ناحیه‌ی محتوا لازم است. */
function decodeHeader(fileBuffer) {
  const outerSize = fileBuffer.readUInt32LE(4); // length of the middle pickle
  const middle = fileBuffer.subarray(8, 8 + outerSize);
  const strLen = middle.readUInt32LE(4);
  const headerString = middle.subarray(8, 8 + strLen).toString('utf8');
  return { header: JSON.parse(headerString), headerSize: outerSize };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */
/* فقط هدر را از دیسک می‌خواند (بدون بارگذاری کل فایل).
 * روی فایل‌های چند صد مگابایتی هم سریع است چون فقط چند کیلوبایت می‌خواند. */
function readHeader(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    if (sizeBuf.readUInt32LE(0) !== 4) throw new Error('Not a valid ASAR archive: ' + archivePath);
    const middleSize = sizeBuf.readUInt32LE(4);
    if (middleSize <= 4 || middleSize > 64 * 1024 * 1024) throw new Error('Invalid ASAR header size: ' + middleSize);
    const middle = Buffer.alloc(middleSize);
    fs.readSync(fd, middle, 0, middleSize, 8);
    const strLen = middle.readUInt32LE(4);
    const headerString = middle.subarray(8, 8 + strLen).toString('utf8');
    return { header: JSON.parse(headerString), headerSize: middleSize };
  } finally {
    fs.closeSync(fd);
  }
}

/* تمام فایل‌های آرشیو را پیمایش می‌کند و برای هرکدام visitor صدا می‌زند.
 * ورودی visitor: (name, relativePath, entry)
 *   entry.size     → حجم بایت
 *   entry.offset   → فاصله از ابتدای ناحیه‌ی محتوا (به‌صورت رشته ذخیره می‌شود!)
 *   entry.files    → اگر پوشه باشد
 *   entry.unpacked → اگر فایل بزرگ/باینری باشد و بیرون از asar باشد
 *   entry.link     → اگر symlink باشد
 * نکته‌ی مهم: offset در JSON به‌صورت رشته است، پس قبل از حساب‌وکتاب Number() لازم است. */
function walkFiles(header, visitor) {
  const visit = (node, rel) => {
    if (!node.files) return;
    for (const name of Object.keys(node.files)) {
      const entry = node.files[name];
      const entryRel = rel ? rel + '/' + name : name;
      if (entry.files) visit(entry, entryRel);
      else visitor(name, entryRel, entry);
    }
  };
  visit(header, '');
}

/* محتوای یک فایل را از بافر آرشیو (یا از پوشه‌ی .unpacked) برمی‌گرداند. */
/**
 * Extract the entire archive into destDir.
 * Unpacked files are copied from `<archive>.unpacked` when present.
 * Returns metadata: { files: [{ rel, entry }], unpacked: [rel...] }
 */
/* کل آرشیو را در یک پوشه باز می‌کند.
 * مراحل:
 *   ۱. ساخت پوشه‌ها (حتی پوشه‌های خالی — در ASAR هم ثبت می‌شوند)
 *   ۲. نوشتن هر فایل در مسیر خودش
 *   ۳. کپی فایل‌های unpacked از کنار آرشیو
 * خروجی شامل فهرست فایل‌های unpacked است تا هنگام بسته‌بندی دوباره،
 * همان‌ها را دوباره unpacked نگه داریم. */
function extractAll(archivePath, destDir) {
  const archiveBuffer = fs.readFileSync(archivePath);
  const { header, headerSize } = decodeHeader(archiveBuffer);
  const base = 8 + headerSize;
  const unpacked = [];
  const files = [];

  walkFiles(header, (name, rel, entry) => { files.push({ rel, entry }); });

  // Recreate directory entries (including empty directories).
  (function mkdirs(node, rel) {
    if (!node.files) return;
    for (const name of Object.keys(node.files)) {
      const e = node.files[name];
      const r = rel ? rel + '/' + name : name;
      if (e.files) {
        fs.mkdirSync(path.join(destDir, r), { recursive: true });
        mkdirs(e, r);
      }
    }
  })(header, '');

  for (const { rel, entry } of files) {
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (entry.files) continue;
    if (entry.link !== undefined) {
      try { fs.symlinkSync(entry.link, target); } catch (e) { /* symlinks may be forbidden on Windows */ }
      continue;
    }
    if (entry.unpacked) {
      unpacked.push(rel);
      const src = path.join(archivePath + '.unpacked', rel);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, target);
        continue;
      }
      // Fallback: try reading from packed area (malformed archives).
    }
    const off = Number(entry.offset) || 0;
    const content = (!entry.unpacked && entry.size)
      ? archiveBuffer.subarray(base + off, base + off + entry.size)
      : Buffer.alloc(0);
    fs.writeFileSync(target, content);
    if (entry.executable) {
      try { fs.chmodSync(target, 0o755); } catch (e) { /* ignore */ }
    }
  }
  return { header, files, unpacked };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */
/* محاسبه‌ی بلوک integrity.
 * Electron محتوا را به بلوک‌های ۴ مگابایتی می‌شکند، هش SHA-256 هر بلوک را
 * می‌گیرد و یک هش نهایی هم از خودِ فهرست بلوک‌ها می‌سازد.
 * (این نسخه در آزمون‌ها استفاده می‌شود؛ نسخه‌ی اصلی در createPackageFromDirectory است.) */
function computeIntegrity(orderedFilePaths, readFn) {
  const files = {};
  let offset = 0;
  const entries = orderedFilePaths.map((p) => ({ path: p, size: readFn(p).length }));
  // Blocks are stacked across the whole content section in traversal order.
  const blocks = [];
  let bufferParts = [];
  let currentSize = 0;
  const flush = () => { if (bufferParts.length) { blocks.push(crypto.createHash('sha256').update(Buffer.concat(bufferParts)).digest('base64')); bufferParts = []; currentSize = 0; } };
  for (const e of entries) {
    files[e.path] = { size: e.size, offset };
    offset += align4(e.size); // asar offsets are byte-exact; alignment not required, but keep sane
    let buf = readFn(e.path);
    let consumed = 0;
    while (consumed < buf.length) {
      const room = BLOCK_SIZE - currentSize;
      const take = Math.min(room, buf.length - consumed);
      bufferParts.push(buf.subarray(consumed, consumed + take));
      currentSize += take;
      consumed += take;
      if (currentSize === BLOCK_SIZE) flush();
    }
  }
  flush();
  const integrity = {
    algorithm: 'SHA256',
    hash: '',
    blockSize: BLOCK_SIZE,
    blocks
  };
  integrity.hash = crypto.createHash('sha256')
    .update(JSON.stringify({ algorithm: integrity.algorithm, blockSize: integrity.blockSize, blocks }))
    .digest('hex');
  return { files, integrity };
}

/**
 * Build an asar archive from a directory.
 * opts:
 *  - shouldUnpack(relPath, size) -> boolean (default false)
 *  - integrity: boolean (default true)
 */
/* ساخت یک app.asar از روی یک پوشه (معادل «بسته‌بندی»).
 *
 * گام‌ها:
 *   ۱. خواندن بازگشتی پوشه و ساختن «درخت JSON» (همان چیزی که در هدر می‌رود)
 *   ۲. تصمیم درباره‌ی unpacked (فایل‌های بزرگ مثل *.node بیرون می‌مانند)
 *   ۳. چیدن فایل‌ها پشت سر هم و ثبت offset هرکدام
 *   ۴. ساخت هدر (با integrity اختیاری)
 *   ۵. نوشتن هدر و بعد محتوای همه‌ی فایل‌ها داخل فایل خروجی
 *
 * گزینه‌ها:
 *   shouldUnpack(relPath, size) → آیا این فایل بیرون از asar بماند؟
 *   integrity: true/false        → بلوک هش اضافه شود؟
 */
function createPackageFromDirectory(srcDir, destFile, opts) {
  opts = opts || {};
  const shouldUnpack = opts.shouldUnpack || (() => false);
  const wantIntegrity = opts.integrity !== false;

  const contents = {};   // rel -> Buffer (packed files, in traversal order)
  const ordered = [];     // [{rel, buf}]
  const unpackedCopies = [];

  function addDir(dir, rel) {
    const names = fs.readdirSync(dir).sort();
    const files = {};
    for (const name of names) {
      if (name === '.DS_Store') continue;
      const full = path.join(dir, name);
      const entryRel = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) {
        files[name] = { link: fs.readlinkSync(full) };
      } else if (st.isDirectory()) {
        files[name] = { files: addDir(full, entryRel) };
      } else {
        const buf = fs.readFileSync(full);
        const isExec = (st.mode & 0o111) !== 0;
        if (shouldUnpack(entryRel, buf.length)) {
          files[name] = { size: buf.length, unpacked: true };
          if (isExec) files[name].executable = true;
          unpackedCopies.push({ rel: entryRel, from: full });
        } else {
          files[name] = { size: buf.length };
          if (isExec) files[name].executable = true;
          ordered.push({ rel: entryRel, buf });
          contents[entryRel] = buf;
        }
      }
    }
    return files;
  }

  const tree = { files: addDir(srcDir, '') };

  // Integrity block (computed over packed contents in traversal order).
  let integrityObject = null;
  if (wantIntegrity && ordered.length) {
    const blocks = [];
    let parts = [];
    let current = 0;
    const flush = () => {
      if (parts.length) { blocks.push(crypto.createHash('sha256').update(Buffer.concat(parts)).digest('base64')); parts = []; current = 0; }
    };
    for (const f of ordered) {
      let consumed = 0;
      while (consumed < f.buf.length) {
        const take = Math.min(BLOCK_SIZE - current, f.buf.length - consumed);
        parts.push(f.buf.subarray(consumed, consumed + take));
        current += take;
        consumed += take;
        if (current === BLOCK_SIZE) flush();
      }
    }
    flush();
    integrityObject = {
      algorithm: 'SHA256',
      hash: crypto.createHash('sha256')
        .update(JSON.stringify({ algorithm: 'SHA256', blockSize: BLOCK_SIZE, blocks }))
        .digest('hex'),
      blockSize: BLOCK_SIZE,
      blocks
    };
    tree.integrity = integrityObject;
  }

  // Assign offsets in deterministic DFS order.
  const offsetOrder = [];
  (function collect(node, rel) {
    if (!node.files) return;
    for (const name of Object.keys(node.files)) {
      const e = node.files[name];
      const r = rel ? rel + '/' + name : name;
      if (e.files) { collect(e, r); continue; }
      if (e.link !== undefined || e.unpacked) continue;
      offsetOrder.push({ entry: e, rel: r });
    }
  })(tree, '');

  let offset = 0;
  const buffersInOrder = [];
  for (const item of offsetOrder) {
    item.entry.offset = String(offset);
    buffersInOrder.push(contents[item.rel]);
    offset += contents[item.rel].length;
  }

  const headerJson = JSON.stringify(tree);
  const headerBuf = encodeHeader(headerJson, integrityObject);

  const fd = fs.openSync(destFile, 'w');
  try {
    fs.writeSync(fd, headerBuf);
    let pos = headerBuf.length;
    for (const buf of buffersInOrder) {
      if (buf.length) { fs.writeSync(fd, buf, 0, buf.length, pos); pos += buf.length; }
    }
  } finally {
    fs.closeSync(fd);
  }

  // Copy unpacked files next to the archive.
  const unpackedRoot = destFile + '.unpacked';
  for (const u of unpackedCopies) {
    const to = path.join(unpackedRoot, u.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(u.from, to);
    const st = fs.statSync(u.from);
    try { fs.chmodSync(to, st.mode); } catch (e) { /* ignore */ }
  }

  return { fileCount: offsetOrder.length, unpackedCount: unpackedCopies.length };
}

/* ------------------------------------------------------------------ *
 * Manifest helpers
 * ------------------------------------------------------------------ */
/* فقط package.json برنامه را می‌خواند (نام، نسخه، فایل main).
 * اگر آرشیو خراب باشد null برمی‌گردد تا برنامه کرش نکند. */
function readManifest(archivePath) {
  try {
    const { header, headerSize } = readHeader(archivePath);
    const entry = header.files && header.files['package.json'];
    if (!entry || entry.files) return null;
    const buf = fs.readFileSync(archivePath);
    const base = 8 + headerSize;
    let content;
    if (entry.unpacked) {
      const p = path.join(archivePath + '.unpacked', 'package.json');
      content = fs.readFileSync(p);
    } else {
      const off = Number(entry.offset) || 0;
      content = buf.subarray(base + off, base + off + entry.size);
    }
    return JSON.parse(content.toString('utf8'));
  } catch (e) {
    return null;
  }
}

module.exports = {
  BLOCK_SIZE,
  readHeader,
  decodeHeader,
  extractAll,
  createPackageFromDirectory,
  readManifest,
  walkFiles
};
