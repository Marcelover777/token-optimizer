import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvFile } = require('../../src/core/env.js');

test('loadEnvFile reads local keys without overriding existing env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-env-'));
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, 'ANTHROPIC_API_KEY=from-file\nKEEP=from-file\nQUOTED=\"hello world\"\n');
  const env = { KEEP: 'already-set' };
  const result = loadEnvFile(file, { env });
  assert.equal(result.loaded, true);
  assert.deepEqual(result.keys, ['ANTHROPIC_API_KEY', 'QUOTED']);
  assert.equal(env.ANTHROPIC_API_KEY, 'from-file');
  assert.equal(env.KEEP, 'already-set');
  assert.equal(env.QUOTED, 'hello world');
  fs.rmSync(dir, { recursive: true, force: true });
});
