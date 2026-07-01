<p align="center">
  <img src="docs/assets/flint-logo.png" width="130" alt="Flint logo"/>
</p>

<h1 align="center">Flint</h1>

<p align="center">
  <strong>Strike sharp. Spend less.</strong><br/>
  <sub>the Claude Code <strong>token-cost optimizer</strong> · why use many token when few do trick · caveman-powered · built for Opus 4.8</sub>
</p>

<p align="center">
  <a href="https://github.com/Marcelover777/flint/stargazers"><img src="https://img.shields.io/github/stars/Marcelover777/flint?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/Marcelover777/flint/commits/main"><img src="https://img.shields.io/github/last-commit/Marcelover777/flint?style=flat" alt="Last Commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Marcelover777/flint?style=flat" alt="License"></a>
</p>

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#60-second-quickstart">Quickstart</a> •
  <a href="#install">Install</a> •
  <a href="#what-you-get">What You Get</a> •
  <a href="#benchmarks">Benchmarks</a> •
  <a href="./docs/OPTIMIZER.md">How it works</a>
</p>

---

<p align="center">
  <img src="docs/assets/hero.png" width="820" alt="Flint — cut ~77% of Claude's output tokens with full technical accuracy"/>
</p>

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill/plugin (also Codex, Gemini, Cursor, Windsurf, Cline, Copilot, 30+ more) that makes the agent talk like a caveman — cuts **~77% of output tokens**, keeps full technical accuracy. Brain still big. Mouth small.

