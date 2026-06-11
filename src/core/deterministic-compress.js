const { protectSegments, restoreSegments } = require('./protect');

const RULES = [
  ['pleasantries', /\b(?:sure|certainly|of course|happy to|please|kindly|thank you|thanks)\b[,.]?\s*/gi, ''],
  ['fillers', /\b(?:just|really|basically|actually|simply|essentially|generally|literally|very|quite)\b\s*/gi, ''],
  ['hedges', /\b(?:perhaps|maybe|might|could potentially|i think|in my opinion|it seems|it appears|it may be worth)\b\s*/gi, ''],
  ['in_order_to', /\bin order to\b/gi, 'to'],
  ['due_to_fact', /\bdue to the fact that\b/gi, 'because'],
  ['point_in_time', /\bat this point in time\b/gi, 'now'],
  ['important_note', /\bit is important to note that\s*/gi, ''],
  ['make_sure_to', /\bmake sure to\b/gi, 'ensure'],
  ['leaders', /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s|i recommend that)\s+/gim, ''],
];

const ARTICLES = ['articles', /\b(?:a|an|the)\s+(?=[a-z])/gi, ''];

function applyRule(text, [rule, regex, replacement]) {
  let count = 0;
  const out = text.replace(regex, () => {
    count++;
    return replacement;
  });
  return { out, count, rule };
}

function compressMasked(text, opts = {}) {
  const mode = opts.mode || 'full';
  const rules = mode === 'lite' ? RULES : [...RULES, ARTICLES];
  const rulesApplied = [];
  let out = String(text || '');
  for (const rule of rules) {
    const result = applyRule(out, rule);
    out = result.out;
    if (result.count) rulesApplied.push({ rule: result.rule, count: result.count });
  }
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
  if (out !== text) rulesApplied.push({ rule: 'whitespace', count: 1 });
  return { compressed: out.trim(), rulesApplied };
}

function compressDeterministic(text, opts = {}) {
  const source = String(text || '');
  if (!source) return { compressed: source, beforeChars: 0, afterChars: 0, rulesApplied: [] };

  const shouldProtect = opts.protect !== false;
  const protectedResult = shouldProtect ? protectSegments(source, opts.protectOptions) : { text: source, segments: [] };
  const compressedMasked = compressMasked(protectedResult.text, opts);
  const restored = shouldProtect
    ? restoreSegments(compressedMasked.compressed, protectedResult.segments)
    : compressedMasked.compressed;

  return {
    compressed: restored,
    beforeChars: source.length,
    afterChars: restored.length,
    rulesApplied: compressedMasked.rulesApplied,
    protectedCount: protectedResult.segments.length,
  };
}

module.exports = {
  RULES,
  compressMasked,
  compressDeterministic,
};
