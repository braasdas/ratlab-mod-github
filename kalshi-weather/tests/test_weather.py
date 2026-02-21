"""Tests for weather data collection modules."""

import json
from unittest.mock import MagicMock, patch

import pytest

from pavlov.weather.metar import (
    celsius_to_fahrenheit,
    fetch_metar,
    knots_to_mph,
    parse_metar,
    get_morning_snapshot,
)
from pavlov.weather.nws import (
    get_forecast,
    get_grid_metadata,
    get_hourly_peak,
    get_afd,
    _grid_cache,
)
from pavlov.weather.openmeteo import fetch_open_meteo, parse_today
from pavlov.weather.collect import compute_consensus, _get_historical_avg


# ---------------------------------------------------------------------------
# Sample data fixtures
# ---------------------------------------------------------------------------

SAMPLE_METAR_OBS = {
    "icaoId": "KJFK",
    "reportTime": "2026-02-21T12:51:00Z",
    "temp": 2.0,
    "dewp": -3.0,
    "wdir": 300,
    "wspd": 12,
    "wgst": 18,
    "visib": 10,
    "altim": 30.22,
    "slp": 1022.5,
    "sky": [{"cover": "SCT", "base": 3500}],
    "wxString": None,
    "rawOb": "KJFK 211251Z 30012G18KT 10SM SCT035 02/M03 A3022",
}

SAMPLE_METAR_OBS_NO_GUST = {
    "icaoId": "KORD",
    "reportTime": "2026-02-21T13:00:00Z",
    "temp": -5.0,
    "dewp": -10.0,
    "wdir": 270,
    "wspd": 8,
    "wgst": None,
    "visib": 8,
    "altim": 30.10,
    "slp": 1019.0,
    "sky": [{"cover": "OVC", "base": 2000}],
    "wxString": "SN",
    "rawOb": "KORD 211300Z 27008KT 8SM OVC020 M05/M10 A3010",
}

SAMPLE_NWS_POINTS_RESPONSE = {
    "properties": {
        "gridId": "OKX",
        "gridX": 33,
        "gridY": 37,
    }
}

SAMPLE_NWS_FORECAST_RESPONSE = {
    "properties": {
        "periods": [
            {
                "number": 1,
                "name": "Today",
                "isDaytime": True,
                "temperature": 42,
                "temperatureUnit": "F",
                "windSpeed": "10 to 15 mph",
                "shortForecast": "Mostly Sunny",
                "detailedForecast": "Mostly sunny, with a high near 42.",
            },
            {
                "number": 2,
                "name": "Tonight",
                "isDaytime": False,
                "temperature": 28,
                "temperatureUnit": "F",
                "windSpeed": "5 to 10 mph",
                "shortForecast": "Clear",
                "detailedForecast": "Clear, with a low around 28.",
            },
        ]
    }
}

SAMPLE_NWS_HOURLY_RESPONSE = {
    "properties": {
        "periods": [
            {
                "startTime": "2026-02-21T10:00:00-05:00",
                "temperature": 35,
            },
            {
                "startTime": "2026-02-21T11:00:00-05:00",
                "temperature": 38,
            },
            {
                "startTime": "2026-02-21T14:00:00-05:00",
                "temperature": 43,
            },
            {
                "startTime": "2026-02-21T15:00:00-05:00",
                "temperature": 42,
            },
            {
                "startTime": "2026-02-22T10:00:00-05:00",
                "temperature": 50,
            },
        ]
    }
}

SAMPLE_NWS_AFD_LIST_RESPONSE = {
    "@graph": [
        {"id": "abc123", "issuanceTime": "2026-02-21T10:00:00Z"},
    ]
}

SAMPLE_NWS_AFD_PRODUCT_RESPONSE = {
    "productText": (
        "Area Forecast Discussion\n"
        "National Weather Service New York NY\n"
        "\n"
        ".SHORT TERM...\n"
        "High temperatures will reach the low 40s today.\n"
        "Temps will be near normal for this time of year.\n"
        "\n"
        ".LONG TERM...\n"
        "A warming trend is expected.\n"
    )
}

