"""Baseline agent architectures for the leaderboard.

Every agent implements BaseAgent.answer(question_item, pool) and returns an
AgentAnswer with the predicted *shuffled* choice index plus token/latency stats.

Baselines (match the GoA replication plan's M1 set):
  - SingleAgent      : one model answers directly
  - MixtureOfAgents  : N proposer models answer independently, one aggregator
                       synthesizes (sequential on the 24GB rig via ModelPool)
  - RefineAgent      : sequential refinement passes across the model pool

The Graph-of-Agents variants are intentionally NOT implemented here — that is
the replication's M2 portfolio work. They plug in by subclassing BaseAgent
(see agents_goa_stub.py).
"""
from __future__ import annotations

import time

from .llm import ModelPool
from .schema import AgentAnswer
from .suite import format_prompt, parse_letter, shuffled_choices


class BaseAgent:
    name = "base"

    def describe(self) -> dict:
        return {"architecture": self.name}

    def answer(self, item: dict, pool: ModelPool, seed: int) -> AgentAnswer:
        raise NotImplementedError


def _ask(pool: ModelPool, model_key: str, prompt: str,
         max_tokens: int = 1024) -> tuple[str, int, int, float]:
    t0 = time.time()
    client = pool.ensure(model_key)
    res = client.chat([{"role": "user", "content": prompt}],
                      max_tokens=max_tokens, temperature=0.0)
    return res.text, res.prompt_tokens, res.completion_tokens, time.time() - t0


class SingleAgent(BaseAgent):
    name = "single-agent"

    def __init__(self, model_key: str):
        self.model_key = model_key

    def describe(self) -> dict:
        return {"architecture": self.name, "model": self.model_key}

    def answer(self, item: dict, pool: ModelPool, seed: int) -> AgentAnswer:
        choices, correct = shuffled_choices(item, seed)
        text, pt, ct, lat = _ask(pool, self.model_key,
                                format_prompt(item["question"], choices))
        pred = parse_letter(text, len(choices))
        return AgentAnswer(
            answer_idx=pred if pred is not None else -1,
            prompt_tokens=pt, completion_tokens=ct, latency_s=lat,
            trace=[{"step": "answer", "model": self.model_key,
                    "text": text[:600]}],
        )


class MixtureOfAgents(BaseAgent):
    """N independent proposers, then one aggregator picks the final answer."""
    name = "mixture-of-agents"

    def __init__(self, proposer_keys: list[str], aggregator_key: str):
        self.proposer_keys = proposer_keys
        self.aggregator_key = aggregator_key

    def describe(self) -> dict:
        return {"architecture": self.name,
                "proposers": self.proposer_keys,
                "aggregator": self.aggregator_key}

    def answer(self, item: dict, pool: ModelPool, seed: int) -> AgentAnswer:
        from .suite import LETTERS
        choices, correct = shuffled_choices(item, seed)
        prompt = format_prompt(item["question"], choices)
        proposals, pt, ct, lat = [], 0, 0, 0.0
        trace = []
        for key in self.proposer_keys:
            text, p, c, l = _ask(pool, key, prompt)
            pt, ct, lat = pt + p, ct + c, lat + l
            pred = parse_letter(text, len(choices))
            proposals.append((key, pred, text))
            trace.append({"step": f"propose:{key}", "model": key,
                          "text": text[:400]})
        digest = "\n\n".join(
            f"Model {k} chose "
            f"{LETTERS[p] if p is not None and p >= 0 else '?'}: "
            f"{t[:300]}" for k, p, t in proposals)
        agg_prompt = (
            "You are aggregating answers from several expert models to a "
            "multiple-choice question. Review their answers and reasoning, "
            "then give YOUR final answer as a single letter in the exact "
            f"format: Final answer: <letter>\n\nQuestion: {item['question']}\n\n"
            + "\n".join(f"{L}) {c}" for L, c in zip(LETTERS, choices))
            + f"\n\nExpert proposals:\n{digest}\n\nFinal answer:"
        )
        text, p, c, l = _ask(pool, self.aggregator_key, agg_prompt)
        pt, ct, lat = pt + p, ct + c, lat + l
        pred = parse_letter(text, len(choices))
        trace.append({"step": "aggregate", "model": self.aggregator_key,
                      "text": text[:600]})
        return AgentAnswer(answer_idx=pred if pred is not None else -1,
                           prompt_tokens=pt, completion_tokens=ct,
                           latency_s=lat, trace=trace)


class RefineAgent(BaseAgent):
    """Sequential refinement: each model critiques and improves the last."""
    name = "refine"

    def __init__(self, model_keys: list[str]):
        self.model_keys = model_keys

    def describe(self) -> dict:
        return {"architecture": self.name, "models": self.model_keys}

    def answer(self, item: dict, pool: ModelPool, seed: int) -> AgentAnswer:
        from .suite import LETTERS
        choices, correct = shuffled_choices(item, seed)
        current = format_prompt(item["question"], choices)
        pt, ct, lat, trace = 0, 0, 0.0, []
        text = ""
        for i, key in enumerate(self.model_keys):
            if i > 0:
                current = (
                    "Refine the previous attempt at this multiple-choice "
                    "question. Critique any mistakes, improve the reasoning, "
                    "and give your final answer as a single letter in the "
                    "exact format: Final answer: <letter>\n\n"
                    f"Question: {item['question']}\n\n"
                    + "\n".join(f"{L}) {c}" for L, c in zip(LETTERS, choices))
                    + f"\n\nPrevious attempt:\n{text[:1200]}\n\nFinal answer:"
                )
            text, p, c, l = _ask(pool, key, current)
            pt, ct, lat = pt + p, ct + c, lat + l
            trace.append({"step": f"refine-{i}:{key}", "model": key,
                          "text": text[:400]})
        pred = parse_letter(text, len(choices))
        return AgentAnswer(answer_idx=pred if pred is not None else -1,
                           prompt_tokens=pt, completion_tokens=ct,
                           latency_s=lat, trace=trace)
