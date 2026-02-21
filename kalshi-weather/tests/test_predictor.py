"""Tests for LLM prediction engine and prompt generation."""

from __future__ import annotations

import json

import pytest

from pavlov.predictor.models import WeatherInput, WeatherPrediction
from pavlov.predictor.prompts import (
    FEW_SHOT_EXAMPLES,
    SYSTEM_PROMPT,
    build_user_prompt,
)
from pavlov.predictor.engine import (
    format_weather_for_prediction,
    parse_prediction_response,
    validate_prediction,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_weather_input() -> WeatherInput:
    """Fully populated WeatherInput for testing."""
    return WeatherInput(
        city_id="NYC",
        city_name="New York City",
        date="2026-02-21",
        kalshi_brackets=["35-38", "39-42", "43-46", "47-50"],
        contract_prices={"35-38": 0.18, "39-42": 0.39, "43-46": 0.28, "47-50": 0.08},
        metar_temp_f=34.0,
        metar_dewp_f=28.0,
        metar_wind_speed_mph=13.8,
        metar_wind_dir=300,
        metar_cloud_cover=0.45,
        metar_raw="KJFK 211251Z 30012KT 10SM SCT035 01/M03 A3015",
        nws_forecast_high_f=42.0,
        nws_hourly_peak_f=43.0,
        nws_detailed_forecast="Mostly sunny, with a high near 42.",
        nws_afd_excerpt="Temps expected to peak near 42.",
        open_meteo_high_f=41.0,
        consensus_mean_f=42.0,
        consensus_std_f=1.0,
        historical_avg_f=42.0,
    )


@pytest.fixture
def sample_collected_data() -> dict:
    """Dict matching the output format of collect_city()."""
    return {
        "city_id": "NYC",
        "city_name": "New York City",
        "date": "2026-02-21",
        "collection_time": "2026-02-21T12:35:00+00:00",
        "metar": {
            "station": "KJFK",
            "obs_time": "2026-02-21T12:51:00Z",
            "temp_f": 34.0,
            "dewp_f": 27.0,
            "wind_dir": 300,
            "wind_speed_mph": 13.8,
            "cloud_cover": 0.45,
            "visibility_miles": 10,
            "pressure_hpa": 1022.5,
            "raw": "KJFK 211251Z 30012KT 10SM SCT035 01/M03 A3015",
        },
        "nws": {
            "office": "OKX",
            "forecast_high_f": 42,
            "hourly_peak_f": 43,
            "hourly_peak_hour": 14,
            "short_forecast": "Mostly Sunny",
            "detailed_forecast": "Mostly sunny, with a high near 42.",
            "wind": "NW 10 to 15 mph",
            "afd_excerpt": "Temps expected to peak near 42.",
        },
        "open_meteo": {
            "forecast_high_f": 41.0,
            "forecast_low_f": 28.0,
            "cloud_cover_pct": 35,
            "precip_prob_pct": 0,
            "wind_max_mph": 18.5,
        },
        "consensus": {
            "mean_high_f": 42.0,
            "std_high_f": 1.0,
            "sources_agree": True,
        },
        "historical": {
            "avg_high_f": 42,
            "month": 2,
        },
    }


@pytest.fixture
def sample_llm_response() -> str:
    """Realistic LLM response with chain-of-thought and JSON block."""
    return (
        "REASONING:\n"
        "\n"
        "Step 1 -- Data sources:\n"
        "- METAR current: 34F\n"
        "- NWS forecast high: 42F\n"
        "- NWS hourly peak: 43F\n"
        "- Open-Meteo: 41F\n"
        "- Consensus mean: 42F\n"
        "\n"
        "Step 2 -- Agreement:\n"
        "All sources within 2F, strong agreement.\n"
        "\n"
        "Step 3 -- Uncertainty:\n"
        "No major factors.\n"
        "\n"
        "Step 4 -- Brackets:\n"
        "  39-42: ~48%\n"
        "  43-46: ~32%\n"
        "  35-38: ~12%\n"
        "\n"
        "Step 5 -- Selection:\n"
        "39-42 is the primary bracket. 43-46 is adjacent.\n"
        "\n"
        "```json\n"
        "{\n"
        '  "predicted_high_f": 42.0,\n'
        '  "confidence": 0.72,\n'
        '  "recommended_bracket": "39-42",\n'
        '  "bracket_probability": 0.48,\n'
        '  "adjacent_bracket": "43-46",\n'
        '  "adjacent_probability": 0.32,\n'
        '  "reasoning_summary": "Strong source agreement around 41-43F. '
        '39-42 bracket is primary with modest edge.",\n'
        '  "data_sources_used": ["KJFK METAR", "NWS OKX", "Open-Meteo", "climatology"],\n'
        '  "uncertainty_flags": []\n'
        "}\n"
        "```"
    )


@pytest.fixture
def valid_config() -> dict:
    """Minimal config dict with risk section."""
    return {
        "risk": {
            "min_confidence": 0.55,
            "min_edge": 0.02,
        }
    }


# ===================================================================
# WeatherInput / WeatherPrediction construction tests
# ===================================================================

class TestModels:
    """Test dataclass construction and defaults."""

    def test_weather_input_full(self, sample_weather_input: WeatherInput):
        """Fully populated WeatherInput stores all fields."""
        wi = sample_weather_input
        assert wi.city_id == "NYC"
        assert wi.date == "2026-02-21"
        assert wi.metar_temp_f == 34.0
        assert wi.consensus_mean_f == 42.0
        assert len(wi.kalshi_brackets) == 4
        assert wi.contract_prices["39-42"] == 0.39

    def test_weather_input_minimal(self):
        """WeatherInput with only required fields uses None defaults."""
        wi = WeatherInput(city_id="MIA", city_name="Miami", date="2026-03-01")
        assert wi.metar_temp_f is None
        assert wi.nws_forecast_high_f is None
        assert wi.open_meteo_high_f is None
        assert wi.kalshi_brackets == []
        assert wi.contract_prices == {}

    def test_weather_prediction_construction(self):
        """WeatherPrediction stores all prediction fields."""
        pred = WeatherPrediction(
            city_id="NYC",
            date="2026-02-21",
            predicted_high_f=42.0,
            confidence=0.72,
            recommended_bracket="39-42",
            bracket_probability=0.48,
            adjacent_bracket="43-46",
            adjacent_probability=0.32,
            reasoning_summary="Sources agree.",
            uncertainty_flags=[],
            data_sources_used=["METAR", "NWS"],
            full_reasoning="Step 1...",
            raw_response="full text here",
        )
        assert pred.predicted_high_f == 42.0
        assert pred.confidence == 0.72
        assert pred.recommended_bracket == "39-42"
        assert pred.adjacent_bracket == "43-46"
        assert pred.reasoning_summary == "Sources agree."

    def test_weather_prediction_defaults(self):
        """WeatherPrediction list/string fields default correctly."""
        pred = WeatherPrediction(
            city_id="CHI",
            date="2026-03-01",
            predicted_high_f=38.0,
            confidence=0.60,
            recommended_bracket="36-39",
            bracket_probability=0.40,
            adjacent_bracket="40-43",
            adjacent_probability=0.25,
            reasoning_summary="Moderate confidence.",
        )
        assert pred.uncertainty_flags == []
        assert pred.data_sources_used == []
        assert pred.full_reasoning == ""
        assert pred.raw_response == ""


# ===================================================================
# Prompt builder tests
# ===================================================================

class TestPrompts:
    """Test prompt template constants and build_user_prompt."""

    def test_system_prompt_nonempty(self):
        """System prompt exists and contains calibration language."""
        assert len(SYSTEM_PROMPT) > 200
        assert "calibrated" in SYSTEM_PROMPT.lower()
        assert "Brier score" in SYSTEM_PROMPT
        assert "REASONING PROCESS" in SYSTEM_PROMPT

    def test_few_shot_examples_structure(self):
        """Few-shot examples are user/assistant pairs."""
        assert len(FEW_SHOT_EXAMPLES) == 4  # 2 user + 2 assistant
        assert FEW_SHOT_EXAMPLES[0]["role"] == "user"
        assert FEW_SHOT_EXAMPLES[1]["role"] == "assistant"
        assert FEW_SHOT_EXAMPLES[2]["role"] == "user"
        assert FEW_SHOT_EXAMPLES[3]["role"] == "assistant"

    def test_few_shot_correct_example_has_json(self):
        """The well-calibrated example contains a JSON block."""
        assistant_text = FEW_SHOT_EXAMPLES[1]["content"]
        assert "```json" in assistant_text
        assert '"confidence"' in assistant_text

    def test_few_shot_overconfident_example_warns(self):
        """The overconfident example flags bad behaviour."""
        user_text = FEW_SHOT_EXAMPLES[2]["content"]
        assert "OVERCONFIDENT" in user_text
        assistant_text = FEW_SHOT_EXAMPLES[3]["content"]
        assert "WHY THIS IS WRONG" in assistant_text

    def test_build_user_prompt_all_sections(self, sample_weather_input: WeatherInput):
        """Prompt includes all expected sections when data is present."""
        prompt = build_user_prompt(sample_weather_input)

        assert "New York City" in prompt
        assert "TARGET DATE: 2026-02-21" in prompt
        assert "AVAILABLE BRACKETS:" in prompt
        assert "CONTRACT PRICES:" in prompt
        assert "METAR" in prompt
        assert "34.0F" in prompt
        assert "NWS FORECAST:" in prompt
        assert "42.0F" in prompt
        assert "OPEN-METEO:" in prompt
        assert "41.0F" in prompt
        assert "CONSENSUS:" in prompt
        assert "HISTORICAL AVG" in prompt
        assert "JSON prediction block" in prompt

    def test_build_user_prompt_minimal(self):
        """Prompt gracefully omits sections when data is missing."""
        wi = WeatherInput(city_id="MIA", city_name="Miami", date="2026-03-01")
        prompt = build_user_prompt(wi)

        assert "Miami" in prompt
        assert "TARGET DATE: 2026-03-01" in prompt
        # Missing sections should NOT appear
        assert "METAR" not in prompt
        assert "NWS FORECAST:" not in prompt
        assert "OPEN-METEO:" not in prompt
        assert "CONSENSUS:" not in prompt
        assert "HISTORICAL AVG" not in prompt
        # Closing instruction always present
        assert "JSON prediction block" in prompt

    def test_build_user_prompt_partial_data(self):
        """Prompt includes only the sections with data."""
        wi = WeatherInput(
            city_id="CHI",
            city_name="Chicago",
            date="2026-01-15",
            nws_forecast_high_f=37.0,
            historical_avg_f=31.0,
        )
        prompt = build_user_prompt(wi)

        assert "NWS FORECAST:" in prompt
        assert "37.0F" in prompt
        assert "HISTORICAL AVG" in prompt
        assert "31.0F" in prompt
        # No METAR or Open-Meteo
        assert "METAR" not in prompt
        assert "OPEN-METEO:" not in prompt

    def test_build_user_prompt_contract_prices_json(self, sample_weather_input: WeatherInput):
        """Contract prices are serialised as valid JSON."""
        prompt = build_user_prompt(sample_weather_input)
        # Find the CONTRACT PRICES line and parse the JSON portion
        for line in prompt.split("\n"):
            if line.startswith("CONTRACT PRICES:"):
                json_part = line.split("CONTRACT PRICES: ", 1)[1]
                prices = json.loads(json_part)
                assert prices["39-42"] == 0.39
                break
        else:
            pytest.fail("CONTRACT PRICES line not found in prompt")


# ===================================================================
# Response parser tests
# ===================================================================

class TestParser:
    """Test parse_prediction_response."""

    def test_parse_valid_response(self, sample_llm_response: str):
        """Successfully parse a well-formed LLM response."""
        pred = parse_prediction_response(sample_llm_response, "NYC", "2026-02-21")

        assert pred.city_id == "NYC"
        assert pred.date == "2026-02-21"
        assert pred.predicted_high_f == 42.0
        assert pred.confidence == 0.72
        assert pred.recommended_bracket == "39-42"
        assert pred.bracket_probability == 0.48
        assert pred.adjacent_bracket == "43-46"
        assert pred.adjacent_probability == 0.32
        assert "METAR" in pred.data_sources_used[0]
        assert pred.uncertainty_flags == []
        assert len(pred.full_reasoning) > 0
        assert pred.raw_response == sample_llm_response

    def test_parse_extracts_chain_of_thought(self, sample_llm_response: str):
        """Chain-of-thought is everything before the JSON block."""
        pred = parse_prediction_response(sample_llm_response, "NYC", "2026-02-21")
        assert "REASONING:" in pred.full_reasoning
        assert "Step 1" in pred.full_reasoning
        # JSON block should NOT be in full_reasoning
        assert "```json" not in pred.full_reasoning

    def test_confidence_clamping_above_one(self):
        """Confidence > 1.0 is clamped to 0.99."""
        response = (
            "Some reasoning.\n"
            "```json\n"
            "{\n"
            '  "predicted_high_f": 40.0,\n'
            '  "confidence": 1.5,\n'
            '  "recommended_bracket": "39-42",\n'
            '  "bracket_probability": 0.50,\n'
            '  "adjacent_bracket": "43-46",\n'
            '  "adjacent_probability": 0.30,\n'
            '  "reasoning_summary": "test",\n'
            '  "data_sources_used": [],\n'
            '  "uncertainty_flags": []\n'
            "}\n"
            "```"
        )
        pred = parse_prediction_response(response, "NYC", "2026-02-21")
        assert pred.confidence == 0.99

    def test_confidence_clamping_exactly_one(self):
        """Confidence == 1.0 is not clamped (it is within [0, 1])."""
        response = (
            "Reasoning.\n"
            "```json\n"
            "{\n"
            '  "predicted_high_f": 40.0,\n'
            '  "confidence": 1.0,\n'
            '  "recommended_bracket": "39-42",\n'
            '  "bracket_probability": 0.50,\n'
            '  "adjacent_bracket": "43-46",\n'
            '  "adjacent_probability": 0.30,\n'
            '  "reasoning_summary": "test",\n'
            '  "data_sources_used": [],\n'
            '  "uncertainty_flags": []\n'
            "}\n"
            "```"
        )
        pred = parse_prediction_response(response, "NYC", "2026-02-21")
        # 1.0 is valid; not clamped down
        assert pred.confidence == 1.0

    def test_confidence_clamping_negative(self):
        """Negative confidence is clamped to 0.0."""
        response = (
            "Reasoning.\n"
            "```json\n"
            "{\n"
            '  "predicted_high_f": 40.0,\n'
            '  "confidence": -0.5,\n'
            '  "recommended_bracket": "39-42",\n'
            '  "bracket_probability": 0.50,\n'
            '  "adjacent_bracket": "43-46",\n'
            '  "adjacent_probability": 0.30,\n'
            '  "reasoning_summary": "test",\n'
            '  "data_sources_used": [],\n'
            '  "uncertainty_flags": []\n'
            "}\n"
            "```"
        )
        pred = parse_prediction_response(response, "NYC", "2026-02-21")
        assert pred.confidence == 0.0

    def test_missing_json_block_raises(self):
        """ValueError when the response has no JSON fence."""
        with pytest.raises(ValueError, match="did not contain"):
            parse_prediction_response("Just plain text.", "NYC", "2026-02-21")

    def test_malformed_json_raises(self):
        """ValueError when JSON is syntactically broken."""
        bad = "Some text.\n```json\n{bad json}\n```"
        with pytest.raises(ValueError, match="Failed to parse JSON"):
            parse_prediction_response(bad, "NYC", "2026-02-21")

    def test_missing_required_keys_raises(self):
        """ValueError when required JSON keys are absent."""
        incomplete = (
            "Reasoning.\n"
            "```json\n"
            '{"predicted_high_f": 40.0, "confidence": 0.7}\n'
            "```"
        )
        with pytest.raises(ValueError, match="missing required keys"):
            parse_prediction_response(incomplete, "NYC", "2026-02-21")


# ===================================================================
# format_weather_for_prediction tests
# ===================================================================

class TestFormatWeather:
    """Test conversion from collect.py output dict to WeatherInput."""

    def test_full_collected_data(self, sample_collected_data: dict):
        """All fields are mapped correctly from collected dict."""
        wi = format_weather_for_prediction(
            sample_collected_data,
            kalshi_brackets=["39-42", "43-46"],
            contract_prices={"39-42": 0.39, "43-46": 0.28},
        )

        assert wi.city_id == "NYC"
        assert wi.city_name == "New York City"
        assert wi.date == "2026-02-21"
        assert wi.metar_temp_f == 34.0
        assert wi.metar_dewp_f == 27.0
        assert wi.metar_wind_speed_mph == 13.8
        assert wi.metar_wind_dir == 300
        assert wi.metar_cloud_cover == 0.45
        assert "KJFK" in wi.metar_raw
        assert wi.nws_forecast_high_f == 42
        assert wi.nws_hourly_peak_f == 43
        assert "sunny" in wi.nws_detailed_forecast.lower()
        assert wi.nws_afd_excerpt is not None
        assert wi.open_meteo_high_f == 41.0
        assert wi.consensus_mean_f == 42.0
        assert wi.consensus_std_f == 1.0
        assert wi.historical_avg_f == 42
        assert wi.kalshi_brackets == ["39-42", "43-46"]
        assert wi.contract_prices["39-42"] == 0.39

    def test_missing_metar(self, sample_collected_data: dict):
        """Handles missing METAR gracefully."""
        sample_collected_data["metar"] = None
        wi = format_weather_for_prediction(sample_collected_data)
        assert wi.metar_temp_f is None
        assert wi.metar_raw is None

    def test_missing_nws(self, sample_collected_data: dict):
        """Handles missing NWS data gracefully."""
        sample_collected_data["nws"] = None
        wi = format_weather_for_prediction(sample_collected_data)
        assert wi.nws_forecast_high_f is None
        assert wi.nws_detailed_forecast is None

    def test_auto_generated_brackets(self, sample_collected_data: dict):
        """Brackets are auto-generated from consensus mean when not provided."""
        wi = format_weather_for_prediction(sample_collected_data)
        # Consensus mean is 42.0, so brackets should centre around there
        assert len(wi.kalshi_brackets) > 0
        # The centre bracket should contain 42
        bracket_values = []
        for b in wi.kalshi_brackets:
            lo, hi = b.split("-")
            bracket_values.append((int(lo), int(hi)))
        # At least one bracket should span the consensus mean
        found = any(lo <= 42 <= hi for lo, hi in bracket_values)
        assert found, f"No bracket contains 42: {wi.kalshi_brackets}"

    def test_no_consensus_no_brackets(self, sample_collected_data: dict):
        """Empty brackets when no consensus mean and no explicit brackets."""
        sample_collected_data["consensus"] = {"mean_high_f": None}
        wi = format_weather_for_prediction(sample_collected_data)
        assert wi.kalshi_brackets == []


# ===================================================================
# Validation tests
# ===================================================================

class TestValidation:
    """Test validate_prediction."""

    def _make_prediction(self, **overrides) -> WeatherPrediction:
        """Helper to create a valid prediction with optional overrides."""
        defaults = dict(
            city_id="NYC",
            date="2026-02-21",
            predicted_high_f=42.0,
            confidence=0.72,
            recommended_bracket="39-42",
            bracket_probability=0.48,
            adjacent_bracket="43-46",
            adjacent_probability=0.32,
            reasoning_summary="Test.",
        )
        defaults.update(overrides)
        return WeatherPrediction(**defaults)

    def test_valid_prediction_passes(self, valid_config: dict):
        """A well-formed prediction passes validation."""
        pred = self._make_prediction()
        assert validate_prediction(pred, valid_config) is True

    def test_low_confidence_rejected(self, valid_config: dict):
        """Prediction below min_confidence is rejected."""
        pred = self._make_prediction(confidence=0.40)
        assert validate_prediction(pred, valid_config) is False

    def test_exactly_min_confidence_passes(self, valid_config: dict):
        """Prediction at exactly min_confidence passes."""
        pred = self._make_prediction(confidence=0.55)
        assert validate_prediction(pred, valid_config) is True

    def test_invalid_bracket_format_rejected(self, valid_config: dict):
        """Bracket with wrong format is rejected."""
        pred = self._make_prediction(recommended_bracket="39 to 42")
        assert validate_prediction(pred, valid_config) is False

    def test_zero_bracket_probability_rejected(self, valid_config: dict):
        """Bracket probability of 0 is rejected."""
        pred = self._make_prediction(bracket_probability=0.0)
        assert validate_prediction(pred, valid_config) is False

    def test_negative_bracket_probability_rejected(self, valid_config: dict):
        """Negative bracket probability is rejected."""
        pred = self._make_prediction(bracket_probability=-0.1)
        assert validate_prediction(pred, valid_config) is False

    def test_missing_risk_section_uses_defaults(self):
        """Config without 'risk' section uses default min_confidence."""
        pred = self._make_prediction(confidence=0.60)
        # Default min_confidence is 0.55
        assert validate_prediction(pred, {}) is True

    def test_high_confidence_still_valid(self, valid_config: dict):
        """High confidence is allowed (validation doesn't cap it)."""
        pred = self._make_prediction(confidence=0.95)
        assert validate_prediction(pred, valid_config) is True


# ===================================================================
# Integration: collected data -> prompt round-trip
# ===================================================================

class TestRoundTrip:
    """End-to-end: collected data -> WeatherInput -> prompt -> parseable."""

    def test_collected_to_prompt(self, sample_collected_data: dict):
        """Collected data converts to WeatherInput and builds a valid prompt."""
        wi = format_weather_for_prediction(
            sample_collected_data,
            kalshi_brackets=["39-42", "43-46"],
            contract_prices={"39-42": 0.39, "43-46": 0.28},
        )
        prompt = build_user_prompt(wi)

        # The prompt should be a non-trivial string with expected content
        assert len(prompt) > 100
        assert "New York City" in prompt
        assert "39-42" in prompt
        assert "JSON prediction block" in prompt

    def test_parse_then_validate(self, sample_llm_response: str, valid_config: dict):
        """A parsed LLM response passes validation."""
        pred = parse_prediction_response(sample_llm_response, "NYC", "2026-02-21")
        assert validate_prediction(pred, valid_config) is True
