# PLAN — Token Optimizer v3: power-ups, cannibalized techniques, didactic visual docs

> Execution plan produced by `/claude-mem:make-plan`. Each phase is self-contained
> and can run in a fresh chat context. Frame every task as **copy the pattern from
> the cited source**, not "transform existing code from memory". Numbers go into
> docs only from real runs (CLAUDE.md rule). Repo root:
> `C:\Users\Usuario\Documents\token-optimizer`. Default branch: `main`
> (fork `Marcelover777/token-optimizer`; upstream `JuliusBrussee/caveman`, MIT).

---

## Phase 0 — Documentation Discovery (consolidated; READ FIRST)

### Allowed APIs / techniques (cited)

| Technique / API | Source | Use here |
|---|---|---|
| LLMLingua-2 extractive prompt compression (`compress_prompt`, MIT, local BERT-class model) | https://github.com/microsoft/LLMLingua | Optional **candidate** compressor for surface #2, **gated by the existing validator** (it gives NO byte-preservation guarantee). |
| TOON — lossless tabular JSON encoding (MIT, TS+Py SDKs) | https://github.com/toon-format/toon | Re-encode uniform JSON the optimizer **injects** (tool/skill manifests) and large uniform arrays in MCP descriptions. Lossless round-trip = respects byte-preservation. |
| Anthropic Tool Search Tool — `defer_loading: true` + `tool_search_tool_regex_20251119` | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool | Surface #3: **omit** long-tail tool defs (85%+ definition-token cut) instead of only compressing them. Preserves prompt cache. |
| Anthropic Context Editing — `clear_tool_uses_20250919` (`trigger`/`keep`/`clear_at_least`/`exclude_tools`) | https://platform.claude.com/docs/en/build-with-claude/context-editing | Surface #4: report `cleared_input_tokens` as a measured saving; ship a recommended config for long Claude Code sessions. |
| Anthropic Prompt Caching (order tools→system→messages, 1024-tok min, 5-min TTL, byte-stable prefix) | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Surface #1/#4: keep the injected ruleset byte-stable; price re-injection at `cacheReadPerMTok` not `inputPerMTok`. |
| Independent caveman benchmark — full ruleset (552 tok) underperformed a 6-line micro vs a **terse** baseline (net 14–21%, not 75%) | https://medium.com/@KubaGuzik/i-benchmarked-the-viral-caveman-prompt-to-save-llm-tokens-then-my-6-line-version-beat-it | Surface #1: ship/keep a **micro (~6-line) tier** as default for uncached/reinforcement; quote honest net-vs-terse numbers. |
| GPTCache — semantic/exact response caching (MIT) | https://github.com/zilliztech/GPTCache | Narrow use: exact-match cache of doc-compression results by content hash (surface #2); NOT semantic caching of code answers (false-hit risk). |

### Image-generation fact-check (anti-pattern guard)

**Anthropic CANNOT generate images.** The Messages API is text + image **input**,
**text output** only — confirmed verbatim in
https://platform.claude.com/docs/en/about-claude/models/overview.md
("…text and image input, **text output**…") and the vision guide
https://platform.claude.com/docs/en/build-with-claude/vision.md (input-only).
The `ANTHROPIC_API_KEY` powers bench/compress/count_tokens, NOT image generation.

**Real image options (ranked):**
1. **Claude-authored SVG / Mermaid → PNG via headless Chrome** (already used for
   `docs/assets/hero.png`: write HTML/SVG, then
   `chrome --headless=new --no-sandbox --screenshot=out.png --window-size=W,H --force-device-scale-factor=2 file:///…`).
   Free, brand-consistent, reproducible, vector-crisp, version-controlled. **DEFAULT.**
2. Connected diagram MCPs (`mcp__9ed2cb42-…__generate_diagram`,
   `mcp__visualize__show_widget`, Figma) — optional, external dep, less reproducible.
3. External text-to-image (DALL·E/SD) — different provider, raster, corrupts labels.
   **Not for technical diagrams.**

### Anti-patterns to prevent (all phases)
- ❌ Claiming/implying Anthropic generates images anywhere in code or docs.
- ❌ Changing `validate.js` collectors without applying the **identical** regex to
  `protect.js` — the protect↔validate round-trip invariant breaks (`verifySegments`).
- ❌ Putting any number in README/PDF/OPTIMIZER that isn't from a real `benchmarks/`
  or `evals/` run.
