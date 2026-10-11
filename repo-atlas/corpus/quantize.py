"""Quantize the float index to int8 + base64 for shipping.

Vectors are L2-normalized in [-1, 1]; q = round(v * 127) loses almost no
ranking quality (standard practice for vector indexes) and shrinks
370 x 384 float32 (568 KB) -> 142 KB -> ~190 KB base64.

Reads docs/data/index.json (float), writes it back in compact form:
  { model, dim, quant: "int8", repos, chunks: [{r, t}], vecs: "<base64>" }
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "docs" / "data" / "index.json"


def main() -> None:
    idx = json.loads(INDEX.read_text())
    if idx.get("quant") == "int8":
        print("already quantized")
        return
    vecs = np.array([c["v"] for c in idx["chunks"]], dtype=np.float64)
    q = np.clip(np.round(vecs * 127), -127, 127).astype(np.int8)
    b64 = base64.b64encode(q.tobytes()).decode("ascii")
    compact = {
        "model": idx["model"],
        "dim": idx["dim"],
        "quant": "int8",
        "repos": idx["repos"],
        "chunks": [{"r": c["r"], "t": c["t"]} for c in idx["chunks"]],
        "vecs": b64,
    }
    INDEX.write_text(json.dumps(compact))
    print(f"quantized: {len(b64)/1e6:.2f} MB base64 vecs, "
          f"{INDEX.stat().st_size/1e6:.2f} MB total")


if __name__ == "__main__":
    main()
