import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanSecrets } = require('../../src/core/secret-scan.js');

test('blocks known secret content before LLM', () => {
  const result = scanSecrets({ content: 'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz123456' });
  assert.equal(result.ok, false);
  assert.equal(result.action, 'abort_before_llm');
});

test('blocks sensitive paths', () => {
  const result = scanSecrets({ filePath: 'C:/repo/.aws/credentials', content: 'docs only' });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].type, 'sensitive_path');
});
