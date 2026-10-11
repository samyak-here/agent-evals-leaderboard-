"""Split the quantized index into <128KB parts for pushing.

The GitHub push channel caps a single argument at ~128KB, so the index
ships as: index.json (meta) + chunks.{0,1}.json + vecs.{0,1}.json.
app.js fetches the parts in parallel and reassembles them.
"""
from __future__ import annotations

import json
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "docs" / "data" / "index.json"


def main() -> None:
    idx = json.loads(SRC.read_text())
    assert idx.get("quant") == "int8", "quantize first"
    d = SRC.parent
    chunks, vecs = idx["chunks"], idx["vecs"]
    mid_c, mid_v = len(chunks) // 2, len(vecs) // 2
    (d / "index.json").write_text(json.dumps({
        "model": idx["model"], "dim": idx["dim"], "quant": "int8",
        "repos": idx["repos"],
        "chunk_parts": [f"chunks.{i}.json" for i in range(2)],
        "vec_parts": [f"vecs.{i}.json" for i in range(2)],
    }))
    (d / "chunks.0.json").write_text(json.dumps(chunks[:mid_c]))
    (d / "chunks.1.json").write_text(json.dumps(chunks[mid_c:]))
    (d / "vecs.0.json").write_text(json.dumps({"data": vecs[:mid_v]}))
    (d / "vecs.1.json").write_text(json.dumps({"data": vecs[mid_v:]}))
    for f in ["index.json", "chunks.0.json", "chunks.1.json",
              "vecs.0.json", "vecs.1.json"]:
        print(f, (d / f).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
