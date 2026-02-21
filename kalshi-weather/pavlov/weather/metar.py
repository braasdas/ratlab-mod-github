"""METAR aviation weather report fetcher and parser."""

import logging
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)

METAR_API_URL = "https://aviationweather.gov/api/data/metar"
USER_AGENT = "PavlovWeatherBot/1.0 (kalshi-weather-trading)"
TIMEOUT = 15

# Sky cover abbreviation -> fractional cloud cover
SKY_COVER_MAP = {
    "SKC": 0.0,
    "CLR": 0.0,
    "FEW": 0.2,
    "SCT": 0.45,
    "BKN": 0.75,
    "OVC": 1.0,
}


def celsius_to_fahrenheit(c: float) -> float:
    """Convert Celsius to Fahrenheit."""
    return (c * 9.0 / 5.0) + 32.0


def knots_to_mph(knots: float) -> float:
    """Convert knots to miles per hour."""
    return knots * 1.15078


def fetch_metar(station_ids: list[str], hours: int = 2) -> list[dict]:
    """Fetch METAR observations from aviationweather.gov.

    Parameters
    ----------
    station_ids : list[str]
        ICAO station identifiers (e.g. ["KJFK", "KORD"]).
    hours : int
        How many hours of observations to retrieve (default 2).

    Returns
    -------
    list[dict]
        Raw JSON observation records.  Empty list on failure.
    """
    if not station_ids:
        return []

    params = {
        "ids": ",".join(station_ids),
        "format": "json",
        "hours": hours,
    }
    headers = {"User-Agent": USER_AGENT}

    try:
        resp = requests.get(
            METAR_API_URL, params=params, headers=headers, timeout=TIMEOUT
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            logger.info("Fetched %d METAR observations for %s", len(data), station_ids)
            return data
        logger.warning("Unexpected METAR response type: %s", type(data))
        return []
    except requests.exceptions.Timeout:
        logger.error("METAR request timed out after %ds", TIMEOUT)
        return []
    except requests.exceptions.RequestException as exc:
        logger.error("METAR request failed: %s", exc)
        return []
    except ValueError as exc:
        logger.error("METAR JSON decode error: %s", exc)
        return []


def parse_metar(raw_obs: dict) -> dict:
    """Parse a single raw METAR observation into a structured dict.

    Converts temperatures to Fahrenheit, wind speeds to mph,
    and calculates a fractional cloud cover value.

    Parameters
    ----------
    raw_obs : dict
        A single observation record from the METAR API.

    Returns
    -------
    dict
        Parsed observation with converted units.
    """
    # Temperature conversions
    temp_c = raw_obs.get("temp")
    dewp_c = raw_obs.get("dewp")
    temp_f = round(celsius_to_fahrenheit(temp_c), 1) if temp_c is not None else None
    dewp_f = round(celsius_to_fahrenheit(dewp_c), 1) if dewp_c is not None else None

    # Wind conversions
    wspd_kt = raw_obs.get("wspd")
    wgst_kt = raw_obs.get("wgst")
    wind_speed_mph = (
        round(knots_to_mph(wspd_kt), 1) if wspd_kt is not None else None
    )
    wind_gust_mph = (
        round(knots_to_mph(wgst_kt), 1) if wgst_kt is not None else None
    )

    # Cloud cover: take the maximum cover fraction from all sky layers
    sky_layers = raw_obs.get("sky") or []
    cloud_cover = 0.0
    for layer in sky_layers:
        cover_code = layer.get("cover", "")
        fraction = SKY_COVER_MAP.get(cover_code, 0.0)
        cloud_cover = max(cloud_cover, fraction)

    return {
        "station": raw_obs.get("icaoId"),
        "obs_time": raw_obs.get("reportTime"),
        "temp_f": temp_f,
        "dewp_f": dewp_f,
        "wind_dir": raw_obs.get("wdir"),
        "wind_speed_mph": wind_speed_mph,
        "wind_gust_mph": wind_gust_mph,
        "cloud_cover": cloud_cover,
        "visibility_miles": raw_obs.get("visib"),
        "pressure_hpa": raw_obs.get("slp"),
        "raw": raw_obs.get("rawOb"),
    }


def get_morning_snapshot(cities: list[dict]) -> dict[str, dict]:
    """Fetch the most recent METAR observation for each city.

    Makes a single batched API call for all stations, then groups
    results and selects the most recent observation per station.

    Parameters
    ----------
    cities : list[dict]
        City configuration dicts, each containing ``metar_station`` and ``id``.

    Returns
    -------
    dict[str, dict]
        Parsed METAR data keyed by city ID.
    """
    # Build mapping: station -> city_id
    station_to_city = {}
    stations = []
    for city in cities:
        station = city.get("metar_station")
        city_id = city.get("id")
        if station and city_id:
            station_to_city[station] = city_id
            stations.append(station)

    if not stations:
        return {}

    # Single batched fetch
    raw_obs_list = fetch_metar(stations)
    if not raw_obs_list:
        return {}

    # Group by station, keep most recent
    station_latest: dict[str, dict] = {}
    for obs in raw_obs_list:
        station = obs.get("icaoId")
        if station not in station_to_city:
            continue

        report_time = obs.get("reportTime", "")
        existing = station_latest.get(station)
        if existing is None or report_time > existing.get("reportTime", ""):
            station_latest[station] = obs

    # Parse and key by city_id
    result = {}
    for station, obs in station_latest.items():
        city_id = station_to_city[station]
        result[city_id] = parse_metar(obs)

    return result
