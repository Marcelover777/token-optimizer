const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function defaultCachePath() {
  return path.join(os.homedir(), '.cache', 'caveman', 'mcp-shrink-v1.json');
}

function loadCache(filePath = defaultCachePath()) {
  try {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!json.entries) json.entries = {};
    return json;
  } catch (_) {
    return { schema_version: 1, entries: {} };
  }
}

function saveCache(cache, filePath = defaultCachePath()) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2) + '\n');
  } catch (_) {}
}

function makeCacheKey(parts) {
  return 'sha256:' + sha(JSON.stringify(parts));
}

module.exports = { defaultCachePath, loadCache, saveCache, makeCacheKey };
