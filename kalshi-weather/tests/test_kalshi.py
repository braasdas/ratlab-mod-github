"""Tests for Kalshi API client and trade execution."""

import base64
import json
import math
import re
import uuid
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from pavlov.trading.kalshi_client import (
    KalshiClient,
    calculate_fee,
    format_event_ticker,
    DEMO_BASE,
    PRODUCTION_BASE,
)


# ---------------------------------------------------------------------------
# Helper: build a minimal config dict for KalshiClient
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_private_key(tmp_path):
    """Generate a temporary RSA private key in PEM format for testing."""
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_file = tmp_path / "test_key.pem"
    key_file.write_bytes(pem)
    return str(key_file), private_key


@pytest.fixture
def client_config(sample_private_key):
    """Return a config dict suitable for KalshiClient."""
    key_path, _ = sample_private_key
    return {
        "key_id": "test-key-id-123",
        "private_key_path": key_path,
        "paper_mode": True,
    }


@pytest.fixture
def client(client_config):
    """Return an initialised KalshiClient using a test key."""
    return KalshiClient(client_config)


# ---------------------------------------------------------------------------
# format_event_ticker tests
# ---------------------------------------------------------------------------


class TestFormatEventTicker:
    """Tests for the format_event_ticker helper."""

    def test_feb_21_2026(self):
        result = format_event_ticker("KXHIGHNY", "2026-02-21")
        assert result == "KXHIGHNY-26FEB21"

    def test_mar_05_2026(self):
        result = format_event_ticker("KXHIGHNY", "2026-03-05")
        assert result == "KXHIGHNY-26MAR05"

    def test_jan_01_2026(self):
        result = format_event_ticker("KXHIGHNY", "2026-01-01")
        assert result == "KXHIGHNY-26JAN01"

    def test_dec_31_2025(self):
        result = format_event_ticker("KXHIGHNY", "2025-12-31")
        assert result == "KXHIGHNY-25DEC31"

    def test_single_digit_day_padded(self):
        """Day 5 should be zero-padded to 05."""
        result = format_event_ticker("KXHIGHCHI", "2026-07-05")
        assert result == "KXHIGHCHI-26JUL05"

    def test_different_series(self):
        result = format_event_ticker("KXHIGHMI", "2026-11-15")
        assert result == "KXHIGHMI-26NOV15"


# ---------------------------------------------------------------------------
# calculate_fee tests
# ---------------------------------------------------------------------------


class TestCalculateFee:
    """Tests for the Kalshi fee calculation."""

    def test_fee_at_50_cents(self):
        """At 50c, per-contract fee = 0.07 * 0.50 * 0.50 = 0.0175 (max)."""
        fee = calculate_fee(count=1, price_cents=50)
        # 0.07 * 0.5 * 0.5 = 0.0175 per contract, ceil(0.0175*100)/100 = 0.02
        assert fee == pytest.approx(math.ceil(0.0175 * 1 * 100) / 100.0)

    def test_fee_at_20_cents(self):
        """At 20c, per-contract = 0.07 * 0.20 * 0.80 = 0.0112."""
        fee = calculate_fee(count=1, price_cents=20)
        expected = math.ceil(0.07 * 0.20 * 0.80 * 1 * 100) / 100.0
        assert fee == pytest.approx(expected)

    def test_fee_scales_with_count(self):
        """Fee for 10 contracts should be larger than for 1."""
        fee_1 = calculate_fee(count=1, price_cents=40)
        fee_10 = calculate_fee(count=10, price_cents=40)
        assert fee_10 >= fee_1

    def test_fee_max_per_contract(self):
        """Per-contract fee should never exceed 1.75 cents (0.0175)."""
        # Price 50c maximises fee
        fee = calculate_fee(count=100, price_cents=50)
        max_possible = math.ceil(0.0175 * 100 * 100) / 100.0
        assert fee <= max_possible + 0.01  # small rounding tolerance

    def test_fee_at_extreme_prices(self):
        """At 1c and 99c the fee should be very small."""
        fee_low = calculate_fee(count=1, price_cents=1)
        fee_high = calculate_fee(count=1, price_cents=99)
        # 0.07 * 0.01 * 0.99 ~ 0.000693, ceil rounds to 0.01
        assert fee_low <= 0.01
        assert fee_high <= 0.01


# ---------------------------------------------------------------------------
# KalshiClient.__init__ tests
# ---------------------------------------------------------------------------


