import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { savingsModel } = require('../../src/hooks/caveman-stats.js');

test('savingsModel falls back to config target model when the log has no model', () => {
  const r = savingsModel({ outputTokens: 1000, mode: 'full', model: null });
  assert.equal(r.pricing_source, 'config-default');
  assert.ok(r.pricing && r.pricing.outputPerMTok > 0, 'priced via config default');
  assert.ok(r.savedCostUsd != null, 'USD estimate no longer vanishes');
  assert.ok(r.priced_model, 'priced_model recorded');
});

test('savingsModel uses the session model when present', () => {
  const r = savingsModel({ outputTokens: 1000, mode: 'full', model: 'claude-opus-4-8' });
  assert.equal(r.pricing_source, 'session-model');
  assert.equal(r.priced_model, 'claude-opus-4-8');
});
