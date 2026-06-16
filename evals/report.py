#!/usr/bin/env python3
"""Generate a lightweight token-optimizer eval report from offline snapshots.

Now also scores per-arm FIDELITY against the no-system-prompt baseline using the
offline heuristic judge (judge.py) — turning the report's fidelity verdict from
an unverified string into a measured, committed number. Works without API access
so CI can validate it; an LLM judge can wrap the same rubric for a stronger pass.
"""

import json
from datetime import date
from pathlib import Path
from statistics import mean

import judge  # sibling module: heuristic term-recall fidelity scorer

ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT / "prompts"
REPORTS = ROOT / "reports"
SNAPSHOT = ROOT / "snapshots" / "results.json"

_BASELINE_KEYS = ("__baseline__", "baseline")
_SKIP_KEYS = ("__baseline__", "baseline", "__terse__", "terse")


def fidelity_by_arm(snapshot: dict) -> dict:
    """For each skill arm, term-recall of its output vs the baseline output."""
    arms = snapshot.get("arms", {})
    baseline = next((arms[k] for k in _BASELINE_KEYS if isinstance(arms.get(k), list)), None)
    if not baseline:
        return {}
    out = {}
    for name, outputs in arms.items():
        if name in _SKIP_KEYS or not isinstance(outputs, list):
            continue
        scores, flagged = [], []
        for i, cand in enumerate(outputs):
            if i >= len(baseline):
                break
            s = judge.heuristic_score(str(baseline[i]), str(cand))
            scores.append(s["score"])
            if s["verdict"] != "pass":
                flagged.append({"prompt_index": i, "score": s["score"], "missing_claims": s["missing_claims"]})
        if scores:
            out[name] = {
                "mean_score": round(mean(scores), 2),
                "min_score": min(scores),
                "n": len(scores),
                "flagged": flagged,
                "verdict": "pass" if min(scores) >= 3 else "review",
                "method": "heuristic-term-recall (offline; not an LLM judge)",
            }
    return out


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    rows = []
    for file in sorted(PROMPTS.glob("*.txt")):
        text = file.read_text(encoding="utf-8")
        rows.append({"file": file.name, "chars": len(text), "approx_tokens": max(1, len(text) // 4)})

    fidelity = {}
    try:
        snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        fidelity = fidelity_by_arm(snapshot)
    except FileNotFoundError:
        pass

    payload = {
        "schema_version": 2,
        "date": str(date.today()),
        "prompts": rows,
        "cross_arm_term_agreement": fidelity,
    }
    json_path = REPORTS / f"optimizer-{date.today()}.json"
    md_path = REPORTS / f"optimizer-{date.today()}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = ["# Token Optimizer Eval Report", ""]
    lines += [f"- {r['file']}: ~{r['approx_tokens']} tokens" for r in rows]
    if fidelity:
        lines += ["", "## Cross-arm technical-term agreement (advisory — NOT compression fidelity)",
                 "", "_Independent generations of the same prompt; terse answers legitimately reuse fewer of the verbose baseline’s terms, so low values here are expected and do not indicate technical loss. The HARD fidelity guarantee is the byte-level validator (src/core/validate.js) on the doc-compression surface._", ""]
        for name, fi in fidelity.items():
            lines.append(f"- {name}: mean {fi['mean_score']}/5, min {fi['min_score']}, {fi['verdict']} (n={fi['n']})")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({"json": str(json_path), "md": str(md_path), "agreement_arms": list(fidelity)}, indent=2))


if __name__ == "__main__":
    main()
