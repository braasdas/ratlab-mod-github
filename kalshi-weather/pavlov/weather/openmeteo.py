"""Open-Meteo API client for historical and forecast weather data."""

import logging

import requests

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "PavlovWeatherBot/1.0 (kalshi-weather-trading)"
TIMEOUT = 15


def fetch_open_meteo(city_config: dict) -> dict | None:
    """Fetch forecast data from Open-Meteo for a given city.

    Parameters
    ----------
    city_config : dict
        City configuration dict with latitude, longitude, and timezone.

    Returns
    -------
    dict or None
        Raw API response as a dict.  None on failure.
    """
    lat = city_config.get("latitude")
    lon = city_config.get("longitude")
    tz = city_config.get("timezone", "America/New_York")

    if lat is None or lon is None:
        logger.error("Missing latitude/longitude for city %s", city_config.get("id"))
        return None

    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
        "hourly": "temperature_2m,cloudcover,precipitation_probability,wind_speed_10m",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "timezone": tz,
        "forecast_days": 3,
    }
    headers = {"User-Agent": USER_AGENT}

    try:
        resp = requests.get(
            OPEN_METEO_URL, params=params, headers=headers, timeout=TIMEOUT
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "Fetched Open-Meteo data for %s (%.2f, %.2f)",
            city_config.get("id"),
            lat,
            lon,
        )
        return data
    except requests.exceptions.Timeout:
        logger.error("Open-Meteo request timed out for %s", city_config.get("id"))
        return None
    except requests.exceptions.RequestException as exc:
        logger.error("Open-Meteo request failed for %s: %s", city_config.get("id"), exc)
        return None
    except ValueError as exc:
        logger.error("Open-Meteo JSON decode error: %s", exc)
        return None


def extract_today(city_config: dict) -> dict | None:
    """Fetch Open-Meteo data and extract today's forecast summary.

    Parameters
    ----------
    city_config : dict
        City configuration dict.

    Returns
    -------
    dict or None
        Today's forecast with forecast_high_f, forecast_low_f,
        cloud_cover_pct, precip_prob_pct, wind_max_mph.
        None on failure.
    """
    data = fetch_open_meteo(city_config)
    if data is None:
        return None

    return parse_today(data)


def parse_today(data: dict) -> dict | None:
    """Parse a raw Open-Meteo response and extract today's values.

    Today is index 0 in the daily arrays.

    Parameters
    ----------
    data : dict
        Raw Open-Meteo API response.

    Returns
    -------
    dict or None
        Parsed today forecast, or None if data is missing.
    """
    daily = data.get("daily", {})
    hourly = data.get("hourly", {})

    # Daily values -- index 0 = today
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])
    precip_probs = daily.get("precipitation_probability_max", [])
    wind_maxes = daily.get("wind_speed_10m_max", [])

    if not highs:
        logger.warning("No daily temperature data in Open-Meteo response")
        return None

    forecast_high = highs[0] if highs else None
    forecast_low = lows[0] if lows else None
    precip_prob = precip_probs[0] if precip_probs else None
    wind_max = wind_maxes[0] if wind_maxes else None

    # Cloud cover: average today's hourly cloud cover values
    # Hourly arrays cover all forecast days; today is first 24 entries
    cloud_covers = hourly.get("cloudcover", [])
    if cloud_covers and len(cloud_covers) >= 24:
        today_clouds = cloud_covers[:24]
        valid_clouds = [c for c in today_clouds if c is not None]
        cloud_cover_pct = (
            round(sum(valid_clouds) / len(valid_clouds), 1) if valid_clouds else None
        )
    elif cloud_covers:
        valid_clouds = [c for c in cloud_covers if c is not None]
        cloud_cover_pct = (
            round(sum(valid_clouds) / len(valid_clouds), 1) if valid_clouds else None
        )
    else:
        cloud_cover_pct = None

    return {
        "forecast_high_f": forecast_high,
        "forecast_low_f": forecast_low,
        "cloud_cover_pct": cloud_cover_pct,
        "precip_prob_pct": precip_prob,
        "wind_max_mph": wind_max,
    }
