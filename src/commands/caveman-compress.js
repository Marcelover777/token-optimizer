#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../hooks/caveman-config');
const { splitMarkdownSections } = require('../core/markdown-sections');
const { protectSegments, restoreSegments, sha256 } = require('../core/protect');
const { compressDeterministic } = require('../core/deterministic-compress');
const { validateCompression } = require('../core/validate');
const { scanSecrets } = require('../core/secret-scan');
const { cacheKey, loadCache, saveCache, getCacheEntry, putCacheEntry } = require('../core/cache');
const { atomicWriteFile, ensureBackup } = require('../core/atomic-write');

const COMPRESSOR_VERSION = 1;
const ALLOWED_EXTS = new Set(['.md', '.txt', '.typ', '.typst', '.tex', '']);

function usage() {
  return `Usage: node src/commands/caveman-compress.js <file> [flags]

Flags:
  --check          validate/compress in memory, write nothing
  --diff           print simple line diff
  --out <file>     write compressed output to file
  --strict         fail on invariant warnings/errors (default)
  --local-only     never call API
  --llm <model>    opt in to LLM compression for low-savings sections
  --restore        restore latest .caveman backup or legacy .original.md
  --json           print JSON report
  --dry-run        same as --check, includes planned write target
  --no-cache       bypass section cache`;
}

function parseArgs(argv) {
  const opts = { strict: true, json: false, check: false, diff: false, dryRun: false, localOnly: false, noCache: false, restore: false, out: null, llmModel: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--diff') opts.diff = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--local-only') opts.localOnly = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--dry-run') { opts.dryRun = true; opts.check = true; }
    else if (arg === '--no-cache') opts.noCache = true;
    else if (arg === '--restore') opts.restore = true;
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--llm') opts.llmModel = argv[++i] || 'claude-fable-5';
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    else positional.push(arg);
  }
  opts.file = positional[0];
  return opts;
}

function assertAllowedFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`Refusing to compress non-prose file extension: ${ext || '(none)'}`);
  if (/\.original\.md$|\.backup\.md$|\.source\.md$/i.test(file)) {
    // .source.md is allowed only as explicit input.
    if (!/\.source\.md$/i.test(file)) throw new Error('Refusing to compress backup/original file');
  }
  if (file.split(/[\\/]/).includes('.git') || file.split(/[\\/]/).includes('node_modules')) {
    throw new Error('Refusing to compress ignored/system path');
  }
}

function resolveInputOutput(file, outArg, config) {
  const input = path.resolve(file);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  if (!fs.statSync(input).isFile()) throw new Error(`Not a file: ${input}`);
  assertAllowedFile(input);

  if (outArg) return { source: input, target: path.resolve(outArg), sourceSplit: true };

  if (/\.source\.md$/i.test(input)) {
    return { source: input, target: input.replace(/\.source\.md$/i, '.md'), sourceSplit: true };
  }

  const sourceCandidate = input.replace(/\.md$/i, '.source.md');
  if (config.compression.sourceSplit && fs.existsSync(sourceCandidate)) {
    return { source: sourceCandidate, target: input, sourceSplit: true };
  }

  return { source: input, target: input, sourceSplit: false };
}

function simpleDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out.join('\n');
}

