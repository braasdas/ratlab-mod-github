"""Data models for prediction inputs, outputs, and bracket probabilities.

Provides :class:`WeatherInput` (structured weather data fed to the LLM)
and :class:`WeatherPrediction` (parsed and validated LLM output).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class WeatherInput:
    """Complete weather data package formatted for LLM prediction.

    All temperature values are in Fahrenheit.  Optional fields default to
    ``None`` so the prompt builder can gracefully skip missing sources
    (e.g. NWS can occasionally fail).
    """

    city_id: str
    city_name: str
    date: str  # "YYYY-MM-DD"

    # Kalshi market data
    kalshi_brackets: list[str] = field(default_factory=list)
    contract_prices: dict[str, float] = field(default_factory=dict)

    # METAR observations
    metar_temp_f: Optional[float] = None
    metar_dewp_f: Optional[float] = None
    metar_wind_speed_mph: Optional[float] = None
    metar_wind_dir: Optional[int] = None
    metar_cloud_cover: Optional[float] = None  # 0.0-1.0
    metar_raw: Optional[str] = None

    # NWS forecast
    nws_forecast_high_f: Optional[float] = None
    nws_hourly_peak_f: Optional[float] = None
    nws_detailed_forecast: Optional[str] = None
    nws_afd_excerpt: Optional[str] = None

    # Open-Meteo
    open_meteo_high_f: Optional[float] = None

    # Consensus statistics
    consensus_mean_f: Optional[float] = None
    consensus_std_f: Optional[float] = None

    # Climatology
    historical_avg_f: Optional[float] = None


@dataclass
class WeatherPrediction:
    """Parsed and validated LLM prediction output.

    Created by :func:`pavlov.predictor.engine.parse_prediction_response`
    from the raw text the agent produces.
    """

    city_id: str
    date: str  # "YYYY-MM-DD"

    predicted_high_f: float
    confidence: float  # 0.0-1.0, calibrated

    recommended_bracket: str  # e.g. "39-42"
    bracket_probability: float  # probability for the primary bracket

    adjacent_bracket: str  # e.g. "43-46"
    adjacent_probability: float

    reasoning_summary: str
    uncertainty_flags: list[str] = field(default_factory=list)
    data_sources_used: list[str] = field(default_factory=list)

    full_reasoning: str = ""  # chain-of-thought before JSON
    raw_response: str = ""  # complete LLM output for audit
