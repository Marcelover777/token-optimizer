const fs = require('fs');
const path = require('path');
const os = require('os');
const { sha256 } = require('./protect');
const { atomicWriteFile } = require('./atomic-write');

function defaultCachePath(kind = 'compress') {
  return path.join(os.homedir(), '.cache', 'caveman', `${kind}-v1.json`);
}

function loadCache(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('bad cache');
    if (!parsed.entries) parsed.entries = {};
    return parsed;
  } catch {
    return { schema_version: 1, entries: {} };
  }
}

function saveCache(filePath, cache) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteFile(filePath, JSON.stringify(cache, null, 2) + '\n');
}

function cacheKey(parts) {
  return `sha256:${sha256(JSON.stringify(parts))}`;
}

function getCacheEntry(cache, key) {
  return cache && cache.entries ? cache.entries[key] || null : null;
}

function putCacheEntry(cache, key, entry) {
  if (!cache.entries) cache.entries = {};
  cache.entries[key] = {
    ...entry,
    created_at: entry.created_at || new Date().toISOString(),
  };
}

module.exports = {
  defaultCachePath,
  loadCache,
  saveCache,
  cacheKey,
  getCacheEntry,
  putCacheEntry,
};
