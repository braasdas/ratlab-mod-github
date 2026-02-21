"""Configuration loader for Pavlov trading bot."""

import os
import re
from datetime import date
from pathlib import Path

import yaml


def get_project_root() -> Path:
    """Return the project root directory (parent of the pavlov package)."""
    return Path(__file__).resolve().parent.parent


def _resolve_env_vars(value):
    """Recursively walk a config structure and replace ${VAR_NAME} patterns
    with the corresponding environment variable value.

    Missing env vars resolve to empty string so the bot can still run
    in paper mode without all secrets configured.
    """
    if isinstance(value, str):
        # Replace all ${VAR_NAME} occurrences in the string
        def _replace(match):
            var_name = match.group(1)
            return os.environ.get(var_name, "")

        return re.sub(r"\$\{([^}]+)\}", _replace, value)

    if isinstance(value, dict):
        return {k: _resolve_env_vars(v) for k, v in value.items()}

    if isinstance(value, list):
        return [_resolve_env_vars(item) for item in value]

    # Numbers, booleans, None -- pass through unchanged
    return value


def _validate_config(config: dict) -> None:
    """Validate that all required config sections and fields are present.

    Raises ValueError with a descriptive message on the first problem found.
    """
    # Required top-level sections
    for section in ("kalshi", "cities", "risk"):
        if section not in config:
            raise ValueError(f"Missing required config section: '{section}'")

    # cities must be a non-empty list
    if not isinstance(config["cities"], list) or len(config["cities"]) == 0:
        raise ValueError("'cities' must be a non-empty list")

    # Each city needs certain fields
    required_city_fields = [
        "id", "name", "metar_station", "latitude", "longitude", "kalshi_series",
    ]
    for i, city in enumerate(config["cities"]):
        for field in required_city_fields:
            if field not in city:
                city_label = city.get("id", f"index {i}")
                raise ValueError(
                    f"City '{city_label}' is missing required field: '{field}'"
                )

    # Risk section required fields
    for field in ("bankroll", "risk_tolerance"):
        if field not in config["risk"]:
            raise ValueError(
                f"'risk' section is missing required field: '{field}'"
            )


def get_config(config_path=None) -> dict:
    """Load, resolve, and validate the project configuration.

    Parameters
    ----------
    config_path : str or Path, optional
        Explicit path to a YAML config file.  When *None* (the default),
        looks for ``config.yaml`` in the project root.

    Returns
    -------
    dict
        The fully-resolved and validated configuration dictionary.
    """
    if config_path is None:
        config_path = get_project_root() / "config.yaml"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    config = _resolve_env_vars(config)
    _validate_config(config)

    return config


def get_data_dir(date_str: str | None = None) -> Path:
    """Return the path to the data directory for a given date, creating it
    if it does not already exist.

    Parameters
    ----------
    date_str : str, optional
        Date string (e.g. ``"2026-02-21"``).  Defaults to today's date.

    Returns
    -------
    Path
        Absolute path to ``<project_root>/data/<date_str>/``.
    """
    if date_str is None:
        date_str = date.today().isoformat()

    data_dir = get_project_root() / "data" / date_str
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir
