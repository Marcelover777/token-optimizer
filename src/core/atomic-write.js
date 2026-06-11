const fs = require('fs');
const path = require('path');

function atomicWriteFile(filePath, content, opts = {}) {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, content, opts.encoding || 'utf8');
  fs.renameSync(temp, target);
}

function ensureBackup(filePath, backupDir) {
  const source = path.resolve(filePath);
  if (!fs.existsSync(source)) return null;
  const dir = backupDir || path.join(path.dirname(source), '.caveman', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(source));
  fs.copyFileSync(source, dest);
  return dest;
}

module.exports = {
  atomicWriteFile,
  ensureBackup,
};
