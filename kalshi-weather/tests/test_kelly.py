"""Tests for Kelly criterion position sizing."""

import math

import pytest

from pavlov.trading.kelly import (
    KellyInput,
    KellyResult,
    KellySizer,
    PortfolioState,
    kelly_contracts,
    kelly_fraction,
)


# ---------------------------------------------------------------------------
# Standalone helper tests
# ---------------------------------------------------------------------------


class TestKellyFraction:
    """Tests for the raw kelly_fraction() helper."""

    def test_high_edge_example(self):
        """kelly_fraction(0.92, 0.39) should be approximately 0.869."""
        f = kelly_fraction(0.92, 0.39)
        assert f == pytest.approx(0.8689, abs=0.001)

    def test_no_edge(self):
        """p == c means zero edge, fraction should be 0."""
        f = kelly_fraction(0.50, 0.50)
        assert f == pytest.approx(0.0, abs=1e-9)

    def test_negative_edge(self):
        """p < c means negative fraction (no bet)."""
        f = kelly_fraction(0.30, 0.50)
        assert f < 0

    def test_extreme_edge(self):
        """Very high probability, low price should give fraction near 1."""
        f = kelly_fraction(0.99, 0.01)
        # (0.99 - 0.01) / (1 - 0.01) = 0.98 / 0.99 ~ 0.9899
        assert f == pytest.approx(0.98 / 0.99, abs=1e-6)


class TestKellyContracts:
    """Tests for the quick one-shot kelly_contracts() helper."""

    def test_basic_contract_count(self):
        """Sanity check: reasonable inputs produce a positive integer."""
        contracts = kelly_contracts(500, 0.70, 0.40, risk_tolerance=0.5)
        assert isinstance(contracts, int)
        assert contracts > 0

    def test_no_edge_returns_zero(self):
        """When p < c, no contracts should be recommended."""
        contracts = kelly_contracts(1000, 0.30, 0.50, risk_tolerance=0.5)
        assert contracts == 0

    def test_floor_behavior(self):
        """Contract count should be floored, never rounded up."""
        # f* = (0.60 - 0.40) / (1 - 0.40) = 0.3333...
        # half-kelly: 0.1667, dollar = 1000 * 0.1667 = 166.67
        # contracts = floor(166.67 / 0.40) = floor(416.67) = 416
        contracts = kelly_contracts(1000, 0.60, 0.40, risk_tolerance=0.5)
        assert contracts == 416


# ---------------------------------------------------------------------------
# KellyInput validation tests
# ---------------------------------------------------------------------------


class TestKellyInputValidation:
    """Tests for KellyInput dataclass validation."""

    def test_valid_input(self):
        inp = KellyInput(
            bankroll=500,
            estimated_prob=0.60,
            contract_price=0.40,
            risk_tolerance=0.25,
            label="test",
        )
        assert inp.bankroll == 500

    def test_prob_out_of_range_high(self):
        with pytest.raises(ValueError, match="estimated_prob"):
            KellyInput(500, 1.0, 0.40, 0.25)

    def test_prob_out_of_range_low(self):
        with pytest.raises(ValueError, match="estimated_prob"):
            KellyInput(500, 0.0, 0.40, 0.25)

    def test_price_out_of_range(self):
        with pytest.raises(ValueError, match="contract_price"):
            KellyInput(500, 0.50, 1.00, 0.25)

    def test_negative_bankroll(self):
        with pytest.raises(ValueError, match="bankroll"):
            KellyInput(-100, 0.50, 0.40, 0.25)

    def test_risk_tolerance_out_of_range(self):
        with pytest.raises(ValueError, match="risk_tolerance"):
            KellyInput(500, 0.50, 0.40, 1.5)


# ---------------------------------------------------------------------------
# PortfolioState tests
# ---------------------------------------------------------------------------


