import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { splitMarkdownSections, splitFencedRuns } = require('../../src/core/markdown-sections.js');

const MIXED = [
  '# Title',
  '',
  'Some prose before code that should compress.',
  '',
  '```js',
  'const x = 1; // code stays verbatim',
  'function f() { return x; }',
  '```',
  '',
  'More prose after the fenced block.',
  '',
  '## Second',
  '',
  'Tail prose.',
  '',
].join('\n');

test('splitMarkdownSections reconstructs the file byte-for-byte', () => {
  const secs = splitMarkdownSections(MIXED);
  assert.equal(secs.map(s => s.text).join(''), MIXED);
});

test('prose and fenced-code runs are separated, code tagged kind=code', () => {
  const secs = splitMarkdownSections(MIXED);
  const code = secs.filter(s => s.kind === 'code');
  assert.equal(code.length, 1);
  assert.match(code[0].text, /```js[\s\S]*```/);
  assert.ok(secs.some(s => s.kind === 'prose' && /Some prose before/.test(s.text)));
  assert.ok(secs.some(s => s.kind === 'prose' && /More prose after/.test(s.text)));
});

test('splitFencedRuns is a no-op partition on pure prose', () => {
  const runs = splitFencedRuns('just prose, no fences here');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'prose');
});

test('unclosed fence trails as a code run (no crash, exact round-trip)', () => {
  const t = 'intro\n```sh\nnpm test\n';
  const runs = splitFencedRuns(t);
  assert.equal(runs.map(r => r.text).join(''), t);
  assert.equal(runs[runs.length - 1].kind, 'code');
});
