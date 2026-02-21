"""Orchestrator that collects weather data from all sources for each city."""

import json
import logging
import statistics
from datetime import date, datetime, timezone

from pavlov.config import get_config, get_data_dir
from pavlov.weather.metar import get_morning_snapshot
from pavlov.weather.nws import get_afd, get_forecast, get_hourly_peak
from pavlov.weather.openmeteo import extract_today

logger = logging.getLogger(__name__)

# Month abbreviation -> month number
MONTH_ABBREV = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _get_historical_avg(city_config: dict) -> dict:
    """Get historical average high for the current month.

    Parameters
    ----------
    city_config : dict
        City configuration with ``historical_avg_high`` section.

    Returns
    -------
    dict
        Dict with avg_high_f and month.
    """
    today = date.today()
    month_num = today.month
    hist = city_config.get("historical_avg_high", {})

    # Find the matching month abbreviation
    avg_high = None
    for abbrev, num in MONTH_ABBREV.items():
        if num == month_num:
            avg_high = hist.get(abbrev)
            break

    return {
        "avg_high_f": avg_high,
        "month": month_num,
    }


def compute_consensus(metar_data: dict | None,
                      nws_data: dict | None,
                      open_meteo_data: dict | None) -> dict:
    """Calculate consensus statistics from available high temp estimates.

    Collects all available high temperature estimates and computes
    the mean and standard deviation.  ``sources_agree`` is True if
    the standard deviation is less than 3.0 degrees.

    Parameters
    ----------
    metar_data : dict or None
        Parsed METAR data (current temp, not a high forecast).
    nws_data : dict or None
        NWS forecast data.
    open_meteo_data : dict or None
        Open-Meteo forecast data.

    Returns
    -------
    dict
        Consensus dict with mean_high_f, std_high_f, sources_agree.
    """
    highs = []

    if nws_data and nws_data.get("forecast_high_f") is not None:
        highs.append(float(nws_data["forecast_high_f"]))

    if nws_data and nws_data.get("hourly_peak_f") is not None:
        highs.append(float(nws_data["hourly_peak_f"]))

    if open_meteo_data and open_meteo_data.get("forecast_high_f") is not None:
        highs.append(float(open_meteo_data["forecast_high_f"]))

    if not highs:
        return {
            "mean_high_f": None,
            "std_high_f": None,
            "sources_agree": False,
        }

    mean_high = round(statistics.mean(highs), 1)
    std_high = round(statistics.stdev(highs), 1) if len(highs) >= 2 else 0.0

    return {
        "mean_high_f": mean_high,
        "std_high_f": std_high,
        "sources_agree": std_high < 3.0,
    }


def collect_city(city_config: dict, metar_snapshot: dict) -> dict:
    """Collect all weather data for a single city.

    Parameters
    ----------
    city_config : dict
        City configuration from config.yaml.
    metar_snapshot : dict
        Pre-fetched METAR data keyed by city ID.

    Returns
    -------
    dict
        Full weather data structure for this city.
    """
    city_id = city_config["id"]
    today_str = date.today().isoformat()
    now_str = datetime.now(timezone.utc).isoformat()

    lat = city_config["latitude"]
    lon = city_config["longitude"]

    # METAR (already fetched in batch)
    metar_data = metar_snapshot.get(city_id)

    # NWS forecast
    nws_forecast = get_forecast(lat, lon)
    nws_hourly = get_hourly_peak(lat, lon)

    # NWS AFD
    nws_office = city_config.get("nws_office")
    afd_text = None
    if nws_office:
        afd_text = get_afd(nws_office)

    # Merge NWS data
    nws_data = None
    if nws_forecast or nws_hourly:
        nws_data = {
            "office": nws_office,
            "forecast_high_f": None,
            "hourly_peak_f": None,
            "hourly_peak_hour": None,
            "short_forecast": None,
            "detailed_forecast": None,
            "wind": None,
            "afd_excerpt": afd_text,
        }
        if nws_forecast:
            nws_data["forecast_high_f"] = nws_forecast.get("forecast_high_f")
            nws_data["short_forecast"] = nws_forecast.get("short_forecast")
            nws_data["wind"] = nws_forecast.get("wind")
            nws_data["detailed_forecast"] = nws_forecast.get("detailed_forecast")
        if nws_hourly:
            nws_data["hourly_peak_f"] = nws_hourly.get("hourly_peak_f")
            nws_data["hourly_peak_hour"] = nws_hourly.get("hourly_peak_hour")

    # Open-Meteo
    open_meteo_data = extract_today(city_config)

    # Consensus
    consensus = compute_consensus(metar_data, nws_data, open_meteo_data)

    # Historical
    historical = _get_historical_avg(city_config)

    return {
        "city_id": city_id,
        "city_name": city_config["name"],
        "date": today_str,
        "collection_time": now_str,
        "metar": metar_data,
        "nws": nws_data,
        "open_meteo": open_meteo_data,
        "consensus": consensus,
        "historical": historical,
    }


