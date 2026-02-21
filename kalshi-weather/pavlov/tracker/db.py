"""SQLite database schema, connection management, and CRUD operations."""

import json
import sqlite3
from pathlib import Path

from pavlov.config import get_project_root

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    city_id         TEXT NOT NULL,
    date            TEXT NOT NULL,
    predicted_high  REAL NOT NULL,
    confidence      REAL NOT NULL,
    primary_bracket TEXT NOT NULL,
    adjacent_bracket TEXT,
    reasoning       TEXT,
    weather_data    TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(city_id, date)
);

CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id   INTEGER REFERENCES predictions(id),
    city_id         TEXT NOT NULL,
    date            TEXT NOT NULL,
    bracket         TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    side            TEXT NOT NULL,
    price_cents     INTEGER NOT NULL,
    contracts       INTEGER NOT NULL,
    outlay_cents    INTEGER NOT NULL,
    order_id        TEXT,
    is_paper        BOOLEAN DEFAULT 0,
    status          TEXT DEFAULT 'pending',
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settlements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id        INTEGER REFERENCES trades(id),
    city_id         TEXT NOT NULL,
    date            TEXT NOT NULL,
    bracket         TEXT NOT NULL,
    actual_high_f   REAL,
    market_result   TEXT,
    revenue_cents   INTEGER DEFAULT 0,
    cost_cents      INTEGER NOT NULL,
    fee_cents       INTEGER DEFAULT 0,
    net_pnl_cents   INTEGER NOT NULL,
    roi_pct         REAL NOT NULL,
    settled_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_summary (
    date            TEXT PRIMARY KEY,
    total_trades    INTEGER,
    wins            INTEGER,
    losses          INTEGER,
    gross_pnl_cents INTEGER,
    fees_cents      INTEGER,
    net_pnl_cents   INTEGER,
    bankroll_after  INTEGER,
    cumulative_pnl  INTEGER,
    win_rate        REAL,
    current_streak  INTEGER,
    longest_streak  INTEGER
);
"""

# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------


def get_db(db_path: str = None) -> sqlite3.Connection:
    """Get database connection. Creates tables if they don't exist.

    Parameters
    ----------
    db_path : str, optional
        Path to the SQLite database file.  When *None*, defaults to
        ``{project_root}/pavlov.db``.

    Returns
    -------
    sqlite3.Connection
        A connection with ``row_factory`` set to ``sqlite3.Row`` so that
        rows behave like dictionaries.
    """
    if db_path is None:
        db_path = str(get_project_root() / "pavlov.db")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection):
    """Create all tables if they don't exist."""
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


# ---------------------------------------------------------------------------
# CRUD — predictions
# ---------------------------------------------------------------------------


def insert_prediction(
    conn: sqlite3.Connection,
    city_id: str,
    date: str,
    predicted_high: float,
    confidence: float,
    primary_bracket: str,
    adjacent_bracket: str = None,
    reasoning: str = None,
    weather_data=None,
) -> int:
    """Insert a prediction, return the prediction ID.

    ``weather_data`` can be a dict/list; it will be serialised to JSON.
    Raises ``sqlite3.IntegrityError`` if a prediction for the same
    (city_id, date) pair already exists.
    """
    if weather_data is not None and not isinstance(weather_data, str):
        weather_data = json.dumps(weather_data)

    cur = conn.execute(
        """
        INSERT INTO predictions
            (city_id, date, predicted_high, confidence,
             primary_bracket, adjacent_bracket, reasoning, weather_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            city_id,
            date,
            predicted_high,
            confidence,
            primary_bracket,
            adjacent_bracket,
            reasoning,
            weather_data,
        ),
    )
    conn.commit()
    return cur.lastrowid


# ---------------------------------------------------------------------------
# CRUD — trades
# ---------------------------------------------------------------------------


def insert_trade(
    conn: sqlite3.Connection,
    prediction_id: int,
    city_id: str,
    date: str,
    bracket: str,
    ticker: str,
    side: str,
    price_cents: int,
    contracts: int,
    outlay_cents: int,
    order_id: str = None,
    is_paper: bool = False,
) -> int:
    """Insert a trade, return the trade ID."""
    cur = conn.execute(
        """
        INSERT INTO trades
            (prediction_id, city_id, date, bracket, ticker, side,
             price_cents, contracts, outlay_cents, order_id, is_paper)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            prediction_id,
            city_id,
            date,
            bracket,
            ticker,
            side,
            price_cents,
            contracts,
            outlay_cents,
            order_id,
            1 if is_paper else 0,
        ),
    )
    conn.commit()
    return cur.lastrowid


