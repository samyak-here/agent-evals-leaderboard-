# Agent Evals — multi-agent systems leaderboard

A public benchmark of multi-agent LLM architectures on **GPQA diamond**:
accuracy, wall-clock latency and token cost, plotted as Pareto curves.
Measured runs come from a single 24GB rig; paper-reported numbers are
always labeled **paper**.

**Site:** `docs/` is a dependency-free static page (ECharts vendored in
`docs/vendor/`) — open `docs/index.html` or serve the folder.

## Quickstart

```bash
# 1. (on the 24GB rig) prepare the suite — question text never leaves the rig
cd ../goa-replication
python scripts/gpqa_loader.py --dev-n 20   # writes data/gpqa_dev.json (gitignored)

# 2. run a baseline (models serve one-at-a-time automatically)
cd ../agent-evals-leaderboard
python -m benchmark.runner --agent single --model qwen25-7b-instruct \
  --suite ../goa-replication/data/gpqa_dev.json \
  --models-yaml ../goa-replication/models.yaml \
  --scripts-dir ../goa-replication/scripts --kind benchmark

python -m benchmark.runner --agent moa    --suite ... --kind benchmark
python -m benchmark.runner --agent refine --suite ... --kind benchmark

# 3. compile the site data
python -m benchmark.compile   # writes docs/data/leaderboard.json
```

No-GPU smoke test of the whole pipeline:

```bash
python -m benchmark.runner --agent moa --suite /tmp/smoke_suite.json \
  --mock --kind smoke
```

## Layout

| path | purpose |
|---|---|
| `benchmark/llm.py` | OpenAI-compatible client + `ModelPool` (serves the six vLLM models one at a time via `serve_one.sh`) |
| `benchmark/agents.py` | `SingleAgent`, `MixtureOfAgents`, `RefineAgent` — all baselines from the GoA replication plan |
| `benchmark/agents_goa_stub.py` | plug-in point for the GoA M2 implementation (subclass `BaseAgent`, register, run — no other changes) |
| `benchmark/runner.py` | executes a suite; writes `results/runs/<ts>-<agent>/{config.json,records.jsonl,summary.json}` — same layout as the goa-replication harness |
| `benchmark/schema.py` | run/summary dataclasses + validation |
| `benchmark/suite.py` | suite loading, per-question choice shuffling (seeded), answer parsing |
| `benchmark/compile.py` | compiles measured runs + `results/references.json` into `docs/data/leaderboard.json` |
| `results/references.json` | paper-reported rows (GoA-6 40.54, MoA-6 32.83) — labeled `paper` everywhere |
| `docs/` | the leaderboard website |

## Methodology (also on the site)

- **Suite:** GPQA diamond (198 questions), gated — question text is never published.
- **Fairness:** choices re-shuffled per question with a recorded seed; temperature 0.
- **Cost:** wall-clock seconds × assumed $0.50/GPU-hour (configurable via `--gpu-hourly-usd`); raw token counts reported alongside.
- **Honesty:** `paper` rows are author-reported reference targets, not local measurements. Smoke runs never publish (`compile.py` only ships `kind == "benchmark"`).

## Roadmap

- [ ] Run the six single-model baselines on the rig
- [ ] Run MoA-6 and Refine-6 on the full diamond split
- [ ] Wire in the GoA M2 implementation via `agents_goa_stub.py`
- [ ] Deploy `docs/` to GitHub Pages
