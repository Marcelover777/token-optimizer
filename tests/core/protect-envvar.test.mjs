import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { protectSegments, restoreSegments } = require('../../src/core/protect.js');

test('env-var protector freezes real identifiers but frees prose ALL-CAPS', () => {
  const t = 'NOTE: This SHOULD use HTTP and return JSON; set API_KEY, read $HOME and MAX_FLAG_BYTES.';
  const r = protectSegments(t);
  const env = r.segments.filter(s => s.type === 'env_var').map(s => s.value);
  // Real identifiers / env vars stay frozen
  assert.ok(env.includes('API_KEY'), 'API_KEY frozen');
  assert.ok(env.includes('$HOME'), '$HOME frozen');
  assert.ok(env.includes('MAX_FLAG_BYTES'), 'MAX_FLAG_BYTES frozen');
  // Prose ALL-CAPS without underscore/$ are no longer frozen (so they compress)
  assert.ok(!env.includes('NOTE'), 'NOTE not frozen');
  assert.ok(!env.includes('SHOULD'), 'SHOULD not frozen');
  assert.ok(!env.includes('HTTP'), 'HTTP not frozen');
  assert.ok(!env.includes('JSON'), 'JSON not frozen');
  // Round-trip must still be exact
  assert.equal(restoreSegments(r.text, r.segments), t);
});
