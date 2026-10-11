"""Benchmark runner: executes an agent over a question suite and logs a run.

Run layout mirrors goa-replication/scripts/run_log.py:
  results/runs/<UTC-ts>-<agent-name>/config.json
  results/runs/<UTC-ts>-<agent-name>/records.jsonl   (one JSON object/question)
  results/runs/<UTC-ts>-<agent-name>/summary.json

Records carry the goa-replication fields (question_id, model, predicted,
correct, latency_s, prompt_tokens, completion_tokens) plus agent, subdomain,
cost_usd and the choice shuffle used, so compile.py can rebuild everything.

Usage (on the 24GB rig):
  python -m benchmark.runner --agent single --model qwen25-7b-instruct \
      --suite /path/to/gpqa_dev.json --models-yaml ../goa-replication/models.yaml \
      --scripts-dir ../goa-replication/scripts --kind benchmark
  python -m benchmark.runner --agent moa --suite ... --kind benchmark
  python -m benchmark.runner --agent refine --suite ... --kind benchmark
  python -m benchmark.runner --agent single --mock --limit 5 --kind smoke   # no GPU needed
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from .agents import BaseAgent, MixtureOfAgents, RefineAgent, SingleAgent
from .llm import ModelPool
from .schema import AgentAnswer, RunConfig, Summary
from .suite import LETTERS, load_suite, shuffled_choices

ROOT = Path(__file__).resolve().parent.parent
SIX_MODELS = ["qwen25-7b-instruct", "qwen25-coder-7b-instruct", "mathstral-7b",
              "biomedical-llama3-8b", "finance-llama3-8b", "saul-7b-instruct"]


class MockPool:
    """Deterministic fake pool for --mock smoke runs (no GPU, no network)."""

    def __init__(self, correct_bias: float = 0.6):
        self.correct_bias = correct_bias
        self.active = "mock-model"

    def ensure(self, key: str):
        parent = self

        class MockClient:
            model = key

            def chat(self, messages, max_tokens=1024, temperature=0.0):
                from .llm import ChatResult
                # deterministic pseudo-answer derived from prompt hash
                h = int(hashlib.sha256(
                    messages[-1]["content"].encode()).hexdigest(), 16)
                letter = LETTERS[h % 4]
                return ChatResult(
                    text=f"Reasoning...\nFinal answer: {letter}",
                    prompt_tokens=120 + h % 80,
                    completion_tokens=40 + h % 30,
                )
        # small sleep so latency/cost plumbing is exercised
        time.sleep(0.01)
        return MockClient()

    def shutdown(self):
        pass


def build_agent(name: str, model: str | None) -> BaseAgent:
    if name == "single":
        if not model:
            raise ValueError("--model is required for the single agent")
        return SingleAgent(model)
    if name == "moa":
        return MixtureOfAgents(SIX_MODELS, SIX_MODELS[0])
    if name == "refine":
        return RefineAgent(SIX_MODELS)
    raise ValueError(f"unknown agent: {name} (see agents_goa_stub.py to add GoA)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True, choices=["single", "moa", "refine"])
    ap.add_argument("--model", default=None, help="model key for --agent single")
    ap.add_argument("--suite", required=True, help="suite JSON (local, never committed)")
    ap.add_argument("--models-yaml", default=None)
    ap.add_argument("--scripts-dir", default=None)
    ap.add_argument("--kind", default="benchmark", choices=["benchmark", "smoke"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--gpu-hourly-usd", type=float, default=0.50,
                    help="assumed GPU rental rate for cost accounting")
    ap.add_argument("--mock", action="store_true", help="mock LLM, no GPU needed")
    ap.add_argument("--notes", default="")
    args = ap.parse_args()

    suite, suite_sha = load_suite(args.suite)
    if args.limit:
        suite = suite[:args.limit]

    agent = build_agent(args.agent, args.model)
    if args.mock:
        pool: ModelPool | MockPool = MockPool()
    else:
        if not args.models_yaml or not args.scripts_dir:
            ap.error("--models-yaml and --scripts-dir are required without --mock")
        pool = ModelPool(args.models_yaml, args.scripts_dir)

    models_used = sorted({args.model} if args.agent == "single"
                         else set(SIX_MODELS))
    cfg = RunConfig(
        agent=agent.name, agent_params=agent.describe(),
        suite_file=str(args.suite), suite_sha=suite_sha, suite_n=len(suite),
        choice_seed=args.seed, kind=args.kind, models=models_used,
        gpu_hourly_usd=args.gpu_hourly_usd, notes=args.notes or (
            "mock smoke run — pipeline validation only" if args.mock else ""),
    )

    run_dir = (ROOT / "results" / "runs" /
               f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{agent.name}")
    run_dir.mkdir(parents=True)
    cfg_dict = cfg.to_dict()
    cfg_dict["config_sha"] = hashlib.sha256(
        json.dumps(cfg_dict, sort_keys=True).encode()).hexdigest()[:12]
    cfg_dict["started_utc"] = datetime.now(timezone.utc).isoformat()
    (run_dir / "config.json").write_text(json.dumps(cfg_dict, indent=1))

    n_correct, latencies, pt_tot, ct_tot = 0, [], 0, 0
    with open(run_dir / "records.jsonl", "w") as f:
        for i, item in enumerate(suite):
            choices, correct_idx = shuffled_choices(item, args.seed)
            ans: AgentAnswer = agent.answer(item, pool, args.seed)
            ok = ans.answer_idx == correct_idx
            n_correct += ok
            latencies.append(ans.latency_s)
            pt_tot += ans.prompt_tokens
            ct_tot += ans.completion_tokens
            cost = ans.latency_s * args.gpu_hourly_usd / 3600.0
            rec = {
                "question_id": item["id"],
                "subdomain": item.get("subdomain"),
                "agent": agent.name,
                "model": ",".join(models_used),
                "predicted": (LETTERS[ans.answer_idx]
                              if 0 <= ans.answer_idx < len(choices) else None),
                "correct": bool(ok),
                "latency_s": round(ans.latency_s, 3),
                "prompt_tokens": ans.prompt_tokens,
                "completion_tokens": ans.completion_tokens,
                "cost_usd": round(cost, 6),
                "t_utc": datetime.now(timezone.utc).isoformat(),
            }
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(f"[{i+1}/{len(suite)}] q={item['id']} "
                  f"pred={rec['predicted']} correct={ok} "
                  f"{ans.latency_s:.1f}s", flush=True)

    pool.shutdown()
    summary = Summary(
        n=len(suite),
        accuracy=n_correct / len(suite) if suite else 0.0,
        mean_latency_s=sum(latencies) / len(latencies) if latencies else 0.0,
        total_prompt_tokens=pt_tot,
        total_completion_tokens=ct_tot,
        total_cost_usd=round(
            sum(latencies) * args.gpu_hourly_usd / 3600.0, 4),
    )
    (run_dir / "summary.json").write_text(json.dumps(summary.to_dict(), indent=1))
    print(json.dumps(summary.to_dict(), indent=1))
    print(f"run dir: {run_dir}")


if __name__ == "__main__":
    main()
