"""Plug-in point for the Graph-of-Agents replication (M2).

The GoA orchestrator — node selection, directed edges, forward/reverse
message passing, pooling — is the replication's own portfolio implementation
and lives in the goa-replication project, NOT here.

To add a GoA variant to the leaderboard:
  1. Implement it as a subclass of benchmark.agents.BaseAgent
     (see benchmark/agents.py for the contract: answer(item, pool, seed)
     -> AgentAnswer with the *shuffled* choice index).
  2. Register it in benchmark/runner.py's AGENTS table.
  3. Run it with: python -m benchmark.runner --agent goa-6 --suite ... --kind benchmark

The leaderboard site picks up any new measured run automatically on the
next `python -m benchmark.compile`.
"""
from .agents import BaseAgent  # noqa: F401  (re-exported for implementers)
