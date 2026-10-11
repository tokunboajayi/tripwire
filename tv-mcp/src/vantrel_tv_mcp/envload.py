"""Load the shared Vantrel .env, like the rest of the repo (see mcp/envload.py).

Looks for the repo-root .env, then ./.env. KEY=value lines,
inline " #" comments and optional quotes. Real environment variables win.
Imported first by server.py, because cdp.py and engine.py read env at import.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import MutableMapping

REPO_ENV = Path(__file__).resolve().parents[3] / ".env"


def parse_env(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #")[0].strip().strip('"').strip("'")
        if key.strip() and value:
            values[key.strip()] = value
    return values


def load_env(paths: list[Path] | None = None, environ: MutableMapping[str, str] = os.environ) -> Path | None:
    """Apply the first .env found without overriding existing variables; return its path."""
    for path in paths or [REPO_ENV, Path.cwd() / ".env"]:
        if path.is_file():
            for key, value in parse_env(path.read_text(encoding="utf-8")).items():
                environ.setdefault(key, value)
            return path
    return None


load_env()