> [!NOTE]
> **Fork of [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) (MIT).** This repo keeps the full caveman product and adds a **model-aware token-cost optimizer**, now targeting **Claude Fable 5** (`claude-fable-5`, Anthropic's current Mythos-class model at $10/$50 per MTok — an earlier note here claiming Fable 5 was retired was wrong; at 2x Opus output pricing every saved token is worth double). On a **real, budgeted Opus 4.8 benchmark** it cut **76.7% of output tokens** (mean; p50 79.3%) with **zero fidelity failures**, plus **15–51% of re-sent doc/context** — surfaces caveman doesn't touch at all. It adds safe doc compression, MCP metadata shrink, adaptive injection, and a budget-guarded USD benchmark. **→ [docs/OPTIMIZER.md](./docs/OPTIMIZER.md)** explains how it works. Upstream attribution in [NOTICE](./NOTICE).

> [!TIP]
> **New: [Flint 2](./flint/) — standalone, project-local, Fable 5-native.** Fully detached from the caveman install layout: one `node flint/install.mjs <project>` drops engine + skills + compact subagents into that project's `.claude/`, auto-activates every session, and adds **agent-loop rules** (final-message cap, ≤1 line between tool calls, never re-print code/diffs) — the surfaces where agentic sessions actually burn output. Extended local compressor (EN + PT-BR): **14.4%** prose-heavy EN / **9.9%** PT-BR / **10.8%** mixed, local-only, zero network, validation-gated. 48/48 tests. **→ [flint/README.md](./flint/README.md)**

## Before / After

<p align="center">
  <img src="docs/assets/before-after.gif" width="680" alt="Flint compressing a verbose answer into a terse one — 69 to 19 tokens, -72%"/>
</p>

<table>
<tr>
<td width="50%">

### 🗣️ Normal Claude (69 tokens)

> "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle. When you pass an inline object as a prop, React's shallow comparison sees it as a different object every time, which triggers a re-render. I'd recommend using useMemo to memoize the object."

</td>
<td width="50%">

### <img src="docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman Claude (19 tokens)

> "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."

</td>
</tr>
<tr>
<td>

### 🗣️ Normal Claude

> "Sure! I'd be happy to help you with that. The issue you're experiencing is most likely caused by your authentication middleware not properly validating the token expiry. Let me take a look and suggest a fix."

</td>
<td>

### <img src="docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman Claude

> "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"

</td>
</tr>
</table>

**Same fix. 75% less word. Brain still big.**

```
┌─────────────────────────────────────┐
│  TOKENS SAVED          ████████ 75% │
│  TECHNICAL ACCURACY    ████████ 100%│
│  SPEED INCREASE        ████████ ~3x │
│  VIBES                 ████████ OOG │
└─────────────────────────────────────┘
```

Pick your level of grunt — `lite` (drop filler), `full` (default caveman), `ultra` (telegraphic), or `wenyan` (classical Chinese, even shorter). One command switch. Cost go down forever.

<table align="center">
<tr><td>

### <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> Like this trick? Now get whole agent — **caveman-code**

This skill shrink what agent **say**. **[caveman-code](https://github.com/JuliusBrussee/caveman-code)** shrink **everything** — full terminal coding agent, caveman top to bottom. **~2× fewer tokens than Codex** on identical tasks. 20+ providers · plan mode · autopilot goal loop · MIT.

```bash
npm install -g @juliusbrussee/caveman-code
```

[**▶ Try caveman-code now →**](https://github.com/JuliusBrussee/caveman-code) — *why use many token when whole agent save*

</td></tr>
</table>

## 60-second Quickstart

Three steps. One rock. That it.

**1. Install** — one line (~30s, needs Node ≥18):

```bash
# macOS / Linux / WSL / Git Bash
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash
# Windows PowerShell 5.1+
irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex
```

**2. Turn it on** — open Claude Code, type:

```
/caveman
```

Every reply now terse, full accuracy. Stop with `normal mode`. Grunt levels: `/caveman lite | full | ultra | wenyan`.

**3. See the money** — real tokens + USD for Opus 4.8:

```
/caveman-stats --json
```

Statusline shows `[CAVEMAN] ⛏ 12.4k` — lifetime tokens saved.

### Optimizer layer (clone, zero deps)

The `/caveman*` slash commands above ship with the install. The **optimizer CLI** (safe doc compression, USD benchmark, MCP shrink) runs straight from a clone — **no `npm install`, just Node ≥18**:

```bash
git clone https://github.com/Marcelover777/flint && cd flint
node src/commands/caveman-compress.js CLAUDE.md --check   # preview, no write, no network
node src/commands/caveman-bench.js --offline --report     # token + USD report
node src/commands/caveman-doctor.js --json                # health check
```

How it all works → **[docs/OPTIMIZER.md](./docs/OPTIMIZER.md)**.

## Install

One line. Find every agent. Install for each.

```bash
# macOS / Linux / WSL / Git Bash
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash

# Windows (PowerShell 5.1+)
irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex
```

~30 seconds. Needs Node ≥18. Skip agent you no have. Safe to re-run.

**Trigger:** type `/caveman` or say "talk like caveman". Stop with "normal mode".

One agent only, manual command, or any of 30+ other agents → [**INSTALL.md**](./INSTALL.md).
Install break? Open agent, say *"Read CLAUDE.md and INSTALL.md, install caveman for me."* Agent fix own brain.

## What You Get

| Skill | What |
|---|---|
| `/caveman [lite\|full\|ultra\|wenyan]` | Compress every reply. Levels stick until session end. |
| `/caveman-commit` | Conventional Commit messages, ≤50 char subject. Why over what. |
| `/caveman-review` | One-line PR comments: `L42: 🔴 bug: user null. Add guard.` |
| `/caveman-stats` | Real session token usage + lifetime savings + model-aware USD (Fable 5 default). JSON via `--json`, tweetable line via `--share`. |
| `/caveman-compress <file>` | Local-first safe memory compression. Code/URLs/paths byte-preserved. LLM compression opt-in via `--llm` (default `claude-sonnet-4-6`). |
| `/caveman-doctor` | Checks hooks, config, statusline, MCP shrink, pricing, secret scanner, token-count readiness. |
| `/caveman-bench` | Offline eval/bench report; budgeted Opus 4.8 online path when API key exists. |
| `caveman-shrink` | MCP middleware. Wraps any MCP server, compresses list descriptions with Content-Length support. [npm](https://www.npmjs.com/package/caveman-shrink). |
| `cavecrew-*` | Compact subagents (investigator/builder/reviewer). File/line evidence stays, main context lasts longer. |

**Statusline badge** — Claude Code shows `[CAVEMAN] ⛏ 12.4k` (lifetime tokens saved). Updates every `/caveman-stats` run. Set `CAVEMAN_STATUSLINE_SAVINGS=0` to silence.

Auto-activate every session: Claude Code, Codex, Gemini (built-in). Cursor / Windsurf / Cline / Copilot get always-on rule files via `--with-init`. Other agents trigger with `/caveman` per session. Full feature matrix in [INSTALL.md](./INSTALL.md).

## Benchmarks

Real token counts from the Claude API. Average **65% output reduction** across 10 prompts (range 22-87%).

<!-- BENCHMARK-TABLE-START -->
| Task | Normal | Caveman | Saved |
|------|-------:|--------:|------:|
| Explain React re-render bug | 1180 | 159 | 87% |
| Fix auth middleware token expiry | 704 | 121 | 83% |
| Set up PostgreSQL connection pool | 2347 | 380 | 84% |
| Explain git rebase vs merge | 702 | 292 | 58% |
| Refactor callback to async/await | 387 | 301 | 22% |
| Architecture: microservices vs monolith | 446 | 310 | 30% |
| Review PR for security issues | 678 | 398 | 41% |
| Docker multi-stage build | 1042 | 290 | 72% |
| Debug PostgreSQL race condition | 1200 | 232 | 81% |
| Implement React error boundary | 3454 | 456 | 87% |
| **Average** | **1214** | **294** | **65%** |
<!-- BENCHMARK-TABLE-END -->

Raw data and reproduction script: [`benchmarks/`](./benchmarks/). Three-arm eval harness (baseline / terse / skill) lives in [`evals/`](./evals/) — caveman compared against `Answer concisely.` not against verbose default, so the delta is honest.

### Model-aware token-cost optimizer (Fable 5 default)

> Default target is **`claude-fable-5`** ($10/$50 per MTok — verified pricing
> table also covers Opus 4.8/4.7, Sonnet 4.6, Haiku 4.5 and any Claude via
> longest-prefix match). The Opus 4.8 benchmark below still stands; on Fable 5
> the same output cut is worth 2x in USD.

A **model-aware token-cost optimizer** sits on top of caveman. It attacks four
surfaces — model output, re-sent context/docs, MCP tool metadata, and
measurement — and prices the result for the model you actually ran:

<p align="center">
  <img src="docs/assets/diagrams/four-surfaces.png" width="780" alt="The four token-cost surfaces: output, re-sent context, MCP metadata, measurement"/>
</p>

- micro-inject by default for Claude Code SessionStart, with full skill fallback via config;
- `/caveman-stats --json` reports input/output/cache tokens and USD cost for `claude-fable-5` (default), `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`, and any Claude model (longest-prefix pricing);
- `/caveman-compress --local-only` runs with no network; `--llm` is opt-in (default backend `claude-sonnet-4-6`), with protected spans, secret-scan abort, per-section validation + one repair pass + safe fallback, and a `--max-llm-usd` spend cap;
- `/caveman-bench --online --model claude-opus-4-8` re-benchmarks against Opus directly (budget-guarded, hard $15 cap);
- `caveman-shrink` preserves `inputSchema`, never mutates `tools/call`, and supports newline JSON + `Content-Length` framing.

**Safe by construction** — every doc rewrite runs through a validation gate; break an invariant and it repairs once, else falls back to the safe local result. Code, URLs, paths, numbers, and identifiers stay byte-identical.

<p align="center">
  <img src="docs/assets/diagrams/compression-pipeline.png" width="860" alt="Compression pipeline: split prose/code, protect spans, compress, validate, repair, or fall back"/>
</p>

**Real Opus 4.8 results** (budgeted run, ~$0.29 at verified $5/$25 pricing, [raw JSON](./evals/reports/claude-opus-4-8-2026-06-13-online.json)):

| Surface | Result | vs caveman |
|---|---|---|
| Output tokens | **76.7%** cut (mean; p50 79.3%, worst 64.5%) | caveman-style line cut 59.4% on the same run → optimizer emits **~43% fewer** |
| Re-sent doc/context | **15–51%** cut, every doc validated intact | caveman: **0%** (no context surface) |
| Fidelity | **0 failures** | — |

**Does it lose answer quality?** No — and that's enforced, not hoped: it cuts
filler/redundancy, **never** code/identifiers/paths/URLs/numbers (byte-frozen and
validated), and any risky rewrite that drifts is **rejected and falls back** to a
safe result. The worst case is "compressed less," never "corrupted." Full detail,
the Opus benchmark, the **why-no-quality-loss** breakdown, and the **caveman
comparison**: **→ [docs/OPTIMIZER.md](./docs/OPTIMIZER.md)**.

LLM compression may send selected prose to the Claude API. API traffic can have retention requirements; do not run LLM compression on sensitive documents. Local-only mode stays on machine.

**caveman-compress receipts** (real memory files):

| File | Original | Compressed | Saved |
|---|---:|---:|---:|
| `claude-md-preferences.md` | 706 | 285 | **59.6%** |
| `project-notes.md` | 1145 | 535 | **53.3%** |
| `claude-md-project.md` | 1122 | 636 | **43.3%** |
| `todo-list.md` | 627 | 388 | **38.1%** |
| `mixed-with-code.md` | 888 | 560 | **36.9%** |
| **Average** | **898** | **481** | **46%** |

> [!IMPORTANT]
> Caveman only affects output tokens — thinking/reasoning tokens untouched. Caveman no make brain smaller. Caveman make *mouth* smaller. Biggest win is **readability and speed**, cost savings a bonus.

A March 2026 paper ["Brevity Constraints Reverse Performance Hierarchies in Language Models"](https://arxiv.org/abs/2604.00025) found that constraining large models to brief responses **improved accuracy by 26 points** on certain benchmarks. Verbose not always better. Sometimes less word = more correct.

## How It Work

1. Install drop skill file in agent.
2. Skill tell agent: drop filler, keep substance, use fragments.
3. For Claude Code, hook also write tiny flag file each session — agent see flag, talk caveman from message one. No need say `/caveman`.
4. Stats command read Claude Code session log, count tokens saved, write number to statusline.
5. Caveman-compress sub-skill rewrite memory files (CLAUDE.md, project notes) so each session start with smaller context. Save tokens forever, not just one reply.

Maintainer detail (hook architecture, file ownership, CI sync) live in [CLAUDE.md](./CLAUDE.md).

## Lobster, Meet Rock 🦞 <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/>

[**OpenClaw**](https://openclaw.ai) the self-host gateway. One box, many agent inside (Claude Code, Codex, Pi, OpenCode), wired to your Slack / Discord / iMessage / Telegram / whatever. Tagline: *"The lobster way."* Lobster strong. Lobster smart. Lobster also talk a lot.

Caveman teach lobster brevity — same canonical installer, scoped to one agent:

```bash
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --only openclaw

# Windows (PowerShell): no Node? install Node ≥18 first, then
npx -y github:JuliusBrussee/caveman -- --only openclaw
```

Two thing happen, no more:

1. **Skill drop** at `~/.openclaw/workspace/skills/caveman/SKILL.md` — spec-correct frontmatter (`version`, `always: true`), discoverable by `openclaw skills list`. Skill not auto-inject (OpenClaw load skill on demand) — that why we also do step 2.
2. **SOUL.md nudge.** Tiny marker-fenced block appended to `~/.openclaw/workspace/SOUL.md`. OpenClaw inject SOUL.md into *every* turn under "Project Context" (12K-per-file, 60K total — block well under). Lobster terse from message one. No `/caveman` per session. No nag.

```
~/.openclaw/workspace/
├── skills/caveman/SKILL.md   ← full ruleset, on-demand load
└── SOUL.md                    ← <!-- caveman-begin --> ... <!-- caveman-end -->
                                  ↑ auto-inject every turn
```

Custom workspace path? `OPENCLAW_WORKSPACE=/your/path` before the command. Uninstall: same one-liner with `--uninstall` — skill folder gone, SOUL.md block ripped out cleanly, your other workspace content stay untouched. Idempotent re-runs (frontmatter not double-prepended, marker block not duplicated).

Lobster claw still sharp. Lobster mouth now small. Brain still big.

## Caveman Ecosystem

Five tools. One philosophy: **agent do more with less**.

| Repo | What |
|------|------|
| [**caveman**](https://github.com/JuliusBrussee/caveman) *(you here)* | Output compression — *why use many token when few do trick* |
| [**caveman-code**](https://github.com/JuliusBrussee/caveman-code) | Whole terminal coding agent — *why use many token when whole agent can save* |
| [**cavemem**](https://github.com/JuliusBrussee/cavemem) | Cross-agent memory — *why agent forget when agent can remember* |
| [**cavekit**](https://github.com/JuliusBrussee/cavekit) | Spec-driven build loop — *why agent guess when agent can know* |
| [**cavegemma**](https://github.com/JuliusBrussee/finetune-caveman) | Gemma 4 31B fine-tuned on caveman pairs — *why prompt every turn when weight remember* |

Compose: cavekit drive build, caveman compress what agent *say*, cavemem compress what agent *remember*, cavegemma bake compression into weight, caveman-code ship it all as one terminal agent. One rock. Two rock. Three rock. Four rock. Five rock. That it.

## Links

- [INSTALL.md](./INSTALL.md) — full install matrix, all flags, per-agent detail
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to send patch
- [CLAUDE.md](./CLAUDE.md) — maintainer guide (file ownership, hook architecture, CI)
- [docs/](./docs/) — extra guides (Windows install, etc.)
- [Issues](https://github.com/JuliusBrussee/caveman/issues) — bug, feature, weird behavior

## Star This Repo

Caveman save you token, save you money. Star cost zero. Fair trade. ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=Marcelover777/flint&type=Date)](https://star-history.com/#Marcelover777/flint&Date)

## Also by Julius Brussee

- **[Revu](https://github.com/JuliusBrussee/revu-swift)** — local-first macOS study app with FSRS spaced repetition. [revu.cards](https://revu.cards)

## License

MIT — free like mass mammoth on open plain.
