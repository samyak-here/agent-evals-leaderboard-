"""Chunk READMEs and precompute MiniLM embeddings for the Atlas index.

Model: sentence-transformers/all-MiniLM-L6-v2 via fastembed (ONNX, CPU).
The browser embeds queries with the same weights via Transformers.js
(Xenova/all-MiniLM-L6-v2), so vectors are directly comparable.

Writes docs/data/index.json:
  { model, dim, repos: [{repo,url,summary,stars,category}], chunks: [{r, t, v}] }
Vectors are L2-normalized and rounded to 4 decimals.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus" / "corpus.json"
OUT = ROOT / "docs" / "data" / "index.json"

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
CHUNK = 600
OVERLAP = 60
MAX_CHUNKS_PER_REPO = 10


def clean(text: str) -> str:
    # drop code fences, html, badge/link noise; keep prose
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[(.*?)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"#{1,6}\s*", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk(text: str) -> list[str]:
    paras = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 40]
    chunks, cur = [], ""
    for p in paras:
        if len(cur) + len(p) > CHUNK and cur:
            chunks.append(cur)
            cur = p[-OVERLAP:] if len(p) > OVERLAP else ""
        else:
            cur = (cur + "\n\n" + p).strip()
    if cur.strip():
        chunks.append(cur)
    return chunks[:MAX_CHUNKS_PER_REPO]


def main() -> None:
    corpus = json.loads(CORPUS.read_text())["repos"]
    print(f"embedding {len(corpus)} repos with {MODEL}")
    model = TextEmbedding(MODEL)

    repos_meta, chunk_rows, texts = [], [], []
    for i, r in enumerate(corpus):
        repos_meta.append({k: r[k] for k in
                           ("repo", "url", "summary", "stars", "category")})
        card = f"{r['repo']}. {r.get('summary') or ''} Category: {r.get('category') or ''}"
        chunks = [card]
        if r.get("readme"):
            chunks += chunk(clean(r["readme"]))
        for c in chunks:
            chunk_rows.append((i, c[:800]))
            texts.append(c[:800])
    print(f"{len(texts)} chunks total; embedding on CPU...")
    vecs = list(model.embed(texts, batch_size=32))
    arr = np.stack(vecs).astype(np.float64)
    arr /= np.linalg.norm(arr, axis=1, keepdims=True) + 1e-12

    chunks_out = [{"r": i, "t": t, "v": [round(float(x), 4) for x in v]}
                  for (i, t), v in zip(chunk_rows, arr)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "model": "all-MiniLM-L6-v2", "dim": 384,
        "repos": repos_meta, "chunks": chunks_out,
    }))
    print(f"wrote {OUT} ({OUT.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
