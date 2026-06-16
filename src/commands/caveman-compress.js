#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadLocalEnv } = require('../core/env');
const { loadConfig } = require('../hooks/caveman-config');
const { splitMarkdownSections } = require('../core/markdown-sections');
const { protectSegments, restoreSegments, sha256 } = require('../core/protect');
const { compressDeterministic } = require('../core/deterministic-compress');
const { validateCompression } = require('../core/validate');
const { scanSecrets } = require('../core/secret-scan');
const { cacheKey, loadCache, saveCache, getCacheEntry, putCacheEntry } = require('../core/cache');
const { atomicWriteFile, ensureBackup } = require('../core/atomic-write');

const COMPRESSOR_VERSION = 3;
const ALLOWED_EXTS = new Set(['.md', '.txt', '.typ', '.typst', '.tex', '']);
const LLM_TIMEOUT_MS = Number(process.env.CAVEMAN_LLM_TIMEOUT_MS || 60_000);
loadLocalEnv();

// Cumulative LLM usage for this process — lets callers (bench, smoke) compute
// real spend from API-reported token counts instead of estimates.
const llmUsage = { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
function resetLlmUsage() {
  llmUsage.calls = 0; llmUsage.input = 0; llmUsage.output = 0; llmUsage.cache_read = 0; llmUsage.cache_write = 0;
}
function getLlmUsage() {
  return { ...llmUsage };
}

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
  --no-cache       bypass section cache
  --max-llm-usd <n>  stop calling the LLM once estimated spend reaches n USD`;
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
    else if (arg === '--llm') {
      // Only consume the next token as the model name if it isn't itself a flag,
      // so `--llm --check` doesn't silently swallow --check as the model.
      const next = argv[i + 1];
      opts.llmModel = (next && !next.startsWith('--')) ? argv[++i] : 'claude-sonnet-4-6';
    }
    else if (arg === '--max-llm-usd') opts.maxLlmUsd = Number(argv[++i]);
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

function buildCompressPrompt(maskedText, mode, repair) {
  const rules = [
    'Rewrite the text below as maximally terse caveman-style technical notes, in the SAME language as the input.',
    'Hard rules:',
    '- Cut 40-60% of characters where safe. Keep every requirement, decision, date, metric, identifier, error, and action item.',
    '- Reproduce every numeric value exactly, same count, same order. Never round, merge, or drop numbers.',
    '- Keep uncertainty words (might, may, could, perhaps) attached to the claims they qualify.',
    '- Tokens matching __CAVEMAN_PROTECTED_NNNNNN_hhhhhhhh__ are frozen content. Reproduce each one byte-exact, same count, same order. Never invent, drop, merge, split, or edit them.',
    '- Keep markdown structure identical: same number of list items with the same markers (-, *, 1.) and same indentation; same table rows and column count; do not add or remove headings.',
    '- Compress the WORDS inside each bullet/cell, never the structure around them.',
    '- No new facts, no commentary, no preamble, no code fences around the answer. Return only the rewritten text.',
  ];
  if (repair) {
    rules.push(
      '',
      'REPAIR PASS. Your previous attempt violated these invariants: ' + repair.errors.map(e => `${e.code} (${e.message})`).join('; ') + '.',
      'Fix every violation. When in doubt, copy the violating region verbatim from the original text. Compression is secondary to exact preservation in this pass.',
      '',
      'Previous attempt:',
      '<<<',
      repair.previous,
      '>>>'
    );
  }
  return `${rules.join('\n')}\n\nMode: ${mode}.\n\nText:\n<<<\n${maskedText}\n>>>`;
}

async function callAnthropicCompress(maskedText, model, mode, opts = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required for --llm');
  if (typeof fetch !== 'function') throw new Error('fetch unavailable in this Node runtime');
  const prompt = buildCompressPrompt(maskedText, mode, opts.repair);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || LLM_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
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
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const e = new Error(`Anthropic compression timed out after ${timeoutMs}ms`);
      e.code = 'timeout';
      throw e;
    }
    const e = new Error(`Anthropic compression request failed: ${error.message}`);
    e.code = 'api_failure';
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const e = new Error(`Anthropic compression failed: HTTP ${res.status}`);
    e.code = 'api_failure';
    throw e;
  }
  const json = await res.json();
  const usage = json.usage || {};
  llmUsage.calls += 1;
  llmUsage.input += usage.input_tokens || 0;
  llmUsage.output += usage.output_tokens || 0;
  llmUsage.cache_read += usage.cache_read_input_tokens || 0;
  llmUsage.cache_write += usage.cache_creation_input_tokens || 0;
  const text = extractTextContent(json);
  if (!text || !text.trim()) {
    const e = new Error('Anthropic compression returned empty text');
    e.code = 'api_failure';
    throw e;
  }
  return text.trim();
}

function makeLlmBudget(maxUsd, model) {
  const { pricingForModel, costForUsage } = require('../core/pricing');
  const pricing = pricingForModel(model);
  return {
    maxUsd,
    spent() { return pricing ? (costForUsage(getLlmUsage(), pricing) || 0) : 0; },
    exhausted() { return this.spent() >= maxUsd; },
  };
}

function extractTextContent(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : [];
  const textBlock = blocks.find(block => block && block.type === 'text' && typeof block.text === 'string');
  return textBlock ? textBlock.text : '';
}

function splitLeadingHeading(text) {
  const source = String(text || '');
  const match = /^(#{1,6}[ \t]+[^\r\n]+(?:\r?\n)?)([\s\S]*)$/.exec(source);
  if (!match) return { heading: '', body: source };
  return { heading: match[1], body: match[2] };
}

function splitBoundaryWhitespace(text) {
  const source = String(text || '');
  const leading = (/^\s*/.exec(source) || [''])[0];
  const trailing = (/\s*$/.exec(source) || [''])[0];
  const end = source.length - trailing.length;
  return {
    leading,
    core: source.slice(leading.length, end),
    trailing,
  };
}

async function compressSection(section, opts, config, cache) {
  // A pure fenced-code run is fully protected anyway; return it verbatim and
  // skip the savings gate / LLM call entirely.
  if (section.kind === 'code') return { text: section.text, cacheHit: false, strategy: 'verbatim-code', llmAttempts: 0 };
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

  const { heading, body } = splitLeadingHeading(section.text);
  const sourceForCompression = heading ? body : section.text;
  const boundary = splitBoundaryWhitespace(sourceForCompression);
  if (!boundary.core.trim()) {
    return { text: section.text, cacheHit: false, strategy: 'local' };
  }

  const protectedResult = protectSegments(boundary.core);
  const local = compressDeterministic(protectedResult.text, { mode, protect: false });
  const localBody = restoreSegments(local.compressed, protectedResult.segments);
  const localRestored = heading + boundary.leading + localBody + boundary.trailing;
  let restored = localRestored;
  let strategy = 'local';
  let fallback = null;
  let llmAttempts = 0;
  const localSavings = boundary.core.length ? (boundary.core.length - localBody.length) / boundary.core.length : 0;

  const allowLlm = !opts.localOnly && (opts.llmModel || config.compression.llmEnabled);
  if (allowLlm && localSavings < config.compression.minLocalSavingsToSkipLLM) {
    const model = opts.llmModel || config.compression.llmModel;
    if (opts.secretRisk) {
      fallback = { from: 'local+llm', to: 'local', reason: 'secret_risk', attempts: 0 };
    } else if (opts.budget && opts.budget.exhausted && opts.budget.exhausted()) {
      fallback = { from: 'local+llm', to: 'local', reason: 'budget_exhausted', attempts: 0 };
    } else {
      try {
        llmAttempts = 1;
        let llmMasked = await callAnthropicCompress(local.compressed, model, mode);
        let llmRestored = heading + boundary.leading + restoreSegments(llmMasked, protectedResult.segments) + boundary.trailing;
        let llmValidation = validateCompression(section.text, llmRestored, { strict: opts.strict });
        if (!llmValidation.ok && (!opts.budget || !opts.budget.exhausted || !opts.budget.exhausted())) {
          // One stricter repair pass before giving up — the model gets told
          // exactly which invariants it broke.
          llmAttempts = 2;
          llmMasked = await callAnthropicCompress(local.compressed, model, mode, {
            repair: { errors: llmValidation.errors, previous: llmMasked },
          });
          llmRestored = heading + boundary.leading + restoreSegments(llmMasked, protectedResult.segments) + boundary.trailing;
          llmValidation = validateCompression(section.text, llmRestored, { strict: opts.strict });
        }
        if (llmValidation.ok && llmRestored.length <= localRestored.length) {
          restored = llmRestored;
          strategy = 'local+llm';
        } else {
          fallback = {
            from: 'local+llm',
            to: 'local',
            reason: llmValidation.ok ? 'no_savings' : 'validation_failed',
            attempts: llmAttempts,
            errors: llmValidation.errors.map(error => error.code),
          };
        }
      } catch (error) {
        fallback = {
          from: 'local+llm',
          to: 'local',
          reason: error.code === 'timeout' ? 'timeout' : 'api_failure',
          attempts: llmAttempts,
          message: String(error.message || '').slice(0, 200),
        };
      }
    }
  }

  // Final safety net: the accepted output must pass the same invariants as the
  // whole file, or we keep the section untouched. Only validated outputs are
  // ever cached.
  const sectionValidation = validateCompression(section.text, restored, { strict: opts.strict });
  if (!sectionValidation.ok) {
    return {
      text: section.text,
      cacheHit: false,
      strategy: 'original',
      llmAttempts,
      fallback: {
        from: strategy,
        to: 'original',
        reason: 'validation_failed',
        attempts: llmAttempts,
        errors: sectionValidation.errors.map(error => error.code),
      },
    };
  }

  putCacheEntry(cache, key, {
    source_hash: sourceHash,
    compressed_hash: sha256(restored),
    source_chars: section.text.length,
    compressed_chars: restored.length,
    protected_count: protectedResult.segments.length,
    strategy,
    fallback,
    compressed: restored,
  });
  return { text: restored, cacheHit: false, strategy, fallback, llmAttempts };
}

async function compressFile(opts) {
  const config = loadConfig();
  if (opts.help || !opts.file) return { help: usage() };
  resetLlmUsage(); // report.llm.usage is per-file, not per-process
  const io = resolveInputOutput(opts.file, opts.out, config);
  const original = fs.readFileSync(io.source, 'utf8');
  if (!original.trim()) throw new Error('Refusing to compress empty file');

  const secretScan = scanSecrets({ filePath: io.source, content: original });
  if (!secretScan.ok && config.security.abortOnSecret) {
    return { ok: false, aborted: true, reason: 'secret_scan', secretScan };
  }
  // Secret findings that did not abort (abortOnSecret=false) still block the
  // LLM path unless the user explicitly allowed it.
  const secretRisk = !secretScan.ok && !config.security.allowLLMForSensitiveFiles;
  if (!opts.budget && Number.isFinite(opts.maxLlmUsd) && opts.maxLlmUsd > 0) {
    opts = { ...opts, budget: makeLlmBudget(opts.maxLlmUsd, opts.llmModel || config.compression.llmModel) };
  }

  const cachePath = path.join(path.dirname(io.target), '.caveman', 'cache', 'compress-v1.json');
  const cache = opts.noCache ? { schema_version: 1, entries: {} } : loadCache(cachePath);
  cache.model = opts.llmModel || config.compression.llmModel;
  cache.strategy = opts.localOnly ? 'local-only' : config.compression.defaultStrategy;

  const sections = splitMarkdownSections(original);
  const outputs = [];
  const sectionReports = [];
  const fallbackCounts = {};
  let llmAccepted = 0;
  let llmAttempted = 0;
  const sectionOpts = { ...opts, secretRisk };
  for (const section of sections) {
    const out = await compressSection(section, sectionOpts, config, cache);
    outputs.push(out.text);
    if (out.llmAttempts) llmAttempted++;
    if (out.strategy === 'local+llm') llmAccepted++;
    if (out.fallback) fallbackCounts[out.fallback.reason] = (fallbackCounts[out.fallback.reason] || 0) + 1;
    sectionReports.push({ title: section.title, chars: section.text.length, compressed_chars: out.text.length, cache_hit: out.cacheHit, strategy: out.strategy, llm_attempts: out.llmAttempts || 0, fallback: out.fallback || null });
  }
  const compressed = outputs.join('');
  const validation = validateCompression(original, compressed, { strict: opts.strict });
  const ok = validation.ok;

  const report = {
    schema_version: 2,
    ok,
    source: io.source,
    target: io.target,
    source_split: io.sourceSplit,
    dry_run: opts.dryRun || opts.check,
    local_only: opts.localOnly,
    secret_scan: secretScan,
    secret_risk_blocked_llm: secretRisk && !opts.localOnly,
    llm: {
      sections_attempted: llmAttempted,
      sections_accepted: llmAccepted,
      fallback_counts: fallbackCounts,
      usage: getLlmUsage(),
    },
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

module.exports = { parseArgs, compressFile, simpleDiff, resolveInputOutput, splitLeadingHeading, splitBoundaryWhitespace, extractTextContent, buildCompressPrompt, makeLlmBudget, getLlmUsage, resetLlmUsage };
