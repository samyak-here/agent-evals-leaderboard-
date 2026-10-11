"""Fetch READMEs for every repo in the catalog.

Source: ~/workspace/repo-catalog/repos.json ({updated, repos:[{repo,url,summary,stars,category,added}]}).
Tries raw.githubusercontent.com README candidates (no auth, no tight rate limit).
Writes corpus/corpus.json — never commit question text; READMEs are public docs.
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = Path.home() / "workspace" / "repo-catalog" / "repos.json"
OUT = ROOT / "corpus" / "corpus.json"

CANDIDATES = ["README.md", "readme.md", "README.rst", "README.txt", "Readme.md"]


def fetch_readme(repo: str) -> str | None:
    for name in CANDIDATES:
        url = f"https://raw.githubusercontent.com/{repo}/HEAD/{name}"
        req = urllib.request.Request(url, headers={"User-Agent": "repo-atlas/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status == 200:
                    text = resp.read().decode("utf-8", errors="replace")
                    if len(text.strip()) > 200:
                        return text
        except Exception:
            continue
    return None


def main() -> None:
    catalog = json.loads(CATALOG.read_text())
    repos = catalog["repos"]
    print(f"{len(repos)} repos in catalog")
    out = []
    for i, r in enumerate(repos):
        readme = fetch_readme(r["repo"])
        # strip to a sane size; drop images/badges noise crudely
        if readme:
            lines = [l for l in readme.splitlines()
                     if not l.strip().startswith(("<img", "[![", "<p align"))]
            readme = "\n".join(lines)[:8000]
        out.append({**r, "readme": readme, "readme_ok": bool(readme)})
        print(f"[{i+1}/{len(repos)}] {r['repo']}: "
              f"{'readme %d chars' % len(readme) if readme else 'NO README'}")
        time.sleep(0.4)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated": catalog.get("updated"), "repos": out}, indent=1))
    ok = sum(1 for r in out if r["readme_ok"])
    print(f"wrote {OUT} — {ok}/{len(out)} READMEs fetched")


if __name__ == "__main__":
    main()
