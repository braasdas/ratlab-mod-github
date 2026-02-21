"""Prompt templates for LLM temperature prediction queries.

Contains the system prompt, few-shot calibration examples, and the
:func:`build_user_prompt` function that formats a :class:`WeatherInput`
into the user message the OpenClaw agent reasons about.

This module does NOT call any LLM API.  It only prepares text.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pavlov.predictor.models import WeatherInput


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a calibrated meteorological analyst specializing in short-range \
temperature forecasting for prediction market purposes. Your outputs are \
used to size real financial positions on Kalshi weather contracts.

CRITICAL CALIBRATION REQUIREMENTS:
- You are systematically overconfident. Research shows LLM verbalized \
confidence clusters at 80-100% even when accuracy is far lower. \
ACTIVELY counteract this.
- Your confidence score represents the probability that your recommended \
bracket is the correct resolution. It should reflect ACTUAL uncertainty.
- A confidence of 0.95+ should be genuinely rare -- reserved for situations \
where every source agrees and there is zero model disagreement.
- When uncertain, say so. 0.55-0.75 is completely acceptable.
- You are evaluated by Brier score: overconfident wrong predictions cost \
more than under-confident correct ones.

REASONING PROCESS (follow in this exact order):
1. List every data source and its implied high temperature
2. Note any disagreements between sources
3. Identify uncertainty factors (fronts, onshore flow, sea breeze, etc.)
4. Rank the top 3 plausible brackets with rough probabilities
5. Select the best bracket AND the best adjacent bracket
6. Assign calibrated confidence
7. Output JSON LAST, after reasoning is complete

OUTPUT FORMAT:
After your chain-of-thought, output a JSON block delimited by ```json \
and ```. The JSON must contain exactly these keys:
  predicted_high_f        : float, point estimate of daily high in F
  confidence              : float 0.0-1.0, calibrated
  recommended_bracket     : string, e.g. "39-42"
  bracket_probability     : float, probability for this bracket
  adjacent_bracket        : string, the next best bracket to also buy
  adjacent_probability    : float, probability for adjacent bracket
  reasoning_summary       : string, 1-2 sentences
  data_sources_used       : list of strings
  uncertainty_flags       : list of strings (empty if no concerns)"""


# ---------------------------------------------------------------------------
# Few-shot examples (calibration anchors)
# ---------------------------------------------------------------------------

