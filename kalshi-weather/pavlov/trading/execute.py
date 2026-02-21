"""Trade execution engine for Kalshi weather bracket contracts.

Connects weather predictions to real or paper trades via the KalshiClient,
sizes positions using Kelly criterion, and persists everything to SQLite.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from pavlov.trading.kalshi_client import (
    KalshiClient,
    format_event_ticker,
)
from pavlov.trading.kelly import KellyInput, KellySizer, PortfolioState
from pavlov.tracker.db import (
    get_db,
    insert_prediction,
    insert_trade,
    update_trade_status,
)
from pavlov.tracker.stats import get_current_bankroll

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_ticker(series: str, date_str: str, bracket_str: str) -> str:
    """Build a full Kalshi market ticker from series, date, and bracket.

    Parameters
    ----------
    series : str
        The Kalshi series ticker, e.g. ``"KXHIGHNY"``.
    date_str : str
        Date in ``"YYYY-MM-DD"`` format.
    bracket_str : str
        Bracket range like ``"39-42"``.  The lower bound is used for the
        ``B`` prefix in the ticker.

    Returns
    -------
    str
        Full ticker, e.g. ``"KXHIGHNY-26FEB21-B39"``.

    Examples
    --------
    >>> _build_ticker("KXHIGHNY", "2026-02-21", "39-42")
    'KXHIGHNY-26FEB21-B39'
    >>> _build_ticker("KXHIGHCHI", "2026-03-05", "47-50")
    'KXHIGHCHI-26MAR05-B47'
    """
    event_ticker = format_event_ticker(series, date_str)
    lower_bound = bracket_str.replace(" ", "").split("-")[0]
    return f"{event_ticker}-B{lower_bound}"


def _prediction_field(prediction: Any, key: str, default=None):
    """Read a field from a prediction that may be a dict or dataclass."""
    if isinstance(prediction, dict):
        return prediction.get(key, default)
    return getattr(prediction, key, default)


# ---------------------------------------------------------------------------
# Main execution function
# ---------------------------------------------------------------------------


def execute_daily_trades(
    predictions: list,
    config: dict,
    kalshi_client: Optional[KalshiClient] = None,
    db_conn=None,
) -> list:
    """Execute trades for a list of weather predictions.

    Each prediction is a dict or object with at least:

    - ``city_id``, ``date``, ``predicted_high_f``, ``confidence``
    - ``recommended_bracket``, ``bracket_probability``
    - ``adjacent_bracket``, ``adjacent_probability``
    - ``reasoning_summary``, ``uncertainty_flags``, ``data_sources_used``
    - ``full_reasoning``, ``raw_response``

    Parameters
    ----------
    predictions : list
        List of prediction dicts or objects.
    config : dict
        Full project configuration (must include ``kalshi``, ``risk``,
        and ``cities`` sections).
    kalshi_client : KalshiClient, optional
        An initialised client.  If *None* and not in paper mode, one is
        created from ``config["kalshi"]``.
    db_conn : sqlite3.Connection, optional
        Database connection.  If *None*, one is opened via :func:`get_db`.

    Returns
    -------
    list[dict]
        One execution report per prediction (see module docstring for format).
    """
    risk_cfg = config.get("risk", {})
    kalshi_cfg = config.get("kalshi", {})
    paper_mode = kalshi_cfg.get("paper_mode", True)
    min_confidence = risk_cfg.get("min_confidence", 0.55)
    risk_tolerance = risk_cfg.get("risk_tolerance", 0.25)
    adjacent_enabled = risk_cfg.get("adjacent_brackets", False)

    # Build a city lookup: city_id -> city config
    city_map: Dict[str, dict] = {}
    for city in config.get("cities", []):
        city_map[city["id"]] = city

    # Database connection
    own_conn = False
    if db_conn is None:
        db_conn = get_db()
        own_conn = True

    # Kalshi client (only needed for live mode)
    if not paper_mode and kalshi_client is None:
        kalshi_client = KalshiClient(kalshi_cfg)

    # Kelly sizer
    sizer = KellySizer(
        max_single_pct=risk_cfg.get("max_single_position_pct", 0.10),
        max_daily_pct=risk_cfg.get("max_daily_exposure_pct", 0.25),
        max_portfolio_pct=risk_cfg.get("max_portfolio_exposure_pct", 0.30),
        min_edge=risk_cfg.get("min_edge", 0.02),
    )

    # Get current bankroll
    bankroll = get_current_bankroll(
        db_conn, default_bankroll=risk_cfg.get("bankroll", 500.0)
    )

    portfolio = PortfolioState()
    reports: List[dict] = []

    for prediction in predictions:
        city_id = _prediction_field(prediction, "city_id")
        pred_date = _prediction_field(prediction, "date")
        confidence = _prediction_field(prediction, "confidence", 0.0)
        predicted_high = _prediction_field(prediction, "predicted_high_f")
        primary_bracket = _prediction_field(prediction, "recommended_bracket")
        bracket_prob = _prediction_field(prediction, "bracket_probability", 0.0)
        adjacent_bracket = _prediction_field(prediction, "adjacent_bracket")
        adjacent_prob = _prediction_field(prediction, "adjacent_probability", 0.0)
        reasoning = _prediction_field(prediction, "reasoning_summary", "")
        full_reasoning = _prediction_field(prediction, "full_reasoning", "")

        report: Dict[str, Any] = {
            "city_id": city_id,
            "date": pred_date,
            "mode": "paper" if paper_mode else "live",
            "trades": [],
            "total_outlay": 0.0,
            "bankroll_pct_deployed": 0.0,
        }

        # ------ Validation ------
        if confidence < min_confidence:
            logger.info(
                "Skipping %s: confidence %.2f < min %.2f",
                city_id, confidence, min_confidence,
            )
            report["skip_reason"] = (
                f"confidence {confidence:.2f} below minimum {min_confidence:.2f}"
            )
            reports.append(report)
            continue

        if bracket_prob <= 0:
            logger.info("Skipping %s: bracket_probability <= 0", city_id)
            report["skip_reason"] = "bracket_probability <= 0"
            reports.append(report)
            continue

        # ------ City config ------
        city_cfg = city_map.get(city_id)
        if city_cfg is None:
            logger.warning("City %s not found in config, skipping", city_id)
            report["skip_reason"] = f"city {city_id} not in config"
            reports.append(report)
            continue

        series = city_cfg["kalshi_series"]

        # ------ Market discovery ------
        # Fetch market data if a client is available (even in paper mode,
        # real prices are preferred over estimated prices).
        markets: Optional[List[dict]] = None
        if kalshi_client is not None:
            try:
                markets = kalshi_client.find_weather_markets(series, pred_date)
            except Exception as exc:
                logger.error(
                    "Market discovery failed for %s: %s", city_id, exc
                )
                if not paper_mode:
                    report["skip_reason"] = f"market discovery failed: {exc}"
                    reports.append(report)
                    continue
                # In paper mode, continue with estimated prices
                logger.info(
                    "Paper mode: continuing with estimated prices for %s",
                    city_id,
                )

        # ------ Save prediction to DB ------
        try:
            prediction_id = insert_prediction(
                conn=db_conn,
                city_id=city_id,
                date=pred_date,
                predicted_high=predicted_high,
                confidence=confidence,
                primary_bracket=primary_bracket,
                adjacent_bracket=adjacent_bracket,
                reasoning=reasoning,
                weather_data=full_reasoning,
            )
        except Exception as exc:
            logger.error(
                "Failed to insert prediction for %s: %s", city_id, exc
            )
            report["skip_reason"] = f"db error: {exc}"
            reports.append(report)
            continue

        # ------ Build bracket list to trade ------
        brackets_to_trade = [
            {"bracket": primary_bracket, "prob": bracket_prob},
        ]
        if adjacent_enabled and adjacent_bracket and adjacent_prob > 0:
            brackets_to_trade.append(
                {"bracket": adjacent_bracket, "prob": adjacent_prob},
            )

        total_outlay = 0.0

        for bracket_info in brackets_to_trade:
            bracket_str = bracket_info["bracket"]
            prob = bracket_info["prob"]

            # Determine contract price
            ticker = _build_ticker(series, pred_date, bracket_str)
            price_cents: Optional[int] = None

            if markets is not None:
                bracket_market = None
                if kalshi_client is not None:
                    bracket_market = kalshi_client.find_bracket(
                        markets, bracket_str
                    )
                if bracket_market is not None:
                    price_cents = bracket_market.get("yes_ask")
                    ticker = bracket_market.get("ticker", ticker)

            # For paper mode without real market data, estimate price from
            # probability (assume market is roughly efficient,
            # price ~ prob * 100).
            if price_cents is None:
                price_cents = max(1, min(99, round(prob * 100)))
                logger.debug(
                    "No market data for %s %s, estimating price at %dc",
                    city_id, bracket_str, price_cents,
                )

            contract_price = price_cents / 100.0

            # Ensure contract_price is in valid range for Kelly
            if contract_price < 0.01 or contract_price > 0.99:
                logger.warning(
                    "Invalid contract price %.2f for %s %s, skipping bracket",
                    contract_price, city_id, bracket_str,
                )
                continue

            # Ensure probability is in valid range for Kelly
            if prob <= 0.0 or prob >= 1.0:
                logger.warning(
                    "Invalid probability %.4f for %s %s, skipping bracket",
                    prob, city_id, bracket_str,
                )
                continue

            # ------ Kelly sizing ------
            kelly_input = KellyInput(
                bankroll=bankroll,
                estimated_prob=prob,
                contract_price=contract_price,
                risk_tolerance=risk_tolerance,
                label=f"{city_id} {bracket_str}",
            )

            kelly_result = sizer.size(kelly_input, portfolio=portfolio)

            if not kelly_result.recommended or kelly_result.contracts == 0:
                logger.info(
                    "Kelly says no bet for %s %s: %s",
                    city_id, bracket_str, kelly_result.reason,
                )
                continue

            contracts = kelly_result.contracts
            outlay_cents = round(contracts * price_cents)
            outlay_dollars = outlay_cents / 100.0
            max_profit = round(contracts * (100 - price_cents)) / 100.0
            max_loss = outlay_dollars

            # ------ Place order ------
            order_id = None
            status = "paper"

            if paper_mode:
                logger.info(
                    "PAPER TRADE: %s %s %d contracts @ %dc = $%.2f",
                    city_id, bracket_str, contracts, price_cents, outlay_dollars,
                )
                status = "paper"
            else:
                # Live order
                try:
                    order_response = kalshi_client.place_order(
                        ticker=ticker,
                        side="yes",
                        price_cents=price_cents,
                        count=contracts,
                    )
                    order_id = order_response.get("order_id")
                    api_status = order_response.get("status", "resting")
                    status = api_status  # "executed" or "resting"
                    logger.info(
                        "LIVE ORDER: %s %s %d @ %dc -> %s (order_id=%s)",
                        city_id, bracket_str, contracts, price_cents,
                        status, order_id,
                    )
                except Exception as exc:
                    logger.error(
                        "Order placement failed for %s %s: %s",
                        city_id, bracket_str, exc,
                    )
                    status = "failed"

            # ------ Save trade to DB ------
            try:
                trade_id = insert_trade(
                    conn=db_conn,
                    prediction_id=prediction_id,
                    city_id=city_id,
                    date=pred_date,
                    bracket=bracket_str,
                    ticker=ticker,
                    side="yes",
                    price_cents=price_cents,
                    contracts=contracts,
                    outlay_cents=outlay_cents,
                    order_id=order_id,
                    is_paper=paper_mode,
                )
                # Update status if not default 'pending'
                if status != "pending":
                    update_trade_status(db_conn, trade_id, status, order_id)
            except Exception as exc:
                logger.error(
                    "Failed to insert trade for %s %s: %s",
                    city_id, bracket_str, exc,
                )

            # Update portfolio tracking
            portfolio.add_position(
                label=f"{city_id} {bracket_str}",
                contracts=contracts,
                price=contract_price,
                prob=prob,
            )
            sizer.record_deployment(outlay_dollars)

            total_outlay += outlay_dollars

            trade_report = {
                "bracket": bracket_str,
                "ticker": ticker,
                "side": "yes",
                "price_cents": price_cents,
                "contracts": contracts,
                "outlay_dollars": round(outlay_dollars, 2),
                "max_profit_dollars": round(max_profit, 2),
                "max_loss_dollars": round(max_loss, 2),
                "order_id": order_id,
                "status": status,
            }
            report["trades"].append(trade_report)

        report["total_outlay"] = round(total_outlay, 2)
        report["bankroll_pct_deployed"] = (
            round(total_outlay / bankroll * 100, 1) if bankroll > 0 else 0.0
        )
        reports.append(report)

    if own_conn:
        db_conn.close()

    return reports
