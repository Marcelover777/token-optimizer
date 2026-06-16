import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { saveCache, loadCache } = require('../../src/mcp-servers/caveman-shrink/cache.js');

test('saveCache round-trips via atomic temp+rename', () => {
  const tmp = path.join(os.tmpdir(), 'mcp-cache-' + process.pid + '-' + Date.now() + '.json');
  saveCache({ schema_version: 1, entries: { a: { compressed: 'x' } } }, tmp);
  assert.equal(loadCache(tmp).entries.a.compressed, 'x');
  fs.rmSync(tmp, { force: true });
});

test('saveCache refuses to write through a symlink (no clobber)', () => {
  const secret = path.join(os.tmpdir(), 'mcp-secret-' + process.pid + '-' + Date.now() + '.txt');
  const link = path.join(os.tmpdir(), 'mcp-link-' + process.pid + '-' + Date.now() + '.json');
  fs.writeFileSync(secret, 'SECRET');
  let symlinked = true;
  try { fs.symlinkSync(secret, link); } catch { symlinked = false; } // Windows w/o privilege
  if (symlinked) {
    saveCache({ entries: {} }, link);
    assert.equal(fs.readFileSync(secret, 'utf8'), 'SECRET', 'symlink target untouched');
    fs.rmSync(link, { force: true });
  }
  fs.rmSync(secret, { force: true });
});