FEW_SHOT_EXAMPLES: list[dict[str, str]] = [
    # ---- Example 1: Well-calibrated correct prediction ----
    {
        "role": "user",
        "content": (
            "Predict the daily high temperature for New York City (KJFK) on 2026-01-15.\n"
            "\n"
            "TARGET DATE: 2026-01-15\n"
            "AVAILABLE BRACKETS: 28-31, 32-35, 36-39, 40-43, 44-47\n"
            'CONTRACT PRICES: {"28-31": 0.08, "32-35": 0.21, "36-39": 0.38, "40-43": 0.24, "44-47": 0.07}\n'
            "\n"
            "METAR (KJFK):\n"
            "  Current temp: 33.0F, Dewpoint: 26.0F\n"
            "  Wind: 300 deg @ 13.8 mph, Cloud cover: 45%\n"
            "  Raw: KJFK 211251Z 30012KT 10SM SCT035 01/M03 A3015\n"
            "\n"
            "NWS FORECAST:\n"
            "  Forecast High: 38.0F\n"
            "  Hourly Peak: 39.0F\n"
            "  Detailed: Partly cloudy and cold. Northwest winds 10-15 mph.\n"
            "\n"
            "OPEN-METEO: High 37.5F\n"
            "\n"
            "CONSENSUS: Mean 38.2F (std 0.8F)\n"
            "HISTORICAL AVG (Jan): 39.0F\n"
            "\n"
            "Now reason through the data step by step, then provide your JSON prediction block."
        ),
    },
    {
        "role": "assistant",
        "content": (
            "REASONING:\n"
            "\n"
            "Step 1 -- Data source inventory:\n"
            "- METAR current temp: 33F at ~13Z, rising through the morning\n"
            "- NWS forecast high: 38F\n"
            "- NWS hourly peak: 39F\n"
            "- Open-Meteo: 37.5F\n"
            "- Climatological average: 39F\n"
            "\n"
            "Step 2 -- Source agreement:\n"
            "Good agreement between NWS (38-39F), Open-Meteo (37.5F), and "
            "climatology (39F). All sources within a 1.5F spread. The METAR "
            "morning reading of 33F is consistent with daytime warming reaching "
            "the upper 30s by afternoon.\n"
            "\n"
            "Step 3 -- Uncertainty factors:\n"
            "- Northwest flow post-frontal: typically brings clear skies and good "
            "solar heating, supporting the 37-39F range.\n"
            "- 45% cloud cover could limit warming slightly.\n"
            "- No major uncertainty factors present.\n"
            "\n"
            "Step 4 -- Bracket probabilities:\n"
            "  36-39: ~45% -- NWS and Open-Meteo cluster here\n"
            "  40-43: ~30% -- possible if clearing exceeds expectations\n"
            "  32-35: ~15% -- if clouds persist and limit warming\n"
            "  44-47: ~5%  -- very unlikely given source consensus\n"
            "  28-31: ~5%  -- extremely unlikely, morning already at 33F\n"
            "\n"
            "Step 5 -- Selection:\n"
            "The 36-39 bracket captures the model consensus. Adjacent bracket "
            "40-43 covers the upside scenario. Confidence is moderate because "
            "a 2-3F swing in the final afternoon reading is normal.\n"
            "\n"
            "```json\n"
            "{\n"
            '  "predicted_high_f": 38.0,\n'
            '  "confidence": 0.68,\n'
            '  "recommended_bracket": "36-39",\n'
            '  "bracket_probability": 0.45,\n'
            '  "adjacent_bracket": "40-43",\n'
            '  "adjacent_probability": 0.30,\n'
            '  "reasoning_summary": "All three forecast sources agree on 37-39F '
            "with a northwest post-frontal pattern. The 36-39 bracket has a "
            'modest edge over its $0.38 market price.",\n'
            '  "data_sources_used": ["KJFK METAR", "NWS OKX", "Open-Meteo", "climatology"],\n'
            '  "uncertainty_flags": []\n'
            "}\n"
            "```"
        ),
    },
    # ---- Example 2: Overconfident and wrong (what NOT to do) ----
    {
        "role": "user",
        "content": (
            "[NOTE: The following is an example of OVERCONFIDENT, WRONG reasoning. "
            "Study it to understand what to avoid.]\n"
            "\n"
            "Predict the daily high temperature for Chicago (KORD) on 2026-03-01.\n"
            "\n"
            "TARGET DATE: 2026-03-01\n"
            "AVAILABLE BRACKETS: 28-31, 32-35, 36-39, 40-43, 44-47\n"
            'CONTRACT PRICES: {"28-31": 0.12, "32-35": 0.29, "36-39": 0.33, "40-43": 0.18, "44-47": 0.06}\n'
            "\n"
            "NWS FORECAST: High 37F. Chance of rain/snow mix near 32F early morning.\n"
            "OPEN-METEO: High 42.0F\n"
            "\n"
            "CONSENSUS: Mean 39.5F (std 3.5F)\n"
            "HISTORICAL AVG (Mar): 47.0F\n"
            "\n"
            "Now reason through the data step by step, then provide your JSON prediction block."
        ),
    },
    {
        "role": "assistant",
        "content": (
            "[OVERCONFIDENT EXAMPLE -- DO NOT IMITATE]\n"
            "\n"
            'BAD REASONING (what not to do):\n'
            '"NWS says 37F, Open-Meteo says 42F. The average is about 39.5F so '
            'the 36-39 bracket is clearly right. I\'m 95% confident."\n'
            "\n"
            "WHY THIS IS WRONG:\n"
            "- NWS and Open-Meteo disagree by 5F -- this is a significant model "
            "spread for a single-day forecast. The uncertainty_flags should "
            'include "model disagreement".\n'
            "- A rain/snow mix near 32F early morning suggests a frontal boundary "
            "is very close. These boundaries are notoriously hard to pin down "
            "by even 5F.\n"
            "- 95% confidence across a single 4F bracket when models disagree by "
            "5F is demonstrably uncalibrated.\n"
            "- The 40-43 bracket at $0.18 is potentially underpriced if "
            "Open-Meteo is right.\n"
            "\n"
            "CORRECT APPROACH WOULD PRODUCE:\n"
            "```json\n"
            "{\n"
            '  "predicted_high_f": 38.5,\n'
            '  "confidence": 0.55,\n'
            '  "recommended_bracket": "36-39",\n'
            '  "bracket_probability": 0.38,\n'
            '  "adjacent_bracket": "40-43",\n'
            '  "adjacent_probability": 0.28,\n'
            '  "reasoning_summary": "Significant model disagreement (5F spread) '
            "with a nearby frontal boundary makes this forecast uncertain. "
            '36-39 leads but 40-43 and 32-35 are both meaningful probabilities.",\n'
            '  "data_sources_used": ["NWS Chicago", "Open-Meteo", "climatology"],\n'
            '  "uncertainty_flags": ["model disagreement (NWS vs Open-Meteo: 5F)", '
            '"frontal boundary nearby", "rain/snow mix possible"]\n'
            "}\n"
            "```"
        ),
    },
]


