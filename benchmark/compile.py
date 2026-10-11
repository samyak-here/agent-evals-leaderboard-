"""Compile measured runs + paper references into docs/data/leaderboard.json.

Only runs with kind == "benchmark" are published. Smoke/validation runs stay
local. Paper-reference rows come from results/references.json and are always
labeled kind == "paper" on the site.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .schema import validate_summary

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    rows: list[dict] = []

    refs = json.loads((ROOT / "results" / "references.json").read_text())
    for r in refs["rows"]:
        rows.append({
            "id": r["id"],
            "architecture": r["architecture"],
            "variant": r.get("variant", ""),
            "kind": "paper",
            "n": r["n"],
            "accuracy": r["accuracy"],
            "mean_latency_s": r.get("mean_latency_s"),
            "cost_usd": None,
            "total_tokens": None,
            "models": r.get("models", []),
            "date": r.get("date"),
            "source": r.get("source", ""),
            "notes": r.get("notes", ""),
        })

    runs_dir = ROOT / "results" / "runs"
    if runs_dir.exists():
        for run_dir in sorted(runs_dir.iterdir()):
            if not run_dir.is_dir():
                continue
            cfg = json.loads((run_dir / "config.json").read_text())
            if cfg.get("kind") != "benchmark":
                continue
            summary = validate_summary(
                json.loads((run_dir / "summary.json").read_text()))
            rows.append({
                "id": run_dir.name,
                "architecture": cfg["agent"],
                "variant": cfg.get("notes", ""),
                "kind": "measured",
                "n": summary.n,
                "accuracy": round(summary.accuracy, 4),
                "mean_latency_s": round(summary.mean_latency_s, 2),
                "cost_usd": summary.total_cost_usd,
                "total_tokens": (summary.total_prompt_tokens
                                 + summary.total_completion_tokens),
                "models": cfg.get("models", []),
                "date": cfg.get("started_utc", "")[:10],
                "source": "local run",
                "notes": cfg.get("notes", ""),
            })

    rows.sort(key=lambda r: (r["accuracy"] is None, -(r["accuracy"] or 0)))

    # "coming soon" slots: architectures with a defined path but no data yet
    pending = [
        {"architecture": "graph-of-agents",
         "variant": "GoA-6 (author pool)",
         "detail": "Blocked on the M2 replication run — plugs in via "
                   "benchmark/agents_goa_stub.py, no code changes needed."},
        {"architecture": "single-agent",
         "variant": "per-model baselines",
         "detail": "Six single-model runs (one per pool model) on the rig."},
    ]
    have_arch = {r["architecture"] for r in rows if r["kind"] == "measured"}
    pending = [p for p in pending if not (
        p["architecture"] == "single-agent" and "single-agent" in have_arch)]

    out = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "suite": {
            "name": "GPQA diamond",
            "note": "Gated dataset — question text never published; "
                    "suite files stay on the rig.",
        },
        "cost_model": {
            "gpu_hourly_usd": 0.50,
            "note": "Assumed 4090-class rental rate; configurable per run "
                    "via --gpu-hourly-usd. Paper rows carry no cost data.",
        },
        "rows": rows,
        "pending": pending,
    }
    dest = ROOT / "docs" / "data" / "leaderboard.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=1))
    print(f"wrote {dest} ({len(rows)} rows, {len(pending)} pending)")


if __name__ == "__main__":
    main()
