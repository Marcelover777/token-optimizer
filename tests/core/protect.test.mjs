import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { protectSegments, restoreSegments, verifySegments } = require('../../src/core/protect.js');

test('protect/restore round trips technical spans', () => {
  const input = [
    '# Title',
    'Use `API_KEY` and https://example.com/docs.',
    'Run:',
    '```sh',
    'npm install the-package',
    '```',
    'Path C:\\tmp\\file.txt and /tmp/file.txt stay.',
  ].join('\n');
  const protectedResult = protectSegments(input);
  assert.ok(protectedResult.segments.length >= 4);
  const restored = restoreSegments(protectedResult.text, protectedResult.segments);
  assert.equal(restored, input);
  assert.equal(verifySegments(input, restored, protectedResult.segments).ok, true);
});
