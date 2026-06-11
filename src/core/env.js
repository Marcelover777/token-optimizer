const fs = require('fs');
const path = require('path');

function parseEnvValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function loadEnvFile(file, opts = {}) {
  const env = opts.env || process.env;
  if (!fs.existsSync(file)) return { loaded: false, file, keys: [] };
  const keys = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    if (!opts.override && env[key]) continue;
    env[key] = parseEnvValue(match[2]);
    keys.push(key);
  }
  return { loaded: true, file, keys };
}

function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const next = path.dirname(dir);
    if (next === dir) return path.resolve(start);
    dir = next;
  }
}

function loadLocalEnv(opts = {}) {
  const root = opts.root || findProjectRoot(opts.start || process.cwd());
  const file = opts.file || path.join(root, '.env.local');
  return loadEnvFile(file, opts);
}

module.exports = {
  parseEnvValue,
  loadEnvFile,
  loadLocalEnv,
  findProjectRoot,
};
