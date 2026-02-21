"""Kalshi REST API client with RSA-PSS authentication and order management.

Supports market discovery for weather bracket contracts, order placement,
position tracking, and settlement queries.  Authentication uses RSA-PSS
SHA-256 signatures per Kalshi's API specification.

BASE URLs:
    Production: https://api.elections.kalshi.com/trade-api/v2
    Demo:       https://demo-api.kalshi.co/trade-api/v2

Rate limits: 20 reads/sec, 10 writes/sec.
"""

from __future__ import annotations

import base64
import logging
import math
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PRODUCTION_BASE = "https://api.elections.kalshi.com/trade-api/v2"
DEMO_BASE = "https://demo-api.kalshi.co/trade-api/v2"

_MONTH_ABBR = {
    1: "JAN", 2: "FEB", 3: "MAR", 4: "APR",
    5: "MAY", 6: "JUN", 7: "JUL", 8: "AUG",
    9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC",
}


# ---------------------------------------------------------------------------
# Standalone helpers
# ---------------------------------------------------------------------------


def format_event_ticker(series: str, date_str: str) -> str:
    """Convert series + 'YYYY-MM-DD' date to an event ticker.

    Examples
    --------
    >>> format_event_ticker("KXHIGHNY", "2026-02-21")
    'KXHIGHNY-26FEB21'
    >>> format_event_ticker("KXHIGHNY", "2026-03-05")
    'KXHIGHNY-26MAR05'
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    yy = f"{dt.year % 100:02d}"
    mon = _MONTH_ABBR[dt.month]
    dd = f"{dt.day:02d}"
    return f"{series}-{yy}{mon}{dd}"


def calculate_fee(count: int, price_cents: int) -> float:
    """Calculate Kalshi taker fee in cents.

    Formula: ceil(0.07 * count * P * (1 - P)) where P = price_cents / 100.
    Maximum fee is 1.75 cents per contract (at 50-cent price).

    Parameters
    ----------
    count : int
        Number of contracts.
    price_cents : int
        Price per contract in cents (1-99).

    Returns
    -------
    float
        Total fee in cents.
    """
    p = price_cents / 100.0
    per_contract_fee = min(0.07 * p * (1.0 - p), 0.0175)
    return math.ceil(per_contract_fee * count * 100) / 100.0


# ---------------------------------------------------------------------------
# KalshiClient
# ---------------------------------------------------------------------------


class KalshiClient:
    """Kalshi REST API client with RSA-PSS SHA-256 authentication.

    Parameters
    ----------
    config : dict
        The ``kalshi`` section of the project config.  Expected keys:

        - ``key_id`` (str): API key ID.
        - ``private_key_path`` (str): Path to PEM private key file.
        - ``api_base`` (str, optional): Override base URL.
        - ``paper_mode`` (bool, optional): Use demo API if True (default True).
    """

    # Default timeout for HTTP requests (seconds).
    REQUEST_TIMEOUT = 15

    def __init__(self, config: dict) -> None:
        self._key_id: str = config["key_id"]

        # Determine base URL: paper_mode -> demo, otherwise production.
        paper_mode = config.get("paper_mode", True)
        if paper_mode:
            self._base_url = DEMO_BASE
        else:
            self._base_url = config.get("api_base", PRODUCTION_BASE)

        # Load the RSA private key from disk.
        key_path = Path(config["private_key_path"])
        if not key_path.is_absolute():
            # Resolve relative to project root (parent of pavlov package).
            project_root = Path(__file__).resolve().parent.parent.parent
            key_path = project_root / key_path

        pem_data = key_path.read_bytes()
        self._private_key = serialization.load_pem_private_key(
            pem_data, password=None
        )

        self._session = requests.Session()
        logger.info(
            "KalshiClient initialised (base=%s, paper=%s)", self._base_url, paper_mode
        )

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _sign(self, method: str, path: str) -> Dict[str, str]:
        """Build authentication headers with RSA-PSS SHA-256 signature.

        The signature message is ``"{timestamp_ms}{METHOD}{path}"`` where
        *path* is the URL path **without** query parameters.

        Parameters
        ----------
        method : str
            HTTP method, e.g. ``"GET"``, ``"POST"``.
        path : str
            The request path including the ``/trade-api/v2`` prefix.  Any
            query string is stripped before signing.

        Returns
        -------
        dict
            Headers: ``KALSHI-ACCESS-KEY``, ``KALSHI-ACCESS-TIMESTAMP``,
            ``KALSHI-ACCESS-SIGNATURE``.
        """
        # Timestamp in milliseconds.
        ts = str(int(time.time() * 1000))

        # Strip query parameters for signing.
        signing_path = path.split("?")[0]

        message = f"{ts}{method.upper()}{signing_path}".encode("utf-8")

        signature = self._private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )

        sig_b64 = base64.b64encode(signature).decode("utf-8")

        return {
            "KALSHI-ACCESS-KEY": self._key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": sig_b64,
        }

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _build_url(self, path: str) -> str:
        """Join base URL with a path fragment.

        If *path* already starts with ``/trade-api/v2`` it is used as-is
        (appended to the host).  Otherwise the base URL is prepended.
        """
        if path.startswith("/trade-api"):
            # Absolute path -- combine with host of base URL.
            parsed = urlparse(self._base_url)
            return f"{parsed.scheme}://{parsed.netloc}{path}"
        if path.startswith("/"):
            return f"{self._base_url}{path}"
        return f"{self._base_url}/{path}"

    def _full_path(self, path: str) -> str:
        """Return the full API path (with /trade-api/v2 prefix) for signing."""
        if path.startswith("/trade-api"):
            return path
        base_path = urlparse(self._base_url).path  # /trade-api/v2
        if path.startswith("/"):
            return f"{base_path}{path}"
        return f"{base_path}/{path}"

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        """Authenticated GET request.

        Parameters
        ----------
        path : str
            API path relative to the base URL (e.g. ``"/markets"``).
        params : dict, optional
            Query parameters.

        Returns
        -------
        dict
            Parsed JSON response.

        Raises
        ------
        requests.HTTPError
            On 4xx/5xx responses.
        """
        full_path = self._full_path(path)
        headers = self._sign("GET", full_path)
        url = self._build_url(path)

        logger.debug("GET %s params=%s", url, params)
        resp = self._session.get(
            url, headers=headers, params=params, timeout=self.REQUEST_TIMEOUT
        )
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, body: dict) -> dict:
        """Authenticated POST request.

        Parameters
        ----------
        path : str
            API path relative to the base URL.
        body : dict
            JSON request body.

        Returns
        -------
        dict
            Parsed JSON response.
        """
        full_path = self._full_path(path)
        headers = self._sign("POST", full_path)
        headers["Content-Type"] = "application/json"
        url = self._build_url(path)

        logger.debug("POST %s body=%s", url, body)
        resp = self._session.post(
            url, headers=headers, json=body, timeout=self.REQUEST_TIMEOUT
        )
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str) -> dict:
        """Authenticated DELETE request.

        Parameters
        ----------
        path : str
            API path relative to the base URL.

        Returns
        -------
        dict
            Parsed JSON response (may be empty on 204).
        """
        full_path = self._full_path(path)
        headers = self._sign("DELETE", full_path)
        url = self._build_url(path)

        logger.debug("DELETE %s", url)
        resp = self._session.delete(
            url, headers=headers, timeout=self.REQUEST_TIMEOUT
        )
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return {}
        return resp.json()

    # ------------------------------------------------------------------
    # Account endpoints
    # ------------------------------------------------------------------

    def get_balance(self) -> float:
        """Fetch account balance in **dollars** (API returns cents).

        Returns
        -------
        float
            Available balance in dollars.
        """
        data = self._get("/portfolio/balance")
        balance_cents = data.get("balance", 0)
        return balance_cents / 100.0

    # ------------------------------------------------------------------
    # Market discovery
    # ------------------------------------------------------------------

    def find_weather_markets(
        self, series_ticker: str, date_str: str
    ) -> List[dict]:
        """Retrieve all open bracket markets for a weather event.

        Parameters
        ----------
        series_ticker : str
            The series ticker, e.g. ``"KXHIGHNY"``.
        date_str : str
            Date in ``"YYYY-MM-DD"`` format.

        Returns
        -------
        list[dict]
            List of market dicts from the Kalshi API, each containing
            ``ticker``, ``subtitle``, ``status``, ``yes_bid``, ``yes_ask``,
            ``last_price``, ``volume``, etc.
        """
        event_ticker = format_event_ticker(series_ticker, date_str)
        params = {"event_ticker": event_ticker, "status": "open"}
        data = self._get("/markets", params=params)
        markets = data.get("markets", [])
        logger.info(
            "Found %d open markets for %s", len(markets), event_ticker
        )
        return markets

    def find_bracket(
        self, markets: List[dict], bracket_str: str
    ) -> Optional[dict]:
        """Find a specific bracket market by its temperature range.

        Parameters
        ----------
        markets : list[dict]
            List of market dicts (e.g. from :meth:`find_weather_markets`).
        bracket_str : str
            Bracket description like ``"42-44"`` or ``"39-42"``.

        Returns
        -------
        dict or None
            The matching market dict, or ``None`` if no match is found.
            Matches against the ``subtitle`` field which contains text
            like ``"42\u00b0 to 44\u00b0"``.
        """
        # Parse the bracket string to extract low and high values.
        parts = bracket_str.replace(" ", "").split("-")
        if len(parts) != 2:
            logger.warning("Invalid bracket_str format: %s", bracket_str)
            return None

        low, high = parts[0], parts[1]

        for market in markets:
            subtitle = market.get("subtitle", "")
            # Match patterns like "42° to 44°", "42 to 44", etc.
            if re.search(rf"\b{re.escape(low)}\s*\u00b0?\s*to\s*{re.escape(high)}\s*\u00b0?", subtitle):
                return market

        logger.debug("No bracket match for '%s' in %d markets", bracket_str, len(markets))
        return None

    def get_market(self, ticker: str) -> dict:
        """Fetch details for a single market.

        Parameters
        ----------
        ticker : str
            Market ticker, e.g. ``"KXHIGHNY-26FEB21-B42"``.

        Returns
        -------
        dict
            Market details from the API.
        """
        data = self._get(f"/markets/{ticker}")
        return data.get("market", data)

    def get_orderbook(self, ticker: str) -> dict:
        """Fetch the order book for a market.

        Parameters
        ----------
        ticker : str
            Market ticker.

        Returns
        -------
        dict
            Order book with ``yes`` and ``no`` sides, each containing
            lists of ``[price, quantity]`` entries.
        """
        data = self._get(f"/markets/{ticker}/orderbook")
        return data.get("orderbook", data)

    # ------------------------------------------------------------------
    # Trading
    # ------------------------------------------------------------------

    def place_order(
        self,
        ticker: str,
        side: str,
        price_cents: int,
        count: int,
    ) -> dict:
        """Place a limit order on a Kalshi market.

        Parameters
        ----------
        ticker : str
            Market ticker.
        side : str
            ``"yes"`` or ``"no"``.
        price_cents : int
            Limit price in cents (1-99).
        count : int
            Number of contracts.

        Returns
        -------
        dict
            Order response containing ``order_id``, ``status``
            (``"resting"`` or ``"executed"``), ``fill_count_fp``,
            ``remaining_count_fp``, etc.
        """
        body = {
            "ticker": ticker,
            "client_order_id": str(uuid.uuid4()),
            "action": "buy",
            "side": side,
            "type": "limit",
            "count": count,
            "yes_price": price_cents,
            "time_in_force": "good_till_canceled",
        }
        data = self._post("/portfolio/orders", body)
        order = data.get("order", data)
        logger.info(
            "Order placed: ticker=%s side=%s price=%dc count=%d -> %s",
            ticker, side, price_cents, count, order.get("status", "unknown"),
        )
        return order

    def cancel_order(self, order_id: str) -> bool:
        """Cancel an open order.

        Parameters
        ----------
        order_id : str
            The order ID returned by :meth:`place_order`.

        Returns
        -------
        bool
            ``True`` if the cancellation succeeded.
        """
        try:
            self._delete(f"/portfolio/orders/{order_id}")
            logger.info("Order %s cancelled", order_id)
            return True
        except requests.HTTPError as exc:
            logger.error("Failed to cancel order %s: %s", order_id, exc)
            return False

    # ------------------------------------------------------------------
    # Positions & settlements
    # ------------------------------------------------------------------

    def get_positions(self, event_ticker: Optional[str] = None) -> List[dict]:
        """Fetch open positions.

        Parameters
        ----------
        event_ticker : str, optional
            Filter to positions in a specific event.

        Returns
        -------
        list[dict]
            Position dicts from the API.
        """
        params: Dict[str, Any] = {}
        if event_ticker:
            params["event_ticker"] = event_ticker
        data = self._get("/portfolio/positions", params=params or None)
        positions = data.get("market_positions", [])
        return positions

    def get_settlements(self, ticker: Optional[str] = None) -> List[dict]:
        """Fetch settlement history.

        Parameters
        ----------
        ticker : str, optional
            Filter to a specific market ticker.

        Returns
        -------
        list[dict]
            Settlement dicts from the API.
        """
        params: Dict[str, Any] = {}
        if ticker:
            params["ticker"] = ticker
        data = self._get("/portfolio/settlements", params=params or None)
        settlements = data.get("settlements", [])
        return settlements
