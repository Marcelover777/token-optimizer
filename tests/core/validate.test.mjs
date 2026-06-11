import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateCompression } = require('../../src/core/validate.js');

test('validates preserved markdown invariants', () => {
  const original = '# A\n\nSee https://example.com and `API_KEY`.\n\n```js\nconst x = 1;\n```\n';
  const compressed = '# A\n\nSee https://example.com + `API_KEY`.\n\n```js\nconst x = 1;\n```\n';
  const result = validateCompression(original, compressed);
  assert.equal(result.ok, true);
});

test('fails when code block changes', () => {
  const original = '```js\nconst x = 1;\n```\n';
  const compressed = '```js\nconst x = 2;\n```\n';
  const result = validateCompression(original, compressed, { strict: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'fenced_code_changed');
});
