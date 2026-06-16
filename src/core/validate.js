const { hasLeakedSentinel } = require('./protect');

function collect(text, regex, mapper = m => m[0]) {
  return [...String(text || '').matchAll(regex)].map(mapper);
}

function sameArray(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function tableShapes(text) {
  return String(text || '').split('\n')
    .filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.split('|').length);
}

function listShapes(text) {
  return String(text || '').split('\n')
    .filter(line => /^\s*(?:[-*+]|\d+\.)\s+/.test(line))
    .map(line => {
      const indent = line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      const marker = line.trim().match(/^(?:[-*+]|\d+\.)/)[0].replace(/\d+\./, '#.');
      return `${indent}:${marker}`;
    });
}

function pushDiff(errors, code, label, originalItems, compressedItems) {
  if (!sameArray(originalItems, compressedItems)) {
    errors.push({
      code,
      message: `${label} changed`,
      originalCount: originalItems.length,
      compressedCount: compressedItems.length,
    });
  }
}

function validateCompression(original, compressed, opts = {}) {
  const strict = opts.strict !== false;
  const errors = [];
  const warnings = [];
  const o = String(original || '');
  const c = String(compressed || '');

  pushDiff(errors, 'headings_changed', 'Markdown headings',
    collect(o, /^#{1,6}\s+.*$/gm), collect(c, /^#{1,6}\s+.*$/gm));
  pushDiff(errors, 'frontmatter_changed', 'Frontmatter',
    collect(o, /^---\n[\s\S]*?\n---(?=\n|$)/gm), collect(c, /^---\n[\s\S]*?\n---(?=\n|$)/gm));
  pushDiff(errors, 'fenced_code_changed', 'Fenced code blocks',
    collect(o, /(```|~~~)[\s\S]*?\1/gm), collect(c, /(```|~~~)[\s\S]*?\1/gm));
  pushDiff(errors, 'inline_code_changed', 'Inline code',
    collect(o, /`[^`\n]+`/g), collect(c, /`[^`\n]+`/g));
  pushDiff(errors, 'urls_changed', 'URLs',
    collect(o, /\bhttps?:\/\/[^\s<>)]+/gi), collect(c, /\bhttps?:\/\/[^\s<>)]+/gi));
  pushDiff(errors, 'link_targets_changed', 'Markdown link targets',
    collect(o, /\[[^\]\n]+\]\(([^) \n]+)(?:\s+"[^"]*")?\)/g, m => m[1]),
    collect(c, /\[[^\]\n]+\]\(([^) \n]+)(?:\s+"[^"]*")?\)/g, m => m[1]));
  pushDiff(errors, 'paths_changed', 'File paths',
    collect(o, /\b[A-Za-z]:\\[^\s`"'<>|]+|(?:^|[\s(])(?:\.{1,2}\/|\/)[^\s`"'<>),]+/g, m => m[0].trim()),
    collect(c, /\b[A-Za-z]:\\[^\s`"'<>|]+|(?:^|[\s(])(?:\.{1,2}\/|\/)[^\s`"'<>),]+/g, m => m[0].trim()));
  pushDiff(errors, 'env_changed', 'Environment variables',
    collect(o, /\$[A-Za-z_][A-Za-z0-9_]*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g),
    collect(c, /\$[A-Za-z_][A-Za-z0-9_]*|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g));
  pushDiff(errors, 'numbers_changed', 'Numbers, versions, or dates',
    collect(o, /\b(?:v?\d+\.\d+(?:\.\d+)?|\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?\s?(?:ms|s|m|h|KB|MB|GB|TB|%|USD|tokens?))\b/gi),
    collect(c, /\b(?:v?\d+\.\d+(?:\.\d+)?|\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?\s?(?:ms|s|m|h|KB|MB|GB|TB|%|USD|tokens?))\b/gi));
  // Bare numeric values too ("priority 3", "limit 500") — the unit-suffixed
  // check above misses them, and they are exactly the kind of fact an LLM
  // rewrite can silently alter.
  pushDiff(errors, 'plain_numbers_changed', 'Numeric values',
    collect(o, /\d+(?:\.\d+)?/g), collect(c, /\d+(?:\.\d+)?/g));

  pushDiff(errors, 'table_shape_changed', 'Markdown table shape', tableShapes(o), tableShapes(c));
  pushDiff(errors, 'list_shape_changed', 'List nesting shape', listShapes(o), listShapes(c));

  if (hasLeakedSentinel(c)) {
    errors.push({ code: 'placeholder_leaked', message: 'Protected placeholder leaked into output' });
  }
  if (strict && c.length > o.length) {
    errors.push({ code: 'increased_size', message: 'Compressed output is larger than original' });
  }
  if (o.length > 0 && c.length / o.length > 0.8) {
    warnings.push({ code: 'low_savings', message: 'Output is less than 20% smaller' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      originalChars: o.length,
      compressedChars: c.length,
      savedChars: Math.max(0, o.length - c.length),
      savingsRatio: o.length ? (o.length - c.length) / o.length : 0,
    },
  };
}

module.exports = {
  validateCompression,
  collect,
  tableShapes,
  listShapes,
};
