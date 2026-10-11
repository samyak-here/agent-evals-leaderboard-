# Repo Atlas — semantic search over the library

Fifty-two hand-curated repos (from the reel-repo digest), searchable **by meaning**.
Type "screen recorder with auto-zoom" and get the recorder — not repos that happen
to be named that.

## How it works

- **Corpus** (`corpus/`): READMEs fetched for every repo in `~/workspace/repo-catalog/repos.json`,
  cleaned and chunked.
- **Index** (`corpus/embed.py`): chunks embedded with `all-MiniLM-L6-v2` (fastembed/ONNX,
  CPU) into L2-normalized 384-d vectors → `docs/data/index.json` (1.4 MB, static).
- **Query** (`docs/app.js`): your search text is embedded **in the browser tab** with the
  same weights via Transformers.js (WebAssembly) → cosine similarity → ranked cards.
  Nothing you type ever leaves your machine. Falls back to keyword search if the
  model can't load.

## Run it

```bash
# rebuild the corpus (READMEs change; the digest adds repos)
python3 corpus/fetch.py
# rebuild the index (needs the venv: python3 -m venv .venv && .venv/bin/pip install fastembed)
no_proxy="localhost,127.0.0.1" .venv/bin/python corpus/embed.py
# serve
cd docs && python3 -m http.server 8000
```

## Resume bullet

"Shipped Repo Atlas: semantic search over 52 curated repos — README corpus embedded
with MiniLM into 384-d vectors, queries embedded client-side in WebAssembly with
zero backend; category filters, keyboard navigation, snippet highlighting."

## Roadmap

- [ ] RAG tier: "which repo does X?" answered with citations (FastAPI + pgvector)
- [ ] Golden-set eval harness: 50 judged queries, before/after on chunking
- [ ] Auto-sync the index with the daily reel-repo digest
- [ ] Deploy to GitHub Pages
