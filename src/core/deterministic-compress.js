const { protectSegments, restoreSegments } = require('./protect');

const RULES = [
  // Multi-word phrase rewrites first so shorter filler rules cannot break them.
  ['due_to_fact', /\bdue to the fact that\b/gi, 'because'],
  ['despite_fact', /\b(?:despite|in spite of) the fact that\b/gi, 'although'],
  ['in_the_event', /\bin the event that\b/gi, 'if'],
  ['point_in_time', /\bat this point in time\b/gi, 'now'],
  ['at_the_moment', /\bat the moment\b/gi, 'now'],
  ['in_order_to', /\bin order to\b/gi, 'to'],
  ['in_order_for', /\bin order for\b/gi, 'for'],
  ['prior_to', /\bprior to\b/gi, 'before'],
  ['subsequent_to', /\bsubsequent to\b/gi, 'after'],
  ['is_able_to', /\b(?:is|are) able to\b/gi, 'can'],
  ['will_be_able_to', /\bwill be able to\b/gi, 'can'],
  ['whether_or_not', /\bwhether or not\b/gi, 'whether'],
  ['each_and_every', /\beach and every\b/gi, 'every'],
  ['a_large_number_of', /\ba large number of\b/gi, 'many'],
  ['the_majority_of', /\bthe majority of\b/gi, 'most'],
  ['on_a_regular_basis', /\bon a regular basis\b/gi, 'regularly'],
  ['as_well_as', /\bas well as\b/gi, 'and'],
  ['in_conjunction_with', /\bin conjunction with\b/gi, 'with'],
  ['with_regard_to', /\bwith regards? to\b/gi, 'about'],
  ['take_into_account', /\btake into account\b/gi, 'consider'],
  ['in_most_cases', /\bin most cases,?\s*/gi, 'usually '],
  ['as_a_result', /\bas a result,?\s*/gi, 'so '],
  ['however_comma', /\bhowever,\s*/gi, 'but '],
  ['therefore', /\btherefore,?\s*/gi, 'so '],
  ['in_addition_comma', /\bin addition,\s*/gi, 'also, '],
  ['important_note', /\bit is important to (?:note|remember|mention) that\s*/gi, ''],
  ['worth_noting', /\bit(?:'s| is) worth noting that\s*/gi, ''],
  ['note_that', /\b(?:note that|keep in mind that|remember that)\s+/gi, ''],
  ['in_other_words', /\bin other words,?\s*/gi, ''],
  ['going_forward', /,?\s*going forward\b/gi, ''],
  ['make_sure_to', /\bmake sure to\b/gi, 'ensure'],
  ['utilize', /\butili[sz](e[sd]?|ing)\b/gi, (m, tail) => ({ e: 'use', es: 'uses', ed: 'used', ing: 'using' })[tail.toLowerCase()] || 'use'],
  // Portuguese (PT-BR) phrase rewrites — same caveman intent, same safety bar.
  ['pt_devido_fato', /\bdevido ao fato de que\b/gi, 'porque'],
  ['pt_a_fim_de', /\ba fim de\b/gi, 'para'],
  ['pt_neste_momento', /\bneste momento\b/gi, 'agora'],
  // \b cannot anchor before the non-ASCII "É", so anchor on start/whitespace.
  ['pt_importante_notar', /(^|[\s(;:,.!?])[eé] importante (?:notar|destacar|ressaltar|lembrar) que,?\s*/gim, (m, g1) => g1],
  ['pt_vale_mencionar', /\bvale (?:a pena )?(?:mencionar|notar|destacar) que\s*/gi, ''],
  ['pt_tenha_em_mente', /\btenha em mente que\s*/gi, ''],
  ['pt_certifique', /\bcertifique-se de\b/gi, 'garanta'],
  ['pt_no_entanto', /\bno entanto,?\s*/gi, 'mas '],
  ['pt_alem_disso', /\bal[eé]m disso,?\s*/gi, 'e '],
  ['pt_fillers', /\b(?:basicamente|simplesmente|literalmente|essencialmente|na verdade|de fato)\b,?\s*/gi, ''],
  ['pt_pleasantries', /\b(?:por favor|obrigad[oa]|com certeza)\b[,.]?\s*/gi, ''],
  // Single-word/short filler removals last.
  ['pleasantries', /\b(?:sure|certainly|of course|happy to|please|kindly|thank you|thanks)\b[,.]?\s*/gi, ''],
  ['fillers', /\b(?:just|really|basically|actually|simply|essentially|generally|literally|very|quite)\b\s*/gi, ''],
  ['hedges', /\b(?:perhaps|maybe|might|could potentially|i think|in my opinion|it seems|it appears|it may be worth)\b\s*/gi, ''],
  ['leaders', /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s|i recommend that)\s+/gim, ''],
];

const ARTICLES = ['articles', /\b(?:a|an|the)\s+(?=[a-z])/gi, ''];

function applyRule(text, [rule, regex, replacement]) {
  let count = 0;
  const out = text.replace(regex, (...args) => {
    count++;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
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
