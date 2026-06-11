---
name: caveman-compress
description: >
  Safely compress natural language memory files (CLAUDE.md, AGENTS.md, notes)
  with local-first Caveman optimizer. Preserves code, URLs, paths, commands,
  env vars, numbers, headings, frontmatter, and protected blocks exactly.
  Supports --check, --diff, --local-only, --llm, --restore, and --json.
  Trigger: /caveman-compress FILEPATH or "compress memory file"
---

# Caveman Compress

## Purpose

Compress prose files to reduce input/context tokens. Local deterministic compression runs first. LLM compression is opt-in only via `--llm <model>` or config; default does not call network/API.

## Trigger

`/caveman-compress <filepath>` or user asks to compress memory/prose file.

## Process

Run from repo root:

```bash
node src/commands/caveman-compress.js <absolute_or_relative_filepath> --check --local-only
```

If check passes and user asked to write, run without `--check`.

Useful flags:

```bash
--check
--diff
--out <file>
--strict
--local-only
--llm claude-fable-5
--restore
--json
--dry-run
--no-cache
```

## Safety

Before any LLM call:

- validate file extension/path;
- scan path/content/entropy for secrets;
- protect code, URLs, paths, commands, env vars, versions, numbers, model/API names, markdown links, and errors;
- run deterministic compression;
- validate strict invariants;
- write atomically with backup only after validation.

If secret scan finds high/critical risk, abort before LLM. Do not override in chat. User must rename/remove secret material or use local-only on a safe file.

## Reversibility

Default write creates `.caveman/backups/<timestamp>/FILE` and report under `.caveman/reports/`. Legacy direct compression also preserves `FILE.original.md` when absent. `--restore` restores latest backup or legacy original.

Source split:

- `CLAUDE.source.md` = human canonical source;
- `CLAUDE.md` = compressed agent-facing file;
- `--out` can write explicit compressed target.

Never compress `*.original.md`, `*.backup.md`, `.caveman/backups/**`, `.git/**`, `node_modules/**`, binary/archive/db/lock files, or known secret paths.

## Preserve Exactly

- fenced and indented code blocks;
- inline code;
- URLs and markdown link targets;
- file paths and shell commands;
- env vars;
- API/model names;
- versions, dates, numbers, units;
- headings and frontmatter;
- markdown table/list structure.

## Return

Report changed file, backup/report path, validation result, tests/checks run, and remaining risk. If `--json` was requested, return parseable JSON only.
