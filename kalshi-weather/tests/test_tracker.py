"""Tests for pavlov.tracker — SQLite persistence and statistics."""

import sqlite3

import pytest

from pavlov.tracker.db import (
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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def conn():
    """In-memory SQLite connection with tables initialised."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    init_db(c)
    return c


def _insert_sample_prediction(conn, city_id="AUS", date="2026-02-21"):
    """Helper to insert a sample prediction and return its ID."""
    return insert_prediction(
        conn,
        city_id=city_id,
        date=date,
        predicted_high=72.5,
        confidence=0.85,
        primary_bracket="70-74",
        adjacent_bracket="75-79",
        reasoning="Model ensemble agrees on low 70s",
        weather_data={"temp": 72.5, "source": "test"},
    )


def _insert_sample_trade(conn, prediction_id, city_id="AUS", date="2026-02-21"):
    """Helper to insert a sample trade and return its ID."""
    return insert_trade(
        conn,
        prediction_id=prediction_id,
        city_id=city_id,
        date=date,
        bracket="70-74",
        ticker="KXHIGHAUSW-26FEB21-T70",
        side="yes",
        price_cents=65,
        contracts=3,
        outlay_cents=195,
        order_id=None,
        is_paper=True,
    )


# ===================================================================
# Table creation
# ===================================================================


class TestTableCreation:
    def test_tables_exist(self, conn):
        """All four tables should exist after init_db."""
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = sorted(row["name"] for row in cur.fetchall())
        assert "daily_summary" in tables
        assert "predictions" in tables
        assert "settlements" in tables
        assert "trades" in tables

    def test_init_db_idempotent(self, conn):
        """Calling init_db twice should not raise."""
        init_db(conn)
        init_db(conn)


# ===================================================================
# Predictions
# ===================================================================


class TestPredictions:
    def test_insert_prediction(self, conn):
        pid = _insert_sample_prediction(conn)
        assert pid is not None and pid > 0

        row = get_prediction_by_city_date(conn, "AUS", "2026-02-21")
        assert row is not None
        assert row["predicted_high"] == 72.5
        assert row["confidence"] == 0.85
        assert row["primary_bracket"] == "70-74"
        assert row["adjacent_bracket"] == "75-79"
        assert row["reasoning"] == "Model ensemble agrees on low 70s"
        # weather_data is stored as JSON string
        assert '"temp"' in row["weather_data"]

    def test_prediction_uniqueness(self, conn):
        """Inserting a duplicate (city_id, date) should raise IntegrityError."""
        _insert_sample_prediction(conn)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_sample_prediction(conn)

    def test_prediction_not_found(self, conn):
        result = get_prediction_by_city_date(conn, "MISSING", "2099-01-01")
        assert result is None


# ===================================================================
# Trades
# ===================================================================


class TestTrades:
    def test_insert_trade(self, conn):
        pid = _insert_sample_prediction(conn)
        tid = _insert_sample_trade(conn, pid)
        assert tid is not None and tid > 0

        trades = get_trades_by_date(conn, "2026-02-21")
        assert len(trades) == 1
        t = trades[0]
        assert t["prediction_id"] == pid
        assert t["city_id"] == "AUS"
        assert t["bracket"] == "70-74"
        assert t["side"] == "yes"
        assert t["price_cents"] == 65
        assert t["contracts"] == 3
        assert t["outlay_cents"] == 195
        assert t["is_paper"] == 1
        assert t["status"] == "pending"

    def test_update_trade_status(self, conn):
        pid = _insert_sample_prediction(conn)
        tid = _insert_sample_trade(conn, pid)

        update_trade_status(conn, tid, "filled", order_id="ORD-123")

        trades = get_trades_by_date(conn, "2026-02-21")
        assert trades[0]["status"] == "filled"
        assert trades[0]["order_id"] == "ORD-123"

    def test_update_trade_status_without_order_id(self, conn):
        pid = _insert_sample_prediction(conn)
        tid = _insert_sample_trade(conn, pid)

        update_trade_status(conn, tid, "canceled")

        trades = get_trades_by_date(conn, "2026-02-21")
        assert trades[0]["status"] == "canceled"
        assert trades[0]["order_id"] is None

    def test_get_trades_by_date_empty(self, conn):
        result = get_trades_by_date(conn, "2099-01-01")
        assert result == []


# ===================================================================
# Unsettled trades
# ===================================================================


class TestUnsettledTrades:
    def test_get_unsettled_trades(self, conn):
        pid = _insert_sample_prediction(conn)
        tid1 = _insert_sample_trade(conn, pid)
        tid2 = insert_trade(
            conn, pid, "AUS", "2026-02-21", "75-79",
            "KXHIGHAUSW-26FEB21-T75", "no", 30, 2, 60,
        )

        # One pending, one filled => both unsettled
        update_trade_status(conn, tid2, "filled")
        unsettled = get_unsettled_trades(conn)
        assert len(unsettled) == 2

        # Settle one
        update_trade_status(conn, tid1, "settled")
        unsettled = get_unsettled_trades(conn)
        assert len(unsettled) == 1
        assert unsettled[0]["id"] == tid2

    def test_canceled_trades_excluded(self, conn):
        pid = _insert_sample_prediction(conn)
        tid = _insert_sample_trade(conn, pid)
        update_trade_status(conn, tid, "canceled")

        unsettled = get_unsettled_trades(conn)
        assert len(unsettled) == 0


# ===================================================================
# Settlements
# ===================================================================


class TestSettlements:
    def test_insert_settlement(self, conn):
        pid = _insert_sample_prediction(conn)
        tid = _insert_sample_trade(conn, pid)

        sid = insert_settlement(
            conn,
            trade_id=tid,
            city_id="AUS",
            date="2026-02-21",
            bracket="70-74",
            actual_high_f=73.0,
            market_result="win",
            revenue_cents=300,
            cost_cents=195,
            fee_cents=10,
            net_pnl_cents=95,
            roi_pct=48.72,
        )
        assert sid is not None and sid > 0

        cur = conn.execute("SELECT * FROM settlements WHERE id = ?", (sid,))
        row = dict(cur.fetchone())
        assert row["actual_high_f"] == 73.0
        assert row["market_result"] == "win"
        assert row["revenue_cents"] == 300
        assert row["cost_cents"] == 195
        assert row["fee_cents"] == 10
        assert row["net_pnl_cents"] == 95
        assert abs(row["roi_pct"] - 48.72) < 0.01


# ===================================================================
# Daily summary
# ===================================================================


class TestDailySummary:
    def test_insert_daily_summary(self, conn):
        update_daily_summary(
            conn,
            date="2026-02-21",
            total_trades=4,
            wins=3,
            losses=1,
            gross_pnl_cents=1250,
            fees_cents=85,
            net_pnl_cents=1165,
            bankroll_after=51165,
            cumulative_pnl=1165,
            win_rate=75.0,
            current_streak=3,
            longest_streak=3,
        )

        cur = conn.execute("SELECT * FROM daily_summary WHERE date = ?", ("2026-02-21",))
        row = dict(cur.fetchone())
        assert row["total_trades"] == 4
        assert row["wins"] == 3
        assert row["losses"] == 1
        assert row["bankroll_after"] == 51165

    def test_daily_summary_replace(self, conn):
        """INSERT OR REPLACE should update existing row for same date."""
        update_daily_summary(
            conn, "2026-02-21", 4, 3, 1, 1250, 85, 1165, 51165, 1165, 75.0, 3, 3,
        )
        update_daily_summary(
            conn, "2026-02-21", 5, 4, 1, 1500, 100, 1400, 51400, 1400, 80.0, 4, 4,
        )

        cur = conn.execute("SELECT COUNT(*) AS cnt FROM daily_summary WHERE date = ?", ("2026-02-21",))
        assert cur.fetchone()["cnt"] == 1

        cur = conn.execute("SELECT * FROM daily_summary WHERE date = ?", ("2026-02-21",))
        row = dict(cur.fetchone())
        assert row["total_trades"] == 5
        assert row["wins"] == 4


# ===================================================================
# Stats — bankroll
# ===================================================================


class TestGetCurrentBankroll:
    def test_default_bankroll_no_data(self, conn):
        assert get_current_bankroll(conn) == 500.0

    def test_custom_default(self, conn):
        assert get_current_bankroll(conn, default_bankroll=1000.0) == 1000.0

    def test_bankroll_from_summary(self, conn):
        update_daily_summary(
            conn, "2026-02-20", 2, 1, 1, 0, 0, 0, 50000, 0, 50.0, 0, 0,
        )
        update_daily_summary(
            conn, "2026-02-21", 4, 3, 1, 1250, 85, 1165, 51165, 1165, 75.0, 3, 3,
        )
        # Should return the latest date's bankroll in dollars
        assert get_current_bankroll(conn) == 511.65


# ===================================================================
# Stats — win rate
# ===================================================================


class TestGetWinRate:
    def test_no_settlements(self, conn):
        assert get_win_rate(conn) == 0.0

    def test_win_rate(self, conn):
        pid = _insert_sample_prediction(conn)
        # Create 4 trades, 3 wins, 1 loss
        for i in range(4):
            tid = insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"TICKER-{i}", "yes", 65, 1, 65,
            )
            result = "win" if i < 3 else "loss"
            insert_settlement(
                conn, tid, "AUS", "2026-02-21", "70-74",
                73.0, result, 100 if result == "win" else 0,
                65, 5, 30 if result == "win" else -65, 46.0,
            )

        assert abs(get_win_rate(conn) - 0.75) < 0.001


# ===================================================================
# Stats — streaks
# ===================================================================


class TestGetCurrentStreak:
    def test_no_data(self, conn):
        assert get_current_streak(conn) == 0

    def test_winning_streak(self, conn):
        pid = _insert_sample_prediction(conn)
        for i in range(3):
            tid = insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"T-{i}", "yes", 65, 1, 65,
            )
            insert_settlement(
                conn, tid, "AUS", "2026-02-21", "70-74",
                73.0, "win", 100, 65, 5, 30, 46.0,
            )
        assert get_current_streak(conn) == 3

    def test_losing_streak(self, conn):
        pid = _insert_sample_prediction(conn)
        # One win, then two losses
        tid = insert_trade(conn, pid, "AUS", "2026-02-21", "70-74", "T-0", "yes", 65, 1, 65)
        insert_settlement(conn, tid, "AUS", "2026-02-21", "70-74", 73.0, "win", 100, 65, 5, 30, 46.0)

        for i in range(1, 3):
            tid = insert_trade(conn, pid, "AUS", "2026-02-21", "70-74", f"T-{i}", "yes", 65, 1, 65)
            insert_settlement(conn, tid, "AUS", "2026-02-21", "70-74", 80.0, "loss", 0, 65, 5, -70, -107.0)

        assert get_current_streak(conn) == -2


class TestGetLongestStreak:
    def test_no_data(self, conn):
        assert get_longest_streak(conn) == 0

    def test_longest_streak(self, conn):
        pid = _insert_sample_prediction(conn)
        # Pattern: W W W L W W
        results = ["win", "win", "win", "loss", "win", "win"]
        for i, result in enumerate(results):
            tid = insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"T-{i}", "yes", 65, 1, 65,
            )
            insert_settlement(
                conn, tid, "AUS", "2026-02-21", "70-74",
                73.0, result, 100 if result == "win" else 0,
                65, 5, 30 if result == "win" else -70, 46.0,
            )
        assert get_longest_streak(conn) == 3


# ===================================================================
# Stats — cumulative P&L
# ===================================================================


class TestGetCumulativePnl:
    def test_no_data(self, conn):
        assert get_cumulative_pnl(conn) == 0.0

    def test_cumulative_pnl(self, conn):
        pid = _insert_sample_prediction(conn)
        # Two wins at +30 cents each, one loss at -70 cents
        for i, (result, pnl) in enumerate([("win", 30), ("win", 30), ("loss", -70)]):
            tid = insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"T-{i}", "yes", 65, 1, 65,
            )
            insert_settlement(
                conn, tid, "AUS", "2026-02-21", "70-74",
                73.0, result, 100 if result == "win" else 0,
                65, 5, pnl, 46.0,
            )
        # 30 + 30 - 70 = -10 cents = -$0.10
        assert abs(get_cumulative_pnl(conn) - (-0.10)) < 0.001


# ===================================================================
# Stats — total trades
# ===================================================================


class TestGetTotalTrades:
    def test_no_trades(self, conn):
        assert get_total_trades(conn) == 0

    def test_total_trades(self, conn):
        pid = _insert_sample_prediction(conn)
        for i in range(5):
            insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"T-{i}", "yes", 65, 1, 65,
            )
        assert get_total_trades(conn) == 5


# ===================================================================
# Stats — daily report and format
# ===================================================================


class TestDailyReport:
    def test_daily_report_with_data(self, conn):
        pid = _insert_sample_prediction(conn)

        # 3 wins, 1 loss
        for i in range(4):
            tid = insert_trade(
                conn, pid, "AUS", "2026-02-21", "70-74",
                f"T-{i}", "yes", 65, 1, 65,
            )
            result = "win" if i < 3 else "loss"
            revenue = 100 if result == "win" else 0
            net_pnl = 30 if result == "win" else -70
            insert_settlement(
                conn, tid, "AUS", "2026-02-21", "70-74",
                73.0, result, revenue, 65, 5, net_pnl, 46.0,
            )

        # Add daily summary so bankroll is available
        update_daily_summary(
            conn, "2026-02-21", 4, 3, 1, 1250, 85, 1165, 51165, 1165, 75.0, 3, 3,
        )

        report = get_daily_report(conn, "2026-02-21")
        assert report["date"] == "2026-02-21"
        assert report["trades"] == 4
        assert report["wins"] == 3
        assert report["losses"] == 1
        assert abs(report["win_rate"] - 75.0) < 0.1

    def test_daily_report_empty(self, conn):
        report = get_daily_report(conn, "2099-01-01")
        assert report["trades"] == 0
        assert report["wins"] == 0


class TestFormatReport:
    def test_format_report_winning(self, conn):
        report = {
            "date": "2026-02-21",
            "trades": 4,
            "wins": 3,
            "losses": 1,
            "win_rate": 75.0,
            "gross_pnl": 12.50,
            "fees": 0.85,
            "net_pnl": 11.65,
            "bankroll": 511.65,
            "cumulative_pnl": 11.65,
            "current_streak": 3,
            "longest_streak": 3,
        }
        output = format_report(report)

        assert "PAVLOV DAILY REPORT" in output
        assert "2026-02-21" in output
        assert "Trades today:    4" in output
        assert "3/4 (75.0%)" in output
        assert "+$11.65" in output
        assert "$0.85" in output
        assert "$511.65" in output
        assert "+3 (winning)" in output

    def test_format_report_losing(self, conn):
        report = {
            "date": "2026-02-22",
            "trades": 2,
            "wins": 0,
            "losses": 2,
            "win_rate": 0.0,
            "gross_pnl": -5.00,
            "fees": 0.50,
            "net_pnl": -5.50,
            "bankroll": 494.50,
            "cumulative_pnl": -5.50,
            "current_streak": -2,
            "longest_streak": 3,
        }
        output = format_report(report)

        assert "-2 (losing)" in output
        assert "$5.50" in output  # absolute value shown

    def test_format_report_no_streak(self, conn):
        report = {
            "date": "2026-02-23",
            "trades": 0,
            "wins": 0,
            "losses": 0,
            "win_rate": 0.0,
            "gross_pnl": 0.0,
            "fees": 0.0,
            "net_pnl": 0.0,
            "bankroll": 500.0,
            "cumulative_pnl": 0.0,
            "current_streak": 0,
            "longest_streak": 0,
        }
        output = format_report(report)
        assert "Current streak:  0" in output
