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

test('phrase rewrites compress verbose English safely', () => {
  const out = compressDeterministic('It is important to note that the service utilizes Redis in order to cache, and in most cases requests are able to hit the cache.', { mode: 'full' });
  assert.match(out.compressed, /\buses\b/);
  assert.match(out.compressed, /\bcan hit\b/);
  assert.doesNotMatch(out.compressed, /important to note/i);
  assert.doesNotMatch(out.compressed, /in order to/i);
});

test('PT-BR phrase rewrites work', () => {
  const out = compressDeterministic('É importante notar que, devido ao fato de que o volume cresceu, certifique-se de revisar a fila. Além disso, basicamente tudo funciona.', { mode: 'full' });
  assert.match(out.compressed, /porque/i);
  assert.match(out.compressed, /garanta/);
  assert.doesNotMatch(out.compressed, /importante notar/i);
  assert.doesNotMatch(out.compressed, /basicamente/i);
});

test('lite keeps articles', () => {
  const out = compressDeterministic('The user can read the file.', { mode: 'lite' });
  assert.match(out.compressed, /\bThe user\b/);
});
