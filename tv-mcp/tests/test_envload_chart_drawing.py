import pytest

from tripwire_tv_mcp.chart import same_symbol
from tripwire_tv_mcp.drawing import COLORS, BRAIN_COLORS, brain_color
from tripwire_tv_mcp.envload import load_env, parse_env
from tripwire_tv_mcp.regime import BRAIN_BY_REGIME


# --- .env loading -----------------------------------------------------------

def test_parse_env_matches_repo_convention():
    text = '# comment\nTRIPWIRE_API=http://127.0.0.1:8080  # local\nTRIPWIRE_MCP_TOKEN="abc"\nEMPTY=\nnoequals\n'
    assert parse_env(text) == {"TRIPWIRE_API": "http://127.0.0.1:8080", "TRIPWIRE_MCP_TOKEN": "abc"}


def test_load_env_never_overrides_real_env(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("TRIPWIRE_MCP_TOKEN=from_file\nTV_CDP_PORT=9333\n")
    environ = {"TRIPWIRE_MCP_TOKEN": "from_shell"}
    assert load_env([tmp_path / "missing.env", env_file], environ) == env_file
    assert environ == {"TRIPWIRE_MCP_TOKEN": "from_shell", "TV_CDP_PORT": "9333"}


def test_load_env_without_file(tmp_path):
    environ = {}
    assert load_env([tmp_path / ".env"], environ) is None and environ == {}


def test_repo_env_points_at_repo_root():
    from tripwire_tv_mcp.envload import REPO_ENV

    assert (REPO_ENV.parent / "tv-mcp" / "src" / "tripwire_tv_mcp").is_dir()


# --- symbol matching --------------------------------------------------------

@pytest.mark.parametrize(
    "a,b,same",
    [
        ("COINBASE:BTCUSD", "BINANCE:BTCUSDT", False),
        ("CME_MINI:ES1!", "CME_MINI:MES1!", False),
        ("NASDAQ:AMD", "NASDAQ:AMDL", False),
        ("COINBASE:BTCUSD", "BINANCE:BTCUSD", False),
        ("binance:btcusdt", "BINANCE:BTCUSDT", True),
        ("BTCUSDT", "BINANCE:BTCUSDT", True),
        ("MES1!", "CME_MINI:MES1!", True),
        (None, "BINANCE:BTCUSDT", False),
    ],
)
def test_same_symbol_is_exact(a, b, same):
    assert same_symbol(a, b) is same


# --- brain colours ----------------------------------------------------------

def test_every_engine_brain_has_a_colour():
    assert set(BRAIN_COLORS) == set(BRAIN_BY_REGIME.values())
    for brain in BRAIN_BY_REGIME.values():
        assert brain_color(brain) != COLORS["note"]
        assert brain_color(brain.lower()) == BRAIN_COLORS[brain]


def test_unknown_brain_falls_back_to_note_colour():
    assert brain_color(None) == brain_color("mean_reversion") == COLORS["note"]