async function callAnthropicCompress(maskedText, model, mode) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required for --llm');
  if (typeof fetch !== 'function') throw new Error('fetch unavailable in this Node runtime');
  const prompt = `Compress prose in same language as input. Preserve every sentinel exactly. No new facts. No deletion of requirements. Return only compressed text.\n\nMode: ${mode}.\n\nText:\n<<<\n${maskedText}\n>>>`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(1024, Math.min(8192, Math.ceil(maskedText.length / 2))),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic compression failed: HTTP ${res.status}`);
  const json = await res.json();
  const text = json.content && json.content[0] && json.content[0].text;
  if (!text || !text.trim()) throw new Error('Anthropic compression returned empty text');
  return text.trim();
}

async function compressSection(section, opts, config, cache) {
  const sourceHash = sha256(section.text);
  const mode = opts.mode || 'full';
  const key = cacheKey({
    sourceHash,
    compressorVersion: COMPRESSOR_VERSION,
    mode,
    model: opts.llmModel || config.compression.llmModel,
    strict: opts.strict,
  });
  const cached = opts.noCache ? null : getCacheEntry(cache, key);
  if (cached && cached.compressed) return { text: cached.compressed, cacheHit: true, strategy: cached.strategy || 'cache' };

  const protectedResult = protectSegments(section.text);
  const local = compressDeterministic(protectedResult.text, { mode, protect: false });
  let masked = local.compressed;
  let strategy = 'local';
  const localSavings = section.text.length ? (section.text.length - restoreSegments(masked, protectedResult.segments).length) / section.text.length : 0;

  const allowLlm = !opts.localOnly && (opts.llmModel || config.compression.llmEnabled);
  if (allowLlm && localSavings < config.compression.minLocalSavingsToSkipLLM) {
    masked = await callAnthropicCompress(masked, opts.llmModel || config.compression.llmModel, mode);
    strategy = 'local+llm';
  }

  const restored = restoreSegments(masked, protectedResult.segments);
  putCacheEntry(cache, key, {
    source_hash: sourceHash,
    compressed_hash: sha256(restored),
    source_chars: section.text.length,
    compressed_chars: restored.length,
    protected_count: protectedResult.segments.length,
    strategy,
    compressed: restored,
  });
  return { text: restored, cacheHit: false, strategy };
}

async function compressFile(opts) {
  const config = loadConfig();
  if (opts.help || !opts.file) return { help: usage() };
  const io = resolveInputOutput(opts.file, opts.out, config);
  const original = fs.readFileSync(io.source, 'utf8');
  if (!original.trim()) throw new Error('Refusing to compress empty file');

  const secretScan = scanSecrets({ filePath: io.source, content: original });
  if (!secretScan.ok && config.security.abortOnSecret) {
    return { ok: false, aborted: true, reason: 'secret_scan', secretScan };
  }

  const cachePath = path.join(path.dirname(io.target), '.caveman', 'cache', 'compress-v1.json');
  const cache = opts.noCache ? { schema_version: 1, entries: {} } : loadCache(cachePath);
  cache.model = opts.llmModel || config.compression.llmModel;
  cache.strategy = opts.localOnly ? 'local-only' : config.compression.defaultStrategy;

  const sections = splitMarkdownSections(original);
  const outputs = [];
  const sectionReports = [];
  for (const section of sections) {
    const out = await compressSection(section, opts, config, cache);
    outputs.push(out.text);
    sectionReports.push({ title: section.title, chars: section.text.length, compressed_chars: out.text.length, cache_hit: out.cacheHit, strategy: out.strategy });
  }
  const compressed = outputs.join('');
  const validation = validateCompression(original, compressed, { strict: opts.strict });
  const ok = validation.ok;

  const report = {
    schema_version: 1,
    ok,
    source: io.source,
    target: io.target,
    source_split: io.sourceSplit,
    dry_run: opts.dryRun || opts.check,
    local_only: opts.localOnly,
    secret_scan: secretScan,
    validation,
    sections: sectionReports,
    metrics: validation.metrics,
  };

  const reportDir = path.join(path.dirname(io.target), '.caveman', 'reports');
  const reportPath = path.join(reportDir, `compress-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  if (!ok) return { ...report, compressed, reportPath };

  if (!opts.noCache && !opts.check && !opts.dryRun) saveCache(cachePath, cache);
  if (!opts.check && !opts.dryRun) {
    const backupDir = path.join(path.dirname(io.target), '.caveman', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
    const backup = ensureBackup(io.target, backupDir);
    if (!io.sourceSplit && io.target === io.source) {
      const legacy = io.target.replace(/\.md$/i, '.original.md');
      if (!fs.existsSync(legacy)) fs.copyFileSync(io.target, legacy);
    }
    atomicWriteFile(io.target, compressed);
    fs.mkdirSync(reportDir, { recursive: true });
    atomicWriteFile(reportPath, JSON.stringify({ ...report, backup }, null, 2) + '\n');
    report.backup = backup;
    report.report = reportPath;
  }

  return { ...report, compressed, diff: opts.diff ? simpleDiff(original, compressed) : '' };
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.restore) {
      const file = path.resolve(opts.file);
      const backupRoot = path.join(path.dirname(file), '.caveman', 'backups');
      let restoreFrom = null;
      if (fs.existsSync(backupRoot)) {
        const dirs = fs.readdirSync(backupRoot).sort().reverse();
        for (const dir of dirs) {
          const candidate = path.join(backupRoot, dir, path.basename(file));
          if (fs.existsSync(candidate)) { restoreFrom = candidate; break; }
        }
      }
      const legacy = file.replace(/\.md$/i, '.original.md');
      if (!restoreFrom && fs.existsSync(legacy)) restoreFrom = legacy;
      if (!restoreFrom) throw new Error('No backup found to restore');
      atomicWriteFile(file, fs.readFileSync(restoreFrom, 'utf8'));
      const result = { ok: true, restored_from: restoreFrom, target: file };
      process.stdout.write(opts.json ? JSON.stringify(result, null, 2) + '\n' : `Restored ${file} from ${restoreFrom}\n`);
      return;
    }

    const result = await compressFile(opts);
    if (result.help) {
      process.stdout.write(result.help + '\n');
      return;
    }
    if (opts.json) {
      const { compressed, ...safe } = result;
      process.stdout.write(JSON.stringify(safe, null, 2) + '\n');
    } else if (result.aborted) {
      process.stdout.write(`Compression aborted: ${result.reason}\n`);
    } else if (result.diff) {
      process.stdout.write(result.diff + '\n');
    } else {
      process.stdout.write(`${result.ok ? 'Compression OK' : 'Compression failed'}: ${result.source} -> ${result.target}\n`);
      process.stdout.write(`Saved chars: ${result.metrics.savedChars}\n`);
      if (result.dry_run) process.stdout.write('No files written.\n');
    }
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`caveman-compress: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, compressFile, simpleDiff, resolveInputOutput };
