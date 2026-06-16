#!/usr/bin/env node
// caveman-stats - read Claude Code session logs, print token usage, and
// estimate savings/costs with model-aware pricing (Opus 4.8 default; prices by
// the model recorded in the session log, any Claude via the central table).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readFlag, appendFlag, readHistory, safeWriteFlag, getTargetModel } = require('./caveman-config');

let pricingCore;
try {
  pricingCore = require('../core/pricing');
} catch (_) {
  pricingCore = {
    pricingForModel(model) {
      if (!model) return null;
      // Fallback only (used if require('../core/pricing') fails). Kept in sync
      // with src/core/pricing.js — current models first so longest-prefix wins.
      const rows = [
        ['claude-opus-4-8', 5, 25, 6.25, 0.5],
        ['claude-opus-4-7', 5, 25, 6.25, 0.5],
        ['claude-opus-4-6', 5, 25, 6.25, 0.5],
        ['claude-opus-4-5', 5, 25, 6.25, 0.5],
        ['claude-sonnet-4-6', 3, 15, 3.75, 0.3],
        ['claude-haiku-4-5', 1, 5, 1.25, 0.1],
        ['claude-fable-5', 10, 50, 12.5, 1],
        ['claude-opus-4', 15, 75, 18.75, 1.5],
        ['claude-sonnet-4', 3, 15, 3.75, 0.3],
        ['claude-haiku-4', 0.8, 4, 1, 0.08],
        ['claude-3-5-sonnet', 3, 15, 3.75, 0.3],
        ['claude-3-5-haiku', 0.8, 4, 1, 0.08],
        ['claude-3-opus', 15, 75, 18.75, 1.5],
      ];
      for (const [prefix, inputPerMTok, outputPerMTok, cacheWritePerMTok, cacheReadPerMTok] of rows) {
        if (model.startsWith(prefix)) {
          return { model: prefix, inputPerMTok, outputPerMTok, cacheWritePerMTok, cacheReadPerMTok, source: 'embedded-fallback' };
        }
      }
      return null;
    },
    outputPriceForModel(model) {
      const pricing = this.pricingForModel(model);
      return pricing ? pricing.outputPerMTok : null;
    },
    costForUsage(tokens, pricing) {
      if (!pricing) return null;
      return (((tokens.input || 0) * pricing.inputPerMTok) +
        ((tokens.output || 0) * pricing.outputPerMTok) +
        ((tokens.cache_write || 0) * pricing.cacheWritePerMTok) +
        ((tokens.cache_read || 0) * pricing.cacheReadPerMTok)) / 1_000_000;
    },
    estimateBaseline({ tokens, modeRatio, pricing, injectionOverhead = 0 }) {
      if (!pricing || modeRatio == null) {
        return { estimatedBaselineOutput: 0, estimatedSavedOutput: 0, estimatedNetSaved: 0, actualCostUsd: pricing ? this.costForUsage(tokens, pricing) : null, baselineCostUsd: null, savedCostUsd: null };
      }
      const estimatedBaselineOutput = Math.round((tokens.output || 0) / (1 - modeRatio));
      const estimatedSavedOutput = estimatedBaselineOutput - (tokens.output || 0);
      const actualCostUsd = this.costForUsage(tokens, pricing);
      const baselineCostUsd = this.costForUsage({ ...tokens, output: estimatedBaselineOutput, input: (tokens.input || 0) + injectionOverhead }, pricing);
      return { estimatedBaselineOutput, estimatedSavedOutput, estimatedNetSaved: Math.max(0, estimatedSavedOutput - injectionOverhead), actualCostUsd, baselineCostUsd, savedCostUsd: baselineCostUsd - actualCostUsd };
    },
    formatUsd(amount) {
      if (amount == null || !Number.isFinite(amount)) return null;
      if (amount >= 1) return `$${amount.toFixed(2)}`;
      if (amount >= 0.01) return `$${amount.toFixed(3)}`;
      return `$${amount.toFixed(4)}`;
    },
  };
}

