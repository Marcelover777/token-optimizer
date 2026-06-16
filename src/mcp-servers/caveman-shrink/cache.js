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
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    // Predictable path under ~/.cache: refuse to write through a symlink and
    // write atomically via temp + rename (matches the repo flag-file standard).
    try { if (fs.lstatSync(filePath).isSymbolicLink()) return; } catch (e) { if (e.code !== 'ENOENT') return; }
    const tmp = path.join(dir, '.mcp-shrink.' + process.pid + '.' + Date.now() + '.tmp');
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tmp, flags, 0o600);
      fs.writeSync(fd, JSON.stringify(cache, null, 2) + '\n');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    fs.renameSync(tmp, filePath);
  } catch (_) {}
}

function makeCacheKey(parts) {
  return 'sha256:' + sha(JSON.stringify(parts));
}

module.exports = { defaultCachePath, loadCache, saveCache, makeCacheKey };