- ❌ Compressing `tools/call` results without a validator gate and default-off flag.
- ❌ Reordering/reformatting the cached SessionStart prefix (invalidates KV cache).
- ❌ Trusting LLMLingua-2 output without passing it through `validateCompression`.

### Verification baseline (run before starting)
```
npm run test:all              # expect 96/96
git diff --check
node src/commands/caveman-doctor.js --json
node src/commands/caveman-bench.js --offline --report
```

---

## Phase 1 — Correctness & safety quick wins (low risk, code-verified)

**What to implement** (each has an exact location; copy the pattern, add a test):

1. **Tighten the env-var protector** so prose ALL-CAPS (NOTE/SHOULD/HTTP/JSON) is no
   longer frozen, while real SCREAMING_CASE/`$VARS` stay protected.
   - `src/core/protect.js:32` and **both** collectors in `src/core/validate.js:62-63`
     (apply the IDENTICAL alternation in both files).
   - Replace `\b[A-Z][A-Z0-9_]{2,}\b` with `\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`
     (requires an underscore-joined segment: keeps `API_KEY`, `MAX_FLAG_BYTES`;
     frees `HTTP`, `JSON`, `NOTE`). Keep the existing `\$[A-Za-z_][A-Za-z0-9_]*`.
   - Add fixtures asserting `API_KEY`/`$HOME` preserved, `NOTE`/`HTTP` compressible.

