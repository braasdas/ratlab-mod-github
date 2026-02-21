"""SQLite persistence and statistics tracking subpackage."""

from pavlov.tracker.db import (
    get_db,
    init_db,
    insert_prediction,
    insert_trade,
    update_trade_status,
    insert_settlement,
    update_daily_summary,
    get_trades_by_date,
    get_unsettled_trades,
    get_prediction_by_city_date,
)
from pavlov.tracker.stats import (
    get_current_bankroll,
    get_win_rate,
    get_current_streak,
    get_longest_streak,
    get_cumulative_pnl,
    get_total_trades,
    get_daily_report,
    format_report,
)

__all__ = [
    # db
    "get_db",
    "init_db",
    "insert_prediction",
    "insert_trade",
    "update_trade_status",
    "insert_settlement",
    "update_daily_summary",
    "get_trades_by_date",
    "get_unsettled_trades",
    "get_prediction_by_city_date",
    # stats
    "get_current_bankroll",
    "get_win_rate",
    "get_current_streak",
    "get_longest_streak",
    "get_cumulative_pnl",
    "get_total_trades",
    "get_daily_report",
    "format_report",
]
