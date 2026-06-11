#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadLocalEnv } = require('../core/env');
const { loadConfig, getConfigDir, readFlag } = require('../hooks/caveman-config');
const { pricingForModel } = require('../core/pricing');
const { scanSecrets } = require('../core/secret-scan');

loadLocalEnv({ root: path.resolve(__dirname, '..', '..') });

function checkFile(file) {
  return fs.existsSync(file) ? 'OK' : 'missing';
}

function doctor(opts = {}) {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const config = loadConfig();
  const checks = {
    node: process.versions.node,
    config_dir: getConfigDir(),
    claude_config: claudeDir,
    hooks: {
      activate: checkFile(path.join(hooksDir, 'caveman-activate.js')),
      tracker: checkFile(path.join(hooksDir, 'caveman-mode-tracker.js')),
      stats: checkFile(path.join(hooksDir, 'caveman-stats.js')),
    },
    mode: readFlag(path.join(claudeDir, '.caveman-active')) || 'off',
    injection: `${config.injection.reinforcement}/${config.injection.sessionStart}`,
    statusline: 'unknown',
    pricing: pricingForModel(config.targetModel) ? `${config.targetModel} OK` : `${config.targetModel} unknown`,
    secret_scan: scanSecrets({ content: 'OPENAI_API_KEY=sk-proj-testtesttesttesttesttesttest' }).ok ? 'failed' : 'OK',
    mcp_shrink: checkFile(path.join(__dirname, '..', 'mcp-servers', 'caveman-shrink', 'framing.js')),
    token_count_api: process.env.ANTHROPIC_API_KEY ? 'available' : 'no ANTHROPIC_API_KEY',
    warnings: [],
  };

  const settingsPath = path.join(claudeDir, 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    checks.statusline = settings.statusLine ? 'OK' : 'missing';
  } catch (_) {
    checks.statusline = 'missing';
  }
  if (checks.statusline !== 'OK') checks.warnings.push('statusline not configured. Run: /caveman-doctor --fix-statusline');

  if (opts.fixStatusline) {
    fs.mkdirSync(claudeDir, { recursive: true });
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
    const script = process.platform === 'win32'
      ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(hooksDir, 'caveman-statusline.ps1')}"`
      : `bash "${path.join(hooksDir, 'caveman-statusline.sh')}"`;
    settings.statusLine = { type: 'command', command: script };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    checks.statusline = 'OK';
    checks.fixed_statusline = true;
  }
  return checks;
}

function format(checks) {
  return `Caveman Doctor
--------------
Claude config: ${checks.claude_config}
Hooks: activate=${checks.hooks.activate}, tracker=${checks.hooks.tracker}, stats=${checks.hooks.stats}
Mode: ${checks.mode}
Injection: ${checks.injection}
Stats pricing: ${checks.pricing}
Secret scan: ${checks.secret_scan}
MCP shrink: ${checks.mcp_shrink}
Token count API: ${checks.token_count_api}
Warnings:
${checks.warnings.map(w => `- ${w}`).join('\n') || '- none'}
`;
}

function main() {
  const args = process.argv.slice(2);
  const checks = doctor({ fixStatusline: args.includes('--fix-statusline') });
  process.stdout.write(args.includes('--json') ? JSON.stringify(checks, null, 2) + '\n' : format(checks));
}

if (require.main === module) main();
module.exports = { doctor, format };