# ---------------------------------------------------------------------------
# User prompt builder
# ---------------------------------------------------------------------------

def build_user_prompt(weather: WeatherInput) -> str:
    """Format a :class:`WeatherInput` into the user message for the LLM.

    All available data is presented in a fixed, structured format so the
    agent can reason about it in a consistent way.  Missing data sources
    are silently omitted.

    Parameters
    ----------
    weather : WeatherInput
        Structured weather data collected by ``pavlov.weather.collect``.

    Returns
    -------
    str
        The complete user prompt ready for the agent.
    """
    lines: list[str] = [
        f"Predict the daily high temperature for {weather.city_name} "
        f"({weather.city_id}) on {weather.date}.",
        "",
        f"TARGET DATE: {weather.date}",
    ]

    if weather.kalshi_brackets:
        lines.append(f"AVAILABLE BRACKETS: {', '.join(weather.kalshi_brackets)}")
    if weather.contract_prices:
        lines.append(f"CONTRACT PRICES: {json.dumps(weather.contract_prices)}")

    lines.append("")

    # --- METAR section ---
    if weather.metar_temp_f is not None:
        lines.append(f"METAR ({weather.city_id}):")
        lines.append(f"  Current temp: {weather.metar_temp_f}F, "
                     f"Dewpoint: {weather.metar_dewp_f}F")
        wind_dir = weather.metar_wind_dir if weather.metar_wind_dir is not None else "N/A"
        wind_spd = weather.metar_wind_speed_mph if weather.metar_wind_speed_mph is not None else "N/A"
        cloud = (f"{weather.metar_cloud_cover * 100:.0f}%"
                 if weather.metar_cloud_cover is not None else "N/A")
        lines.append(f"  Wind: {wind_dir} deg @ {wind_spd} mph, "
                     f"Cloud cover: {cloud}")
        if weather.metar_raw:
            lines.append(f"  Raw: {weather.metar_raw}")
        lines.append("")

    # --- NWS section ---
    nws_present = any([
        weather.nws_forecast_high_f is not None,
        weather.nws_hourly_peak_f is not None,
        weather.nws_detailed_forecast,
    ])
    if nws_present:
        lines.append("NWS FORECAST:")
        if weather.nws_forecast_high_f is not None:
            lines.append(f"  Forecast High: {weather.nws_forecast_high_f}F")
        if weather.nws_hourly_peak_f is not None:
            lines.append(f"  Hourly Peak: {weather.nws_hourly_peak_f}F")
        if weather.nws_detailed_forecast:
            lines.append(f"  Detailed: {weather.nws_detailed_forecast}")
        if weather.nws_afd_excerpt:
            lines.append(f"  AFD Excerpt: {weather.nws_afd_excerpt}")
        lines.append("")

    # --- Open-Meteo section ---
    if weather.open_meteo_high_f is not None:
        lines.append(f"OPEN-METEO: High {weather.open_meteo_high_f}F")
        lines.append("")

    # --- Consensus section ---
    if weather.consensus_mean_f is not None:
        std_str = f" (std {weather.consensus_std_f}F)" if weather.consensus_std_f is not None else ""
        lines.append(f"CONSENSUS: Mean {weather.consensus_mean_f}F{std_str}")

    # --- Climatology section ---
    if weather.historical_avg_f is not None:
        # Extract month from date for display
        month_names = {
            1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
            7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
        }
        try:
            month_num = int(weather.date.split("-")[1])
            month_label = month_names.get(month_num, "")
        except (IndexError, ValueError):
            month_label = ""
        label = f" ({month_label})" if month_label else ""
        lines.append(f"HISTORICAL AVG{label}: {weather.historical_avg_f}F")

    lines.append("")
    lines.append(
        "Now reason through the data step by step, then provide your "
        "JSON prediction block."
    )

    return "\n".join(lines)