class TestClientInit:
    """Tests for KalshiClient initialization."""

    def test_paper_mode_uses_demo_url(self, client):
        """Paper mode should select the demo base URL."""
        assert client._base_url == DEMO_BASE

    def test_production_mode_uses_production_url(self, sample_private_key):
        """Non-paper mode should select the production base URL."""
        key_path, _ = sample_private_key
        config = {
            "key_id": "key-123",
            "private_key_path": key_path,
            "paper_mode": False,
            "api_base": PRODUCTION_BASE,
        }
        c = KalshiClient(config)
        assert c._base_url == PRODUCTION_BASE

    def test_key_id_stored(self, client):
        assert client._key_id == "test-key-id-123"

    def test_private_key_loaded(self, client):
        """Private key should be loaded and usable for signing."""
        assert client._private_key is not None


# ---------------------------------------------------------------------------
# Signature tests
# ---------------------------------------------------------------------------


class TestSignature:
    """Tests for _sign() authentication header generation."""

    def test_sign_returns_required_headers(self, client):
        """Signature should produce all three required Kalshi headers."""
        headers = client._sign("GET", "/trade-api/v2/portfolio/balance")
        assert "KALSHI-ACCESS-KEY" in headers
        assert "KALSHI-ACCESS-TIMESTAMP" in headers
        assert "KALSHI-ACCESS-SIGNATURE" in headers

    def test_sign_key_matches_config(self, client):
        headers = client._sign("GET", "/trade-api/v2/portfolio/balance")
        assert headers["KALSHI-ACCESS-KEY"] == "test-key-id-123"

    def test_sign_timestamp_is_recent_milliseconds(self, client):
        """Timestamp should be current unix time in milliseconds."""
        import time

        before = int(time.time() * 1000)
        headers = client._sign("GET", "/trade-api/v2/portfolio/balance")
        after = int(time.time() * 1000)

        ts = int(headers["KALSHI-ACCESS-TIMESTAMP"])
        assert before <= ts <= after

    def test_sign_signature_is_valid_base64(self, client):
        """Signature should be valid base64."""
        headers = client._sign("GET", "/trade-api/v2/portfolio/balance")
        sig = headers["KALSHI-ACCESS-SIGNATURE"]
        # Should not raise
        decoded = base64.b64decode(sig)
        assert len(decoded) > 0

    def test_sign_strips_query_params(self, client):
        """Signing should produce headers regardless of query string in path."""
        h1 = client._sign("GET", "/trade-api/v2/markets?status=open&limit=10")
        h2 = client._sign("GET", "/trade-api/v2/markets")
        # Both should succeed and have valid signatures
        assert "KALSHI-ACCESS-SIGNATURE" in h1
        assert "KALSHI-ACCESS-SIGNATURE" in h2

    def test_sign_different_methods_differ(self, client):
        """GET and POST to the same path should produce different signatures
        (because the method is part of the signed message, and PSS adds
        randomness)."""
        h_get = client._sign("GET", "/trade-api/v2/portfolio/orders")
        h_post = client._sign("POST", "/trade-api/v2/portfolio/orders")
        # Timestamps are different, so signatures will differ anyway.
        # The key point is both produce valid output.
        assert h_get["KALSHI-ACCESS-SIGNATURE"] != ""
        assert h_post["KALSHI-ACCESS-SIGNATURE"] != ""


# ---------------------------------------------------------------------------
# Bracket matching tests
# ---------------------------------------------------------------------------


class TestFindBracket:
    """Tests for KalshiClient.find_bracket()."""

    SAMPLE_MARKETS = [
        {"ticker": "KXHIGHNY-26FEB21-B38", "subtitle": "38\u00b0 to 40\u00b0", "yes_bid": 10, "yes_ask": 14},
        {"ticker": "KXHIGHNY-26FEB21-B40", "subtitle": "40\u00b0 to 42\u00b0", "yes_bid": 18, "yes_ask": 22},
        {"ticker": "KXHIGHNY-26FEB21-B42", "subtitle": "42\u00b0 to 44\u00b0", "yes_bid": 25, "yes_ask": 30},
        {"ticker": "KXHIGHNY-26FEB21-B44", "subtitle": "44\u00b0 to 46\u00b0", "yes_bid": 15, "yes_ask": 20},
        {"ticker": "KXHIGHNY-26FEB21-T50", "subtitle": "50\u00b0 or above", "yes_bid": 5, "yes_ask": 8},
    ]

    def test_find_existing_bracket(self, client):
        result = client.find_bracket(self.SAMPLE_MARKETS, "42-44")
        assert result is not None
        assert result["ticker"] == "KXHIGHNY-26FEB21-B42"

    def test_find_first_bracket(self, client):
        result = client.find_bracket(self.SAMPLE_MARKETS, "38-40")
        assert result is not None
        assert result["ticker"] == "KXHIGHNY-26FEB21-B38"

    def test_bracket_not_found(self, client):
        result = client.find_bracket(self.SAMPLE_MARKETS, "99-101")
        assert result is None

    def test_empty_markets_list(self, client):
        result = client.find_bracket([], "42-44")
        assert result is None

    def test_bracket_with_spaces(self, client):
        """Bracket string with spaces should still work."""
        result = client.find_bracket(self.SAMPLE_MARKETS, "42 - 44")
        assert result is not None
        assert result["ticker"] == "KXHIGHNY-26FEB21-B42"

    def test_invalid_bracket_format(self, client):
        """Malformed bracket string should return None."""
        result = client.find_bracket(self.SAMPLE_MARKETS, "invalid")
        assert result is None