SAMPLE_OPEN_METEO_RESPONSE = {
    "daily": {
        "time": ["2026-02-21", "2026-02-22", "2026-02-23"],
        "temperature_2m_max": [41.0, 44.0, 48.0],
        "temperature_2m_min": [28.0, 30.0, 33.0],
        "precipitation_probability_max": [0, 10, 30],
        "wind_speed_10m_max": [18.5, 12.0, 8.0],
    },
    "hourly": {
        "time": [f"2026-02-21T{h:02d}:00" for h in range(24)]
        + [f"2026-02-22T{h:02d}:00" for h in range(24)]
        + [f"2026-02-23T{h:02d}:00" for h in range(24)],
        "temperature_2m": [30 + i * 0.5 for i in range(72)],
        "cloudcover": [35] * 24 + [50] * 24 + [60] * 24,
        "precipitation_probability": [0] * 24 + [10] * 24 + [30] * 24,
        "wind_speed_10m": [15] * 72,
    },
}


# ---------------------------------------------------------------------------
# METAR tests
# ---------------------------------------------------------------------------

class TestCelsiusToFahrenheit:
    def test_freezing(self):
        assert celsius_to_fahrenheit(0) == 32.0

    def test_boiling(self):
        assert celsius_to_fahrenheit(100) == 212.0

    def test_negative(self):
        assert celsius_to_fahrenheit(-40) == -40.0

    def test_positive(self):
        assert celsius_to_fahrenheit(2.0) == pytest.approx(35.6)

    def test_dewpoint_negative(self):
        assert celsius_to_fahrenheit(-3.0) == pytest.approx(26.6)


class TestKnotsToMph:
    def test_zero(self):
        assert knots_to_mph(0) == 0.0

    def test_twelve_knots(self):
        assert knots_to_mph(12) == pytest.approx(13.81, abs=0.01)

    def test_eighteen_knots(self):
        assert knots_to_mph(18) == pytest.approx(20.71, abs=0.01)


class TestParseMetar:
    def test_full_observation(self):
        parsed = parse_metar(SAMPLE_METAR_OBS)

        assert parsed["station"] == "KJFK"
        assert parsed["obs_time"] == "2026-02-21T12:51:00Z"
        assert parsed["temp_f"] == pytest.approx(35.6, abs=0.1)
        assert parsed["dewp_f"] == pytest.approx(26.6, abs=0.1)
        assert parsed["wind_dir"] == 300
        assert parsed["wind_speed_mph"] == pytest.approx(13.8, abs=0.1)
        assert parsed["wind_gust_mph"] == pytest.approx(20.7, abs=0.1)
        assert parsed["cloud_cover"] == 0.45
        assert parsed["visibility_miles"] == 10
        assert parsed["pressure_hpa"] == 1022.5
        assert "KJFK" in parsed["raw"]

    def test_no_gust(self):
        parsed = parse_metar(SAMPLE_METAR_OBS_NO_GUST)

        assert parsed["station"] == "KORD"
        assert parsed["wind_gust_mph"] is None
        assert parsed["cloud_cover"] == 1.0  # OVC

    def test_clear_sky(self):
        obs = {**SAMPLE_METAR_OBS, "sky": [{"cover": "CLR", "base": None}]}
        parsed = parse_metar(obs)
        assert parsed["cloud_cover"] == 0.0

    def test_few_sky(self):
        obs = {**SAMPLE_METAR_OBS, "sky": [{"cover": "FEW", "base": 5000}]}
        parsed = parse_metar(obs)
        assert parsed["cloud_cover"] == 0.2

    def test_broken_sky(self):
        obs = {**SAMPLE_METAR_OBS, "sky": [{"cover": "BKN", "base": 3000}]}
        parsed = parse_metar(obs)
        assert parsed["cloud_cover"] == 0.75

    def test_multiple_layers_takes_max(self):
        obs = {
            **SAMPLE_METAR_OBS,
            "sky": [
                {"cover": "FEW", "base": 5000},
                {"cover": "SCT", "base": 8000},
                {"cover": "BKN", "base": 12000},
            ],
        }
        parsed = parse_metar(obs)
        assert parsed["cloud_cover"] == 0.75

    def test_empty_sky_list(self):
        obs = {**SAMPLE_METAR_OBS, "sky": []}
        parsed = parse_metar(obs)
        assert parsed["cloud_cover"] == 0.0

    def test_null_temp(self):
        obs = {**SAMPLE_METAR_OBS, "temp": None, "dewp": None}
        parsed = parse_metar(obs)
        assert parsed["temp_f"] is None
        assert parsed["dewp_f"] is None

    def test_null_wind(self):
        obs = {**SAMPLE_METAR_OBS, "wspd": None}
        parsed = parse_metar(obs)
        assert parsed["wind_speed_mph"] is None


