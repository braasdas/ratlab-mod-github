"""Prediction engine: formats weather data for the agent and parses responses.

This module does NOT call any LLM API.  It prepares structured prompts
for the OpenClaw agent to reason about and parses the resulting JSON
prediction block.

Key functions
-------------
format_weather_for_prediction
    Convert :func:`pavlov.weather.collect.collect_city` output into a
    :class:`WeatherInput`.
parse_prediction_response
    Extract and validate a :class:`WeatherPrediction` from the agent's
    raw text output.
validate_prediction
    Apply config-level sanity checks (min confidence, valid bracket, etc.).
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Optional

from pavlov.predictor.models import WeatherInput, WeatherPrediction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Collected-data -> WeatherInput converter
# ---------------------------------------------------------------------------

def _generate_brackets(center: float, width: int = 4, count: int = 7) -> list[str]:
    """Generate placeholder Kalshi-style brackets centred on *center*.

    Parameters
    ----------
    center : float
        Consensus mean high temperature in Fahrenheit.
    width : int
        Width of each bracket in degrees (default 4, matching Kalshi 2-deg
        half-brackets combined into the 4-deg windows Pavlov trades).
    count : int
        Number of brackets to generate (default 7, centred on *center*).

    Returns
    -------
    list[str]
        Bracket labels like ``["35-38", "39-42", ...]``.
    """
    # Round center down to nearest multiple of width
    base = int(math.floor(center / width)) * width
    # Offset so the center bracket is roughly in the middle
    half = count // 2
    start = base - half * width
    brackets: list[str] = []
    for i in range(count):
        lo = start + i * width
        hi = lo + width - 1
        brackets.append(f"{lo}-{hi}")
    return brackets


def format_weather_for_prediction(
    collected_data: dict,
    kalshi_brackets: Optional[list[str]] = None,
    contract_prices: Optional[dict[str, float]] = None,
) -> WeatherInput:
    """Convert a :func:`collect_city` output dict to a :class:`WeatherInput`.

    Parameters
    ----------
    collected_data : dict
        The per-city dict produced by ``pavlov.weather.collect.collect_city``.
    kalshi_brackets : list[str] or None
        Live bracket labels from Kalshi.  When ``None``, placeholder
        brackets are generated around the consensus mean.
    contract_prices : dict[str, float] or None
        Live contract prices keyed by bracket label.

    Returns
    -------
    WeatherInput
    """
    metar = collected_data.get("metar") or {}
    nws = collected_data.get("nws") or {}
    om = collected_data.get("open_meteo") or {}
    consensus = collected_data.get("consensus") or {}
    historical = collected_data.get("historical") or {}

    # Build brackets from consensus mean if not provided
    consensus_mean = consensus.get("mean_high_f")
    if kalshi_brackets is None:
        if consensus_mean is not None:
            kalshi_brackets = _generate_brackets(consensus_mean)
        else:
            kalshi_brackets = []
    if contract_prices is None:
        contract_prices = {}

    return WeatherInput(
        city_id=collected_data.get("city_id", ""),
        city_name=collected_data.get("city_name", ""),
        date=collected_data.get("date", ""),
        kalshi_brackets=kalshi_brackets,
        contract_prices=contract_prices,
        # METAR
        metar_temp_f=metar.get("temp_f"),
        metar_dewp_f=metar.get("dewp_f"),
        metar_wind_speed_mph=metar.get("wind_speed_mph"),
        metar_wind_dir=metar.get("wind_dir"),
        metar_cloud_cover=metar.get("cloud_cover"),
        metar_raw=metar.get("raw"),
        # NWS
        nws_forecast_high_f=nws.get("forecast_high_f"),
        nws_hourly_peak_f=nws.get("hourly_peak_f"),
        nws_detailed_forecast=nws.get("detailed_forecast"),
        nws_afd_excerpt=nws.get("afd_excerpt"),
        # Open-Meteo
        open_meteo_high_f=om.get("forecast_high_f"),
        # Consensus
        consensus_mean_f=consensus.get("mean_high_f"),
        consensus_std_f=consensus.get("std_high_f"),
        # Climatology
        historical_avg_f=historical.get("avg_high_f"),
    )


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------

_REQUIRED_KEYS = [
    "predicted_high_f",
    "confidence",
    "recommended_bracket",
    "bracket_probability",
    "adjacent_bracket",
    "adjacent_probability",
    "reasoning_summary",
    "data_sources_used",
    "uncertainty_flags",
]


def parse_prediction_response(
    raw_text: str,
    city_id: str,
    date: str,
) -> WeatherPrediction:
    """Extract a :class:`WeatherPrediction` from the agent's raw output.

    The agent is expected to emit chain-of-thought reasoning followed by
    a fenced JSON block (``\\`\\`\\`json ... \\`\\`\\```).

    Parameters
    ----------
    raw_text : str
        The complete text output from the agent/LLM.
    city_id : str
        City identifier to stamp on the prediction.
    date : str
        Target date in ``YYYY-MM-DD`` format.

    Returns
    -------
    WeatherPrediction

    Raises
    ------
    ValueError
        If the JSON block is missing, malformed, or lacks required keys.
    """
    # Locate the JSON block
    json_match = re.search(r"```json\s*(.*?)\s*```", raw_text, re.DOTALL)
    if not json_match:
        raise ValueError(
            "Response did not contain a ```json ... ``` block. "
            f"Raw (first 500 chars): {raw_text[:500]}"
        )

    json_str = json_match.group(1).strip()
    try:
        data: dict = json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse JSON block: {exc}\nJSON: {json_str}") from exc

    # Validate required keys
    missing = [k for k in _REQUIRED_KEYS if k not in data]
    if missing:
        raise ValueError(f"JSON missing required keys: {missing}")

    # --- Confidence clamping & warnings ---
    confidence = float(data["confidence"])
    if confidence > 1.0:
        logger.warning(
            "Agent returned confidence %.2f > 1.0; clamping to 0.99", confidence
        )
        confidence = 0.99
    if confidence < 0.0:
        logger.warning(
            "Agent returned negative confidence %.2f; clamping to 0.0", confidence
        )
        confidence = 0.0
    if confidence > 0.90:
        logger.warning(
            "Agent confidence %.0f%% is very high -- verify this is warranted.",
            confidence * 100,
        )

    # Extract chain-of-thought (everything before the JSON block)
    full_reasoning = raw_text[: json_match.start()].strip()

    return WeatherPrediction(
        city_id=city_id,
        date=date,
        predicted_high_f=float(data["predicted_high_f"]),
        confidence=confidence,
        recommended_bracket=str(data["recommended_bracket"]),
        bracket_probability=float(data["bracket_probability"]),
        adjacent_bracket=str(data["adjacent_bracket"]),
        adjacent_probability=float(data["adjacent_probability"]),
        reasoning_summary=str(data["reasoning_summary"]),
        uncertainty_flags=list(data.get("uncertainty_flags", [])),
        data_sources_used=list(data.get("data_sources_used", [])),
        full_reasoning=full_reasoning,
        raw_response=raw_text,
    )


# ---------------------------------------------------------------------------
# Prediction validator
# ---------------------------------------------------------------------------

_BRACKET_RE = re.compile(r"^\d+-\d+$")


def validate_prediction(prediction: WeatherPrediction, config: dict) -> bool:
    """Apply config-level sanity checks to a prediction.

    Parameters
    ----------
    prediction : WeatherPrediction
        A parsed prediction to validate.
    config : dict
        Full application config (expects ``config["risk"]``).

    Returns
    -------
    bool
        ``True`` if the prediction passes all checks.
    """
    risk = config.get("risk", {})
    min_confidence = risk.get("min_confidence", 0.55)

    if prediction.confidence < min_confidence:
        logger.warning(
            "Prediction for %s rejected: confidence %.2f < min %.2f",
            prediction.city_id,
            prediction.confidence,
            min_confidence,
        )
        return False

    if not _BRACKET_RE.match(prediction.recommended_bracket):
        logger.warning(
            "Prediction for %s rejected: bracket '%s' has invalid format",
            prediction.city_id,
            prediction.recommended_bracket,
        )
        return False

    if prediction.bracket_probability <= 0:
        logger.warning(
            "Prediction for %s rejected: bracket_probability %.4f <= 0",
            prediction.city_id,
            prediction.bracket_probability,
        )
        return False

    return True