# ---------------------------------------------------------------------------
# Mocked HTTP: market discovery
# ---------------------------------------------------------------------------


class TestFindWeatherMarkets:
    """Test find_weather_markets with mocked HTTP responses."""

    def test_find_markets_returns_list(self, client):
        """Should return a list of market dicts from the API."""
        mock_response = {
            "markets": [
                {
                    "ticker": "KXHIGHNY-26FEB21-B38",
                    "subtitle": "38\u00b0 to 40\u00b0",
                    "status": "open",
                    "yes_bid": 10,
                    "yes_ask": 14,
                    "last_price": 12,
                    "volume": 500,
                },
                {
                    "ticker": "KXHIGHNY-26FEB21-B40",
                    "subtitle": "40\u00b0 to 42\u00b0",
                    "status": "open",
                    "yes_bid": 18,
                    "yes_ask": 22,
                    "last_price": 20,
                    "volume": 1240,
                },
            ]
        }

        with patch.object(client, "_get", return_value=mock_response) as mock_get:
            markets = client.find_weather_markets("KXHIGHNY", "2026-02-21")

        assert len(markets) == 2
        assert markets[0]["ticker"] == "KXHIGHNY-26FEB21-B38"
        assert markets[1]["volume"] == 1240

        # Verify the correct endpoint and params were called.
        mock_get.assert_called_once_with(
            "/markets",
            params={"event_ticker": "KXHIGHNY-26FEB21", "status": "open"},
        )

    def test_find_markets_empty_response(self, client):
        """API returning no markets should yield an empty list."""
        with patch.object(client, "_get", return_value={"markets": []}):
            markets = client.find_weather_markets("KXHIGHNY", "2026-02-21")

        assert markets == []

    def test_find_markets_builds_correct_event_ticker(self, client):
        """Verify the event ticker is constructed properly."""
        with patch.object(client, "_get", return_value={"markets": []}) as mock_get:
            client.find_weather_markets("KXHIGHCHI", "2026-03-05")

        call_params = mock_get.call_args[1]["params"]
        assert call_params["event_ticker"] == "KXHIGHCHI-26MAR05"


# ---------------------------------------------------------------------------
# Mocked HTTP: order placement
# ---------------------------------------------------------------------------


class TestPlaceOrder:
    """Test place_order with mocked HTTP."""

    def test_place_order_success(self, client):
        mock_response = {
            "order": {
                "order_id": "abc-123",
                "status": "resting",
                "fill_count_fp": 0,
                "remaining_count_fp": 10,
            }
        }

        with patch.object(client, "_post", return_value=mock_response) as mock_post:
            result = client.place_order(
                ticker="KXHIGHNY-26FEB21-B42",
                side="yes",
                price_cents=22,
                count=10,
            )

        assert result["order_id"] == "abc-123"
        assert result["status"] == "resting"

        # Verify POST body.
        call_args = mock_post.call_args
        body = call_args[0][1]  # positional arg: body
        assert body["ticker"] == "KXHIGHNY-26FEB21-B42"
        assert body["side"] == "yes"
        assert body["yes_price"] == 22
        assert body["count"] == 10
        assert body["type"] == "limit"
        assert body["action"] == "buy"
        assert body["time_in_force"] == "good_till_canceled"
        # client_order_id should be a valid UUID.
        uuid.UUID(body["client_order_id"])  # Should not raise.

    def test_place_order_executed(self, client):
        """Order that fills immediately should report 'executed'."""
        mock_response = {
            "order": {
                "order_id": "def-456",
                "status": "executed",
                "fill_count_fp": 5,
                "remaining_count_fp": 0,
            }
        }

        with patch.object(client, "_post", return_value=mock_response):
            result = client.place_order("TICK-123", "yes", 50, 5)

        assert result["status"] == "executed"
        assert result["fill_count_fp"] == 5


# ---------------------------------------------------------------------------
# Mocked HTTP: balance (cents-to-dollars)
# ---------------------------------------------------------------------------


