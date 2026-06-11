import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JsonRpcFramer } = require('../../src/mcp-servers/caveman-shrink/framing.js');

test('parses newline JSON', () => {
  const framer = new JsonRpcFramer({ mode: 'auto' });
  const frames = framer.push(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].message.method, 'tools/list');
  assert.equal(frames[0].mode, 'newline-json');
});

test('parses Content-Length JSON', () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
  const framer = new JsonRpcFramer({ mode: 'auto' });
  const frames = framer.push(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].message.result.tools, []);
  assert.equal(framer.encode(frames[0].message, frames[0].mode).toString().startsWith('Content-Length:'), true);
});
