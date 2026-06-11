#!/usr/bin/env node
// caveman-shrink - MCP stdio proxy that compresses safe list descriptions.

const { spawn } = require('child_process');
const { JsonRpcFramer } = require('./framing');
const { transformResponse } = require('./transform');

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('caveman-shrink: missing upstream command.\n');
  process.stderr.write('Usage: caveman-shrink <upstream-command> [...args]\n');
  process.exit(2);
}

const debug = process.env.CAVEMAN_SHRINK_DEBUG === '1';
const fields = (process.env.CAVEMAN_SHRINK_FIELDS || 'description')
  .split(',').map(s => s.trim()).filter(Boolean);
const opts = {
  debug,
  fields,
  cache: process.env.CAVEMAN_SHRINK_CACHE !== '0',
  compressNestedSchemas: process.env.CAVEMAN_SHRINK_NESTED_SCHEMA === '1',
  preserveInputSchema: true,
  mode: process.env.CAVEMAN_SHRINK_MODE || 'full',
  serverId: args.join(' '),
};

const upstream = spawn(args[0], args.slice(1), {
  stdio: ['pipe', 'pipe', 'inherit'],
});

upstream.on('error', err => {
  process.stderr.write(`caveman-shrink: failed to spawn upstream: ${err.message}\n`);
  process.exit(1);
});

upstream.on('exit', (code, signal) => {
  if (signal) process.exit(128 + (signal === 'SIGTERM' ? 15 : 9));
  process.exit(code || 0);
});

const clientFramer = new JsonRpcFramer({ mode: process.env.CAVEMAN_SHRINK_FRAMING || 'auto' });
const serverFramer = new JsonRpcFramer({ mode: process.env.CAVEMAN_SHRINK_FRAMING || 'auto' });
const pending = new Map();

process.stdin.on('data', chunk => {
  // Forward request bytes unchanged. We parse a side copy only to map id->method.
  upstream.stdin.write(chunk);
  for (const frame of clientFramer.push(chunk)) {
    const msg = frame.message;
    if (msg && msg.id != null && msg.method) pending.set(String(msg.id), msg.method);
  }
});
process.stdin.on('end', () => upstream.stdin.end());

upstream.stdout.on('data', chunk => {
  const frames = serverFramer.push(chunk);
  if (frames.length === 0) return;
  for (const frame of frames) {
    if (!frame.message) {
      process.stdout.write(frame.raw);
      continue;
    }
    const id = frame.message.id != null ? String(frame.message.id) : null;
    const method = id ? pending.get(id) : null;
    if (id) pending.delete(id);
    const out = transformResponse(frame.message, method, opts);
    process.stdout.write(serverFramer.encode(out, frame.mode));
  }
});