def update_trade_status(
    conn: sqlite3.Connection,
    trade_id: int,
    status: str,
    order_id: str = None,
):
    """Update trade status (pending, filled, settled, canceled).

    Optionally update the ``order_id`` at the same time (e.g. when an
    exchange order is acknowledged).
    """
    if order_id is not None:
        conn.execute(
            "UPDATE trades SET status = ?, order_id = ? WHERE id = ?",
            (status, order_id, trade_id),
        )
    else:
        conn.execute(
            "UPDATE trades SET status = ? WHERE id = ?",
            (status, trade_id),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# CRUD — settlements
# ---------------------------------------------------------------------------


def insert_settlement(
    conn: sqlite3.Connection,
    trade_id: int,
    city_id: str,
    date: str,
    bracket: str,
    actual_high_f: float,
    market_result: str,
    revenue_cents: int,
    cost_cents: int,
    fee_cents: int,
    net_pnl_cents: int,
    roi_pct: float,
) -> int:
    """Insert a settlement record, return the settlement ID."""
    cur = conn.execute(
        """
        INSERT INTO settlements
            (trade_id, city_id, date, bracket, actual_high_f, market_result,
             revenue_cents, cost_cents, fee_cents, net_pnl_cents, roi_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trade_id,
            city_id,
            date,
            bracket,
            actual_high_f,
            market_result,
            revenue_cents,
            cost_cents,
            fee_cents,
            net_pnl_cents,
            roi_pct,
        ),
    )
    conn.commit()
    return cur.lastrowid


# ---------------------------------------------------------------------------
# CRUD — daily summary
# ---------------------------------------------------------------------------


def update_daily_summary(
    conn: sqlite3.Connection,
    date: str,
    total_trades: int,
    wins: int,
    losses: int,
    gross_pnl_cents: int,
    fees_cents: int,
    net_pnl_cents: int,
    bankroll_after: int,
    cumulative_pnl: int,
    win_rate: float,
    current_streak: int,
    longest_streak: int,
):
    """Insert or replace daily summary for a given date."""
    conn.execute(
        """
        INSERT OR REPLACE INTO daily_summary
            (date, total_trades, wins, losses, gross_pnl_cents, fees_cents,
             net_pnl_cents, bankroll_after, cumulative_pnl, win_rate,
             current_streak, longest_streak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            date,
            total_trades,
            wins,
            losses,
            gross_pnl_cents,
            fees_cents,
            net_pnl_cents,
            bankroll_after,
            cumulative_pnl,
            win_rate,
            current_streak,
            longest_streak,
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def get_trades_by_date(conn: sqlite3.Connection, date: str) -> list:
    """Get all trades for a specific date, returned as a list of dicts."""
    cur = conn.execute("SELECT * FROM trades WHERE date = ?", (date,))
    return [dict(row) for row in cur.fetchall()]


def get_unsettled_trades(conn: sqlite3.Connection) -> list:
    """Get all trades whose status is neither 'settled' nor 'canceled'."""
    cur = conn.execute(
        "SELECT * FROM trades WHERE status NOT IN ('settled', 'canceled')"
    )
    return [dict(row) for row in cur.fetchall()]


def get_prediction_by_city_date(
    conn: sqlite3.Connection, city_id: str, date: str
) -> dict | None:
    """Get prediction for a city on a date, or None if not found."""
    cur = conn.execute(
        "SELECT * FROM predictions WHERE city_id = ? AND date = ?",
        (city_id, date),
    )
    row = cur.fetchone()
    return dict(row) if row else None
