import os, pathlib
def _load_env():
    """Load the repo-root .env (KEY=value, inline # comments, optional quotes). Real env vars win."""
    for f in (pathlib.Path(__file__).resolve().parent.parent / ".env", pathlib.Path(".env")):
        if not f.exists(): continue
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1); v = v.split(" #")[0].strip().strip('"').strip("'")
            if v: os.environ.setdefault(k.strip(), v)
        break
_load_env()
