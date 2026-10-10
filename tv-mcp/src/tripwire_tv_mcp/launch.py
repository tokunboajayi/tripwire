"""Start TradingView Desktop with the CDP debug port open.

Windows note: current TradingView Desktop ships as an MSIX (Microsoft Store)
package under the ACL-restricted WindowsApps folder. Launching from there is
often refused, and when it does start the debug port may never bind. As in
tradesdontlie/tradingview-mcp, we fall back to a one-time copy of the package
in %LOCALAPPDATA%\\tripwire-tv-mcp and launch that copy instead.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

from .cdp import CDPClient

STARTUP_TIMEOUT_S = 30.0
MSIX_DIRECT_TIMEOUT_S = 15.0
EXIT_TIMEOUT_S = 10.0
POLL_S = 0.5

MSIX_PACKAGE = "TradingView.Desktop"
WIN_EXE = "TradingView.exe"
LOCAL_COPY_DIR = "tripwire-tv-mcp"

CANDIDATES = {
    "darwin": [
        "/Applications/TradingView.app/Contents/MacOS/TradingView",
        str(Path.home() / "Applications/TradingView.app/Contents/MacOS/TradingView"),
    ],
    "win32": [
        os.path.expandvars(rf"%LOCALAPPDATA%\TradingView\{WIN_EXE}"),
        os.path.expandvars(rf"%PROGRAMFILES%\TradingView\{WIN_EXE}"),
        os.path.expandvars(rf"%PROGRAMFILES(X86)%\TradingView\{WIN_EXE}"),
    ],
    "linux": ["/opt/TradingView/tradingview", "/snap/tradingview/current/tradingview"],
}

Runner = Callable[[list[str]], str]


def _run(cmd: list[str]) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip()


def is_windows_apps(path: str) -> bool:
    return "\\windowsapps\\" in path.lower().replace("/", "\\")


def find_msix_exe(run: Runner = _run) -> str | None:
    """Store install: ask PowerShell where the package lives (no admin needed)."""
    location = run([
        "powershell", "-NoProfile", "-Command",
        f"(Get-AppxPackage -Name '{MSIX_PACKAGE}' -ErrorAction SilentlyContinue).InstallLocation",
    ])
    location = location.splitlines()[0].strip() if location else ""
    return str(Path(location) / WIN_EXE) if location else None


def find_tradingview(platform: str = sys.platform, run: Runner = _run, exists: Callable[[str], bool] = os.path.exists) -> str | None:
    override = os.environ.get("TV_APP_PATH")
    if override and exists(override):
        return override
    for path in CANDIDATES.get(platform, CANDIDATES["linux"]):
        if exists(path):
            return path
    if platform == "win32":
        return find_msix_exe(run) or shutil.which(WIN_EXE)
    return shutil.which("tradingview")


def msix_local_copy(exe: str, cache_root: Path | None = None) -> str:
    """Copy the MSIX package out of WindowsApps once per version; return the copied exe."""
    src = Path(exe).parent
    root = cache_root or Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / LOCAL_COPY_DIR
    dst = root / src.name
    if not (dst / WIN_EXE).exists():
        if root.exists():
            for old in root.iterdir():
                if old.name != src.name and old.name.startswith("TradingView."):
                    shutil.rmtree(old, ignore_errors=True)
        shutil.copytree(src, dst)
    return str(dst / WIN_EXE)


def _running(platform: str) -> bool:
    if platform == "win32":
        return WIN_EXE.lower() in _run(["tasklist", "/FI", f"IMAGENAME eq {WIN_EXE}", "/NH"]).lower()
    return bool(_run(["pgrep", "-f", "TradingView"]))


async def kill_tradingview(platform: str = sys.platform) -> bool:
    """Kill TradingView and wait until it is really gone.

    Electron is single-instance: a new copy started while the old one is still
    exiting hands off to it and quits, so the debug port never opens.
    """
    cmd = ["taskkill", "/F", "/IM", WIN_EXE] if platform == "win32" else ["pkill", "-f", "TradingView"]
    subprocess.run(cmd, capture_output=True, check=False)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + EXIT_TIMEOUT_S
    while loop.time() < deadline:
        if not _running(platform):
            return True
        await asyncio.sleep(POLL_S)
    return False


def _spawn(app: str, port: int) -> None:
    kwargs: dict = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([app, f"--remote-debugging-port={port}"], **kwargs)


async def _wait_for_cdp(cdp: CDPClient, timeout_s: float) -> dict | None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        try:
            return await cdp.version()
        except Exception:
            await asyncio.sleep(1.0)
    return None


async def launch(cdp: CDPClient, kill_existing: bool = False) -> dict:
    try:
        info = await cdp.version()
        return {"already_running": True, "browser": info.get("Browser"), "port": cdp.port}
    except Exception:
        pass

    app = find_tradingview()
    if not app:
        raise RuntimeError(
            "TradingView Desktop not found. Install it, or set TV_APP_PATH to the TradingView executable."
        )

    if kill_existing and not await kill_tradingview():
        raise RuntimeError("TradingView did not exit within 10s; close it manually and retry.")

    used_local_copy = False
    try:
        _spawn(app, cdp.port)
        info = await _wait_for_cdp(cdp, MSIX_DIRECT_TIMEOUT_S if is_windows_apps(app) else STARTUP_TIMEOUT_S)
    except OSError:
        if not is_windows_apps(app):
            raise
        info = None  # WindowsApps refused the direct launch

    if info is None and is_windows_apps(app):
        await kill_tradingview()
        app = msix_local_copy(app)
        used_local_copy = True
        _spawn(app, cdp.port)
        info = await _wait_for_cdp(cdp, STARTUP_TIMEOUT_S)

    if info is None:
        raise RuntimeError(
            "TradingView started but the debug port never opened. If TradingView was already "
            "running without the flag, retry with kill_existing=true."
        )
    return {
        "already_running": False, "browser": info.get("Browser"), "port": cdp.port,
        "path": app, "msix_local_copy": used_local_copy,
    }
