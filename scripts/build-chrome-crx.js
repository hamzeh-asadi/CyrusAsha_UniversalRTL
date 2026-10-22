#!/usr/bin/env node
/*
 * Package the Chrome extension as a CRX3 file, using a persistent signing key.
 *
 * The private key lives outside the repository by default so it cannot enter
 * the public source archive. Keep it safe: future releases need the same key
 * to retain this locally packed extension's ID.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const crx3 = require('crx3');

const ROOT = path.join(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const PRODUCT_NAME = 'CyrusAsha_UniversalRTL';
const VERSION = PACKAGE.version;
const BROWSER_DIR = path.join(ROOT, 'release', 'browser');
const SOURCE_DIR = path.join(BROWSER_DIR, 'chrome-unpacked');
const CRX_PATH = path.join(BROWSER_DIR, `${PRODUCT_NAME}-${VERSION}-Chrome.crx`);
const DEFAULT_KEY_PATH = path.join(os.homedir(), '.rtl-universal', `${PRODUCT_NAME}-chrome-signing.pem`);

/* Create the first-release key once. Later builds reuse it rather than silently
 * changing the extension ID. An environment override lets owners bring their
 * own backed-up key when building on another machine. */
function ensureSigningKey(keyPath) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  if (!fs.existsSync(keyPath)) {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Open with restrictive permissions on POSIX systems; on Windows the
    // user's profile directory should be protected by the account ACL.
    const fd = fs.openSync(keyPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, pair.privateKey, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    try { fs.chmodSync(keyPath, 0o600); } catch (_) { /* Windows ACLs apply instead. */ }
    console.log(`Created a new Chrome signing key: ${keyPath}`);
  }

  // Fail clearly if an existing path is not a readable private key.
  crypto.createPrivateKey(fs.readFileSync(keyPath));
  return keyPath;
}

async function buildChromeCrx(options = {}) {
  const sourceDir = options.sourceDir || SOURCE_DIR;
  const crxPath = options.crxPath || process.env.RTL_CHROME_EXTENSION_OUTPUT || CRX_PATH;
  const keyPath = options.keyPath || process.env.RTL_CHROME_EXTENSION_KEY || DEFAULT_KEY_PATH;

  if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
    throw new Error('Chrome extension source not found. Run `npm run build:browser` first.');
  }

  fs.mkdirSync(path.dirname(crxPath), { recursive: true });
  ensureSigningKey(keyPath);

  const result = await crx3([path.join(sourceDir, 'manifest.json')], {
    keyPath,
    crxPath
  });

  console.log(`Packed Chrome extension: ${path.relative(ROOT, crxPath)}`);
  console.log(`Chrome extension ID: ${result.appId}`);
  console.log(`Signing key (keep private): ${keyPath}`);
  return { crxPath, keyPath, appId: result.appId };
}

if (require.main === module) {
  buildChromeCrx().catch((error) => {
    console.error('Chrome CRX build failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildChromeCrx, ensureSigningKey, DEFAULT_KEY_PATH };