2. **Stats USD fallback to `config.targetModel`** when the session log has no model.
   - `src/hooks/caveman-stats.js` `savingsModel` (~:177): `const m = model || getTargetModel();`
     import `getTargetModel` from `./caveman-config`. Add `pricing_source`
     (`'config-default'` vs the model's `source`) to the JSON payload + footer label.

3. **Symlink/atomic-safe MCP shrink cache write** — match the repo's own standard.
   - `src/mcp-servers/caveman-shrink/cache.js:24-29`: route `saveCache` through
     `src/core/atomic-write.js` `atomicWriteFile` (temp+rename) + `lstat` symlink
     refusal like `caveman-config.js safeWriteFlag`.

4. **Scope `findRecentSession` to the current project.**
   - `src/hooks/caveman-stats.js:83-104`: compute the cwd slug (path separators →
     `-`, e.g. `C--Users-Usuario-Documents-token-optimizer`), scan
     `projects/<slug>/` first, fall back to global-newest only if absent.

**Doc references:** subagent codebase audit (findings 1,4,6,8); existing patterns in
`src/core/atomic-write.js`, `src/hooks/caveman-config.js`.

**Verification checklist:**
- `npm run test:all` green (+ new fixtures).
- `node -e "…protectSegments('NOTE: use HTTP, set API_KEY=$HOME')…"` shows NOTE/HTTP
  free, API_KEY/$HOME frozen.
- A doc with no model line in its log now shows a labeled USD estimate.

**Anti-pattern guards:** identical regex in both files; never widen one alone.

---

## Phase 2 — Compression power-ups (raise ratio without losing fidelity)

1. **Split prose runs from fenced-code runs inside a section.**
   - `src/core/markdown-sections.js:33-49` (consumed at `caveman-compress.js:372`):
     after heading split, sub-split each body at `/(```|~~~)[\s\S]*?\1/`; emit prose
     runs and code runs as separate entries (code runs returned verbatim — already
     byte-exact via `protectSegments`). Keep exact offsets so
     `outputs.join('')` reconstructs the file.
   - Add a round-trip test: `join(sections.map(s=>s.text)) === original`.
   - Expected: lifts `mixed-code.md` ratio (local 0.109 → higher) because the 0.35
     LLM gate now measures prose runs alone.

2. **Optional LLMLingua-2 compression candidate, gated by the validator.**
   - New optional backend in `src/commands/caveman-compress.js` compress path:
     run LLMLingua-2 (`compress_prompt`, opt-in flag, local) → restore protected
     spans → `validateCompression(..., {strict})` → accept ONLY if it passes AND is
     shorter than the local result, else fall back. Source: github.com/microsoft/LLMLingua.
   - Document it as opt-in; it adds a Python dep — keep behind a flag and a clear
     "requires `pip install llmlingua`" note. Do not make it default.

3. **Micro-tier default for uncached / reinforcement paths.**
   - Make the per-turn reinforcement string (`src/hooks/prompt-policy.js`
     `reinforcementText`) and the uncached injection use the ~6-line micro form;
     reserve the full `SKILL.md` ruleset for cached SessionStart where input
     overhead amortizes. Source: caveman benchmark (Phase 0).
   - Update the eval harness to choose full-vs-micro by **net** tokens
     (injection input + output) vs the **terse** arm, not baseline.

**Verification:** re-run `caveman-bench --offline` and a budgeted
`--online --model claude-opus-4-8 --max-spend 1`; compare `mixed-code.md` and
prose ratios pre/post; 0 fidelity failures; tests green.

**Anti-pattern guards:** LLMLingua-2 output MUST pass `validateCompression`;
never ship its raw output. Don't quote new ratios until measured.

---

## Phase 3 — MCP surface expansion (biggest token sink)

1. **Handle JSON-RPC batch responses.**
   - `src/mcp-servers/caveman-shrink/transform.js:65-66` + `index.js:59-69`:
     detect `Array.isArray(message)` and map each element through
     `transformResponse(el, methodFor(el.id), opts)` using the existing `pending`
     id→method map. Today a batch passes through uncompressed (verified).

2. **Opt-in `tools/call` RESULT compression** (the largest lever).
   - New default-OFF flag (parallel to `compressNestedSchemas`): walk
     `message.result.content[]` text blocks through `compress()` behind the same
     validator; never touch non-text/structured blocks. README currently skips this.

3. **Tool Search `defer_loading` mode** (cannibalized).
   - Add a middleware mode that marks host-policy low-frequency tools
     `defer_loading: true` and injects the `tool_search_tool_regex_20251119` stub.
     When shrinking a deferred tool's description, KEEP discoverability keywords
     (service prefix + task verbs) so search still finds it.
     Source: Tool Search docs (Phase 0). Verify Claude Code host honors it before
     claiming the saving in docs.

4. **TOON encoding for uniform JSON** (cannibalized).
   - Where the optimizer injects structured manifests, or a tool description embeds
     a large uniform array, offer TOON re-encoding (lossless). Source: toon-format/toon.

5. **Cache hot-path fix.**
   - `transform.js:67-92`: load the shrink cache ONCE at proxy start (`index.js`),
     pass the in-memory object via `opts`, flush debounced/on-exit; avoid the double
     `clone()` when nothing changed. Pair with the Phase 1 symlink-safe writer.

**Verification:** `npm run test:all` (extend `tests/mcp/transform.test.mjs` with a
batch fixture + a `tools/call`-result fixture proving `inputSchema` and non-text
blocks are untouched); confirm a batch is now compressed; confirm tool-result
compression is off by default.

**Anti-pattern guards:** never mutate requests or `tools/call` *inputs*; result
compression default-off + validator-gated; preserve `inputSchema` byte-exact.

---

## Phase 4 — Measurement & honesty

1. **Mode-keyed savings from a committed benchmark** (replaces hardcoded `{full:0.65}`).
   - `src/hooks/caveman-stats.js:73`: load `benchmarks/results/output-savings.json`
     at init (embedded `{full:0.65}` as fallback). Populate ONLY measured modes from
     real runs (pull `full`/`ultra` means from `evals/reports/*online.json`); leave
     unmeasured modes null. Gives `benchmarks/results/` a real purpose.

2. **Wire the fidelity judge into the eval pipeline.**
   - `evals/report.py` currently never calls `evals/judge.py`. For each prompt run
     `judge.heuristic_score(baseline, compressed)` (offline term-recall) and attach
     `{score, missing_claims, verdict}` per row; aggregate `fidelity_verdict`
     honestly (fail if any row < threshold). Optional opt-in LLM-judge behind a
     budget flag (mirror the bench's `--max-spend`).

3. **Context-editing savings as a reported metric + recommended config.**
   - Surface `count_tokens` before/after and any `cleared_input_tokens` in the bench
     report; document a recommended `clear_tool_uses_20250919` config for long
     sessions. Source: context-editing docs (Phase 0).

4. **Cache-prefix pricing correction (conservative).**
   - Stabilize the injected prefix byte-for-byte across turns; in the savings model,
     price re-injection at `cacheReadPerMTok` (Opus 4.8 `$0.50`) not `inputPerMTok`
     (`$5`) ONLY after confirming Claude Code places hook context at a cache
     breakpoint. Until confirmed: stabilize + document, don't change the math.

**Verification:** stats shows savings for `ultra`/`lite` (not just `full`); eval
report's `fidelity_verdict` is computed, not hardcoded; numbers trace to real runs.

**Anti-pattern guards:** every committed ratio from a real run; judge labeled
`heuristic`; don't apply the cache discount unverified.

---

## Phase 5 — Didactic visual docs + new PDF (the user-facing deliverable)

> All diagrams are **Claude-authored SVG/Mermaid**, rendered to PNG with the
> existing headless-Chrome pipeline. NO Anthropic image API (it can't). Build a
> `docs/assets/diagrams/` source dir (committed `.svg` + `.html`) and a
> `tools/render-assets.ps1` that rasterizes each at 2× for README/PDF.

**Asset list (produce in this order):**

| # | Title | Shows | Format | Placement |
|---|---|---|---|---|
| 1 | Before/After token cut | Normal vs caveman answer, token counts, % saved (real `benchmarks/` numbers) | SVG→PNG | README hero + PDF §1 (recreate as SVG source; `hero.png` exists) |
| 2 | Compression pipeline | prose → deterministic rules → optional hybrid LLM → validation gate (headings/code/URLs/paths/numbers) → repair ≤1 → output + `.caveman` backup | SVG→PNG | PDF "How it works" + README What-You-Get |
| 3 | System architecture | SessionStart/UserPromptSubmit hooks ↔ `.caveman-active` flag ↔ statusline; install path | SVG→PNG | PDF Architecture + CONTRIBUTING |
| 4 | 4-surfaces map | output / context / MCP metadata / measurement, each with its mechanism | SVG→PNG | PDF §3 + README |
| 5 | Cost-stacking waterfall | output saved → cumulative $ over N turns at verified Opus 4.8 $5/$25 | SVG→PNG | PDF "Why it pays" + README near benchmark table |
| 6 | Intensity ladder | 6 modes on a compression-vs-fidelity axis | SVG→PNG | PDF Modes + README |

**New PDF (`Token-Optimizer-Guia.pdf`, local, NOT committed):** rebuild the existing
13-page guide with: embedded diagrams 1–6 as numbered figures with one-line
takeaway captions; one sans body + one mono face; orange accent used sparingly;
figure/caption page-break safety; a **prominent "vs original caveman" section**
(already §9 — keep + reference diagram 4); all numbers at verified Opus 4.8 $5/$25.
Render with `chrome --headless=new --no-pdf-header-footer --print-to-pdf`.

**Also produce an English one-pager PDF** (or keep PT-BR + add EN) — decide with user.

**Verification checklist:**
- Each `docs/assets/diagrams/*.svg` renders to a non-empty PNG at 2×; labels legible.
- README references the new PNGs (relative paths render on GitHub).
- PDF is 1 valid file, all figures present, no `$15/$75` or `1.5×`-Fable text
  (`grep`), every number traceable.
- PDF saved OUTSIDE the repo or in a gitignored path (per user: local only).

**Anti-pattern guards:** SVG source committed (diffable); no diffusion/raster for
technical diagrams; no image-gen API claims; PDF not committed to git.

---

## Phase 6 — Final verification

1. `npm run test:all` — all green (record count).
2. `git diff --check`; grep guards:
   - `git grep -nE "claude-fable-5" -- src commands skills plugins` → only pricing/back-compat.
   - `git grep -niE "anthropic.*generat.*image|generate.*image.*anthropic"` → none.
   - `git grep -nE "\$15/M|\$75|1\.5× Fable"` → none.
3. `node src/commands/caveman-doctor.js --json` — no critical warnings.
4. `node src/commands/caveman-bench.js --offline --report`; budgeted
   `--online --model claude-opus-4-8 --max-spend 1` (hard cap $15) — 0 fidelity failures.
5. Visual check: read each rendered PNG + the final PDF page images.
6. Commit code/docs (NOT the PDF, NOT `.plans/`); push; cut `v3.0` release with
   honest before/after numbers and the new diagrams.

---

## Suggested commit/PR slicing
- PR A: Phase 1 (safety/correctness). PR B: Phase 2 (compression). PR C: Phase 3
  (MCP). PR D: Phase 4 (measurement). PR E: Phase 5 (visual docs + PDF). Each PR:
  tests green + grep guards + real numbers.