class TestFetchMetar:
    @patch("pavlov.weather.metar.requests.get")
    def test_successful_fetch(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [SAMPLE_METAR_OBS]
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = fetch_metar(["KJFK"])
        assert len(result) == 1
        assert result[0]["icaoId"] == "KJFK"

    @patch("pavlov.weather.metar.requests.get")
    def test_timeout_returns_empty(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.Timeout("timed out")

        result = fetch_metar(["KJFK"])
        assert result == []

    @patch("pavlov.weather.metar.requests.get")
    def test_http_error_returns_empty(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.HTTPError("500")

        result = fetch_metar(["KJFK"])
        assert result == []

    def test_empty_station_list(self):
        result = fetch_metar([])
        assert result == []


class TestGetMorningSnapshot:
    @patch("pavlov.weather.metar.fetch_metar")
    def test_groups_by_city(self, mock_fetch):
        mock_fetch.return_value = [
            SAMPLE_METAR_OBS,
            SAMPLE_METAR_OBS_NO_GUST,
        ]
        cities = [
            {"id": "NYC", "metar_station": "KJFK"},
            {"id": "Chicago", "metar_station": "KORD"},
        ]

        result = get_morning_snapshot(cities)

        assert "NYC" in result
        assert "Chicago" in result
        assert result["NYC"]["station"] == "KJFK"
        assert result["Chicago"]["station"] == "KORD"

    @patch("pavlov.weather.metar.fetch_metar")
    def test_takes_most_recent(self, mock_fetch):
        older = {**SAMPLE_METAR_OBS, "reportTime": "2026-02-21T11:00:00Z", "temp": 0.0}
        newer = {**SAMPLE_METAR_OBS, "reportTime": "2026-02-21T12:51:00Z", "temp": 2.0}
        mock_fetch.return_value = [older, newer]

        cities = [{"id": "NYC", "metar_station": "KJFK"}]
        result = get_morning_snapshot(cities)

        assert result["NYC"]["temp_f"] == pytest.approx(35.6, abs=0.1)

    @patch("pavlov.weather.metar.fetch_metar")
    def test_empty_on_failure(self, mock_fetch):
        mock_fetch.return_value = []
        cities = [{"id": "NYC", "metar_station": "KJFK"}]
        result = get_morning_snapshot(cities)
        assert result == {}


# ---------------------------------------------------------------------------
# NWS tests
# ---------------------------------------------------------------------------

class TestGetGridMetadata:
    @patch("pavlov.weather.nws._nws_get")
    def test_returns_grid_info(self, mock_get):
        mock_get.return_value = SAMPLE_NWS_POINTS_RESPONSE
        # Clear cache before test
        _grid_cache.clear()

        result = get_grid_metadata(40.7128, -74.006)

        assert result["office"] == "OKX"
        assert result["gridX"] == 33
        assert result["gridY"] == 37

    @patch("pavlov.weather.nws._nws_get")
    def test_caches_result(self, mock_get):
        mock_get.return_value = SAMPLE_NWS_POINTS_RESPONSE
        _grid_cache.clear()

        # First call
        result1 = get_grid_metadata(40.7128, -74.006)
        # Second call should use cache
        result2 = get_grid_metadata(40.7128, -74.006)

        assert result1 == result2
        # Should only have been called once
        mock_get.assert_called_once()

    @patch("pavlov.weather.nws._nws_get")
    def test_returns_none_on_failure(self, mock_get):
        mock_get.return_value = None
        _grid_cache.clear()

        result = get_grid_metadata(40.7128, -74.006)
        assert result is None


class TestGetForecast:
    @patch("pavlov.weather.nws._nws_get")
    def test_returns_forecast(self, mock_nws_get):
        _grid_cache.clear()

        # First call is for /points, second is for /forecast
        mock_nws_get.side_effect = [
            SAMPLE_NWS_POINTS_RESPONSE,
            SAMPLE_NWS_FORECAST_RESPONSE,
        ]

        result = get_forecast(40.7128, -74.006)

        assert result is not None
        assert result["office"] == "OKX"
        assert result["forecast_high_f"] == 42
        assert result["short_forecast"] == "Mostly Sunny"
        assert "10 to 15 mph" in result["wind"]

    @patch("pavlov.weather.nws._nws_get")
    def test_returns_none_on_api_failure(self, mock_nws_get):
        _grid_cache.clear()
        mock_nws_get.return_value = None

        result = get_forecast(40.7128, -74.006)
        assert result is None

    @patch("pavlov.weather.nws._nws_get")
    def test_no_periods(self, mock_nws_get):
        _grid_cache.clear()
        mock_nws_get.side_effect = [
            SAMPLE_NWS_POINTS_RESPONSE,
            {"properties": {"periods": []}},
        ]

        result = get_forecast(40.7128, -74.006)
        assert result is None


class TestGetHourlyPeak:
    @patch("pavlov.weather.nws._nws_get")
    @patch("pavlov.weather.nws.date")
    def test_finds_peak(self, mock_date, mock_nws_get):
        _grid_cache.clear()
        mock_date.today.return_value.isoformat.return_value = "2026-02-21"

        mock_nws_get.side_effect = [
            SAMPLE_NWS_POINTS_RESPONSE,
            SAMPLE_NWS_HOURLY_RESPONSE,
        ]

        result = get_hourly_peak(40.7128, -74.006)

        assert result is not None
        assert result["hourly_peak_f"] == 43
        assert result["hourly_peak_hour"] == 14

    @patch("pavlov.weather.nws._nws_get")
    @patch("pavlov.weather.nws.date")
    def test_excludes_other_days(self, mock_date, mock_nws_get):
        _grid_cache.clear()
        mock_date.today.return_value.isoformat.return_value = "2026-02-21"

        mock_nws_get.side_effect = [
            SAMPLE_NWS_POINTS_RESPONSE,
            SAMPLE_NWS_HOURLY_RESPONSE,
        ]

        result = get_hourly_peak(40.7128, -74.006)

        # The 50F temp from 2026-02-22 should NOT be the peak
        assert result["hourly_peak_f"] == 43


class TestGetAfd:
    @patch("pavlov.weather.nws._nws_get")
    def test_extracts_short_term(self, mock_nws_get):
        mock_nws_get.side_effect = [
            SAMPLE_NWS_AFD_LIST_RESPONSE,
            SAMPLE_NWS_AFD_PRODUCT_RESPONSE,
        ]

        result = get_afd("OKX")

        assert result is not None
        assert "High temperatures" in result or "temp" in result.lower()

    @patch("pavlov.weather.nws._nws_get")
    def test_returns_none_on_no_products(self, mock_nws_get):
        mock_nws_get.return_value = {"@graph": []}

        result = get_afd("OKX")
        assert result is None

    @patch("pavlov.weather.nws._nws_get")
    def test_returns_none_on_failure(self, mock_nws_get):
        mock_nws_get.return_value = None

        result = get_afd("OKX")
        assert result is None


# ---------------------------------------------------------------------------
# Open-Meteo tests
# ---------------------------------------------------------------------------

class TestParseToday:
    def test_extracts_daily_values(self):
        result = parse_today(SAMPLE_OPEN_METEO_RESPONSE)

        assert result is not None
        assert result["forecast_high_f"] == 41.0
        assert result["forecast_low_f"] == 28.0
        assert result["precip_prob_pct"] == 0
        assert result["wind_max_mph"] == 18.5

    def test_cloud_cover_average(self):
        result = parse_today(SAMPLE_OPEN_METEO_RESPONSE)

        # All 24 hourly values are 35 for today
        assert result["cloud_cover_pct"] == 35.0

    def test_empty_daily(self):
        data = {"daily": {}, "hourly": {}}
        result = parse_today(data)
        assert result is None

    def test_missing_optional_fields(self):
        data = {
            "daily": {
                "temperature_2m_max": [55.0],
                "temperature_2m_min": [],
                "precipitation_probability_max": [],
                "wind_speed_10m_max": [],
            },
            "hourly": {},
        }
        result = parse_today(data)

        assert result is not None
        assert result["forecast_high_f"] == 55.0
        assert result["forecast_low_f"] is None
        assert result["precip_prob_pct"] is None
        assert result["wind_max_mph"] is None


class TestFetchOpenMeteo:
    @patch("pavlov.weather.openmeteo.requests.get")
    def test_successful_fetch(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = SAMPLE_OPEN_METEO_RESPONSE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        city = {
            "id": "NYC",
            "latitude": 40.7128,
            "longitude": -74.006,
            "timezone": "America/New_York",
        }
        result = fetch_open_meteo(city)

        assert result is not None
        assert "daily" in result

    @patch("pavlov.weather.openmeteo.requests.get")
    def test_timeout_returns_none(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.Timeout("timed out")

        city = {"id": "NYC", "latitude": 40.7128, "longitude": -74.006}
        result = fetch_open_meteo(city)
        assert result is None

    def test_missing_coords(self):
        result = fetch_open_meteo({"id": "bad"})
        assert result is None


# ---------------------------------------------------------------------------
# Consensus tests
# ---------------------------------------------------------------------------

class TestComputeConsensus:
    def test_all_sources_agree(self):
        nws = {"forecast_high_f": 42, "hourly_peak_f": 43}
        om = {"forecast_high_f": 41.0}

        result = compute_consensus(None, nws, om)

        assert result["mean_high_f"] == pytest.approx(42.0, abs=0.1)
        assert result["std_high_f"] is not None
        assert result["sources_agree"] is True

    def test_sources_disagree(self):
        nws = {"forecast_high_f": 42, "hourly_peak_f": 43}
        om = {"forecast_high_f": 55.0}  # Way off

        result = compute_consensus(None, nws, om)

        assert result["sources_agree"] is False
        assert result["std_high_f"] > 3.0

    def test_no_data(self):
        result = compute_consensus(None, None, None)

        assert result["mean_high_f"] is None
        assert result["std_high_f"] is None
        assert result["sources_agree"] is False

    def test_single_source(self):
        nws = {"forecast_high_f": 42, "hourly_peak_f": None}
        result = compute_consensus(None, nws, None)

        assert result["mean_high_f"] == 42.0
        assert result["std_high_f"] == 0.0
        assert result["sources_agree"] is True

    def test_two_sources_close(self):
        nws = {"forecast_high_f": 40, "hourly_peak_f": None}
        om = {"forecast_high_f": 41.0}

        result = compute_consensus(None, nws, om)

        assert result["mean_high_f"] == pytest.approx(40.5, abs=0.1)
        assert result["sources_agree"] is True


# ---------------------------------------------------------------------------
# Historical average tests
# ---------------------------------------------------------------------------

class TestGetHistoricalAvg:
    @patch("pavlov.weather.collect.date")
    def test_february(self, mock_date):
        mock_date.today.return_value.month = 2
        city = {
            "historical_avg_high": {
                "jan": 39, "feb": 42, "mar": 50, "apr": 61,
                "may": 72, "jun": 80, "jul": 85, "aug": 84,
                "sep": 76, "oct": 65, "nov": 54, "dec": 43,
            }
        }
        result = _get_historical_avg(city)
        assert result["avg_high_f"] == 42
        assert result["month"] == 2

    @patch("pavlov.weather.collect.date")
    def test_missing_historical(self, mock_date):
        mock_date.today.return_value.month = 7
        city = {}
        result = _get_historical_avg(city)
        assert result["avg_high_f"] is None
        assert result["month"] == 7
