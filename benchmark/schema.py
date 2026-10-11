"""Shared dataclasses + validation for the agent-evals leaderboard.

Record/summary layout is deliberately compatible with the goa-replication
run_log.py harness (runs/<ts>-<name>/{config.json,records.jsonl,summary.json}),
so runs from either project can be compiled by benchmark/compile.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class AgentAnswer:
    answer_idx: int                      # index into the *shuffled* choice list
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_s: float = 0.0
    trace: list[dict[str, Any]] = field(default_factory=list)  # [{step, model, text}]


@dataclass
class RunConfig:
    agent: str
    agent_params: dict[str, Any]
    suite_file: str
    suite_sha: str
    suite_n: int
    choice_seed: int
    kind: str                            # "benchmark" | "smoke"
    models: list[str]
    gpu_hourly_usd: float
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Summary:
    n: int
    accuracy: float
    mean_latency_s: float
    total_prompt_tokens: int
    total_completion_tokens: int
    total_cost_usd: float

    def to_dict(self) -> dict:
        return asdict(self)


def validate_summary(d: dict) -> Summary:
    """Build a Summary from a parsed summary.json, raising on bad shape."""
    required = {"n", "accuracy", "mean_latency_s",
                "total_prompt_tokens", "total_completion_tokens", "total_cost_usd"}
    missing = required - set(d)
    if missing:
        raise ValueError(f"summary.json missing keys: {sorted(missing)}")
    s = Summary(**{k: d[k] for k in required})
    if not (0.0 <= s.accuracy <= 1.0):
        raise ValueError(f"accuracy out of range: {s.accuracy}")
    if s.n <= 0:
        raise ValueError(f"n must be positive: {s.n}")
    return s