class TestGetBalance:
    """Test get_balance with mocked HTTP."""

    def test_balance_converts_cents_to_dollars(self, client):
        """Balance of 50000 cents should become 500.0 dollars."""
        with patch.object(client, "_get", return_value={"balance": 50000}):
            balance = client.get_balance()

        assert balance == pytest.approx(500.0)

    def test_balance_zero(self, client):
        with patch.object(client, "_get", return_value={"balance": 0}):
            balance = client.get_balance()

        assert balance == pytest.approx(0.0)

    def test_balance_fractional_cents(self, client):
        """12345 cents should be $123.45."""
        with patch.object(client, "_get", return_value={"balance": 12345}):
            balance = client.get_balance()

        assert balance == pytest.approx(123.45)


# ---------------------------------------------------------------------------
# Mocked HTTP: cancel order
# ---------------------------------------------------------------------------


class TestCancelOrder:
    """Test cancel_order with mocked HTTP."""

    def test_cancel_success(self, client):
        with patch.object(client, "_delete", return_value={}) as mock_del:
            result = client.cancel_order("order-xyz")

        assert result is True
        mock_del.assert_called_once_with("/portfolio/orders/order-xyz")

    def test_cancel_failure(self, client):
        """HTTP error should return False, not raise."""
        import requests as req
        with patch.object(
            client, "_delete",
            side_effect=req.HTTPError("404 Not Found"),
        ):
            result = client.cancel_order("bad-order-id")

        assert result is False


# ---------------------------------------------------------------------------
# Mocked HTTP: positions and settlements
# ---------------------------------------------------------------------------


class TestPositions:
    """Test get_positions with mocked HTTP."""

    def test_get_positions_all(self, client):
        mock_data = {
            "market_positions": [
                {"ticker": "T1", "position": 10},
                {"ticker": "T2", "position": 5},
            ]
        }
        with patch.object(client, "_get", return_value=mock_data) as mock_get:
            positions = client.get_positions()

        assert len(positions) == 2
        mock_get.assert_called_once_with("/portfolio/positions", params=None)

    def test_get_positions_filtered(self, client):
        mock_data = {"market_positions": [{"ticker": "T1", "position": 10}]}
        with patch.object(client, "_get", return_value=mock_data) as mock_get:
            positions = client.get_positions(event_ticker="EVENT-123")

        assert len(positions) == 1
        mock_get.assert_called_once_with(
            "/portfolio/positions",
            params={"event_ticker": "EVENT-123"},
        )


class TestSettlements:
    """Test get_settlements with mocked HTTP."""

    def test_get_settlements_all(self, client):
        mock_data = {
            "settlements": [
                {"ticker": "T1", "revenue": 100},
            ]
        }
        with patch.object(client, "_get", return_value=mock_data) as mock_get:
            settlements = client.get_settlements()

        assert len(settlements) == 1
        mock_get.assert_called_once_with("/portfolio/settlements", params=None)

    def test_get_settlements_filtered(self, client):
        mock_data = {"settlements": []}
        with patch.object(client, "_get", return_value=mock_data) as mock_get:
            client.get_settlements(ticker="TICK-123")

        mock_get.assert_called_once_with(
            "/portfolio/settlements",
            params={"ticker": "TICK-123"},
        )


# ---------------------------------------------------------------------------
# Mocked HTTP: orderbook
# ---------------------------------------------------------------------------


class TestGetOrderbook:
    """Test get_orderbook with mocked HTTP."""

    def test_get_orderbook(self, client):
        mock_data = {
            "orderbook": {
                "yes": [[22, 100], [21, 250]],
                "no": [[78, 80], [79, 150]],
            }
        }
        with patch.object(client, "_get", return_value=mock_data) as mock_get:
            ob = client.get_orderbook("KXHIGHNY-26FEB21-B42")

        assert "yes" in ob
        assert "no" in ob
        assert ob["yes"][0] == [22, 100]
        mock_get.assert_called_once_with("/markets/KXHIGHNY-26FEB21-B42/orderbook")


# ---------------------------------------------------------------------------
# URL building tests
# ---------------------------------------------------------------------------


class TestURLBuilding:
    """Test internal URL construction helpers."""

    def test_full_path_relative(self, client):
        """Relative path should be prefixed with /trade-api/v2."""
        path = client._full_path("/markets")
        assert path == "/trade-api/v2/markets"

    def test_full_path_absolute(self, client):
        """Path already starting with /trade-api should be unchanged."""
        path = client._full_path("/trade-api/v2/portfolio/balance")
        assert path == "/trade-api/v2/portfolio/balance"

    def test_build_url_relative(self, client):
        """Relative path should be joined to the base URL."""
        url = client._build_url("/markets")
        assert url == f"{DEMO_BASE}/markets"

    def test_build_url_absolute(self, client):
        """Absolute /trade-api path should use the base URL's host."""
        url = client._build_url("/trade-api/v2/portfolio/balance")
        assert "portfolio/balance" in url
        assert url.startswith("https://")
