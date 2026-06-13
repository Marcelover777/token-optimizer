import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pricingForModel, outputPriceForModel, costForUsage } = require('../../src/core/pricing.js');

test('Fable 5 resolves to an exact entry with the 2026-06-10 source', () => {
  const p = pricingForModel('claude-fable-5');
  assert.equal(p.model, 'claude-fable-5');
  assert.equal(p.outputPerMTok, 50);
  assert.equal(p.source, 'anthropic-pricing-2026-06-10');
});

test('Opus 4.8 resolves to an explicit, model-aware entry (not a prefix fallback)', () => {
  const p = pricingForModel('claude-opus-4-8');
  assert.equal(p.model, 'claude-opus-4-8');
  assert.equal(p.outputPerMTok, 75);
  // Honest provenance: inherited from the Opus 4 family, not a verified 4.8 price.
  assert.equal(p.source, 'inherited-opus-4-family-unverified');
});

test('Opus 4.8 1M-context variant prefix-matches the explicit 4.8 entry', () => {
  // The exact session model id is e.g. "claude-opus-4-8[1m]"; the longer
  // "claude-opus-4-8" key must win over the shorter "claude-opus-4" key.
  const p = pricingForModel('claude-opus-4-8[1m]');
  assert.equal(p.model, 'claude-opus-4-8');
  assert.equal(p.outputPerMTok, 75);
});

test('plain Opus 4 still resolves to its own entry', () => {
  const p = pricingForModel('claude-opus-4');
  assert.equal(p.model, 'claude-opus-4');
  assert.equal(p.source, 'anthropic-pricing-prefix');
});

test('Opus output costs 1.5x Fable per output token, so equal % savings = larger $ savings', () => {
  assert.equal(outputPriceForModel('claude-opus-4-8'), 75);
  assert.equal(outputPriceForModel('claude-fable-5'), 50);
  const cut = { output: 1000 };
  const opusSaved = costForUsage(cut, pricingForModel('claude-opus-4-8'));
  const fableSaved = costForUsage(cut, pricingForModel('claude-fable-5'));
  assert.equal(opusSaved > fableSaved, true);
  assert.equal(Math.round((opusSaved / fableSaved) * 100) / 100, 1.5);
});

test('unknown model returns null rather than guessing', () => {
  assert.equal(pricingForModel('gpt-9'), null);
  assert.equal(pricingForModel(''), null);
  assert.equal(pricingForModel(undefined), null);
});