// Mean per-task output savings from committed benchmark snapshots.
const COMPRESSION = { full: 0.65 };

function priceForModel(model) {
  return pricingCore.outputPriceForModel(model);
}

function formatUsd(amount) {
  return pricingCore.formatUsd(amount) || '$0.0000';
}

function findRecentSession(claudeDir) {
  const projectsDir = path.join(claudeDir, 'projects');
  let entries;
  try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return null; }

  let best = null;
  const slug = process.cwd().replace(/[\/:]/g, '-').replace(/^-+/, ''); const scoped = path.join(projectsDir, slug); let roots = []; try { if (fs.statSync(scoped).isDirectory()) roots.push(scoped); } catch {} if (!roots.length) roots = entries.map(e => path.join(projectsDir, e.name)); const stack = [...roots];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      try {
        for (const child of fs.readdirSync(p)) stack.push(path.join(p, child));
      } catch {}
    } else if (p.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtime)) {
      best = { file: p, mtime: st.mtimeMs };
    }
  }
  return best ? best.file : null;
}

function readUsageNumber(usage, ...keys) {
  for (const key of keys) {
    if (typeof usage[key] === 'number') return usage[key];
  }
  return 0;
}

function parseSession(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, model: null };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let turns = 0;
  let model = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    inputTokens += readUsageNumber(usage, 'input_tokens');
    outputTokens += readUsageNumber(usage, 'output_tokens');
    cacheReadTokens += readUsageNumber(usage, 'cache_read_input_tokens');
    cacheCreationTokens += readUsageNumber(usage, 'cache_creation_input_tokens', 'cache_creation_tokens');
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, turns, model };
}

function findCompressedPairs(dirs) {
  const pairs = [];
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.original.md')) continue;
      const base = entry.name.slice(0, -'.original.md'.length);
      const originalPath = path.join(dir, entry.name);
      const compressedPath = path.join(dir, `${base}.md`);
      let oSize, cSize;
      try {
        oSize = fs.statSync(originalPath).size;
        cSize = fs.statSync(compressedPath).size;
      } catch { continue; }
      if (oSize <= cSize) continue;
      pairs.push({ name: base, dir, originalSize: oSize, compressedSize: cSize });
    }
  }
  return pairs;
}

function summarizeCompressed(pairs) {
  if (!pairs || pairs.length === 0) return null;
  const totalOriginal = pairs.reduce((s, p) => s + p.originalSize, 0);
  const totalCompressed = pairs.reduce((s, p) => s + p.compressedSize, 0);
  const bytesSaved = totalOriginal - totalCompressed;
  const tokensSaved = Math.round(bytesSaved / 4);
  return { count: pairs.length, bytesSaved, tokensSaved };
}

function savingsModel({ inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, mode, model, injectionOverhead = 0 }) {
  const ratio = COMPRESSION[mode] != null ? COMPRESSION[mode] : null;
  let pricingSource = 'session-model'; let resolvedModel = model; if (!resolvedModel) { resolvedModel = getTargetModel(); pricingSource = 'config-default'; } const pricing = pricingCore.pricingForModel(resolvedModel);
  const tokens = {
    input: inputTokens,
    output: outputTokens,
    cache_read: cacheReadTokens,
    cache_write: cacheCreationTokens,
    injection_overhead: injectionOverhead,
  };
  const estimate = pricingCore.estimateBaseline({ tokens, modeRatio: ratio, pricing, injectionOverhead });
  return { ratio, pricing, pricing_source: pricingSource, priced_model: resolvedModel || null, tokens, ...estimate };
}

function deriveSavings({ outputTokens, inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, mode, model }) {
  const s = savingsModel({ outputTokens, inputTokens, cacheReadTokens, cacheCreationTokens, mode, model });
  return {
    estSavedTokens: s.estimatedSavedOutput || 0,
    estSavedUsd: s.savedCostUsd || 0,
  };
}

