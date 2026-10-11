"""Benchmark suite loading. The suite JSON is produced locally by
goa-replication/scripts/gpqa_loader.py and is NEVER committed (GPQA is gated;
question text stays on the rig).
"""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

LETTERS = "ABCDEFGH"


def load_suite(path: str | Path) -> tuple[list[dict], str]:
    items = json.loads(Path(path).read_text())
    sha = hashlib.sha256(
        json.dumps(items, sort_keys=True).encode()).hexdigest()[:12]
    return items, sha


def shuffled_choices(item: dict, seed: int) -> tuple[list[str], int]:
    """Shuffle choices deterministically per (seed, question id).

    Returns (shuffled choice texts, index of the correct answer).
    """
    rng = random.Random(f"{seed}:{item['id']}")
    order = list(range(len(item["choices"])))
    rng.shuffle(order)
    texts = [item["choices"][i] for i in order]
    correct = order.index(item["correct_idx"])
    return texts, correct


def format_prompt(question: str, choices: list[str]) -> str:
    lines = [
        "Answer the following multiple-choice question.",
        "Think step by step, then give your final answer as a single letter",
        "on its own line in the exact format: Final answer: <letter>",
        "",
        f"Question: {question}",
        "",
    ]
    for letter, text in zip(LETTERS, choices):
        lines.append(f"{letter}) {text}")
    lines += ["", "Final answer:"]
    return "\n".join(lines)


def parse_letter(text: str, n_choices: int) -> int | None:
    """Extract the predicted choice index from free-form model output."""
    import re
    valid = set(LETTERS[:n_choices])
    m = re.search(r"final answer:\s*([A-H])", text, re.IGNORECASE)
    if m and m.group(1).upper() in valid:
        return LETTERS.index(m.group(1).upper())
    # fallback: last standalone valid letter in the text
    found = re.findall(r"\b([A-H])\b", text)
    for letter in reversed(found):
        if letter in valid:
            return LETTERS.index(letter)
    return None
