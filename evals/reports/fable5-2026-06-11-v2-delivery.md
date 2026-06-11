# Fable 5 Optimizer V2 — Delivery Report (2026-06-11)

Baseline for every comparison: **current V1 branch** (`codex/fable5-optimizer`,
commit `03b8136`), not upstream Caveman. Online numbers come from two budgeted
runs of `node src/commands/caveman-bench.js --online` against `claude-fable-5`
(real API usage, priced via `src/core/pricing.js`).

## Spend

| Run | Calls | Input tok | Output tok | Cost |
|-----|------:|----------:|-----------:|-----:|
| Run 1 (pre-tune, $3 cap) | 21 | 10,226 | 11,564 | $0.680 |
| Run 2 (final, $2 cap) | 21 | 10,209 | 10,289 | $0.617 |
| **Total** | 42 | 20,435 | 21,853 | **$1.30 of $15 hard cap** |

Committed snapshot: `evals/reports/fable5-2026-06-11-online.json` (run 2,
matches shipped MICRO.md).

## Surface 1 — Visible output vs normal (no-caveman) mode

6 prompts (EN dev, PT-BR, agentic coding), 800-token output cap. Baseline hit
the cap on most prompts, so reductions below are **underestimates**.

| Arm | Mean | p50 | Worst |
|-----|-----:|----:|------:|
| V1 MICRO full line | 55.2% | 55.4% | 25.1% |
| **V2 MICRO full line** | **70.7%** | **67.9%** | **53.6%** |

Target ≥60% visible output reduction: **met** (mean and p50; worst-case 53.6%).
Per-prompt output tokens vs V1: V2 emits on average **35% fewer output tokens
than V1** (per-prompt ratio mean 0.67, p50 0.66, worst 0.96).

What changed: MICRO full line now says "Answer only what asked — no preamble,
no recap, no extras". An intermediate candidate with "Bullets over prose"
*regressed* vs V1 (45.6% mean) because it encouraged enumeration — caught and
discarded by the A/B run.

## Surface 2 — Doc/context compression (hybrid LLM, opt-in)

`evals/fixtures/docs/*.md` are realistic verbose docs (EN prose, PT-BR prose,
mixed prose+code). `--check` mode, strict validation, no cache. V1 reference is
the smoke documented in the brief (11.47% prose / 3.55% mixed).

| Fixture | Local-only | Hybrid run 1 | Hybrid run 2 | Fallbacks |
|---------|----------:|-------------:|-------------:|-----------|
| prose-heavy.md (EN) | 13.3% | 58.7% | 58.7% | none |
| prose-heavy-ptbr.md | 8.7% | 46.5% | 46.0% | none |
| mixed-code.md | 10.9% | 36.1% | 30.7% | 1× validation_failed → local (handled) |

Targets: ≥25% prose-heavy **met** (46–59%), ≥10% mixed **met** (31–36%).
All protected spans byte-identical (strict validator: headings, fenced/inline
code, URLs, link targets, paths, env vars, numbers/dates/versions, table and
list shapes). The one validation failure was repaired-then-fell-back exactly as
designed; the file still passed whole-file validation.

Hybrid loop changes: stronger compression prompt (40–60% target, frozen-sentinel
and structure rules), one repair retry quoting the violated invariant codes,
60s fetch timeout, fallback taxonomy (`no_savings`, `validation_failed`,
`secret_risk`, `timeout`, `api_failure`, `budget_exhausted`), per-section
validation before caching (only validated outputs are cached), and a spend
budget (`--max-llm-usd`).

## Surface 3 — Injection overhead

| Item | V1 | V2 |
|------|---:|---:|
| MICRO full line (est. tokens) | 52 | 55 (stronger behavior, ~flat cost) |
| Adaptive reinforcement (est. tokens) | 45 | 32 (−29%) |

## Surface 4 — MCP shrink

No behavior change. `inputSchema` preserved by default, requests and
`tools/call` never mutated; all transform/framing tests pass (0 regressions).

## Headline: additional total-token-cost reduction vs V1

Model: representative session where caveman-affected cost = compressed project
docs re-sent in context + visible output, priced at Fable 5 ($10/M in, $50/M
out). Per turn, 4,000 baseline doc tokens + measured output arms.

| Session doc mix | V1 cost/turn | V2 cost/turn | Additional reduction |
|-----------------|-------------:|-------------:|---------------------:|
| Prose-heavy docs (58.7%) | $0.0507 | $0.0265 | **47.7%** |
| p50 doc mix (46.0%) | $0.0507 | $0.0315 | **37.9%** |
| Code-heavy docs (30.7%) | $0.0507 | $0.0377 | 25.6% (worst case) |

Verdict: the ≥40% target is **met on prose-heavy doc sessions (47.7%)** and
**near-met at the p50 mix (37.9%)**; code-heavy sessions land at ~26% because
protected code blocks are (correctly) untouchable. Reported per the brief with
p50 and worst-case, not just averages.

**Precise blocker:** the two compressible surfaces are now both deep into
diminishing returns — output is already ~70% below normal and doc prose ~50%
smaller — while the largest cost block in real Claude Code sessions (tool
results and conversation history) is untouched by caveman.

**Next highest-leverage change:** extend the caveman-shrink MCP middleware from
`*/list` responses to `tools/call` *results* (read-only, method-aware, same
protect/validate pipeline as doc compression), plus cache-aware injection so
the SessionStart ruleset lands in the prompt-cache prefix. That surface is
5–20× larger than doc context in agentic sessions.

## Quality / fidelity

- 0 critical fidelity failures across both online runs (`fidelity_verdict:
  no_critical_failures`).
- 83/83 tests pass (was 74; +9 new: budget guard, repair prompt, fallback
  taxonomy, PT-BR rules, spend guard, p50/worst summaries).
- Secret fixtures abort before any LLM call; `--local-only` makes no network
  call; `--check` writes nothing; `--restore` round-trip verified.
- Caveman voice preserved in SKILL.md/README; no new dependencies; LLM
  compression remains opt-in; local deterministic path remains the default.