function parseDuration(spec) {
  if (!spec) return null;
  const m = /^(\d+)([dh])$/.exec(spec.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return m[2] === 'd' ? n * 86_400_000 : n * 3_600_000;
}

function normalizeHistoryEntry(entry) {
  if (entry.schema_version === 2 && entry.tokens) {
    return {
      ts: entry.ts || 0,
      session_id: entry.session_id || '_',
      outputTokens: entry.tokens.output || 0,
      inputTokens: entry.tokens.input || 0,
      cacheReadTokens: entry.tokens.cache_read || 0,
      cacheCreationTokens: entry.tokens.cache_write || 0,
      estSavedTokens: entry.tokens.estimated_saved_output || entry.tokens.estimated_net_saved || 0,
      estSavedUsd: entry.cost_usd ? entry.cost_usd.saved_estimated || 0 : 0,
    };
  }
  return {
    ts: entry.ts || 0,
    session_id: entry.session_id || '_',
    outputTokens: entry.output_tokens || 0,
    inputTokens: entry.input_tokens || 0,
    cacheReadTokens: entry.cache_read_tokens || 0,
    cacheCreationTokens: entry.cache_creation_tokens || 0,
    estSavedTokens: entry.est_saved_tokens || 0,
    estSavedUsd: entry.est_saved_usd || 0,
  };
}

function aggregateHistory(historyPath, sinceMs) {
  const lines = readHistory(historyPath);
  const cutoff = sinceMs ? Date.now() - sinceMs : null;
  const latestPerSession = new Map();
  for (const line of lines) {
    let raw;
    try { raw = JSON.parse(line); } catch { continue; }
    if (!raw || typeof raw !== 'object') continue;
    const entry = normalizeHistoryEntry(raw);
    if (cutoff !== null && entry.ts < cutoff) continue;
    const prev = latestPerSession.get(entry.session_id);
    if (!prev || entry.ts >= prev.ts) latestPerSession.set(entry.session_id, entry);
  }
  let outputTokens = 0, inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, estSavedTokens = 0, estSavedUsd = 0;
  for (const e of latestPerSession.values()) {
    outputTokens += e.outputTokens;
    inputTokens += e.inputTokens;
    cacheReadTokens += e.cacheReadTokens;
    cacheCreationTokens += e.cacheCreationTokens;
    estSavedTokens += e.estSavedTokens;
    estSavedUsd += e.estSavedUsd;
  }
  return { sessions: latestPerSession.size, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, estSavedTokens, estSavedUsd };
}

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function formatHistory({ sessions, inputTokens = 0, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0, estSavedTokens, estSavedUsd, since }) {
  const sep = '----------------------------------';
  const window = since ? ` (last ${since})` : '';
  if (sessions === 0) {
    return `\nCaveman Stats - Lifetime${window}\n${sep}\nNo sessions logged yet - run /caveman-stats inside any session to start tracking.\n${sep}\n`;
  }
  const usdLine = estSavedUsd > 0 ? `Est. saved (USD):      ~${formatUsd(estSavedUsd)}\n` : '';
  return `\nCaveman Stats - Lifetime${window}\n${sep}\n` +
    `Sessions:   ${sessions.toLocaleString()}\n${sep}\n` +
    `Input tokens:          ${inputTokens.toLocaleString()}\n` +
    `Output tokens:         ${outputTokens.toLocaleString()}\n` +
    `Cache-write tokens:    ${cacheCreationTokens.toLocaleString()}\n` +
    `Cache-read tokens:     ${cacheReadTokens.toLocaleString()}\n` +
    `Est. tokens saved:     ${estSavedTokens.toLocaleString()}\n` +
    usdLine + sep + '\n';
}

function formatShare({ inputTokens = 0, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0, turns, mode, model }) {
  if (turns === 0) return '🪨 caveman armed but no turns yet - caveman.sh';
  const s = savingsModel({ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, mode, model });
  if (s.ratio !== null) {
    let usd = '';
    if (s.savedCostUsd != null && s.savedCostUsd > 0) usd = ` (~${formatUsd(s.savedCostUsd)})`;
    return `🪨 Saved ${s.estimatedSavedOutput.toLocaleString()} output tokens${usd} across ${turns} turns this session - caveman.sh`;
  }
  return `🪨 ${turns} turns, ${outputTokens.toLocaleString()} output tokens this session - caveman.sh`;
}

function formatStats({ inputTokens = 0, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0, turns, mode, model, sessionPath, compressed }) {
  const sep = '----------------------------------';
  const shortPath = sessionPath && sessionPath.length > 45
    ? '...' + sessionPath.slice(-45)
    : (sessionPath || '');

  if (turns === 0) {
    return `\nCaveman Stats\n${sep}\nNo conversation yet - stats available after first response.\n${sep}\n`;
  }

  const s = savingsModel({ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, mode, model });
  let savings;
  let footer = '';
  if (s.ratio !== null) {
    const usdLine = s.savedCostUsd != null && s.savedCostUsd > 0
      ? `Est. saved (USD):      ~${formatUsd(s.savedCostUsd)}\n`
      : '';
    savings = `Est. without caveman:  ${s.estimatedBaselineOutput.toLocaleString()}\n` +
              `Est. tokens saved:     ${s.estimatedSavedOutput.toLocaleString()} (~${Math.round(s.ratio * 100)}%)\n` +
              usdLine.replace(/\n$/, '');
    if (s.pricing) footer = `Savings est. from benchmarks/. Pricing for ${model}. Actual varies by task.`;
    else footer = 'Savings est. from benchmarks/. Model pricing unknown; USD not calculated.';
  } else if (mode && mode !== 'off') {
    savings = `No savings estimate for '${mode}' mode - only 'full' has benchmark data.`;
  } else {
    savings = 'Caveman not active this session.';
  }

  let costLine = '';
  if (s.actualCostUsd != null) costLine = `Estimated actual cost: ~${formatUsd(s.actualCostUsd)}\n`;
  else if (model) costLine = `Estimated actual cost: unknown pricing for ${model}\n`;

  let memoryLine = '';
  if (compressed && compressed.count > 0) {
    memoryLine = `${sep}\nMemory compressed:     ${compressed.count} file${compressed.count === 1 ? '' : 's'}, ` +
      `~${compressed.tokensSaved.toLocaleString()} tokens saved per session start (approx)\n`;
  }

  return `\nCaveman Stats\n${sep}\n` +
    (shortPath ? `Session:  ${shortPath}\n` : '') +
    `Turns:    ${turns}\n${sep}\n` +
    `Input tokens:          ${inputTokens.toLocaleString()}\n` +
    `Output tokens:         ${outputTokens.toLocaleString()}\n` +
    `Cache-write tokens:    ${cacheCreationTokens.toLocaleString()}\n` +
    `Cache-read tokens:     ${cacheReadTokens.toLocaleString()}\n${sep}\n` +
    costLine +
    `${savings}\n` +
    memoryLine +
    (footer ? footer + '\n' : '');
}

function jsonPayload({ parsed, mode, sessionFile, compressed }) {
  const s = savingsModel({ ...parsed, mode });
  return {
    schema_version: 2,
    model: parsed.model || null,
    mode: mode || null,
    turns: parsed.turns,
    session_path: sessionFile || null,
    tokens: {
      input: parsed.inputTokens,
      output: parsed.outputTokens,
      cache_read: parsed.cacheReadTokens,
      cache_write: parsed.cacheCreationTokens,
      injection_overhead: 0,
      estimated_baseline_output: s.estimatedBaselineOutput || 0,
      estimated_saved_output: s.estimatedSavedOutput || 0,
      estimated_net_saved: s.estimatedNetSaved || 0,
    },
    cost_usd: {
      actual: s.actualCostUsd,
      baseline_estimated: s.baselineCostUsd,
      saved_estimated: s.savedCostUsd,
    },
    confidence: s.ratio == null ? 'tokens_only_no_benchmark_ratio' : 'estimated_from_benchmark_ratio',
    pricing_source: s.pricing ? s.pricing.source : null,
    compressed_memory: compressed || null,
    notes: [
      'Output savings estimated from benchmark ratio for mode/model.',
      s.pricing ? 'Cost uses local pricing table.' : 'Unknown model pricing; cost not calculated.',
      'Use /caveman-bench --model claude-opus-4-8 to calibrate.',
    ],
  };
}

function appendSessionHistory(historyPath, sessionFile, parsed, mode) {
  if (parsed.turns <= 0) return;
  const payload = jsonPayload({ parsed, mode, sessionFile, compressed: null });
  const sessionId = path.basename(sessionFile, '.jsonl');
  appendFlag(historyPath, JSON.stringify({
    ...payload,
    ts: Date.now(),
    session_id: sessionId,
    // v1 compatibility fields.
    input_tokens: parsed.inputTokens,
    output_tokens: parsed.outputTokens,
    cache_read_tokens: parsed.cacheReadTokens,
    cache_creation_tokens: parsed.cacheCreationTokens,
    est_saved_tokens: payload.tokens.estimated_saved_output,
    est_saved_usd: payload.cost_usd.saved_estimated || 0,
  }));
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--session-file');
  const sessionFileArg = i !== -1 ? args[i + 1] : null;
  const share = args.includes('--share');
  const all = args.includes('--all');
  const json = args.includes('--json');
  const sinceIdx = args.indexOf('--since');
  const sinceArg = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const historyPath = path.join(claudeDir, '.caveman-history.jsonl');

  if (all || sinceArg) {
    const sinceMs = parseDuration(sinceArg);
    if (sinceArg && sinceMs === null) {
      process.stderr.write(`caveman-stats: --since takes Nh or Nd (e.g. 7d, 24h), got: ${sinceArg}\n`);
      process.exit(2);
    }
    const agg = aggregateHistory(historyPath, sinceMs);
    if (json) {
      process.stdout.write(JSON.stringify({ schema_version: 2, kind: 'history', since: sinceArg || null, ...agg }, null, 2) + '\n');
    } else {
      process.stdout.write(formatHistory({ ...agg, since: sinceArg || null }));
    }
    return;
  }

  const sessionFile = sessionFileArg || findRecentSession(claudeDir);
  if (!sessionFile) {
    process.stderr.write('caveman-stats: no Claude Code session found.\n');
    process.exit(1);
  }

  const parsed = parseSession(sessionFile);
  const mode = readFlag(path.join(claudeDir, '.caveman-active'));
  const scanDirs = [claudeDir, process.cwd()].filter((d, idx, arr) => arr.indexOf(d) === idx);
  const compressed = summarizeCompressed(findCompressedPairs(scanDirs));

  appendSessionHistory(historyPath, sessionFile, parsed, mode);
  if (parsed.turns > 0) {
    const agg = aggregateHistory(historyPath, null);
    const suffix = agg.estSavedTokens > 0 ? `⛏ ${humanizeTokens(agg.estSavedTokens)}` : '';
    safeWriteFlag(path.join(claudeDir, '.caveman-statusline-suffix'), suffix);
  }

  if (json) {
    process.stdout.write(JSON.stringify(jsonPayload({ parsed, mode, sessionFile, compressed }), null, 2) + '\n');
  } else if (share) {
    process.stdout.write(formatShare({ ...parsed, mode }) + '\n');
  } else {
    process.stdout.write(formatStats({ ...parsed, mode, sessionPath: sessionFile, compressed }));
  }
}

if (require.main === module) main();

module.exports = {
  formatStats,
  formatShare,
  formatHistory,
  aggregateHistory,
  parseDuration,
  deriveSavings,
  parseSession,
  priceForModel,
  formatUsd,
  COMPRESSION,
  MODEL_OUTPUT_PRICE_PER_M: Object.entries(pricingCore.MODEL_PRICING || {}).map(([model, p]) => [model, p.outputPerMTok]),
  findCompressedPairs,
  summarizeCompressed,
  humanizeTokens,
  jsonPayload,
  savingsModel,
};
