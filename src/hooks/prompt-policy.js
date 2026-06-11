const fs = require('fs');
const path = require('path');
const os = require('os');

const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);
const CONTINUATION_RE = /\b(continue|keep going|go on|explique|explica|an[aá]lise profunda|detalhe|details?|elaborate)\b/i;
const SAFETY_RE = /\b(rm -rf|drop table|delete all|irreversible|permanently delete|dangerous|security warning|credential|secret|private key)\b/i;
const DRIFT_RE = /\b(sure|certainly|of course|happy to|i think|perhaps|maybe|basically|actually)\b/gi;

function statePath(claudeDir, sessionId) {
  const safe = String(sessionId || 'default').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return path.join(claudeDir, `.caveman-prompt-state-${safe}.json`);
}

function sessionIdFrom(data) {
  if (data.session_id) return data.session_id;
  if (data.transcript_path) return path.basename(data.transcript_path, '.jsonl');
  return 'default';
}

function readState(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 32_000) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeState(filePath, state) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const real = fs.existsSync(filePath) ? fs.lstatSync(filePath) : null;
    if (real && (real.isSymbolicLink() || !real.isFile())) return;
    const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, filePath);
  } catch (_) {}
}

function scoreDrift(text) {
  const raw = String(text || '');
  if (!raw) return 0;
  const hits = [...raw.matchAll(DRIFT_RE)].length;
  return hits / Math.max(1, raw.split(/\s+/).length);
}

function readLastAssistantFromTranscript(transcriptPath) {
  if (!transcriptPath) return { outputTokens: 0, text: '' };
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').slice(-30).reverse();
    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      if (entry.type !== 'assistant' || !entry.message) continue;
      const usage = entry.message.usage || {};
      const content = Array.isArray(entry.message.content)
        ? entry.message.content.map(part => typeof part.text === 'string' ? part.text : '').join('\n')
        : '';
      return { outputTokens: usage.output_tokens || 0, text: content };
    }
  } catch (_) {}
  return { outputTokens: 0, text: '' };
}

function reinforcementText(mode) {
  return 'CAVEMAN ' + mode + ' still on: terse, answer-first, no filler' +
    (mode === 'lite' ? ', keep grammar' : ', fragments OK') +
    '. Code/paths/numbers/errors exact. Plain prose for safety.';
}

function shouldReinforce({ prompt, activeMode, config, state, transcript }) {
  if (!activeMode || INDEPENDENT_MODES.has(activeMode)) return { reinforce: false, reason: 'inactive_or_independent' };
  if (/^\/caveman(?:-stats|-compress|-doctor|-bench|-config)?\b/i.test(prompt || '')) {
    return { reinforce: false, reason: 'command_prompt' };
  }
  if (SAFETY_RE.test(prompt || '')) return { reinforce: false, reason: 'safety_prompt' };

  const policy = (config && config.injection) || {};
  if (policy.reinforcement === 'off') return { reinforce: false, reason: 'config_off' };
  if (policy.reinforcement === 'always') return { reinforce: true, reason: 'config_always' };

  const turn = (state.turn || 0) + 1;
  const lastReinforced = state.last_reinforced_turn || 0;
  const firstN = Number(policy.reinforceFirstNTurns || 2);
  const everyN = Number(policy.reinforceEveryNTurns || 6);
  const longOutput = Number(policy.afterLongOutputTokens || 2500);
  const drift = scoreDrift(transcript.text);

  if (state.mode && state.mode !== activeMode) return { reinforce: true, reason: 'mode_changed' };
  if (turn <= firstN) return { reinforce: true, reason: 'first_turns' };
  if (everyN > 0 && turn - lastReinforced >= everyN) return { reinforce: true, reason: 'interval' };
  if (CONTINUATION_RE.test(prompt || '')) return { reinforce: true, reason: 'continuation_prompt' };
  if (transcript.outputTokens >= longOutput) return { reinforce: true, reason: 'long_previous_output' };
  if (drift >= 0.035) return { reinforce: true, reason: 'drift_detected' };
  return { reinforce: false, reason: 'not_needed' };
}

function decideReinforcement({ data, prompt, activeMode, config, claudeDir }) {
  const sessionId = sessionIdFrom(data || {});
  const file = statePath(claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), sessionId);
  const state = readState(file);
  const transcript = readLastAssistantFromTranscript(data && data.transcript_path);
  const decision = shouldReinforce({ prompt, activeMode, config, state, transcript });
  const next = {
    schema_version: 1,
    session_id: sessionId,
    mode: activeMode || null,
    turn: (state.turn || 0) + 1,
    last_reinforced_turn: decision.reinforce ? (state.turn || 0) + 1 : (state.last_reinforced_turn || 0),
    last_output_tokens: transcript.outputTokens || 0,
    drift_score: scoreDrift(transcript.text),
    last_reason: decision.reason,
  };
  writeState(file, next);
  return {
    ...decision,
    state: next,
    additionalContext: decision.reinforce ? reinforcementText(activeMode) : '',
  };
}

module.exports = {
  INDEPENDENT_MODES,
  statePath,
  readState,
  writeState,
  scoreDrift,
  shouldReinforce,
  decideReinforcement,
  reinforcementText,
};
