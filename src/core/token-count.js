// Anthropic token count adapter with an explicit approximation fallback.
const { loadLocalEnv } = require('./env');

const ANTHROPIC_COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const ANTHROPIC_VERSION = '2023-06-01';
loadLocalEnv();

function estimateTokensFromText(text) {
  const raw = String(text || '');
  if (!raw) return 0;
  const nonAscii = [...raw].filter(ch => ch.charCodeAt(0) > 127).length;
  const divisor = nonAscii > raw.length * 0.2 ? 3.2 : 4;
  return Math.max(1, Math.ceil(raw.length / divisor));
}

function estimateTokensForPayload(payload) {
  if (typeof payload === 'string') return estimateTokensFromText(payload);
  return estimateTokensFromText(JSON.stringify(payload || {}));
}

async function countTokensAnthropic(payload, opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      input_tokens: estimateTokensForPayload(payload),
      source: 'chars_approx',
      confidence: 'approximate_no_api_key',
    };
  }
  if (typeof fetch !== 'function') {
    return {
      input_tokens: estimateTokensForPayload(payload),
      source: 'chars_approx',
      confidence: 'approximate_fetch_unavailable',
    };
  }

  const body = {
    model: opts.model || 'claude-fable-5',
    ...(typeof payload === 'string'
      ? { messages: [{ role: 'user', content: payload }] }
      : payload),
  };

  const res = await fetch(ANTHROPIC_COUNT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': opts.anthropicVersion || ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      input_tokens: estimateTokensForPayload(payload),
      source: 'chars_approx',
      confidence: `approximate_token_count_http_${res.status}`,
    };
  }
  const json = await res.json();
  return {
    input_tokens: json.input_tokens || 0,
    source: 'anthropic_count_tokens',
    confidence: 'official_token_count_api',
  };
}

module.exports = {
  ANTHROPIC_COUNT_URL,
  ANTHROPIC_VERSION,
  estimateTokensFromText,
  estimateTokensForPayload,
  countTokensAnthropic,
};
