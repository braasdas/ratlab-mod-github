"""Settlement checker that resolves open positions and records outcomes.

Queries Kalshi for settlement status on unsettled trades, calculates P&L,
and updates the SQLite database with results.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional

from pavlov.trading.kalshi_client import KalshiClient, calculate_fee
from pavlov.tracker.db import (
    get_db,
    get_unsettled_trades,
    insert_settlement,
    update_trade_status,
    update_daily_summary,
)
from pavlov.tracker.stats import (
    get_current_bankroll,
    get_win_rate,
    get_current_streak,
    get_longest_streak,
    get_cumulative_pnl,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _calculate_settlement_pnl(trade: dict, market_result: str) -> dict:
    """Calculate P&L for a single settled trade.

    Parameters
    ----------
    trade : dict
        A trade row from the database with at least ``contracts``,
        ``price_cents``, and ``outlay_cents``.
    market_result : str
        ``"yes"`` if the bracket resolved YES, ``"no"`` if it resolved NO.

    Returns
    -------
    dict
        Settlement details::

            {
                "market_result": "yes" | "no",
                "revenue_cents": int,
                "cost_cents": int,
                "fee_cents": int,
                "net_pnl_cents": int,
                "roi_pct": float,
            }
    """
    contracts = trade["contracts"]
    price_cents = trade["price_cents"]
    cost_cents = trade["outlay_cents"]

    # Revenue: if YES wins, each contract pays 100c; if NO wins, 0.
    if market_result == "yes":
        revenue_cents = contracts * 100
    else:
        revenue_cents = 0

    # Fee is charged on the initial purchase
    fee_cents = int(math.ceil(calculate_fee(contracts, price_cents)))

    # Net P&L: revenue minus cost minus fees
    net_pnl_cents = revenue_cents - cost_cents - fee_cents

    # ROI percentage: net P&L relative to cost
    roi_pct = round(net_pnl_cents / cost_cents * 100, 1) if cost_cents > 0 else 0.0

    return {
        "market_result": market_result,
        "revenue_cents": revenue_cents,
        "cost_cents": cost_cents,
        "fee_cents": fee_cents,
        "net_pnl_cents": net_pnl_cents,
        "roi_pct": roi_pct,
    }


# ---------------------------------------------------------------------------
# Main settlement function
# ---------------------------------------------------------------------------


def settle_trades(
    config: dict,
    kalshi_client: Optional[KalshiClient] = None,
    db_conn=None,
) -> list:
    """Check settlements for all unsettled trades.

    1. Get all unsettled trades from SQLite
    2. For each, query Kalshi for settlement status
    3. If settled: calculate P&L, insert settlement record, update trade status
    4. After all settlements: update daily_summary for each affected date
    5. Return list of settlement results

    Paper mode trades are skipped since we cannot query Kalshi for their
    settlement; they are marked as needing manual resolution.

    Parameters
    ----------
    config : dict
        Full project configuration.
    kalshi_client : KalshiClient, optional
        An initialised client.  If *None*, one is created from
        ``config["kalshi"]``.
    db_conn : sqlite3.Connection, optional
        Database connection.  If *None*, one is opened via :func:`get_db`.

    Returns
    -------
    list[dict]
        One settlement result dict per settled trade.
    """
    kalshi_cfg = config.get("kalshi", {})
    risk_cfg = config.get("risk", {})

    # Database connection
    own_conn = False
    if db_conn is None:
        db_conn = get_db()
        own_conn = True

    # Get unsettled trades
    unsettled = get_unsettled_trades(db_conn)
    if not unsettled:
        logger.info("No unsettled trades found")
        if own_conn:
            db_conn.close()
        return []

    logger.info("Found %d unsettled trades to check", len(unsettled))

    # Initialise Kalshi client if needed
    if kalshi_client is None:
        try:
            kalshi_client = KalshiClient(kalshi_cfg)
        except Exception as exc:
            logger.error("Failed to initialise KalshiClient: %s", exc)
            if own_conn:
                db_conn.close()
            return []

    results: List[dict] = []
    affected_dates: set = set()

    for trade in unsettled:
        trade_id = trade["id"]
        city_id = trade["city_id"]
        trade_date = trade["date"]
        bracket = trade["bracket"]
        ticker = trade["ticker"]
        is_paper = trade.get("is_paper", False)

        # Skip paper trades -- can't query Kalshi for their settlement
        if is_paper:
            logger.debug(
                "Skipping paper trade %d (%s %s) -- needs manual resolution",
                trade_id, city_id, bracket,
            )
            continue

        # Query Kalshi for settlement
        try:
            settlements = kalshi_client.get_settlements(ticker=ticker)
        except Exception as exc:
            logger.error(
                "Failed to query settlement for trade %d (%s): %s",
                trade_id, ticker, exc,
            )
            continue

        if not settlements:
            logger.debug(
                "Trade %d (%s) not yet settled", trade_id, ticker
            )
            continue

        # Use the first (most recent) settlement record
        settlement_data = settlements[0]

        # Determine market result from settlement data
        # Kalshi settlements typically have a 'result' or 'yes_price' field
        # indicating the outcome. A settlement with yes_price=100 means YES won.
        market_result = _extract_market_result(settlement_data)
        if market_result is None:
            logger.warning(
                "Could not determine market result for trade %d (%s)",
                trade_id, ticker,
            )
            continue

        # Calculate P&L
        pnl = _calculate_settlement_pnl(trade, market_result)

        # Insert settlement record
        try:
            insert_settlement(
                conn=db_conn,
                trade_id=trade_id,
                city_id=city_id,
                date=trade_date,
                bracket=bracket,
                actual_high_f=settlement_data.get("actual_high_f", 0.0),
                market_result=market_result,
                revenue_cents=pnl["revenue_cents"],
                cost_cents=pnl["cost_cents"],
                fee_cents=pnl["fee_cents"],
                net_pnl_cents=pnl["net_pnl_cents"],
                roi_pct=pnl["roi_pct"],
            )
        except Exception as exc:
            logger.error(
                "Failed to insert settlement for trade %d: %s",
                trade_id, exc,
            )
            continue

        # Update trade status to 'settled'
        try:
            update_trade_status(db_conn, trade_id, "settled")
        except Exception as exc:
            logger.error(
                "Failed to update trade status for %d: %s",
                trade_id, exc,
            )

        affected_dates.add(trade_date)

        result = {
            "trade_id": trade_id,
            "city_id": city_id,
            "date": trade_date,
            "bracket": bracket,
            "market_result": market_result,
            "revenue_cents": pnl["revenue_cents"],
            "cost_cents": pnl["cost_cents"],
            "fee_cents": pnl["fee_cents"],
            "net_pnl_cents": pnl["net_pnl_cents"],
            "roi_pct": pnl["roi_pct"],
        }
        results.append(result)

        logger.info(
            "Settled trade %d: %s %s -> %s, P&L=%+dc",
            trade_id, city_id, bracket, market_result, pnl["net_pnl_cents"],
        )

    # ------ Update daily summaries for affected dates ------
    for date_str in affected_dates:
        _update_daily_summary_for_date(db_conn, date_str, risk_cfg)

    if own_conn:
        db_conn.close()

    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_market_result(settlement_data: dict) -> Optional[str]:
    """Extract the market result from a Kalshi settlement response.

    Kalshi settlement records may contain various fields.  We look for
    common indicators:

    - ``result``: ``"yes"`` or ``"no"``
    - ``settled_price``: 100 = YES won, 0 = NO won

    Parameters
    ----------
    settlement_data : dict
        A single settlement record from the Kalshi API.

    Returns
    -------
    str or None
        ``"yes"`` or ``"no"``, or ``None`` if the result cannot be
        determined.
    """
    # Direct result field
    result = settlement_data.get("result")
    if result in ("yes", "no"):
        return result

    # settled_price field (100 cents = YES, 0 cents = NO)
    settled_price = settlement_data.get("settled_price")
    if settled_price is not None:
        if settled_price >= 50:
            return "yes"
        else:
            return "no"

    # yes_price field
    yes_price = settlement_data.get("yes_price")
    if yes_price is not None:
        if yes_price >= 50:
            return "yes"
        else:
            return "no"

    return None


def _update_daily_summary_for_date(
    db_conn, date_str: str, risk_cfg: dict
) -> None:
    """Recompute and update the daily summary for a given date.

    Parameters
    ----------
    db_conn : sqlite3.Connection
        Database connection.
    date_str : str
        The date to summarise.
    risk_cfg : dict
        Risk configuration section (for default bankroll).
    """
    from pavlov.tracker.db import get_trades_by_date

    # Count settlements for this date
    cur = db_conn.execute(
        """
        SELECT
            COUNT(*)                                                     AS total,
            COALESCE(SUM(CASE WHEN market_result = 'yes' THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN market_result = 'no' THEN 1 ELSE 0 END), 0)  AS losses,
            COALESCE(SUM(revenue_cents - cost_cents), 0)                 AS gross_pnl,
            COALESCE(SUM(fee_cents), 0)                                  AS fees,
            COALESCE(SUM(net_pnl_cents), 0)                              AS net_pnl
        FROM settlements WHERE date = ?
        """,
        (date_str,),
    )
    row = cur.fetchone()

    total_trades = row[0] if row else 0
    wins = row[1] if row else 0
    losses = row[2] if row else 0
    gross_pnl_cents = row[3] if row else 0
    fees_cents = row[4] if row else 0
    net_pnl_cents = row[5] if row else 0

    win_rate = (wins / total_trades) if total_trades > 0 else 0.0
    bankroll = get_current_bankroll(
        db_conn, default_bankroll=risk_cfg.get("bankroll", 500.0)
    )
    bankroll_cents = int(bankroll * 100)
    cumulative_pnl = get_cumulative_pnl(db_conn)
    cumulative_pnl_cents = int(cumulative_pnl * 100)
    current_streak = get_current_streak(db_conn)
    longest_streak = get_longest_streak(db_conn)

    try:
        update_daily_summary(
            conn=db_conn,
            date=date_str,
            total_trades=total_trades,
            wins=wins,
            losses=losses,
            gross_pnl_cents=gross_pnl_cents,
            fees_cents=fees_cents,
            net_pnl_cents=net_pnl_cents,
            bankroll_after=bankroll_cents,
            cumulative_pnl=cumulative_pnl_cents,
            win_rate=win_rate,
            current_streak=current_streak,
            longest_streak=longest_streak,
        )
        logger.info("Updated daily summary for %s", date_str)
    except Exception as exc:
        logger.error(
            "Failed to update daily summary for %s: %s", date_str, exc
        )
