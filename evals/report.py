#!/usr/bin/env python3
"""Generate lightweight token-optimizer eval report from offline snapshots."""

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT / "prompts"
REPORTS = ROOT / "reports"
ARMS = [
    "baseline",
    "terse",
    "caveman-current-full",
    "optimizer-micro-full",
    "optimizer-adaptive-full",
    "optimizer-lite",
    "optimizer-ultra",
    "local-compress-only",
    "hybrid-compress",
]


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    rows = []
    for file in sorted(PROMPTS.glob("*.txt")):
        text = file.read_text(encoding="utf-8")
        rows.append({"file": file.name, "chars": len(text), "approx_tokens": max(1, len(text) // 4)})
    payload = {"schema_version": 1, "date": str(date.today()), "arms": ARMS, "prompts": rows}
    json_path = REPORTS / f"optimizer-{date.today()}.json"
    md_path = REPORTS / f"optimizer-{date.today()}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("# Token Optimizer Eval Report\n\n" + "\n".join(f"- {r['file']}: ~{r['approx_tokens']} tokens" for r in rows) + "\n", encoding="utf-8")
    print(json.dumps({"json": str(json_path), "md": str(md_path)}, indent=2))


if __name__ == "__main__":
    main()
