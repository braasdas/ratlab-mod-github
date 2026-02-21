"""Tests for pavlov.config module."""

import os
from pathlib import Path

import pytest
import yaml

from pavlov.config import (
    _resolve_env_vars,
    _validate_config,
    get_config,
    get_data_dir,
    get_project_root,
)


# ---------------------------------------------------------------------------
# get_project_root
# ---------------------------------------------------------------------------

def test_get_project_root_returns_path():
    root = get_project_root()
    assert isinstance(root, Path)
    assert (root / "config.yaml").exists()


# ---------------------------------------------------------------------------
# _resolve_env_vars
# ---------------------------------------------------------------------------

def test_resolve_env_vars_replaces_set_var(monkeypatch):
    monkeypatch.setenv("MY_TEST_VAR", "hello123")
    assert _resolve_env_vars("${MY_TEST_VAR}") == "hello123"


def test_resolve_env_vars_missing_var_becomes_empty(monkeypatch):
    monkeypatch.delenv("NONEXISTENT_VAR_XYZ", raising=False)
    assert _resolve_env_vars("${NONEXISTENT_VAR_XYZ}") == ""


def test_resolve_env_vars_partial_string(monkeypatch):
    monkeypatch.setenv("HOST", "localhost")
    result = _resolve_env_vars("http://${HOST}:8080")
    assert result == "http://localhost:8080"


def test_resolve_env_vars_dict(monkeypatch):
    monkeypatch.setenv("SECRET", "s3cret")
    data = {"key": "${SECRET}", "plain": "no-vars", "num": 42}
    resolved = _resolve_env_vars(data)
    assert resolved == {"key": "s3cret", "plain": "no-vars", "num": 42}


def test_resolve_env_vars_nested(monkeypatch):
    monkeypatch.setenv("VAL", "deep")
    data = {"outer": [{"inner": "${VAL}"}]}
    resolved = _resolve_env_vars(data)
    assert resolved == {"outer": [{"inner": "deep"}]}


def test_resolve_env_vars_passthrough_non_strings():
    """Numbers, booleans, None should pass through unchanged."""
    assert _resolve_env_vars(42) == 42
    assert _resolve_env_vars(True) is True
    assert _resolve_env_vars(None) is None


# ---------------------------------------------------------------------------
# _validate_config
# ---------------------------------------------------------------------------

def _minimal_valid_config():
    """Return the smallest config that passes validation."""
    return {
        "kalshi": {"api_base": "https://example.com"},
        "cities": [
            {
                "id": "TEST",
                "name": "Test City",
                "metar_station": "KXXX",
                "latitude": 0.0,
                "longitude": 0.0,
                "kalshi_series": "KXTEST",
            }
        ],
        "risk": {
            "bankroll": 100.0,
            "risk_tolerance": 0.25,
        },
    }


def test_validate_config_passes_on_valid():
    """Should not raise on a valid minimal config."""
    _validate_config(_minimal_valid_config())


@pytest.mark.parametrize("missing_section", ["kalshi", "cities", "risk"])
def test_validate_config_missing_section(missing_section):
    cfg = _minimal_valid_config()
    del cfg[missing_section]
    with pytest.raises(ValueError, match=f"Missing required config section: '{missing_section}'"):
        _validate_config(cfg)


def test_validate_config_empty_cities():
    cfg = _minimal_valid_config()
    cfg["cities"] = []
    with pytest.raises(ValueError, match="non-empty list"):
        _validate_config(cfg)


def test_validate_config_city_missing_field():
    cfg = _minimal_valid_config()
    del cfg["cities"][0]["metar_station"]
    with pytest.raises(ValueError, match="metar_station"):
        _validate_config(cfg)


def test_validate_config_risk_missing_bankroll():
    cfg = _minimal_valid_config()
    del cfg["risk"]["bankroll"]
    with pytest.raises(ValueError, match="bankroll"):
        _validate_config(cfg)


# ---------------------------------------------------------------------------
# get_config -- integration with real config.yaml
# ---------------------------------------------------------------------------

def test_get_config_loads_real_config():
    """Load the actual project config.yaml and verify structure."""
    cfg = get_config()
    assert "kalshi" in cfg
    assert "cities" in cfg
    assert "risk" in cfg
    assert len(cfg["cities"]) > 0
    assert cfg["cities"][0]["id"] == "NYC"


def test_get_config_resolves_env_vars(monkeypatch):
    monkeypatch.setenv("KALSHI_KEY_ID", "test-key-id-789")
    cfg = get_config()
    assert cfg["kalshi"]["key_id"] == "test-key-id-789"


def test_get_config_missing_file():
    with pytest.raises(FileNotFoundError):
        get_config(config_path="/nonexistent/path/config.yaml")


def test_get_config_custom_path(tmp_path):
    """Write a minimal config to a temp file and load it."""
    cfg_data = _minimal_valid_config()
    cfg_file = tmp_path / "test_config.yaml"
    with open(cfg_file, "w") as f:
        yaml.dump(cfg_data, f)

    loaded = get_config(config_path=cfg_file)
    assert loaded["cities"][0]["id"] == "TEST"


# ---------------------------------------------------------------------------
# get_data_dir
# ---------------------------------------------------------------------------

def test_get_data_dir_creates_directory():
    d = get_data_dir("2026-01-01")
    assert d.exists()
    assert d.name == "2026-01-01"
    assert d.parent.name == "data"


def test_get_data_dir_defaults_to_today():
    from datetime import date
    d = get_data_dir()
    assert d.name == date.today().isoformat()
