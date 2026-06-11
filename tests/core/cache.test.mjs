import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadCache, saveCache, cacheKey, putCacheEntry, getCacheEntry } = require('../../src/core/cache.js');

test('cache stores and reads entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-cache-'));
  const file = path.join(dir, 'cache.json');
  const cache = loadCache(file);
  const key = cacheKey({ a: 1 });
  putCacheEntry(cache, key, { compressed: 'small' });
  saveCache(file, cache);
  const loaded = loadCache(file);
  assert.equal(getCacheEntry(loaded, key).compressed, 'small');
  fs.rmSync(dir, { recursive: true, force: true });
});
