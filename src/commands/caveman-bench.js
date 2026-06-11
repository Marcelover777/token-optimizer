#!/usr/bin/env node
// caveman-bench — offline token estimates plus an opt-in, budget-guarded
// online benchmark against the Anthropic API.
//
//   node src/commands/caveman-bench.js --offline --report
//   node src/commands/caveman-bench.js --online [--max-spend 1] [--model claude-fable-5] [--report]
//
// Online mode never exceeds --max-spend (default $1.00) and refuses any value
// above the hard cap of $15.00. Spend is computed from API-reported usage via
// src/core/pricing.js, with a conservative pre-call worst-case guard.
const fs = require('fs');
const path = require('path');
const { loadLocalEnv } = require('../core/env');
const { estimateTokensFromText } = require('../core/token-count');
const { pricingForModel, costForUsage, formatUsd } = require('../core/pricing');

const ROOT = path.resolve(__dirname, '..', '..');
const HARD_CAP_USD = 15;
const DEFAULT_MAX_SPEND_USD = 1;
const ONLINE_MAX_TOKENS = 800;
loadLocalEnv({ root: ROOT });

// Frozen V1 baselines so the improved branch is always compared against the
// state documented in docs/fable5-next-optimizer-brief.md, not against upstream.
const V1_REFERENCE = {
  micro_full_line: 'CAVEMAN full. Terse. Drop filler/pleasantry/hedge/articles. Fragments OK. Preserve code, ids, paths, URLs, numbers, errors exact. Normal prose for safety/destructive/ambiguous multi-step. Persist until off.',
  doc_compression: { 'project-notes.md': 0.1147, 'mixed-with-code.md': 0.0355 },
};

