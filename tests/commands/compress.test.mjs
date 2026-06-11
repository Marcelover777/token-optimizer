import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compressFile, splitLeadingHeading, extractTextContent, buildCompressPrompt } = require('../../src/commands/caveman-compress.js');

test('local-only check writes nothing and preserves code block', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-compress-'));
  const file = path.join(dir, 'CLAUDE.md');
  const original = '# Notes\n\nSure, you can basically run tests in order to catch the issue.\n\n```sh\nnpm test -- --the-flag\n```\n';
  fs.writeFileSync(file, original);
  const result = await compressFile({ file, check: true, localOnly: true, strict: true, noCache: true });
  assert.equal(result.ok, true);
  assert.match(result.compressed, /npm test -- --the-flag/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('secret fixture aborts before compression', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-secret-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, 'Token: github_pat_abcdefghijklmnopqrstuvwxyz1234567890\n');
  const result = await compressFile({ file, check: true, localOnly: true, strict: true, noCache: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'secret_scan');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('splitLeadingHeading preserves markdown heading exactly', () => {
  const result = splitLeadingHeading('## Title Here\n\nSure, basically compress body.');
  assert.equal(result.heading, '## Title Here\n');
  assert.equal(result.body, '\nSure, basically compress body.');
});

test('local-only check preserves fixture headings', async () => {
  const fixture = path.resolve('tests/caveman-compress/project-notes.md');
  const original = fs.readFileSync(fixture, 'utf8');
  const result = await compressFile({ file: fixture, check: true, localOnly: true, strict: true, noCache: true });
  assert.equal(result.ok, true);
  assert.equal((result.compressed.match(/^#{1,6}\s+/gm) || []).length, (original.match(/^#{1,6}\s+/gm) || []).length);
  assert.equal(fs.readFileSync(fixture, 'utf8'), original);
});

test('exhausted budget skips LLM with budget_exhausted fallback and no network call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-budget-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, '# Notes\n\nThe export pipeline reads rows from the warehouse, converts them into CSV batches, uploads each batch to object storage, then notifies the consumer queue when finished. Operators monitor failures with the nightly report and reprocess bad batches by hand when needed.\n');
  const budget = { exhausted: () => true };
  const result = await compressFile({ file, check: true, llmModel: 'claude-fable-5', strict: true, noCache: true, budget });
  assert.equal(result.ok, true);
  const fallbacks = result.sections.map(s => s.fallback).filter(Boolean);
  assert.ok(fallbacks.some(f => f.reason === 'budget_exhausted'));
  assert.equal(result.llm.sections_accepted, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repair prompt names violated invariants and previous attempt', () => {
  const prompt = buildCompressPrompt('masked text', 'full', {
    errors: [{ code: 'list_shape_changed', message: 'List nesting shape changed' }],
    previous: 'bad earlier output',
  });
  assert.match(prompt, /REPAIR PASS/);
  assert.match(prompt, /list_shape_changed/);
  assert.match(prompt, /bad earlier output/);
  assert.match(prompt, /__CAVEMAN_PROTECTED_/);
});

test('extractTextContent skips thinking blocks', () => {
  const message = {
    content: [
      { type: 'thinking', thinking: 'hidden' },
      { type: 'text', text: 'Compressed output.' },
    ],
  };
  assert.equal(extractTextContent(message), 'Compressed output.');
});
