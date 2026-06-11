# Fable 5 Next Optimization Brief

Use the current repository state as baseline, not upstream Caveman.

Current baseline:
- branch: `codex/fable5-optimizer`
- latest hardening commit: `03b8136 fix(compress): harden fable validation loop`
- local tests: `npm run test:all` passes `74/74`
- `MICRO.md` prompt overhead: ~272 estimated tokens
- full `SKILL.md` prompt overhead: ~1050 estimated tokens
- current hybrid online smoke:
  - `project-notes.md`: `ok: true`, ~11.47% char reduction
  - `mixed-with-code.md`: `ok: true`, ~3.55% char reduction
- token-count API works when `ANTHROPIC_API_KEY` exists

## Goal

Maximize additional token and cost reduction from the current V1 implementation while preserving maximum technical quality.

This is not a comparison against original Caveman. Improve from the current V1 branch.

Primary target:
- at least 40% additional total-token-cost reduction versus current V1 on representative Claude Code/Fable sessions.
- at least 60% visible output-token reduction versus normal non-Caveman mode.
- push beyond those targets wherever safe. Prefer maximum safe savings over conservative minimum savings.

Quality target:
- no technical fact loss
- no altered code blocks, identifiers, API names, paths, URLs, env vars, numbers, dates, versions, error strings, schemas, or tool-call payloads
- no broken markdown structure
- no unsafe compression of secrets or sensitive files
- no regression in install paths, hooks, skills, MCP shrink, opencode commands, or Cavecrew contracts

## Optimization Surfaces

Improve all four surfaces together:

1. Output compression
   - make Caveman/Fable output more compact without becoming ambiguous
   - prefer direct answer, terse reasoning, compact bullets, minimal prose
   - keep normal prose for safety, irreversible actions, or ambiguity

2. Input/context compression
   - improve `MICRO.md` and adaptive prompt reinforcement
   - minimize repeated system/policy text after activation
   - compress `CLAUDE.md`, memory docs, and project notes more aggressively when safe

3. MCP/tool metadata shrink
   - reduce tool/list response size while preserving `inputSchema` by default
   - never mutate requests or `tools/call`
   - keep method-aware transforms and framing compatibility

4. Measurement and evals
   - produce a cheap online eval path with explicit spend guard
   - measure input, output, cache write, cache read, and available thinking/output details
   - report estimated USD savings using `src/core/pricing.js`

## Required Improvements

Improve hybrid compression first.

Current issue: safe, but too conservative. Online smoke only saved 3-12% on fixtures.

Desired behavior:
- target 25-45% reduction for prose-heavy docs
- target 10-25% reduction for mixed prose/code docs
- keep per-section validation and fallback
- if LLM output breaks invariants, retry once with a stricter repair prompt before falling back to local
- track why fallback happened: no savings, validation failure, secret risk, API failure, timeout
- cache only validated successful section outputs

Improve evals:
- add a budgeted online bench command or flag, default max spend <= US$1 unless user overrides
- support a hard budget cap; for this task never exceed US$15
- compare current V1 versus improved branch, not original upstream only
- include PT-BR prompts and agentic coding prompts
- write a concise report with:
  - total estimated tokens
  - estimated USD cost
  - savings by surface
  - quality/fidelity verdict
  - failures and fallback counts

Improve success metrics:
- current V1 is baseline
- success is measured as additional reduction from current V1
- normal non-Caveman is only used to show absolute output reduction
- report p50 and worst-case, not only average

## Acceptance Criteria

Must pass:
- `npm run test:all`
- `git diff --check`
- `/caveman-doctor --json` equivalent: `node src/commands/caveman-doctor.js --json`
- offline bench: `node src/commands/caveman-bench.js --offline --report`
- budgeted online smoke when `ANTHROPIC_API_KEY` exists

Compression acceptance:
- all protected spans byte-identical
- markdown headings/list/table/code invariants preserved
- secret fixtures abort before any LLM call
- `--local-only` makes no network call
- `--check` writes no target files
- `--restore` restores latest backup
- LLM compression has per-section validation, one repair attempt, then safe fallback

Target metrics:
- >=40% additional total-token-cost reduction versus current V1 on representative sessions
- >=60% visible output reduction versus normal mode
- >=25% doc compression on prose-heavy fixtures when LLM is enabled
- >=10% doc compression on mixed code/prose fixtures when LLM is enabled
- 0 critical fidelity failures
- 0 schema/tool-call mutation regressions

If targets are not met, report the blocker precisely and propose the next highest-leverage change.

## Constraints

- Do not remove Caveman voice.
- Do not add heavy dependencies unless tests prove built-ins are insufficient.
- LLM compression remains opt-in.
- Local deterministic compression remains safe default.
- Do not self-install into user Claude config unless explicitly asked.
- Do not spend more than US$15 total on online validation.
- Do not print or commit API keys.
