const path = require('path');

const PATH_DENY = [
  /\.env(?:\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(?:^|[\\/])id_rsa(?:\.pub)?$/i,
  /(?:^|[\\/])id_ed25519(?:\.pub)?$/i,
  /credentials\.[^\\/]+$/i,
  /service-account.*\.json$/i,
  /secrets?\.[^\\/]+$/i,
  /\.kubeconfig$/i,
  /(?:^|[\\/])\.aws[\\/]credentials$/i,
  /(?:^|[\\/])(?:\.ssh|\.gnupg|\.kube|\.docker)(?:[\\/]|$)/i,
];

const CONTENT_PATTERNS = [
  ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{12,}/g],
  ['openai_project_key', /sk-proj-[A-Za-z0-9_-]{12,}/g],
  ['generic_sk_key', /\bsk-[A-Za-z0-9_-]{24,}\b/g],
  ['github_pat', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['github_token', /\bghp_[A-Za-z0-9]{20,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['aws_secret_access_key', /AWS_SECRET_ACCESS_KEY\s*=\s*[^\s]+/g],
  ['private_key', /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g],
  ['slack_token', /\bxox[bp]-[A-Za-z0-9-]{20,}\b/g],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
  ['database_url', /DATABASE_URL\s*=\s*[^\s]+|postgres(?:ql)?:\/\/[^\s]+:[^\s@]+@[^\s]+/gi],
  ['postgres_password', /POSTGRES_PASSWORD\s*=\s*[^\s]+/gi],
  ['private_key_env', /PRIVATE_KEY\s*=\s*[^\s]+/gi],
  ['client_secret', /CLIENT_SECRET\s*=\s*[^\s]+/gi],
];

function lineForIndex(text, index) {
  return String(text || '').slice(0, index).split('\n').length;
}

function redact(value) {
  const s = String(value);
  if (s.length <= 12) return `${s.slice(0, 3)}...`;
  return `${s.slice(0, 8)}...${s.slice(-4)}`;
}

function shannon(value) {
  const s = String(value);
  if (!s) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikeHash(token) {
  return /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(token);
}

function scanSecrets({ filePath = '', content = '', allowKnownHashes = false } = {}) {
  const findings = [];
  const normalized = String(filePath || '').replace(/\//g, path.sep);
  for (const re of PATH_DENY) {
    if (re.test(normalized)) {
      findings.push({ type: 'sensitive_path', severity: 'critical', line: 0, redacted: path.basename(filePath) || normalized });
      break;
    }
  }

  const text = String(content || '');
  for (const [type, re] of CONTENT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      findings.push({ type, severity: 'critical', line: lineForIndex(text, m.index), redacted: redact(m[0]) });
    }
  }

  const tokenRe = /\b[A-Za-z0-9_+/-]{32,}\b/g;
  for (const m of text.matchAll(tokenRe)) {
    const token = m[0];
    if (allowKnownHashes && looksLikeHash(token)) continue;
    if (shannon(token) >= 4.4) {
      findings.push({ type: 'high_entropy', severity: 'high', line: lineForIndex(text, m.index), redacted: redact(token) });
    }
  }

  const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
  const severity = findings.reduce((best, f) =>
    severityRank[f.severity] > severityRank[best] ? f.severity : best, 'low');
  const blocked = severity === 'high' || severity === 'critical';
  return {
    ok: !blocked,
    severity: blocked ? severity : 'low',
    findings,
    action: blocked ? 'abort_before_llm' : 'allow',
  };
}

module.exports = {
  PATH_DENY,
  CONTENT_PATTERNS,
  scanSecrets,
  shannon,
  redact,
};
