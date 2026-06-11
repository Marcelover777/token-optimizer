import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformResponse } = require('../../src/mcp-servers/caveman-shrink/transform.js');

test('transforms tools/list descriptions and preserves inputSchema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-mcp-'));
  const msg = { id: 1, result: { tools: [{ name: 'weather', description: 'Sure, this just returns the current weather for the city.', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }] } };
  const out = transformResponse(msg, 'tools/list', { cachePath: path.join(dir, 'cache.json') });
  assert.notEqual(out.result.tools[0].description, msg.result.tools[0].description);
  assert.deepEqual(out.result.tools[0].inputSchema, msg.result.tools[0].inputSchema);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('does not transform tools/call by default', () => {
  const msg = { id: 1, result: { content: [{ type: 'text', text: 'Sure, the result.' }] } };
  assert.deepEqual(transformResponse(msg, 'tools/call'), msg);
});