class TestPortfolioState:
    """Tests for PortfolioState tracking."""

    def test_empty_portfolio(self):
        ps = PortfolioState()
        assert ps.n_positions == 0
        assert ps.total_exposure == 0.0

    def test_add_position(self):
        ps = PortfolioState()
        ps.add_position("NYC high", contracts=10, price=0.39, prob=0.80)
        assert ps.n_positions == 1
        assert ps.total_exposure == pytest.approx(3.90, abs=0.01)

    def test_add_multiple_positions(self):
        ps = PortfolioState()
        ps.add_position("pos1", contracts=10, price=0.50, prob=0.70)
        ps.add_position("pos2", contracts=20, price=0.30, prob=0.60)
        assert ps.n_positions == 2
        # 10*0.50 + 20*0.30 = 5.00 + 6.00 = 11.00
        assert ps.total_exposure == pytest.approx(11.0, abs=0.01)

    def test_remove_position(self):
        ps = PortfolioState()
        ps.add_position("keep", contracts=5, price=0.40, prob=0.60)
        ps.add_position("drop", contracts=10, price=0.50, prob=0.70)
        ps.remove_position("drop")
        assert ps.n_positions == 1
        assert ps.total_exposure == pytest.approx(2.0, abs=0.01)

    def test_remove_nonexistent_no_error(self):
        ps = PortfolioState()
        ps.add_position("pos1", contracts=5, price=0.40, prob=0.60)
        ps.remove_position("does_not_exist")
        assert ps.n_positions == 1


# ---------------------------------------------------------------------------
# KellySizer core tests
# ---------------------------------------------------------------------------


class TestKellySizerEdge:
    """Tests for edge detection and rejection logic."""

    def test_zero_edge_no_bet(self):
        """p=0.28, c=0.28 -> edge=0, no bet."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.28, 0.28, 0.25, "zero edge")
        result = sizer.size(inp)
        assert result.contracts == 0
        assert result.recommended is False
        assert result.edge == pytest.approx(0.0, abs=1e-9)

    def test_negative_edge_no_bet(self):
        """p < c means negative edge, should not bet."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.30, 0.50, 0.25, "negative edge")
        result = sizer.size(inp)
        assert result.contracts == 0
        assert result.recommended is False

    def test_edge_below_min_edge_no_bet(self):
        """Edge of 1% is below the default 2% minimum."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.41, 0.40, 0.25, "tiny edge")
        result = sizer.size(inp)
        assert result.contracts == 0
        assert result.recommended is False
        assert "below minimum threshold" in result.reason

    def test_sufficient_edge_bets(self):
        """Edge well above threshold should produce a bet."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.70, 0.40, 0.25, "good edge")
        result = sizer.size(inp)
        assert result.contracts > 0
        assert result.recommended is True


