# Token-cost optimizer — how it works & what it can do

> Brain still big. Mouth small. Bill smaller.

This document explains the **token-cost optimizer** layer of this repository: the
part that takes the caveman compression idea and turns it into a measured,
model-aware, safety-checked tool for cutting the real dollar cost of agent
sessions on **Claude Fable 5** and **Claude Opus 4.8** (and any other Claude
model, via prefix-matched pricing).

If you just want the product pitch and install, read the [README](../README.md).
This doc is the engineering view.

---

## TL;DR

- It cuts **token counts**, which is model-independent — so it works on Fable 5,
  Opus 4.8, Sonnet, and Haiku alike.
- It attacks **four surfaces** at once: model output, re-sent context/docs, MCP
  tool metadata, and measurement.
- Everything risky is **opt-in and validated**: code, URLs, paths, numbers,
  identifiers, and secrets are never altered or leaked.
- On a representative Fable 5 session it cuts **~70% of visible output tokens**
  and **~25–55% of re-sent doc context**, for a **~38–48% additional
  total-token-cost reduction** on prose/typical doc mixes over the previous
  baseline (worst case ~26% on code-heavy docs, where protected code is
  correctly untouchable).
- On **Opus 4.8 the same percentage cut saves ~1.5× more money**, because Opus
  output costs $75/M vs Fable's $50/M.

---

## The four surfaces

Token spend in a coding-agent session is not one number — it's four. The
optimizer touches each one with a different mechanism.

| # | Surface | Mechanism | Model-specific? |
|---|---------|-----------|-----------------|
| 1 | **Model output** | A tiny terseness ruleset injected at session start (`MICRO.md` / `SKILL.md`): *answer only what was asked, no preamble, no recap, drop filler — keep code/ids/paths/URLs/numbers/errors exact.* | No — pure instruction-following |
| 2 | **Input / re-sent context** | `caveman-compress` rewrites memory files and docs (CLAUDE.md, project notes) so every future session starts from a smaller prompt. | No — produces a smaller file for any reader |
| 3 | **MCP tool metadata** | `caveman-shrink` middleware compresses `*/list` tool descriptions while preserving `inputSchema`, and never mutates requests or `tools/call`. | No — byte-level transform |
| 4 | **Measurement** | `caveman-stats` / `caveman-bench` / `caveman-doctor` read real token usage and price it via a central model-pricing table. | **Yes** — this is the only model-aware part |

