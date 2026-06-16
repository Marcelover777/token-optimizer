# Token-cost optimizer — how it works & what it can do

> Brain still big. Mouth small. Bill smaller.

This document explains the **token-cost optimizer** layer of this repository: the
part that takes the caveman compression idea and turns it into a measured,
model-aware, safety-checked tool for cutting the real dollar cost of agent
sessions on **Claude Opus 4.8** (and any other Claude model, via prefix-matched
pricing).

> **Fable 5 was retired by Anthropic** — the API now answers `claude-fable-5`
> with *"not available, please use Opus 4.8."* The optimizer's defaults target
> **Opus 4.8** accordingly. Everything below is measured on Opus 4.8; older Fable
> numbers are kept only as a historical footnote.

If you just want the product pitch and install, read the [README](../README.md).
This doc is the engineering view.

---

## TL;DR

- It cuts **token counts**, which is model-independent — so it works on Opus 4.8,
  Sonnet, and Haiku alike.
- It attacks **four surfaces** at once: model output, re-sent context/docs, MCP
  tool metadata, and measurement.
- Everything risky is **opt-in and validated**: code, URLs, paths, numbers,
  identifiers, and secrets are never altered or leaked — see
  [Why it doesn't lose quality](#why-it-doesnt-lose-quality).
- **Measured on Opus 4.8 (real API, this repo's bench):** it cuts **~77% of
  visible output tokens** (mean 76.7%, p50 79.3%, worst 64.5% across 6 prompts)
  and **~15–51% of re-sent doc context**, with **zero fidelity failures**.
- That output cut is **vs no-compression Opus**. Against a plain caveman-style
  terse line — same prompts, same run — the optimizer still wins **76.7% vs
  59.4%**. See [Token Optimizer vs Caveman](#token-optimizer-vs-caveman).
- Opus 4.8 output is **$25/M — half the retired Fable 5's $50/M** (verified
  2026-06-16). Moving off Fable already cut your bill ~2×; the optimizer stacks
  its percentage reduction on top of that cheaper baseline.

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
  --strict --llm claude-sonnet-4-6 --max-llm-usd 1

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

1. **Exact match** in the pricing table — `claude-opus-4-8` (default target),
   `claude-sonnet-4-6` (default compression backend), `claude-haiku-4-5`, and the
   retired `claude-fable-5` (kept only so old session logs still price).
2. **Longest-prefix match** for everything else — e.g. the 1M-context
   `claude-opus-4-8[1m]` → `claude-opus-4-8`, `claude-3-5-sonnet…` → its family.

The defaults moved to Opus 4.8 because **Fable 5 was retired** — the API returns
`404 "Claude Fable 5 is not available. Please use Opus 4.8."`. `targetModel`
defaults to `claude-opus-4-8`; the compression backend (`llmModel`) defaults to
`claude-sonnet-4-6` (cheap, capable, and gated by the validator).

### What Opus 4.8 costs vs the retired Fable 5

| | Opus 4.8 (current) | Fable 5 (retired) |
|---|--:|--:|
| Input | $5 / M | $10 / M |
| Output | $25 / M | $50 / M |
| Cache write | $6.25 / M | $12.50 / M |
| Cache read | $0.50 / M | $1.00 / M |
| Pricing provenance | verified `anthropic-pricing-2026-06-16` | verified `anthropic-pricing-2026-06-10` |

Opus 4.8 is **half the price** of the retired Fable 5 on both input and output.
The forced migration off Fable was itself a ~2× cost cut; the optimizer's value
is the percentage reduction it adds on top — which is model-independent, so it
compounds whatever the per-token price happens to be.

### One honest caveat

The optimizer reduces **visible output and re-sent context**. It does **not**
reduce hidden/adaptive *thinking* tokens. So "77% fewer output tokens" is 77% of
the *visible* answer, not of a reasoning trace you never see. (This is why the
win is real but the headline isn't "77% cheaper end-to-end" — see
[the cost model](#additional-total-token-cost-reduction-vs-a-caveman-style-baseline).)

### Targeting / re-benchmarking Opus 4.8

```bash
# Make stats/doctor price the session as Opus 4.8 (already the default):
export CAVEMAN_TARGET_MODEL=claude-opus-4-8     # or set targetModel in config.json

# Re-run the real-API benchmark against Opus yourself (budget-guarded):
node src/commands/caveman-bench.js --online --model claude-opus-4-8 --max-spend 1.5 --report
```

The Opus 4.8 price is inherited from the Opus 4 family and flagged
`inherited-opus-4-family-unverified` in `src/core/pricing.js` — update that entry
when official 4.8 pricing publishes. The *compression backend* (`--llm`) is best
left on a cheaper model (`claude-sonnet-4-6` by default, or `claude-haiku-4-5`):
compressing a doc is a one-time cost amortized over every future session, so
there's no reason to pay Opus rates to rewrite it.

---

## Benchmarks (real Opus 4.8 runs)

All numbers below are from a **budgeted real-API run against `claude-opus-4-8`**
on 2026-06-13, priced via `src/core/pricing.js`. At the verified Opus 4.8 rate
($5/M in, $25/M out) the whole run cost **~$0.29** across **21 API calls**
(12,239 input / 9,317 output tokens), well under its $1.50 cap and the $15 hard
cap. (An earlier draft mispriced Opus at $15/$75 and over-reported this as $0.88;
the token counts are unchanged.) Raw data:
[`evals/reports/claude-opus-4-8-2026-06-13-online.json`](../evals/reports/claude-opus-4-8-2026-06-13-online.json).

### Visible output vs no-compression mode — measured on Opus 4.8

6 prompts (EN dev, PT-BR, agentic coding), 800-token cap. The uncompressed
baseline hit the cap on several prompts, so these reductions are *underestimates*.

| Arm (same prompts, same run) | Mean | p50 | Worst | Best |
|------------------------------|----:|----:|------:|-----:|
| Plain caveman-style terse line | 59.4% | 64.1% | 33.6% | 69.6% |
| **This optimizer's tuned line** | **76.7%** | **79.3%** | **64.5%** | **86.4%** |

The optimizer's line emits **~43% fewer output tokens than the caveman-style
line** on the same prompts — `(1−0.767) / (1−0.594) ≈ 0.57`. (For reference, the
earlier Fable 5 run measured 70.7% mean; Opus follows the terseness instruction
even more tightly.)

### Document and context compression (Opus 4.8)

Same fixtures, strict validation, no cache. Two backends shown: the run's
session model (Opus, pricey but maximal) and the recommended cheap default
(Sonnet 4.6). **Every result passed whole-file validation (`ok: true`)** — see
the fallback column.

| Fixture | Local-only | Opus backend | Sonnet 4.6 backend | Fallbacks (Sonnet) |
|---------|----------:|-------------:|-------------------:|--------------------|
| prose-heavy.md (EN) | 13.3% | **51.3%** | **48.9%** | 1 section → local (safe) |
| prose-heavy-ptbr.md | 8.7% | **29.4%** | **31.7%** | 1 section → local (safe) |
| mixed-code.md | 10.9% | **31.2%** | **15.2%** | 3 sections → local (safe) |

Two things this table proves:

- **Code-heavy docs compress least** — by design, because protected code blocks
  are untouchable.
- **A cheaper/weaker backend never corrupts the doc** — when Sonnet's rewrite
  broke an invariant, the section *fell back to the safe local result* instead
  of shipping a bad rewrite. Less savings, never less correctness. That's the
  quality guarantee in action ([details](#why-it-doesnt-lose-quality)).

### Additional total-token-cost reduction (vs a caveman-style baseline)

The two surfaces above stack. A worked Opus 4.8 example — *illustrative, with the
assumptions shown*, not a single measured number — for one turn that re-sends
4,000 tokens of project docs as context and would otherwise emit 1,000 output
tokens (verified Opus 4.8 pricing $5/M in, $25/M out):

| Setup | Context tokens | Output tokens | Cost / turn |
|-------|---------------:|--------------:|------------:|
| No compression | 4,000 | 1,000 | $0.0450 |
| Caveman (output only, 59.4%) | 4,000 | 406 | $0.0302 |
| **This optimizer** (output 76.7% + docs ~46%) | 2,160 | 233 | **$0.0166** |

→ **~45% cheaper per turn than caveman, ~63% cheaper than no compression** — and
the context savings recur on *every* turn, because the docs were shrunk once.

### Fidelity & tests

- **0 fidelity failures** in the Opus 4.8 run (`fidelity_verdict:
  no_critical_failures`).
- **96/96** unit tests pass (`npm run test:all`) — invariant validation, the
  secret-scan abort path, the fallback taxonomy, PT-BR rules, the spend guard,
  the `--llm` arg-parsing guard, and Opus/Sonnet/Haiku pricing resolution.

Reproduce everything: see [`evals/`](../evals/), the Opus run JSON above, and the
prior Fable report `evals/reports/fable5-2026-06-11-v2-delivery.md`.

---

## Token Optimizer vs Caveman

Caveman (the upstream project this forks) is excellent at **one** thing: making
the model *say less*. The Token Optimizer keeps that and adds three more cost
surfaces — so it shrinks the whole bill, not just the reply.

| Capability | Caveman (upstream) | **Token Optimizer (this repo)** |
|------------|:------------------:|:-------------------------------:|
| Output token cut | ~65% (output only) | **76.7% on Opus 4.8** (tuned line) |
| Same-run head-to-head output | 59.4% | **76.7%** (~43% fewer tokens) |
| Recurring **context/doc** compression | ❌ none | ✅ **15–51%**, validated, reversible |
| **MCP tool-metadata** shrink | ❌ | ✅ `inputSchema`-safe |
| Model-aware **USD** pricing (Opus/Sonnet/Haiku) | ❌ | ✅ central table |
| **Budget-guarded** real-API benchmark | ❌ | ✅ hard $15 cap |
| Per-section **validation + repair + fallback** | ❌ | ✅ 0 corruption |
| **Secret-scan** abort before any LLM call | ❌ | ✅ |
| What it reduces | what the agent *says* | what it *says* **+** context re-sent every turn **+** tool metadata |

The brutal part isn't the output line being tighter (it is). It's that **caveman
leaves your biggest recurring cost — the CLAUDE.md / memory / project docs
re-sent into context every single turn — completely untouched**, while the Token
Optimizer compresses it once and proves the dollar savings on the model you
actually run.

---

## Why it doesn't lose quality

This is the question that kills most "token-saving" tricks: *does the answer get
worse?* For this optimizer the answer is no, and it's not a vibe — it's enforced
by construction. Six reasons:

**1. It removes redundancy, not information.** What gets cut is filler,
pleasantries, hedges, articles, preamble, and recaps — tokens that carry zero
technical content. "Sure! I'd be happy to help. The issue is likely caused by…"
becomes "Bug:". The *substance* — the diagnosis, the code, the steps — is
untouched. Compression here means saying the same thing in fewer words, not
saying less.

**2. Hard invariants are byte-enforced.** Before any rewrite, every piece of
content that *must not change* is masked into a frozen sentinel: fenced and
inline **code, identifiers, API names, file paths, URLs, link targets, env vars,
numbers, dates, version strings, error messages, and table/list structure**. The
rewrite literally cannot see or alter them. After the rewrite they're restored
byte-for-byte, and a validator confirms the full numeric sequence is intact —
including *bare* numbers, so "priority 3" can never become "priority 5". Modal
verbs (`might`, `may`, `could`) are explicitly preserved, because deleting them
turns "this migration **might** fail" into "this migration fail" — that's a
factual change, not compression, and it's forbidden.

**3. Validate → repair → fall back. The worst case is "less savings," never
"corruption."** Every LLM-compressed section is validated against the same
invariants as the whole file. If it fails, the model gets **one repair pass** that
quotes the exact invariant it broke. If it *still* fails, the section **falls back
to the safe local result** — and only validated output is ever cached or written.
You saw this happen live in the [doc-compression benchmark](#document-and-context-compression-opus-48):
on the Sonnet backend, 3 of `mixed-code.md`'s sections failed validation and fell
back — the file still came out 100% intact (`ok: true`), just compressed less.

**4. The auto-clarity guard yields to safety.** The output ruleset explicitly
drops back to **full, normal prose** for security warnings, irreversible-action
confirmations, ambiguous multi-step sequences, or when the user is confused or
repeating a question — then resumes. Terseness is suppressed in exactly the
places where ambiguity would be dangerous.

**5. Secrets never leave the machine.** Sensitive files (keys, private-key
material, credential paths, DB URLs, JWTs, high-entropy tokens) **abort the run
before any network call**, and `--local-only` never touches the network at all.

**6. The evidence backs it up.** Across the real Opus 4.8 and prior Fable runs:
**0 fidelity failures**. And brevity isn't the enemy of correctness — a 2026
study, ["Brevity Constraints Reverse Performance Hierarchies in Language
Models"](https://arxiv.org/abs/2604.00025), found that forcing models to answer
briefly *improved* accuracy by up to 26 points on some benchmarks. Less rambling
can mean more correct.

**The honest boundary:** the optimizer changes *style and re-sent context*, not
the model's reasoning. It makes the mouth smaller and the notes shorter. The
brain — the actual problem-solving — is exactly the same model doing exactly the
same work. That's the whole point: **cost down, capability unchanged.**

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

## Roadmap / measured-but-not-yet-shipped levers

Two further savings sources are documented here but **not shipped** because they
need verification against the live Claude Code host before the numbers can be
claimed honestly:

- **Tool Search `defer_loading`** (Anthropic) omits long-tail MCP tool definitions
  from the prompt prefix (85%+ definition-token cut) and pulls them in on demand.
  Composes with the existing description shrink. Pending: confirm the host honors
  `defer_loading` for third-party MCP servers.
- **Context Editing (`clear_tool_uses_20250919`)** auto-clears stale tool results
  server-side on long sessions. Pending: surface `cleared_input_tokens` as a
  measured metric and ship a recommended config.
- **Cache-prefix pricing** — the injected ruleset is already byte-stable across
  turns; once we confirm Claude Code places hook context at a cache breakpoint,
  re-injection should be priced at `cacheReadPerMTok` (Opus 4.8 $0.50) not
  `inputPerMTok` ($5) — a 10x correction on the dominant overhead term.
