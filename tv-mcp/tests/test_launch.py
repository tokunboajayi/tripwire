from pathlib import Path

import pytest

from vantrel_tv_mcp import launch
from vantrel_tv_mcp.launch import find_msix_exe, find_tradingview, is_windows_apps, msix_local_copy

MSIX_DIR = r"C:\Program Files\WindowsApps\TradingView.Desktop_3.4.1.0_x64__n534cwy3pjxzj"


@pytest.fixture(autouse=True)
def no_override(monkeypatch):
    monkeypatch.delenv("TV_APP_PATH", raising=False)


def test_windows_store_install_is_found_via_powershell():
    calls = []

    def run(cmd):
        calls.append(cmd)
        return MSIX_DIR + "\r\n"

    exe = find_tradingview("win32", run=run, exists=lambda p: False)
    assert exe == str(Path(MSIX_DIR) / "TradingView.exe")
    assert calls[0][0] == "powershell" and "Get-AppxPackage" in calls[0][-1]


def test_classic_windows_install_wins_over_store_lookup():
    classic = launch.CANDIDATES["win32"][0]

    def run(cmd):
        raise AssertionError("PowerShell should not run when a classic install exists")

    assert find_tradingview("win32", run=run, exists=lambda p: p == classic) == classic


def test_no_store_package_returns_none(monkeypatch):
    monkeypatch.setattr(launch.shutil, "which", lambda name: None)
    assert find_msix_exe(lambda cmd: "") is None
    assert find_tradingview("win32", run=lambda cmd: "", exists=lambda p: False) is None


def test_tv_app_path_override(monkeypatch):
    monkeypatch.setenv("TV_APP_PATH", "/custom/TradingView")
    assert find_tradingview("darwin", exists=lambda p: p == "/custom/TradingView") == "/custom/TradingView"


def test_is_windows_apps():
    assert is_windows_apps(MSIX_DIR + r"\TradingView.exe")
    assert is_windows_apps("c:/program files/windowsapps/x/TradingView.exe")
    assert not is_windows_apps(r"C:\Users\aj\AppData\Local\TradingView\TradingView.exe")


def test_msix_local_copy_copies_once_and_prunes_old_versions(tmp_path):
    src = tmp_path / "WindowsApps" / "TradingView.Desktop_3.4.1.0_x64__abc"
    src.mkdir(parents=True)
    (src / "TradingView.exe").write_text("new")
    cache = tmp_path / "cache"
    old = cache / "TradingView.Desktop_3.3.0.0_x64__abc"
    old.mkdir(parents=True)
    keep = cache / "unrelated"
    keep.mkdir()

    exe = msix_local_copy(str(src / "TradingView.exe"), cache_root=cache)

    assert Path(exe) == cache / src.name / "TradingView.exe"
    assert Path(exe).read_text() == "new"
    assert not old.exists() and keep.exists()

    (src / "TradingView.exe").write_text("changed")
    assert Path(msix_local_copy(str(src / "TradingView.exe"), cache_root=cache)).read_text() == "new"


async def test_kill_waits_until_tradingview_exits(monkeypatch):
    states = iter([True, True, False])
    monkeypatch.setattr(launch, "POLL_S", 0)
    monkeypatch.setattr(launch.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(launch, "_running", lambda platform: next(states))
    assert await launch.kill_tradingview("darwin") is True


async def test_kill_reports_timeout(monkeypatch):
    monkeypatch.setattr(launch, "POLL_S", 0)
    monkeypatch.setattr(launch, "EXIT_TIMEOUT_S", 0.01)
    monkeypatch.setattr(launch.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(launch, "_running", lambda platform: True)
    assert await launch.kill_tradingview("win32") is False
