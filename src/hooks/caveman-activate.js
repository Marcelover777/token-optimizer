#!/usr/bin/env node
// caveman - Claude Code SessionStart activation hook.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultMode, loadConfig, safeWriteFlag } = require('./caveman-config');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.caveman-active');
const settingsPath = path.join(claudeDir, 'settings.json');
const config = loadConfig();
const mode = getDefaultMode();

if (mode === 'off') {
  try { fs.unlinkSync(flagPath); } catch (_) {}
  process.stdout.write('OK');
  process.exit(0);
}

safeWriteFlag(flagPath, mode);

const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);
if (INDEPENDENT_MODES.has(mode)) {
  process.stdout.write('CAVEMAN MODE ACTIVE - level: ' + mode + '. Behavior defined by /caveman-' + mode + ' skill.');
  process.exit(0);
}

const modeLabel = mode === 'wenyan' ? 'wenyan-full' : mode;

function readFirstExisting(files) {
  for (const file of files) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) {}
  }
  return '';
}

function readMicroRules(label) {
  const content = readFirstExisting([
    path.join(__dirname, '..', 'skills', 'caveman', 'MICRO.md'),
    path.join(__dirname, '..', '..', 'skills', 'caveman', 'MICRO.md'),
  ]);
  if (content) {
    const prefix = 'CAVEMAN ' + label + '.';
    const hit = content.split('\n').map(s => s.trim()).find(line => line.startsWith(prefix));
    if (hit) return hit;
  }
  const fallback = {
    lite: 'CAVEMAN lite. Concise pro prose, answer-first. No filler/pleasantries/hedging/recap/next-steps. Final <=8 lines+code. <=1 line between tools. Never re-print code/diffs; cite file:line. No headers/tables unasked. Code/paths/URLs/numbers/errors exact. Clear prose for safety/destructive/ambiguous.',
    full: 'CAVEMAN full. Terse fragments. Answer only what asked; no preamble/recap/summary-close/next-steps. Final <=5 lines+code. <=1 line between tools. Never re-print code/diffs/tool output; cite file:line. No headers/tables unasked. Code/paths/URLs/numbers/errors exact. Clear prose for safety/destructive/ambiguous. Persist until off.',
    ultra: 'CAVEMAN ultra. Telegraphic. Answer only. Arrows for causality. One word when enough. Zero tool narration except blockers. Final <=3 lines+code. Never abbrev/re-print code/API/error/path/URL/number. Clear prose for safety/destructive/ambiguous.',
    'wenyan-lite': 'CAVEMAN wenyan-lite. Semi-classical concise. Cut filler/hedge. Code/paths/URLs/numbers/errors exact. Normal prose for safety/destructive/ambiguous.',
    'wenyan-full': 'CAVEMAN wenyan-full. Classical terse. Max concise, technical claims intact. Code/paths/URLs/numbers/errors exact. Normal prose for safety/destructive/ambiguous.',
    'wenyan-ultra': 'CAVEMAN wenyan-ultra. Extreme classical compression. Code/API/error/path/URL/number exact. Normal prose for safety/destructive/ambiguous.',
  };
  return fallback[label] || fallback.full;
}

function readFullSkill(label) {
  const skillContent = readFirstExisting([
    path.join(__dirname, '..', 'skills', 'caveman', 'SKILL.md'),
    path.join(__dirname, '..', '..', 'skills', 'caveman', 'SKILL.md'),
  ]);
  if (!skillContent) {
    return 'CAVEMAN MODE ACTIVE - level: ' + label + '\n\n' +
      'Respond terse like smart caveman. All technical substance stay. Only fluff die.\n\n' +
      'Drop articles/filler/pleasantries/hedging. Fragments OK. Code, paths, URLs, numbers, and errors exact. ' +
      'Use normal prose for security warnings, destructive confirmations, or ambiguous multi-step instructions.';
  }

  const body = skillContent.replace(/^---[\s\S]*?---\s*/, '');
  const filtered = body.split('\n').reduce((acc, line) => {
    const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
    if (tableRowMatch) {
      if (tableRowMatch[1] === label) acc.push(line);
      return acc;
    }
    const exampleMatch = line.match(/^- (\S+?):\s/);
    if (exampleMatch) {
      if (exampleMatch[1] === label) acc.push(line);
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);
  return 'CAVEMAN MODE ACTIVE - level: ' + label + '\n\n' + filtered.join('\n');
}

let output = config.injection.sessionStart === 'full'
  ? readFullSkill(modeLabel)
  : readMicroRules(modeLabel);

try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    hasStatusline = !!settings.statusLine;
  }

  const nudgeMode = config.injection.statuslineNudge || 'once';
  const markerPath = path.join(claudeDir, '.caveman-statusline-nudged');
  const alreadyNudged = nudgeMode === 'once' && fs.existsSync(markerPath);
  if (!hasStatusline && nudgeMode !== 'off' && !alreadyNudged) {
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'caveman-statusline.ps1' : 'caveman-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    const command = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
      : `bash "${scriptPath}"`;
    const statusLineSnippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
    output += '\n\nSTATUSLINE SETUP NEEDED: Caveman badge is not configured. Add this to Claude Code settings.json: ' +
      statusLineSnippet + ' Or run /caveman-doctor --fix-statusline.';
    if (nudgeMode === 'once') safeWriteFlag(markerPath, 'shown');
  }
} catch (_) {
  // Silent fail - do not block session start.
}

process.stdout.write(output);