def collect_all() -> list[dict]:
    """Collect weather data for all configured cities.

    1. Loads config
    2. Fetches METAR for all stations (single batched call)
    3. For each city: fetches NWS and Open-Meteo data
    4. Assembles structured output
    5. Saves to data/YYYY-MM-DD/weather.json
    6. Prints formatted summary

    Returns
    -------
    list[dict]
        Weather data for all cities.
    """
    config = get_config()
    cities = config.get("cities", [])

    if not cities:
        logger.warning("No cities configured")
        return []

    logger.info("Collecting weather data for %d cities...", len(cities))

    # Step 1: Batch METAR fetch
    logger.info("Fetching METAR observations...")
    metar_snapshot = get_morning_snapshot(cities)
    logger.info("Got METAR data for %d stations", len(metar_snapshot))

    # Step 2: Collect each city
    results = []
    for city in cities:
        city_id = city["id"]
        logger.info("Collecting data for %s...", city_id)
        try:
            city_data = collect_city(city, metar_snapshot)
            results.append(city_data)
        except Exception as exc:
            logger.error("Failed to collect data for %s: %s", city_id, exc)

    # Step 3: Save to file
    if results:
        today_str = date.today().isoformat()
        data_dir = get_data_dir(today_str)
        output_path = data_dir / "weather.json"

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, default=str)

        logger.info("Saved weather data to %s", output_path)

    # Step 4: Print summary
    _print_summary(results)

    return results


def _print_summary(results: list[dict]) -> None:
    """Print a formatted summary of collected weather data to stdout."""
    print("\n" + "=" * 60)
    print("  WEATHER DATA COLLECTION SUMMARY")
    print("=" * 60)

    for city_data in results:
        city_name = city_data["city_name"]
        print(f"\n--- {city_name} ({city_data['city_id']}) ---")
        print(f"  Date: {city_data['date']}")

        # METAR
        metar = city_data.get("metar")
        if metar:
            print(f"  METAR: {metar.get('temp_f')}F, "
                  f"wind {metar.get('wind_speed_mph')} mph, "
                  f"cloud cover {metar.get('cloud_cover', 0) * 100:.0f}%")
        else:
            print("  METAR: No data")

        # NWS
        nws = city_data.get("nws")
        if nws:
            print(f"  NWS Forecast High: {nws.get('forecast_high_f')}F")
            print(f"  NWS Hourly Peak:   {nws.get('hourly_peak_f')}F "
                  f"(at hour {nws.get('hourly_peak_hour')})")
            print(f"  NWS Short:         {nws.get('short_forecast')}")
        else:
            print("  NWS: No data")

        # Open-Meteo
        om = city_data.get("open_meteo")
        if om:
            print(f"  Open-Meteo High:   {om.get('forecast_high_f')}F")
            print(f"  Open-Meteo Low:    {om.get('forecast_low_f')}F")
            print(f"  Cloud Cover:       {om.get('cloud_cover_pct')}%")
            print(f"  Precip Prob:       {om.get('precip_prob_pct')}%")
        else:
            print("  Open-Meteo: No data")

        # Consensus
        consensus = city_data.get("consensus", {})
        mean_h = consensus.get("mean_high_f")
        std_h = consensus.get("std_high_f")
        agree = consensus.get("sources_agree")
        if mean_h is not None:
            agree_str = "YES" if agree else "NO"
            print(f"  Consensus High:    {mean_h}F (std={std_h}, agree={agree_str})")
        else:
            print("  Consensus: Insufficient data")

        # Historical
        hist = city_data.get("historical", {})
        if hist.get("avg_high_f") is not None:
            print(f"  Historical Avg:    {hist['avg_high_f']}F (month {hist['month']})")

    print("\n" + "=" * 60)
    print(f"  Collection complete: {len(results)} cities")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    collect_all()
