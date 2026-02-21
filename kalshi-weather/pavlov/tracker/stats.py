"""Performance statistics: win rate, P&L, streaks, and daily summaries."""

import sqlite3


# ---------------------------------------------------------------------------
# Bankroll
# ---------------------------------------------------------------------------


def get_current_bankroll(conn: sqlite3.Connection, default_bankroll: float = 500.0) -> float:
    """Latest bankroll_after from daily_summary, or *default_bankroll*.

    The daily_summary table stores ``bankroll_after`` in **cents**.
    This function converts it to dollars before returning.
    """
    cur = conn.execute(
        "SELECT bankroll_after FROM daily_summary ORDER BY date DESC LIMIT 1"
    )
    row = cur.fetchone()
    if row is None:
        return default_bankroll
    return row["bankroll_after"] / 100.0


# ---------------------------------------------------------------------------
# Win rate
# ---------------------------------------------------------------------------


def get_win_rate(conn: sqlite3.Connection) -> float:
    """Total wins / total settlements.  Returns 0.0 if no data."""
    cur = conn.execute(
        """
        SELECT
            COUNT(*)                                        AS total,
            SUM(CASE WHEN market_result = 'win' THEN 1 ELSE 0 END) AS wins
        FROM settlements
        """
    )
    row = cur.fetchone()
    total = row["total"]
    if total == 0:
        return 0.0
    return row["wins"] / total


# ---------------------------------------------------------------------------
# Streaks
# ---------------------------------------------------------------------------


def get_current_streak(conn: sqlite3.Connection) -> int:
    """Count consecutive wins (positive) or losses (negative) from most recent.

    Returns 0 if there are no settlements.
    """
    cur = conn.execute(
        "SELECT market_result FROM settlements ORDER BY settled_at DESC, id DESC"
    )
    rows = cur.fetchall()
    if not rows:
        return 0

    first_result = rows[0]["market_result"]
    streak = 0
    for row in rows:
        if row["market_result"] == first_result:
            streak += 1
        else:
            break

    return streak if first_result == "win" else -streak


def get_longest_streak(conn: sqlite3.Connection) -> int:
    """Longest winning streak ever.  Returns 0 if no data."""
    cur = conn.execute(
        "SELECT market_result FROM settlements ORDER BY settled_at ASC, id ASC"
    )
    rows = cur.fetchall()
    if not rows:
        return 0

    longest = 0
    current = 0
    for row in rows:
        if row["market_result"] == "win":
            current += 1
            if current > longest:
                longest = current
        else:
            current = 0

    return longest


# ---------------------------------------------------------------------------
# P&L
# ---------------------------------------------------------------------------


def get_cumulative_pnl(conn: sqlite3.Connection) -> float:
    """Sum of all net_pnl from settlements, in **dollars**."""
    cur = conn.execute("SELECT COALESCE(SUM(net_pnl_cents), 0) AS total FROM settlements")
    row = cur.fetchone()
    return row["total"] / 100.0


# ---------------------------------------------------------------------------
# Trade count
# ---------------------------------------------------------------------------


def get_total_trades(conn: sqlite3.Connection) -> int:
    """Total number of trades placed."""
    cur = conn.execute("SELECT COUNT(*) AS cnt FROM trades")
    return cur.fetchone()["cnt"]


# ---------------------------------------------------------------------------
# Daily report
# ---------------------------------------------------------------------------


def get_daily_report(conn: sqlite3.Connection, date: str) -> dict:
    """Build a report dict for a specific date.

    Keys: date, trades, wins, losses, win_rate, gross_pnl, fees, net_pnl,
          bankroll, cumulative_pnl, current_streak, longest_streak.
    """
    # Settlements for the date
    cur = conn.execute(
        """
        SELECT
            COUNT(*)                                                AS total,
            COALESCE(SUM(CASE WHEN market_result = 'win' THEN 1 ELSE 0 END), 0)  AS wins,
            COALESCE(SUM(CASE WHEN market_result = 'loss' THEN 1 ELSE 0 END), 0) AS losses,
            COALESCE(SUM(revenue_cents), 0)                        AS gross_rev,
            COALESCE(SUM(cost_cents), 0)                           AS gross_cost,
            COALESCE(SUM(fee_cents), 0)                            AS fees,
            COALESCE(SUM(net_pnl_cents), 0)                        AS net_pnl
        FROM settlements WHERE date = ?
        """,
        (date,),
    )
    row = cur.fetchone()

    total = row["total"]
    wins = row["wins"]
    losses = row["losses"]
    gross_pnl_cents = row["gross_rev"] - row["gross_cost"]
    fees_cents = row["fees"]
    net_pnl_cents = row["net_pnl"]
    win_rate = (wins / total * 100.0) if total > 0 else 0.0

    return {
        "date": date,
        "trades": total,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,
        "gross_pnl": gross_pnl_cents / 100.0,
        "fees": fees_cents / 100.0,
        "net_pnl": net_pnl_cents / 100.0,
        "bankroll": get_current_bankroll(conn),
        "cumulative_pnl": get_cumulative_pnl(conn),
        "current_streak": get_current_streak(conn),
        "longest_streak": get_longest_streak(conn),
    }


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------


def format_report(report: dict) -> str:
    """Pretty-print report for console output.

    Parameters
    ----------
    report : dict
        As returned by :func:`get_daily_report`.

    Returns
    -------
    str
        Multi-line formatted string.
    """
    width = 39
    bar = "\u2550" * width

    net = report["net_pnl"]
    net_sign = "+" if net >= 0 else ""
    cum = report["cumulative_pnl"]
    cum_sign = "+" if cum >= 0 else ""

    streak = report["current_streak"]
    if streak > 0:
        streak_label = f"+{streak} (winning)"
    elif streak < 0:
        streak_label = f"{streak} (losing)"
    else:
        streak_label = "0"

    lines = [
        bar,
        f"  PAVLOV DAILY REPORT \u2014 {report['date']}",
        bar,
        f"  Trades today:    {report['trades']}",
        f"  Wins:            {report['wins']}/{report['trades']} ({report['win_rate']:.1f}%)",
        f"  P&L today:       {net_sign}${abs(net):.2f}",
        f"  Fees:            ${report['fees']:.2f}",
        f"  Net P&L:         {net_sign}${abs(net):.2f}",
        f"  Bankroll:        ${report['bankroll']:.2f}",
        f"  Cumulative P&L:  {cum_sign}${abs(cum):.2f}",
        f"  Current streak:  {streak_label}",
        f"  Win rate (all):  {report['win_rate']:.1f}%",
        bar,
    ]

    return "\n".join(lines)