class TestKellySizerWorkedExample:
    """Worked example from the task spec."""

    def test_quarter_kelly_68_contracts(self):
        """bankroll=$500, p=0.52, c=0.39, quarter-Kelly -> 68 contracts.

        Math:
          f* = (0.52 - 0.39) / (1 - 0.39) = 0.13 / 0.61 = 0.21311...
          quarter = 0.21311 * 0.25 = 0.05328
          bet = 500 * 0.05328 = 26.639
          contracts = floor(26.639 / 0.39) = floor(68.31) = 68
        """
        sizer = KellySizer()
        inp = KellyInput(
            bankroll=500,
            estimated_prob=0.52,
            contract_price=0.39,
            risk_tolerance=0.25,
            label="worked example",
        )
        result = sizer.size(inp)
        assert result.contracts == 68
        assert result.recommended is True

        # Verify dollar outlay
        assert result.dollar_outlay == pytest.approx(68 * 0.39, abs=0.01)

        # Verify max profit and max loss
        assert result.max_profit == pytest.approx(68 * 0.61, abs=0.01)
        assert result.max_loss == pytest.approx(68 * 0.39, abs=0.01)

    def test_full_kelly_fraction_value(self):
        """Full Kelly fraction should be (0.52-0.39)/(1-0.39) ~ 0.2131."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.52, 0.39, 0.25, "check fraction")
        result = sizer.size(inp)
        assert result.full_kelly_fraction == pytest.approx(0.2131, abs=0.001)


class TestKellySizerGuardrails:
    """Tests for hard guardrail enforcement."""

    def test_single_position_cap_10_percent(self):
        """Even with huge edge, a single position can't exceed 10% of bankroll."""
        sizer = KellySizer()
        inp = KellyInput(
            bankroll=1000,
            estimated_prob=0.95,
            contract_price=0.10,
            risk_tolerance=1.0,  # full Kelly
            label="huge edge",
        )
        result = sizer.size(inp)
        # Full Kelly would be (0.95-0.10)/(1-0.10) = 0.9444 -> 94.4% of bankroll
        # But capped at 10% -> $100 max -> floor(100/0.10) = 1000
        # But then MAX_CONTRACTS_HARD_CAP = 500
        assert result.bankroll_fraction <= 0.10 + 0.001
        assert result.contracts <= 500

    def test_max_contracts_hard_cap(self):
        """Contracts should never exceed MAX_CONTRACTS_HARD_CAP."""
        sizer = KellySizer()
        inp = KellyInput(
            bankroll=100_000,
            estimated_prob=0.95,
            contract_price=0.01,
            risk_tolerance=1.0,
            label="big bankroll cheap contract",
        )
        result = sizer.size(inp)
        assert result.contracts <= 500

    def test_custom_guardrails(self):
        """Constructor params should override default guardrails."""
        sizer = KellySizer(
            max_single_pct=0.05,
            min_edge=0.10,
        )
        # Edge = 0.70 - 0.40 = 0.30, above custom min 0.10
        inp = KellyInput(1000, 0.70, 0.40, 0.50, "custom guardrails")
        result = sizer.size(inp)
        assert result.recommended is True
        # Fraction should be capped at 5%
        assert result.bankroll_fraction <= 0.05 + 0.001

    def test_custom_min_edge_blocks_bet(self):
        """Higher min_edge should block bets that would otherwise pass."""
        sizer = KellySizer(min_edge=0.20)
        # Edge = 0.55 - 0.40 = 0.15, below custom min 0.20
        inp = KellyInput(1000, 0.55, 0.40, 0.50, "blocked by custom min")
        result = sizer.size(inp)
        assert result.contracts == 0
        assert result.recommended is False

    def test_daily_exposure_cap(self):
        """Daily deployment limit should constrain sizing."""
        sizer = KellySizer()
        bankroll = 1000

        # Deploy 20% of bankroll first
        sizer.record_deployment(200.0)

        # Now only 5% daily room left (25% - 20%)
        inp = KellyInput(bankroll, 0.80, 0.30, 0.50, "after prior deployment")
        result = sizer.size(inp)

        # Dollar outlay should be at most ~$50 (5% of $1000)
        assert result.dollar_outlay <= 50.01

    def test_portfolio_exposure_cap(self):
        """Portfolio exposure limit should constrain sizing."""
        sizer = KellySizer()
        bankroll = 1000

        portfolio = PortfolioState()
        # Already have $250 exposed (25% of $1000)
        portfolio.add_position("existing", contracts=500, price=0.50, prob=0.70)

        # Portfolio cap is 30%, so only $50 room left
        inp = KellyInput(bankroll, 0.80, 0.30, 0.50, "near portfolio cap")
        result = sizer.size(inp, portfolio=portfolio)

        assert result.dollar_outlay <= 50.01


