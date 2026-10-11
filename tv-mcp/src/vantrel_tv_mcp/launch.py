"""Start TradingView Desktop with the CDP debug port open."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .cdp import CDPClient

STARTUP_TIMEOUT_S = 30.0

CANDIDATES = {
    "darwin": [
        "/Applications/TradingView.app/Contents/MacOS/TradingView",
        str(Path.home() / "Applications/TradingView.app/Contents/MacOS/TradingView"),
    ],
    "win32": [
        os.path.expandvars(r"%LOCALAPPDATA%\TradingView\TradingView.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\TradingView\TradingView.exe"),
    ],
    "linux": ["/opt/TradingView/tradingview", "/snap/tradingview/current/tradingview"],
}


def find_tradingview() -> str | None:
    override = os.environ.get("TV_APP_PATH")
    if override and Path(override).exists():
        return override
    for path in CANDIDATES.get(sys.platform, CANDIDATES["linux"]):
        if Path(path).exists():
            return path
    return shutil.which("tradingview")


async def launch(cdp: CDPClient, kill_existing: bool = False) -> dict:
    try:
        info = await cdp.version()
        return {"already_running": True, "browser": info.get("Browser"), "port": cdp.port}
    except Exception:
        pass

    app = find_tradingview()
    if not app:
        raise RuntimeError("TradingView Desktop not found. Install it or set TV_APP_PATH.")

    if kill_existing:
        kill = ["taskkill", "/F", "/IM", "TradingView.exe"] if sys.platform == "win32" else ["pkill", "-f", "TradingView"]
        subprocess.run(kill, capture_output=True, check=False)
        await asyncio.sleep(1.5)

    subprocess.Popen(
        [app, f"--remote-debugging-port={cdp.port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    loop = asyncio.get_running_loop()
    deadline = loop.time() + STARTUP_TIMEOUT_S
    while loop.time() < deadline:
        try:
            info = await cdp.version()
            return {"already_running": False, "browser": info.get("Browser"), "port": cdp.port, "path": app}
        except Exception:
            await asyncio.sleep(1.0)
    raise RuntimeError(
        "TradingView started but the debug port never opened. If TradingView was already "
        "running without the flag, retry with kill_existing=true."
    )
