"""OpenAI-compatible chat client (stdlib only) + sequential vLLM model pool.

The 24GB rig serves ONE model at a time via goa-replication/scripts/serve_one.sh.
ModelPool.ensure(key) shells out to start the right server and stop the others,
so multi-agent runs work without any code changes on the agent side.
"""
from __future__ import annotations

import json
import subprocess
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int
    completion_tokens: int


class VLLMClient:
    def __init__(self, base_url: str, model: str, timeout: int = 600):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def chat(self, messages: list[dict], max_tokens: int = 1024,
             temperature: float = 0.0) -> ChatResult:
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        req = urllib.request.Request(
            self.base_url + "/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            body = json.load(resp)
        msg = body["choices"][0]["message"]["content"] or ""
        usage = body.get("usage", {})
        return ChatResult(
            text=msg,
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
        )


def parse_models_yaml(path: str | Path) -> list[dict]:
    """Minimal parser for the fixed shape of goa-replication/models.yaml.

    Only the `models:` list is read (key / hf_id / port / domain scalars).
    """
    models: list[dict] = []
    current: dict | None = None
    in_models = False
    for raw in Path(path).read_text().splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "models:":
            in_models = True
            continue
        if in_models and not line.startswith((" ", "\t")):
            in_models = False  # next top-level key (e.g. baselines:)
        if not in_models:
            continue
        if stripped.startswith("- "):
            current = {}
            models.append(current)
            rest = stripped[2:].strip()
            if rest:
                k, _, v = rest.partition(":")
                current[k.strip()] = v.strip()
        elif current is not None and ":" in stripped:
            k, _, v = stripped.partition(":")
            current[k.strip()] = v.strip()
    for m in models:
        m["port"] = int(m["port"])
    return models


class ModelPool:
    """Keeps exactly one vLLM server up; swaps models between agent steps."""

    def __init__(self, models_yaml: str | Path, scripts_dir: str | Path,
                 dry_run: bool = False):
        self.models = {m["key"]: m for m in parse_models_yaml(models_yaml)}
        self.scripts_dir = Path(scripts_dir)
        self.dry_run = dry_run
        self.active: str | None = None
        self._clients: dict[str, VLLMClient] = {}

    def ensure(self, key: str) -> VLLMClient:
        if key not in self.models:
            raise KeyError(f"unknown model key: {key} (see models.yaml)")
        if self.active != key:
            port = self.models[key]["port"]
            serve = self.scripts_dir / "serve_one.sh"
            if self.dry_run:
                print(f"[dry-run] would run: bash {serve} {key}")
            else:
                subprocess.run(["bash", str(serve), key], check=True)
            self.active = key
        if key not in self._clients:
            port = self.models[key]["port"]
            self._clients[key] = VLLMClient(
                base_url=f"http://localhost:{port}",
                model=self.models[key]["hf_id"],
            )
        return self._clients[key]

    def shutdown(self) -> None:
        stop = self.scripts_dir / "stop_all.sh"
        if self.dry_run:
            print(f"[dry-run] would run: bash {stop}")
        else:
            subprocess.run(["bash", str(stop)], check=True)
        self.active = None