The important consequence: **surfaces 1–3 reduce token *counts***, which is the
same on every model. Only **surface 4** (turning tokens into dollars) cares which
model you ran. That's why the optimizer transfers cleanly from Fable 5 to
Opus 4.8 — see [Model support](#model-support).

---

## Surface 1 — Output compression

A short ruleset is injected at session start so the agent answers tersely from
message one, with no per-turn nagging. Six intensity levels (`lite`, `full`,
`ultra`, plus `wenyan-*` classical-Chinese variants) trade brevity against
readability; `full` is the default.

The single most important line — `CAVEMAN full. Answer only what asked — no
preamble, no recap, no extras…` — was **A/B tuned on real Fable 5 output**. An
earlier candidate that said "bullets over prose" *regressed* (it encouraged
enumeration) and was discarded by the bench. The final line costs ~**55 tokens**
of injection overhead and the adaptive per-turn reinforcement costs ~**32 tokens**.

**Auto-clarity guard:** the agent drops back to normal prose for safety warnings,
irreversible-action confirmations, ambiguous multi-step sequences, or when the
user is confused — then resumes. Compression never costs correctness.

---

## Surface 2 — Input/context compression (`caveman-compress`)

The biggest *recurring* cost in a long project isn't one reply — it's the same
CLAUDE.md, memory, and project notes being re-sent into context every session.
`caveman-compress` rewrites those files once so every future prompt is smaller.

It runs as a **two-stage, fail-safe pipeline**, per markdown section:

1. **Protect.** Code fences, inline code, URLs, link targets, file paths, env
   vars, and numbers/dates/versions are masked into frozen `__CAVEMAN_PROTECTED__`
   sentinels so no stage can touch them.
2. **Secret scan.** Known key formats, private-key material, credential paths,
   database URLs, JWT-looking values, and high-entropy tokens **abort the run
   before any network call**.
3. **Local deterministic compression** (default, offline). ~50 regex rewrites
   that cut filler/hedges/articles in **English and Portuguese (PT-BR)** without
   touching meaning. Modal verbs (`might`, `may`, `could`) are *kept* — deleting
   them turns "this migration might fail" into "this migration fail", which is
   fact loss, not compression.
4. **Optional hybrid LLM compression** (`--llm`, opt-in). For low-savings
   sections it asks a Claude model to rewrite the masked prose 40–60% tighter,
   then:
   - **validates** the result against the same invariants as the whole file
     (headings, list/table shape, code, URLs, paths, env vars, exact numbers
     including bare ones, version strings);
   - on failure, runs **one repair pass** that quotes the exact violated
     invariant codes back to the model;
   - if it still fails, **falls back to the local result** and records *why*
     (`no_savings`, `validation_failed`, `secret_risk`, `timeout`, `api_failure`,
     `budget_exhausted`).
5. **Cache + atomic write + backup.** Only *validated* section outputs are
   cached. Writes are atomic; the original is backed up under `.caveman/backups/`
   and restorable with `--restore`.

### Commands

```bash
# Safe preview — validate/compress in memory, write nothing, no network:
node src/commands/caveman-compress.js CLAUDE.md --check --local-only

# Compress a source file into the live one, strict invariants, opt-in LLM,
# with a hard spend cap:
node src/commands/caveman-compress.js CLAUDE.source.md --out CLAUDE.md \
  --strict --llm claude-fable-5 --max-llm-usd 1

# JSON report (per-section strategy, fallbacks, fidelity metrics):
node src/commands/caveman-compress.js project-notes.md --check --json

# Undo: restore the latest backup
node src/commands/caveman-compress.js CLAUDE.md --restore
```

Key flags: `--check`/`--dry-run` (write nothing), `--local-only` (never call the
API), `--llm <model>` (opt in), `--max-llm-usd <n>` (hard spend cap), `--strict`
(fail on any invariant warning — the default), `--diff`, `--no-cache`,
`--restore`.

---

## Surface 3 — MCP metadata shrink (`caveman-shrink`)

A middleware that wraps any MCP server and compresses verbose tool-list
descriptions in flight. It is deliberately conservative:

- only transforms `*/list` **responses**;
- preserves `inputSchema` by default (the part the model needs to call tools
  correctly);
- **never** mutates requests or `tools/call` results;
- supports both newline-delimited JSON and `Content-Length`-framed MCP transport.

Published as the `caveman-shrink` npm package; see `src/mcp-servers/caveman-shrink/`.

---

## Surface 4 — Measurement (stats / bench / doctor)

You can't optimize what you don't measure, and you shouldn't trust savings
numbers you can't reproduce. Three tools, one central pricing table.

- **`caveman-stats`** reads the real Claude Code session log and reports input /
  output / cache-write / cache-read tokens and an estimated USD cost using the
  model's actual pricing. Lifetime savings feed the statusline badge.
- **`caveman-bench`** has two modes:
  - `--offline --report` — token estimates from committed snapshots, no network.
  - `--online [--model <id>] [--max-spend <usd>] [--report]` — a **budget-guarded**
    real-API benchmark. Spend is computed from API-reported usage; a worst-case
    pre-call guard refuses any call that could exceed `--max-spend`, and there is
    a **hard cap of $15** regardless of flags.
- **`caveman-doctor --json`** verifies hooks, config, statusline, MCP shrink,
  the pricing table, the secret scanner, and token-count-API readiness.

Pricing lives in one file (`src/core/pricing.js`) so docs, stats, doctor, and
bench can never drift apart.

---

## Model support

**The optimizer is model-agnostic by construction** — surfaces 1–3 cut token
counts, which is identical on every model. Only the pricing math (surface 4) is
model-specific, and it resolves your model two ways:

1. **Exact match** in the pricing table — `claude-fable-5` (verified
   2026-06-10 pricing) and `claude-opus-4-8` (explicit, model-aware entry).
2. **Longest-prefix match** for everything else — e.g. `claude-sonnet-4-6` →
   `claude-sonnet-4`, `claude-haiku-4-5` → `claude-haiku-4`, and the 1M-context
   `claude-opus-4-8[1m]` → `claude-opus-4-8`.

### Fable 5 vs Opus 4.8

| | Fable 5 | Opus 4.8 |
|---|--:|--:|
| Input | $10 / M | $15 / M |
| Output | $50 / M | $75 / M |
| Cache write | $12.50 / M | $18.75 / M |
| Cache read | $1.00 / M | $1.50 / M |
| Pricing provenance | verified `anthropic-pricing-2026-06-10` | **inherited from Opus 4 family — unverified for 4.8** |

Because Opus output is **1.5× the price** of Fable output, **cutting the same
70% of output tokens saves 1.5× more real money on Opus 4.8.** The optimizer is
*more* valuable on the pricier model, not less.

### Two honest caveats

1. The headline percentages below were **measured on Fable 5**. The mechanism is
   identical on Opus, but for a *verified* Opus number, re-run the bench:
   ```bash
   node src/commands/caveman-bench.js --online --model claude-opus-4-8 --max-spend 1 --report
   ```
2. The optimizer reduces **visible output and re-sent context**. It does **not**
   reduce hidden/adaptive *thinking* tokens — that's true on both Fable 5 and
   Opus 4.8.

### Targeting Opus 4.8

```bash
# Make stats/doctor price the session as Opus 4.8:
export CAVEMAN_TARGET_MODEL=claude-opus-4-8     # or set targetModel in config.json

# Benchmark against Opus directly:
node src/commands/caveman-bench.js --online --model claude-opus-4-8 --max-spend 1
```

The Opus 4.8 price is inherited from the Opus 4 family and flagged
`inherited-opus-4-family-unverified` in `src/core/pricing.js` — update that entry
when official 4.8 pricing publishes. The *compression backend* (`--llm`) is best
left on a cheaper model (e.g. `claude-fable-5`); there's no reason to pay Opus
rates just to rewrite a doc.

---

## Benchmarks (real runs)

All numbers below are from **budgeted real-API runs against `claude-fable-5`**,
priced via `src/core/pricing.js`. Total validation spend was **~$1.55 of the $15
cap**. Baselines are the project's previous ("V1") state, not a strawman.

### Visible output vs normal (no-compression) mode

6 prompts (EN dev, PT-BR, agentic coding), 800-token output cap. The uncompressed
baseline hit the cap on most prompts, so these reductions are *underestimates*.

| Arm | Mean | p50 | Worst |
|-----|----:|----:|------:|
| Previous baseline | 55.2% | 55.4% | 25.1% |
| **This optimizer** | **70.7%** | **67.9%** | **53.6%** |

### Document/context compression (hybrid LLM, strict validation)

| Fixture | Local-only | Hybrid LLM | Fallbacks |
|---------|----------:|-----------:|-----------|
| prose-heavy.md (EN) | 13.3% | **53.3%** | none (1 repair retry succeeded) |
| prose-heavy-ptbr.md | 8.7% | **41.5%** | none |
| mixed-code.md | 10.9% | **33.5%** | none |

Code-heavy docs compress least — by design, because protected code blocks are
(correctly) untouchable.

### Additional total-token-cost reduction (vs previous baseline)

Representative session = compressed project docs re-sent in context + visible
output, priced at Fable 5.

| Doc mix | Additional reduction |
|---------|---------------------:|
| Prose-heavy (53–59%) | **~47.7%** |
| p50 mix (~46%) | **~37.9%** |
| Code-heavy (~31%) | ~25.6% (worst case) |

### Fidelity & tests

- **0 critical fidelity failures** across the online runs.
- **91/91** unit tests pass (`npm run test:all`) — including invariant
  validation, the secret-scan abort path, the fallback taxonomy, PT-BR rules,
  the spend guard, and model-pricing resolution.

Reproduce: see [`evals/`](../evals/) and the committed report
`evals/reports/fable5-2026-06-11-v2-delivery.md`.

---

## Acceptance / safety checklist

| Guarantee | Enforced by |
|-----------|-------------|
| Protected spans (code/URLs/paths/env vars/numbers) byte-identical | `src/core/protect.js` + `validate.js` |
| Secrets abort before any LLM call | `src/core/secret-scan.js` |
| `--local-only` makes zero network calls | `caveman-compress.js` |
| `--check` writes no files | `caveman-compress.js` |
| `--restore` round-trips from backup | `caveman-compress.js` |
| LLM path: validate → one repair → safe fallback | `compressSection()` |
| Online spend never exceeds the cap (hard $15) | `caveman-bench.js` spend guard |
| Modal verbs and bare numbers preserved | deterministic rules + validator |

---

## Where things live

```
src/core/         protect, secret-scan, deterministic-compress, validate,
                  markdown-sections, token-count, pricing, cache, atomic-write, env
src/commands/     caveman-compress, caveman-bench, caveman-doctor, caveman-config
src/hooks/        prompt-policy (adaptive injection), caveman-stats (model-aware)
src/mcp-servers/  caveman-shrink (framing + transform)
skills/caveman/   SKILL.md (full ruleset) + MICRO.md (tiny injected line)
evals/            fixtures, prompts, harness, committed reports
docs/fable5.md    Fable 5 / Opus 4.8 model notes
```

Maintainer-level detail (hook architecture, file ownership, CI sync) is in the
root [CLAUDE.md](../CLAUDE.md).
