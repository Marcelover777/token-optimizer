# Caveman with Claude Fable 5

Fable 5 makes token waste more expensive, especially output tokens and repeated context. Caveman V1 handles three surfaces:

- output: caveman mode, cavecrew compact contracts;
- input/context: micro-inject, local memory compression, MCP shrink;
- measurement: `/caveman-stats --json` with input/output/cache token fields and Fable 5 pricing.

## Defaults

```json
{
  "defaultMode": "full",
  "targetModel": "claude-fable-5",
  "injection": {
    "sessionStart": "micro",
    "reinforcement": "adaptive"
  },
  "compression": {
    "defaultStrategy": "hybrid",
    "llmEnabled": false,
    "llmModel": "claude-fable-5"
  }
}
```

Config path: `~/.config/caveman/config.json` on macOS/Linux or `%APPDATA%\caveman\config.json` on Windows.

## Commands

```bash
/caveman-stats --json
/caveman-compress CLAUDE.md --check --local-only
/caveman-compress CLAUDE.source.md --out CLAUDE.md --strict
/caveman-doctor --json
/caveman-bench --offline --report
```

## Safety

Local-only compression does not call the network. LLM compression is opt-in and sends selected prose to Claude API after secret scan and protected-span masking. Do not run LLM compression on sensitive documents. Secret scan blocks known keys, private-key material, credential paths, database URLs, JWT-looking values, and high-entropy tokens before LLM use.

## Opus 4.8

The optimizer is model-agnostic — it cuts token counts, which is identical on every model. Only pricing is model-specific, and Opus 4.8 resolves explicitly:

```js
pricingForModel('claude-opus-4-8')      // exact entry: $15 in / $75 out
pricingForModel('claude-opus-4-8[1m]')  // 1M-context variant → same entry
```

Opus 4.8 pricing is inherited from the Opus 4 family and flagged `inherited-opus-4-family-unverified`; update `src/core/pricing.js` when official 4.8 pricing publishes. Because Opus output ($75/M) is 1.5× Fable 5's ($50/M), the same percentage cut saves ~1.5× more money on Opus.

Target Opus for stats/doctor with `CAVEMAN_TARGET_MODEL=claude-opus-4-8`, or benchmark directly with `node src/commands/caveman-bench.js --online --model claude-opus-4-8`. Keep the `--llm` compression backend on a cheaper model. See [OPTIMIZER.md](./OPTIMIZER.md#model-support).

## Limits

Stats are estimates when they use benchmark ratios or char/token fallback. The official Anthropic token-count API is used only when `ANTHROPIC_API_KEY` exists. Caveman reduces visible output and repeated context; it does not directly reduce hidden adaptive thinking tokens.
