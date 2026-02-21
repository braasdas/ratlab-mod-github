"""National Weather Service API client for forecast data."""

import logging
import re
import time
from datetime import date, datetime, timezone
from functools import lru_cache

import requests

logger = logging.getLogger(__name__)

NWS_BASE_URL = "https://api.weather.gov"
USER_AGENT = "(PavlovWeatherBot/1.0, kalshi-weather-trading)"
TIMEOUT = 15
REQUEST_DELAY = 0.5  # Seconds between NWS API calls


def _nws_get(url: str, params: dict | None = None) -> dict | None:
    """Make a GET request to the NWS API with proper headers and delay.

    Parameters
    ----------
    url : str
        Full URL or path relative to NWS_BASE_URL.
    params : dict, optional
        Query parameters.

    Returns
    -------
    dict or None
        Parsed JSON response, or None on failure.
    """
    if not url.startswith("http"):
        url = f"{NWS_BASE_URL}{url}"

    headers = {"User-Agent": USER_AGENT, "Accept": "application/geo+json"}

    time.sleep(REQUEST_DELAY)

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        logger.error("NWS request timed out: %s", url)
        return None
    except requests.exceptions.RequestException as exc:
        logger.error("NWS request failed for %s: %s", url, exc)
        return None
    except ValueError as exc:
        logger.error("NWS JSON decode error for %s: %s", url, exc)
        return None


# Cache for grid metadata (coordinates never change)
_grid_cache: dict[tuple[float, float], dict] = {}


def get_grid_metadata(lat: float, lon: float) -> dict | None:
    """Look up NWS grid metadata for a lat/lon coordinate.

    Results are cached forever since coordinates don't change.

    Parameters
    ----------
    lat : float
        Latitude.
    lon : float
        Longitude.

    Returns
    -------
    dict or None
        Dict with keys: office, gridX, gridY.  None on failure.
    """
    cache_key = (round(lat, 4), round(lon, 4))
    if cache_key in _grid_cache:
        return _grid_cache[cache_key]

    data = _nws_get(f"/points/{lat},{lon}")
    if data is None:
        return None

    props = data.get("properties", {})
    result = {
        "office": props.get("gridId"),
        "gridX": props.get("gridX"),
        "gridY": props.get("gridY"),
    }

    if not result["office"]:
        logger.error("No grid office found for %s,%s", lat, lon)
        return None

    _grid_cache[cache_key] = result
    logger.info("Cached NWS grid metadata for %s,%s: %s", lat, lon, result)
    return result


def get_forecast(lat: float, lon: float) -> dict | None:
    """Get today's forecast from NWS 12-hour period forecast.

    Parameters
    ----------
    lat : float
        Latitude.
    lon : float
        Longitude.

    Returns
    -------
    dict or None
        Dict with forecast_high_f, short_forecast, wind, detailed_forecast,
        office.  None on failure.
    """
    grid = get_grid_metadata(lat, lon)
    if grid is None:
        return None

    office = grid["office"]
    x = grid["gridX"]
    y = grid["gridY"]

    data = _nws_get(f"/gridpoints/{office}/{x},{y}/forecast")
    if data is None:
        return None

    periods = data.get("properties", {}).get("periods", [])
    if not periods:
        logger.warning("No forecast periods returned for %s/%s,%s", office, x, y)
        return None

    # Find the first daytime period (today's high)
    today_period = None
    for period in periods:
        if period.get("isDaytime", False):
            today_period = period
            break

    if today_period is None:
        # If no daytime period found, use the first period
        today_period = periods[0]
        logger.warning("No daytime period found, using first period")

    return {
        "office": office,
        "forecast_high_f": today_period.get("temperature"),
        "short_forecast": today_period.get("shortForecast"),
        "wind": today_period.get("windSpeed", ""),
        "detailed_forecast": today_period.get("detailedForecast", ""),
    }


def get_hourly_peak(lat: float, lon: float) -> dict | None:
    """Get today's peak temperature from NWS hourly forecast.

    Filters hourly periods to today's date and finds the maximum
    temperature and the hour at which it occurs.

    Parameters
    ----------
    lat : float
        Latitude.
    lon : float
        Longitude.

    Returns
    -------
    dict or None
        Dict with hourly_peak_f and hourly_peak_hour.  None on failure.
    """
    grid = get_grid_metadata(lat, lon)
    if grid is None:
        return None

    office = grid["office"]
    x = grid["gridX"]
    y = grid["gridY"]

    data = _nws_get(f"/gridpoints/{office}/{x},{y}/forecast/hourly")
    if data is None:
        return None

    periods = data.get("properties", {}).get("periods", [])
    if not periods:
        logger.warning("No hourly periods returned for %s/%s,%s", office, x, y)
        return None

    today_str = date.today().isoformat()
    peak_temp = None
    peak_hour = None

    for period in periods:
        start_time = period.get("startTime", "")
        # NWS times look like "2026-02-21T14:00:00-05:00"
        if start_time[:10] != today_str:
            continue

        temp = period.get("temperature")
        if temp is not None and (peak_temp is None or temp > peak_temp):
            peak_temp = temp
            # Extract hour from ISO string
            try:
                hour = int(start_time[11:13])
                peak_hour = hour
            except (ValueError, IndexError):
                pass

    if peak_temp is None:
        logger.warning("No hourly temps found for today (%s)", today_str)
        return None

    return {
        "hourly_peak_f": peak_temp,
        "hourly_peak_hour": peak_hour,
    }


def get_afd(office: str) -> str | None:
    """Fetch the most recent Area Forecast Discussion and extract
    temperature-related content.

    Parameters
    ----------
    office : str
        NWS office code (e.g. "OKX").

    Returns
    -------
    str or None
        Extracted temperature-related lines from the AFD, or None on failure.
    """
    # Get list of AFD products for this office
    data = _nws_get(f"/products/types/AFD/locations/{office}")
    if data is None:
        return None

    products = data.get("@graph", [])
    if not products:
        logger.warning("No AFD products found for office %s", office)
        return None

    # Get the most recent product
    product_id = products[0].get("id")
    if not product_id:
        logger.warning("No product ID in first AFD for %s", office)
        return None

    product_data = _nws_get(f"/products/{product_id}")
    if product_data is None:
        return None

    full_text = product_data.get("productText", "")
    if not full_text:
        logger.warning("Empty AFD text for %s", office)
        return None

    # Extract SHORT TERM section and temperature mentions
    excerpt_lines = []

    # Try to extract the SHORT TERM section
    short_term_match = re.search(
        r"\.SHORT TERM\.{0,3}\s*\n(.*?)(?=\n\.[A-Z]|\n\$\$)",
        full_text,
        re.DOTALL | re.IGNORECASE,
    )
    if short_term_match:
        short_term_text = short_term_match.group(1).strip()
        # Keep it reasonable length
        if len(short_term_text) > 1500:
            short_term_text = short_term_text[:1500] + "..."
        excerpt_lines.append(short_term_text)

    # Also grab any lines mentioning temperature
    temp_pattern = re.compile(
        r".*(?:temp|high|low|degree|warm|cold|cool|heat).*",
        re.IGNORECASE,
    )
    for line in full_text.split("\n"):
        line = line.strip()
        if temp_pattern.match(line) and line not in excerpt_lines:
            excerpt_lines.append(line)

    if not excerpt_lines:
        # Fall back to first 500 chars of the AFD
        return full_text[:500] + "..." if len(full_text) > 500 else full_text

    return "\n".join(excerpt_lines[:20])  # Cap at 20 lines