function loadSnapshots() {
  const file = path.join(ROOT, 'evals', 'snapshots', 'results.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function readMicroLine(label) {
  try {
    const content = fs.readFileSync(path.join(ROOT, 'skills', 'caveman', 'MICRO.md'), 'utf8');
    const hit = content.split('\n').map(s => s.trim()).find(line => line.startsWith(`CAVEMAN ${label}.`));
    if (hit) return hit;
  } catch (_) {}
  return V1_REFERENCE.micro_full_line;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function summarizeReductions(reductions) {
  const sorted = [...reductions].sort((a, b) => a - b);
  return {
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    p50: percentile(sorted, 0.5),
    worst: sorted.length ? sorted[0] : 0,
    best: sorted.length ? sorted[sorted.length - 1] : 0,
    n: sorted.length,
  };
}

function offlineReport() {
  const snapshots = loadSnapshots();
  const promptsDir = path.join(ROOT, 'evals', 'prompts');
  const promptFiles = fs.existsSync(promptsDir) ? fs.readdirSync(promptsDir).filter(f => f.endsWith('.txt')) : [];
  const promptTokens = promptFiles.map(file => {
    const text = fs.readFileSync(path.join(promptsDir, file), 'utf8');
    return { file, approx_tokens: estimateTokensFromText(text), chars: text.length };
  });
  const microFull = readMicroLine('full');
  return {
    schema_version: 2,
    mode: 'offline',
    snapshots_present: !!snapshots,
    arms: ['baseline', 'terse', 'caveman-current-full', 'fable-micro-full', 'fable-adaptive-full', 'fable-lite', 'fable-ultra', 'local-compress-only', 'hybrid-compress'],
    prompts: promptTokens,
    injection_overhead: {
      micro_full_line_tokens: estimateTokensFromText(microFull),
      v1_micro_full_line_tokens: estimateTokensFromText(V1_REFERENCE.micro_full_line),
    },
    recommendation: 'Use fable-micro-full as default until online evals prove hybrid/adaptive quality >=4.',
  };
}

// ---------------------------------------------------------------------------
// Online mode
// ---------------------------------------------------------------------------

function makeSpendGuard(maxUsd, pricing) {
  const totals = { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 };
  return {
    totals,
    spentUsd() { return costForUsage(totals, pricing) || 0; },
    record(usage) {
      totals.calls += 1;
      totals.input += usage.input_tokens || 0;
      totals.output += usage.output_tokens || 0;
      totals.cache_read += usage.cache_read_input_tokens || 0;
      totals.cache_write += usage.cache_creation_input_tokens || 0;
    },
    // Worst-case projection: current spend + full input estimate + max output.
    canAfford(inputTokensEstimate, maxOutputTokens) {
      const projected = this.spentUsd() + costForUsage({ input: inputTokensEstimate, output: maxOutputTokens }, pricing);
      return projected <= maxUsd;
    },
    exhausted() { return this.spentUsd() >= maxUsd; },
  };
}

async function anthropicMessage({ model, system, prompt, maxTokens, apiKey }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic message failed: HTTP ${res.status}`);
  const json = await res.json();
  const text = (json.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  return { text, usage: json.usage || {}, stopReason: json.stop_reason };
}

function loadOnlinePrompts() {
  // Representative mix: EN dev, PT-BR, agentic coding. Two prompts per file
  // keeps the default run inside the $1 budget.
  const spec = [
    ['dev-short.txt', 2, 'en-dev'],
    ['pt-br.txt', 2, 'pt-br'],
    ['agentic-coding.txt', 2, 'agentic'],
  ];
  const prompts = [];
  for (const [file, count, tag] of spec) {
    try {
      const lines = fs.readFileSync(path.join(ROOT, 'evals', 'prompts', file), 'utf8')
        .split('\n').map(s => s.trim()).filter(Boolean);
      for (const line of lines.slice(0, count)) prompts.push({ tag, file, prompt: line });
    } catch (_) {}
  }
  return prompts;
}

async function runOutputArms({ model, pricing, guard, apiKey, failures }) {
  const microFull = readMicroLine('full');
  const arms = [
    { id: 'baseline', system: null },
    { id: 'v1-micro-full', system: V1_REFERENCE.micro_full_line },
    { id: 'micro-full', system: microFull },
  ];
  const prompts = loadOnlinePrompts();
  const rows = [];
  for (const item of prompts) {
    const row = { ...item, outputs: {} };
    for (const arm of arms) {
      const inputEstimate = estimateTokensFromText((arm.system || '') + item.prompt) + 16;
      if (!guard.canAfford(inputEstimate, ONLINE_MAX_TOKENS)) {
        row.outputs[arm.id] = { skipped: 'budget' };
        continue;
      }
      try {
        const res = await anthropicMessage({ model, system: arm.system, prompt: item.prompt, maxTokens: ONLINE_MAX_TOKENS, apiKey });
        guard.record(res.usage);
        row.outputs[arm.id] = {
          output_tokens: res.usage.output_tokens || 0,
          input_tokens: res.usage.input_tokens || 0,
          stop_reason: res.stopReason,
          chars: res.text.length,
        };
      } catch (error) {
        failures.push({ surface: 'output-arms', arm: arm.id, prompt: item.prompt.slice(0, 60), error: error.message });
        row.outputs[arm.id] = { error: error.message };
      }
    }
    rows.push(row);
  }

  const reductions = { 'v1-micro-full': [], 'micro-full': [] };
  for (const row of rows) {
    const base = row.outputs.baseline && row.outputs.baseline.output_tokens;
    if (!base) continue;
    for (const armId of Object.keys(reductions)) {
      const out = row.outputs[armId] && row.outputs[armId].output_tokens;
      if (out != null) reductions[armId].push((base - out) / base);
    }
  }
  return {
    arms: arms.map(a => a.id),
    prompts_run: rows.length,
    rows,
    output_reduction_vs_baseline: {
      'v1-micro-full': summarizeReductions(reductions['v1-micro-full']),
      'micro-full': summarizeReductions(reductions['micro-full']),
    },
  };
}

async function runDocCompressionSmoke({ model, pricing, guard, failures }) {
  const { compressFile, getLlmUsage, resetLlmUsage } = require('./caveman-compress');
  const docsDir = path.join(ROOT, 'evals', 'fixtures', 'docs');
  const files = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter(f => f.endsWith('.md')) : [];
  const results = [];
  for (const file of files) {
    const full = path.join(docsDir, file);
    const entry = { file };
    try {
      const localRes = await compressFile({ file: full, check: true, localOnly: true, strict: true, noCache: true });
      entry.local_only = { ok: localRes.ok, savings_ratio: localRes.metrics ? localRes.metrics.savingsRatio : 0 };
    } catch (error) {
      failures.push({ surface: 'doc-compress-local', file, error: error.message });
      entry.local_only = { ok: false, error: error.message };
    }
    if (guard.exhausted()) {
      entry.hybrid = { skipped: 'budget' };
      results.push(entry);
      continue;
    }
    try {
      resetLlmUsage();
      const budget = {
        exhausted: () => guard.exhausted() || !guard.canAfford(0, 0) ||
          (guard.spentUsd() + (costForUsage(getLlmUsage(), pricing) || 0)) >= guard.maxUsd,
      };
      const hybridRes = await compressFile({ file: full, check: true, localOnly: false, llmModel: model, strict: true, noCache: true, budget });
      guard.record({
        input_tokens: getLlmUsage().input,
        output_tokens: getLlmUsage().output,
        cache_read_input_tokens: getLlmUsage().cache_read,
        cache_creation_input_tokens: getLlmUsage().cache_write,
      });
      entry.hybrid = {
        ok: hybridRes.ok,
        savings_ratio: hybridRes.metrics ? hybridRes.metrics.savingsRatio : 0,
        llm: hybridRes.llm || null,
      };
    } catch (error) {
      failures.push({ surface: 'doc-compress-hybrid', file, error: error.message });
      entry.hybrid = { ok: false, error: error.message };
    }
    results.push(entry);
  }
  return { files: results, v1_reference: V1_REFERENCE.doc_compression };
}

async function onlineReport(opts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for --online');
  const model = opts.model || 'claude-fable-5';
  const pricing = pricingForModel(model);
  if (!pricing) throw new Error(`No pricing known for model: ${model}`);
  let maxSpend = Number.isFinite(opts.maxSpend) ? opts.maxSpend : DEFAULT_MAX_SPEND_USD;
  if (maxSpend > HARD_CAP_USD) throw new Error(`--max-spend ${maxSpend} exceeds hard cap of $${HARD_CAP_USD}`);
  if (maxSpend <= 0) throw new Error('--max-spend must be > 0');

  const guard = makeSpendGuard(maxSpend, pricing);
  guard.maxUsd = maxSpend;
  const failures = [];

  const outputArms = await runOutputArms({ model, pricing, guard, apiKey, failures });
  const docCompression = await runDocCompressionSmoke({ model, pricing, guard, failures });

  const totals = guard.totals;
  return {
    schema_version: 2,
    mode: 'online',
    model,
    budget: { max_spend_usd: maxSpend, hard_cap_usd: HARD_CAP_USD },
    spend: {
      total_usd: guard.spentUsd(),
      total_usd_formatted: formatUsd(guard.spentUsd()),
      tokens: { ...totals },
    },
    surfaces: {
      output: outputArms,
      doc_compression: docCompression,
    },
    failures,
    fidelity_verdict: failures.length === 0 ? 'no_critical_failures' : 'see_failures',
  };
}

function writeReport(report) {
  const dir = path.join(ROOT, 'evals', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const suffix = report.mode === 'online' ? '-online' : '';
  const jsonPath = path.join(dir, `fable5-${date}${suffix}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  return { jsonPath };
}

function parseArgs(argv) {
  const opts = { offline: false, online: false, report: false, maxSpend: undefined, model: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--offline') opts.offline = true;
    else if (arg === '--online') opts.online = true;
    else if (arg === '--report') opts.report = true;
    else if (arg === '--max-spend') opts.maxSpend = Number(argv[++i]);
    else if (arg === '--model') opts.model = argv[++i];
  }
  return opts;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = opts.online ? await onlineReport(opts) : offlineReport();
    if (opts.report) report.report_files = writeReport(report);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`caveman-bench: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { offlineReport, onlineReport, writeReport, makeSpendGuard, summarizeReductions, parseArgs, V1_REFERENCE, HARD_CAP_USD, DEFAULT_MAX_SPEND_USD };
