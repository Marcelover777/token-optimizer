import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeSpendGuard, summarizeReductions, parseArgs, HARD_CAP_USD, DEFAULT_MAX_SPEND_USD, offlineReport } = require('../../src/commands/caveman-bench.js');
const { pricingForModel } = require('../../src/core/pricing.js');

test('spend guard blocks calls that would exceed the budget', () => {
  const pricing = pricingForModel('claude-fable-5');
  const guard = makeSpendGuard(0.01, pricing);
  guard.maxUsd = 0.01;
  // 0.01 USD at $50/MTok output = 200 output tokens max.
  assert.equal(guard.canAfford(0, 100), true);
  assert.equal(guard.canAfford(0, 100000), false);
  guard.record({ input_tokens: 0, output_tokens: 200 });
  assert.equal(guard.exhausted(), true);
});

test('spend guard accumulates all four usage buckets', () => {
  const pricing = pricingForModel('claude-fable-5');
  const guard = makeSpendGuard(10, pricing);
  guard.record({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 });
  assert.deepEqual(
    { input: guard.totals.input, output: guard.totals.output, cache_read: guard.totals.cache_read, cache_write: guard.totals.cache_write },
    { input: 100, output: 50, cache_read: 30, cache_write: 20 }
  );
  assert.ok(guard.spentUsd() > 0);
});

test('summarizeReductions reports p50 and worst case', () => {
  const s = summarizeReductions([0.5, 0.7, 0.2]);
  assert.equal(s.p50, 0.5);
  assert.equal(s.worst, 0.2);
  assert.equal(s.n, 3);
});

test('default budget is $1 and hard cap is $15', () => {
  assert.equal(DEFAULT_MAX_SPEND_USD, 1);
  assert.equal(HARD_CAP_USD, 15);
  const opts = parseArgs(['--online', '--max-spend', '2.5']);
  assert.equal(opts.online, true);
  assert.equal(opts.maxSpend, 2.5);
});

test('offline report includes injection overhead estimates', () => {
  const report = offlineReport();
  assert.equal(report.mode, 'offline');
  assert.ok(report.injection_overhead.micro_full_line_tokens > 0);
  // The Fable-tuned MICRO line deliberately spends more injected tokens than
  // the V1 line (~85 vs ~52 estimated) to carry the agent-loop rules
  // (final-message cap, no tool narration, no code re-printing) that dominate
  // savings in agentic sessions. Guard against runaway growth instead of
  // pinning to the V1 size.
  assert.ok(report.injection_overhead.micro_full_line_tokens <= 95);
});
