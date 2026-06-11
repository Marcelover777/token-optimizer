import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compressDeterministic } = require('../../src/core/deterministic-compress.js');

test('compresses prose while preserving protected code and URLs', () => {
  const input = 'Sure, you can basically read `the exact value` at https://example.com/the/path in order to fix the issue.';
  const out = compressDeterministic(input, { mode: 'full' });
  assert.ok(out.afterChars < out.beforeChars);
  assert.match(out.compressed, /`the exact value`/);
  assert.match(out.compressed, /https:\/\/example\.com\/the\/path/);
  assert.doesNotMatch(out.compressed, /\bSure\b/i);
  assert.doesNotMatch(out.compressed, /\bbasically\b/i);
});

test('lite keeps articles', () => {
  const out = compressDeterministic('The user can read the file.', { mode: 'lite' });
  assert.match(out.compressed, /\bThe user\b/);
});
