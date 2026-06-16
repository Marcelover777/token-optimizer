#!/usr/bin/env python3
"""Offline-friendly fidelity judge helpers.

The score measures whether the TECHNICAL terms of the reference survive in the
candidate — code spans, identifiers, API/function names, numbers, URLs, paths,
SCREAMING_CASE and camelCase. Brevity is NOT penalized: dropping filler words is
the whole point of the optimizer, so only technical-substance loss counts.

Note: in the eval snapshot the arms are INDEPENDENT generations of the same
prompt (not a compression of the baseline), so this is an advisory cross-arm
*agreement* signal, not a hard compression-fidelity proof. The hard fidelity
guarantee for the doc-compression surface is the byte-level validator in
src/core/validate.js. Online LLM judging can wrap this rubric for a stronger pass.
"""

import json
import re
import sys

RUBRIC = {
    "score": "0-5 by fraction of technical terms preserved (brevity not penalized)",
    "5": "all technical terms preserved",
    "4": ">=90% preserved — still actionable",
    "3": ">=75% preserved — loses a minor technical detail",
    "2": ">=50% preserved",
    "1": "<50% preserved",
    "0": "unusable",
}

# Code/identifiers/calls/dotted, URLs, paths, SCREAMING_CASE, camelCase, numbers.
_TECH = re.compile(
    r"`[^`]+`"
    r"|https?://\S+"
    r"|\b\w+(?:[/\\]\w+)+\b"
    r"|\b[A-Za-z_]\w*\([^)]*\)"
    r"|\b\w+\.\w[\w.]*\b"
    r"|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b"
    r"|\b\w*[a-z]\w*[A-Z]\w*\b"
    r"|\b\d[\w.%-]*\b"
)


def technical_terms(text: str) -> set:
    terms = set()
    for m in _TECH.finditer(text or ""):
        t = m.group(0).strip("`").strip(".,:;()")
        if len(t) >= 2:
            terms.add(t)
    return terms


def heuristic_score(reference: str, candidate: str) -> dict:
    ref_terms = technical_terms(reference)
    cand = candidate or ""
    missing = sorted(t for t in ref_terms if t not in cand)
    n = len(ref_terms)
    recall = 1.0 if n == 0 else (n - len(missing)) / n
    score = (
        5 if recall >= 0.98
        else 4 if recall >= 0.90
        else 3 if recall >= 0.75
        else 2 if recall >= 0.50
        else 1
    )
    return {
        "score": score,
        "recall": round(recall, 3),
        "technical_terms": n,
        "missing_claims": missing[:12],
        "wrong_claims": [],
        "ambiguity": 0 if score >= 4 else 1,
        "verdict": "pass" if score >= 3 else "review",
        "method": "technical-term recall (brevity not penalized)",
    }


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"rubric": RUBRIC}, indent=2))
        return
    print(json.dumps(heuristic_score(sys.argv[1], sys.argv[2]), indent=2))


if __name__ == "__main__":
    main()