class TestKellySizerMultiPosition:
    """Tests for multi-position discount and portfolio sizing."""

    def test_multi_position_reduces_allocation(self):
        """Having open positions should reduce the sized allocation."""
        sizer = KellySizer()
        inp = KellyInput(1000, 0.70, 0.40, 0.50, "multi-position test")

        # Size with no existing positions
        result_alone = sizer.size(inp)

        # Size with 2 existing positions
        portfolio = PortfolioState()
        portfolio.add_position("pos1", contracts=5, price=0.30, prob=0.60)
        portfolio.add_position("pos2", contracts=5, price=0.35, prob=0.65)
        result_with_positions = sizer.size(inp, portfolio=portfolio)

        # With 2 open positions, discount = 1/3, so should be smaller
        assert result_with_positions.contracts <= result_alone.contracts

    def test_size_portfolio_descending_edge(self):
        """size_portfolio should process bets in descending edge order."""
        sizer = KellySizer()

        inputs = [
            KellyInput(1000, 0.55, 0.40, 0.25, "low_edge"),    # edge 0.15
            KellyInput(1000, 0.80, 0.30, 0.25, "high_edge"),   # edge 0.50
            KellyInput(1000, 0.65, 0.45, 0.25, "mid_edge"),    # edge 0.20
        ]

        results = sizer.size_portfolio(inputs)

        # Should have 3 results
        assert len(results) == 3

        # First processed should be highest edge
        assert results[0].label == "high_edge"
        assert results[1].label == "mid_edge"
        assert results[2].label == "low_edge"

    def test_size_portfolio_cumulative_exposure(self):
        """Later positions in a portfolio sizing should see reduced room."""
        sizer = KellySizer()

        # All identical inputs with good edge
        inputs = [
            KellyInput(1000, 0.70, 0.40, 0.50, f"pos_{i}")
            for i in range(5)
        ]

        results = sizer.size_portfolio(inputs)

        # Each subsequent position should get equal or fewer contracts
        # due to simultaneous discount and portfolio/daily caps
        recommended = [r for r in results if r.recommended]
        if len(recommended) >= 2:
            for i in range(1, len(recommended)):
                assert recommended[i].contracts <= recommended[i - 1].contracts


class TestKellySizerDailyTracking:
    """Tests for daily deployment tracking."""

    def test_record_deployment(self):
        sizer = KellySizer()
        sizer.record_deployment(100.0)
        # Internal state should reflect deployment
        assert sizer._daily_deployed == 100.0

    def test_reset_daily(self):
        sizer = KellySizer()
        sizer.record_deployment(200.0)
        sizer.reset_daily()
        assert sizer._daily_deployed == 0.0

    def test_multiple_deployments_accumulate(self):
        sizer = KellySizer()
        sizer.record_deployment(50.0)
        sizer.record_deployment(75.0)
        assert sizer._daily_deployed == 125.0


# ---------------------------------------------------------------------------
# Edge case and result field tests
# ---------------------------------------------------------------------------


class TestKellyResultFields:
    """Verify result fields are computed correctly."""

    def test_edge_field(self):
        sizer = KellySizer()
        inp = KellyInput(500, 0.60, 0.40, 0.25, "edge check")
        result = sizer.size(inp)
        assert result.edge == pytest.approx(0.20, abs=0.001)

    def test_ev_per_contract(self):
        """EV per contract should equal edge (p - c)."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.60, 0.40, 0.25, "ev check")
        result = sizer.size(inp)
        assert result.expected_value_per_contract == pytest.approx(0.20, abs=0.001)

    def test_max_profit_and_loss(self):
        """max_profit = contracts * (1-c), max_loss = contracts * c."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.60, 0.40, 0.25, "profit/loss check")
        result = sizer.size(inp)
        if result.contracts > 0:
            assert result.max_profit == pytest.approx(
                result.contracts * 0.60, abs=0.01
            )
            assert result.max_loss == pytest.approx(
                result.contracts * 0.40, abs=0.01
            )

    def test_dollar_outlay_matches(self):
        """dollar_outlay should equal contracts * price."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.60, 0.40, 0.25, "outlay check")
        result = sizer.size(inp)
        if result.contracts > 0:
            assert result.dollar_outlay == pytest.approx(
                result.contracts * 0.40, abs=0.01
            )

    def test_bankroll_fraction(self):
        """bankroll_fraction should equal dollar_outlay / bankroll."""
        sizer = KellySizer()
        inp = KellyInput(500, 0.60, 0.40, 0.25, "fraction check")
        result = sizer.size(inp)
        if result.contracts > 0:
            expected_fraction = result.dollar_outlay / 500
            assert result.bankroll_fraction == pytest.approx(
                expected_fraction, abs=0.001
            )
