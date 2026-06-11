const crypto = require('crypto');

const SENTINEL_PREFIX = '__CAVEMAN_PROTECTED_';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function collectMatches(text, type, regex, out) {
  for (const m of text.matchAll(regex)) {
    const value = m[0];
    if (!value) continue;
    out.push({ type, start: m.index, end: m.index + value.length, value });
  }
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function protectSegments(text, options = {}) {
  const source = String(text || '');
  const matches = [];
  collectMatches(source, 'frontmatter', /^---\n[\s\S]*?\n---(?=\n|$)/gm, matches);
  collectMatches(source, 'fenced_code', /(```|~~~)[\s\S]*?\1/gm, matches);
  collectMatches(source, 'indented_code', /^(?: {4}|\t).+(?:\n(?: {4}|\t).+)*/gm, matches);
  collectMatches(source, 'inline_code', /`[^`\n]+`/g, matches);
  collectMatches(source, 'markdown_link', /\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/g, matches);
  collectMatches(source, 'raw_url', /\bhttps?:\/\/[^\s<>)]+/gi, matches);
  collectMatches(source, 'windows_path', /\b[A-Za-z]:\\[^\s`"'<>|]+/g, matches);
  collectMatches(source, 'unix_path', /(?:\.{1,2}\/|\/)[^\s`"'<>),]+/g, matches);
  collectMatches(source, 'env_var', /\b[A-Z][A-Z0-9_]{2,}\b|\$[A-Za-z_][A-Za-z0-9_]*/g, matches);
  collectMatches(source, 'function_call', /\b[A-Za-z_][A-Za-z0-9_]*\([^)\n]*\)/g, matches);
  collectMatches(source, 'dotted_identifier', /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){1,}\b/g, matches);
  collectMatches(source, 'version', /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?\b/g, matches);
  collectMatches(source, 'date', /\b\d{4}-\d{2}-\d{2}\b/g, matches);
  collectMatches(source, 'number_unit', /\b\d+(?:\.\d+)?\s?(?:ms|s|m|h|KB|MB|GB|TB|%|USD|tokens?)\b/gi, matches);
  collectMatches(source, 'html_tag', /<\/?[A-Za-z][^>\n]*>/g, matches);
  collectMatches(source, 'quoted_error', /"(?:[^"\n]*?(?:Error|Exception|failed|denied|not found)[^"\n]*?)"/gi, matches);
  collectMatches(source, 'shell_command', /^\s*(?:npm|pnpm|yarn|node|git|docker|kubectl|curl|python3?|npx|uv|claude|gemini)\s+[^\n]+$/gmi, matches);

  const selected = [];
  for (const item of matches.sort((a, b) => (a.start - b.start) || (b.end - a.end))) {
    if (!selected.some(existing => overlaps(existing, item))) selected.push(item);
  }

  const segments = selected
    .sort((a, b) => a.start - b.start)
    .map((item, index) => {
      const digest = sha256(item.value).slice(0, 8);
      const sentinel = `${SENTINEL_PREFIX}${String(index + 1).padStart(6, '0')}_${digest}__`;
      return { id: index + 1, sentinel, sha256: digest, ...item };
    });

  let masked = source;
  for (const segment of [...segments].sort((a, b) => b.start - a.start)) {
    masked = masked.slice(0, segment.start) + segment.sentinel + masked.slice(segment.end);
  }

  if (options.freezeAll) {
    return {
      text: `${SENTINEL_PREFIX}000001_${sha256(source).slice(0, 8)}__`,
      segments: [{ id: 1, sentinel: `${SENTINEL_PREFIX}000001_${sha256(source).slice(0, 8)}__`, value: source, type: 'all', sha256: sha256(source).slice(0, 8), start: 0, end: source.length }],
    };
  }

  return { text: masked, segments };
}

function restoreSegments(maskedText, segments) {
  let out = String(maskedText || '');
  for (const segment of segments || []) {
    out = out.split(segment.sentinel).join(segment.value);
  }
  return out;
}

function verifySegments(original, restored, segments) {
  const errors = [];
  const output = String(restored || '');
  for (const segment of segments || []) {
    if (output.includes(segment.sentinel)) {
      errors.push({ code: 'placeholder_leaked', sentinel: segment.sentinel });
    }
    if (!output.includes(segment.value)) {
      errors.push({ code: 'protected_missing', type: segment.type, value: segment.value });
    }
  }
  const roundTrip = restoreSegments(protectSegments(original).text, protectSegments(original).segments);
  if (roundTrip !== String(original || '')) {
    errors.push({ code: 'roundtrip_failed' });
  }
  return { ok: errors.length === 0, errors };
}

function hasLeakedSentinel(text) {
  return new RegExp(`${SENTINEL_PREFIX}\\d{6}_[a-f0-9]{8}__`).test(String(text || ''));
}

module.exports = {
  SENTINEL_PREFIX,
  sha256,
  protectSegments,
  restoreSegments,
  verifySegments,
  hasLeakedSentinel,
};
