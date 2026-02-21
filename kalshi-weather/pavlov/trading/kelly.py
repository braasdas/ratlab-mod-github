"""Kelly criterion position sizing for Kalshi binary weather contracts.

The Kelly formula for a binary YES contract paying $1 at cost c:

    f* = (p - c) / (1 - c)

where p is the estimated probability of YES and c is the contract price.
The numerator (p - c) is the edge; the denominator (1 - c) normalises by
the net-win payoff per dollar wagered.

Scaled Kelly: f = f* * risk_tolerance
Contracts:    floor(bankroll * f / c)

Reference: Kelly (1956) Bell Sys Tech J; Meister (2024) arXiv:2412.14144.
"""

from __future__ import annotations

import datetime
import math
import logging
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class KellyInput:
    """All inputs required to size a single Kalshi weather position."""

    bankroll: float          # Current available capital in dollars
    estimated_prob: float    # Probability that YES resolves (0.0-1.0)
    contract_price: float    # Kalshi ask price per contract (0.01-0.99)
    risk_tolerance: float    # Fractional Kelly multiplier (0.0-1.0)
    label: str = ""          # Human label, e.g. "NYC high 39-42F"

    def __post_init__(self):
        if not 0.0 < self.estimated_prob < 1.0:
            raise ValueError(
                f"estimated_prob must be in (0, 1), got {self.estimated_prob}"
            )
        if not 0.01 <= self.contract_price <= 0.99:
            raise ValueError(
                f"contract_price must be in [0.01, 0.99], got {self.contract_price}"
            )
        if not 0.0 <= self.risk_tolerance <= 1.0:
            raise ValueError(
                f"risk_tolerance must be in [0.0, 1.0], got {self.risk_tolerance}"
            )
        if self.bankroll <= 0:
            raise ValueError(f"bankroll must be positive, got {self.bankroll}")


@dataclass
class KellyResult:
    """Output from KellySizer.size()."""

    label: str
    contracts: int                     # Number of contracts (floor, never fractional)
    dollar_outlay: float               # contracts * contract_price
    bankroll_fraction: float           # dollar_outlay / bankroll
    full_kelly_fraction: float         # Raw Kelly fraction before scaling
    edge: float                        # p - c (positive = edge exists)
    expected_value_per_contract: float  # p - c
    max_profit: float                  # contracts * (1 - c)
    max_loss: float                    # contracts * c
    recommended: bool                  # False if no edge or guardrails block
    reason: str = ""                   # Why recommended=False, or sizing notes


@dataclass
class PortfolioState:
    """Tracks open positions for multi-position Kelly adjustment."""

    open_positions: List[dict] = field(default_factory=list)
    # Each dict: {"label": str, "contracts": int, "price": float, "prob": float}

    @property
    def total_exposure(self) -> float:
        """Total dollars currently at risk (sum of contract costs)."""
        return sum(p["contracts"] * p["price"] for p in self.open_positions)

    @property
    def n_positions(self) -> int:
        return len(self.open_positions)

    def add_position(
        self, label: str, contracts: int, price: float, prob: float
    ) -> None:
        self.open_positions.append({
            "label": label,
            "contracts": contracts,
            "price": price,
            "prob": prob,
        })

    def remove_position(self, label: str) -> None:
        self.open_positions = [
            p for p in self.open_positions if p["label"] != label
        ]


# ---------------------------------------------------------------------------
# Core sizer
# ---------------------------------------------------------------------------


class KellySizer:
    """Position sizer for Kalshi binary weather contracts using fractional Kelly.

    Kelly fraction is the CEILING, never the floor. Hard guardrails cannot be
    overridden by risk_tolerance. Multiple simultaneous positions reduce
    per-trade sizing. All monetary values are floats; contracts are integers.

    Guardrails (hard limits):
        MAX_SINGLE_POSITION_PCT : No single bet > this fraction of bankroll
        MAX_DAILY_EXPOSURE_PCT  : Total new capital deployed today <= this
        MAX_PORTFOLIO_EXPOSURE  : Sum of all open positions <= this fraction
        MIN_EDGE                : Don't bet if edge is below this threshold
        MIN_CONTRACTS           : Minimum viable position size
        MAX_CONTRACTS_HARD_CAP  : Absolute ceiling (safety net)
    """

    MAX_SINGLE_POSITION_PCT = 0.10   # 10% bankroll per position
    MAX_DAILY_EXPOSURE_PCT = 0.25    # 25% bankroll per day
    MAX_PORTFOLIO_EXPOSURE = 0.30    # 30% total portfolio
    MIN_EDGE = 0.02                  # 2% edge minimum
    MIN_CONTRACTS = 1
    MAX_CONTRACTS_HARD_CAP = 500

    def __init__(
        self,
        max_single_pct: float = MAX_SINGLE_POSITION_PCT,
        max_daily_pct: float = MAX_DAILY_EXPOSURE_PCT,
        max_portfolio_pct: float = MAX_PORTFOLIO_EXPOSURE,
        min_edge: float = MIN_EDGE,
    ):
        self.max_single_pct = max_single_pct
        self.max_daily_pct = max_daily_pct
        self.max_portfolio_pct = max_portfolio_pct
        self.min_edge = min_edge
        self._daily_deployed: float = 0.0
        self._daily_date: Optional[datetime.date] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def size(
        self,
        inp: KellyInput,
        portfolio: Optional[PortfolioState] = None,
    ) -> KellyResult:
        """Calculate the number of Kalshi YES contracts to buy.

        Parameters
        ----------
        inp : KellyInput
            Bankroll, probabilities, price, and risk tolerance.
        portfolio : PortfolioState, optional
            Current open positions for simultaneous-bet reduction.

        Returns
        -------
        KellyResult
            Contracts, sizing rationale, and recommendation.
        """
        p = inp.estimated_prob
        c = inp.contract_price

        # Step 1: Raw Kelly fraction  f* = (p - c) / (1 - c)
        full_kelly_f = (p - c) / (1.0 - c)
        edge = p - c
        ev_per_contract = p - c  # E[payout] - cost = p*1 + (1-p)*0 - c

        # Step 2: Check for sufficient edge
        if edge < self.min_edge:
            return self._no_bet_result(
                inp, full_kelly_f, edge, ev_per_contract,
                reason=(
                    f"Edge {edge:.1%} is below minimum threshold "
                    f"{self.min_edge:.1%}. Market price ({c:.2f}) too close "
                    f"to or above your estimate ({p:.2f})."
                ),
            )

        if full_kelly_f <= 0:
            return self._no_bet_result(
                inp, full_kelly_f, edge, ev_per_contract,
                reason=f"Kelly fraction non-positive ({full_kelly_f:.4f}). No position.",
            )

        # Step 3: Scale by risk_tolerance (fractional Kelly)
        scaled_f = full_kelly_f * inp.risk_tolerance

        # Step 4: Simultaneous-position discount: f / (1 + n_open)
        n_open = portfolio.n_positions if portfolio else 0
        if n_open > 0:
            simultaneous_discount = 1.0 / (1.0 + n_open)
            scaled_f *= simultaneous_discount
            logger.debug(
                "Applied simultaneous discount 1/%d for %d open positions",
                1 + n_open, n_open,
            )

        # Step 5: Cap at hard guardrails
        # 5a. Single-position ceiling
        f_after_single_cap = min(scaled_f, self.max_single_pct)

        # 5b. Portfolio exposure ceiling
        portfolio_exposure = portfolio.total_exposure if portfolio else 0.0
        remaining_portfolio_room = max(
            0.0, self.max_portfolio_pct * inp.bankroll - portfolio_exposure
        )

        # 5c. Daily deployment ceiling
        self._reset_daily_if_needed()
        remaining_daily_room = max(
            0.0, self.max_daily_pct * inp.bankroll - self._daily_deployed
        )

        # Step 6: Convert fraction to dollar amount
        dollar_from_kelly = f_after_single_cap * inp.bankroll
        dollar_to_deploy = min(
            dollar_from_kelly,
            remaining_portfolio_room,
            remaining_daily_room,
        )

        # Step 7: Convert dollars to whole contracts
        contracts_float = dollar_to_deploy / c
        contracts = max(0, int(math.floor(contracts_float)))
        contracts = min(contracts, self.MAX_CONTRACTS_HARD_CAP)

        if contracts < self.MIN_CONTRACTS:
            return self._no_bet_result(
                inp, full_kelly_f, edge, ev_per_contract,
                reason=(
                    f"Position too small after guardrails "
                    f"({contracts_float:.2f} contracts). "
                    f"Not worth the operational cost."
                ),
            )

        # Step 8: Build final result
        dollar_outlay = contracts * c
        actual_fraction = dollar_outlay / inp.bankroll
        max_profit = contracts * (1.0 - c)
        max_loss = contracts * c

        notes = []
        if scaled_f < full_kelly_f:
            detail = f"risk_tolerance={inp.risk_tolerance:.1f}"
            if n_open > 0:
                detail += f", {n_open}-position discount"
            notes.append(
                f"Full Kelly {full_kelly_f:.1%} -> scaled to "
                f"{scaled_f:.1%} ({detail})"
            )
        if f_after_single_cap < scaled_f:
            notes.append(
                f"Single-position cap applied ({self.max_single_pct:.0%} max)"
            )
        if dollar_to_deploy < dollar_from_kelly:
            notes.append(
                f"Guardrail limited deployment: "
                f"portfolio_room=${remaining_portfolio_room:.2f}, "
                f"daily_room=${remaining_daily_room:.2f}"
            )

        return KellyResult(
            label=inp.label,
            contracts=contracts,
            dollar_outlay=round(dollar_outlay, 2),
            bankroll_fraction=round(actual_fraction, 4),
            full_kelly_fraction=round(full_kelly_f, 4),
            edge=round(edge, 4),
            expected_value_per_contract=round(ev_per_contract, 4),
            max_profit=round(max_profit, 2),
            max_loss=round(max_loss, 2),
            recommended=True,
            reason=" | ".join(notes) if notes else "Within all guardrails.",
        )

    def size_portfolio(
        self,
        inputs: List[KellyInput],
        portfolio: Optional[PortfolioState] = None,
    ) -> List[KellyResult]:
        """Size multiple positions simultaneously.

        Processes in descending edge order (best opportunities first) and
        threads cumulative exposure through each sizing call so earlier
        (better-edge) bets get priority.
        """
        sorted_inputs = sorted(
            inputs,
            key=lambda x: x.estimated_prob - x.contract_price,
            reverse=True,
        )

        running_portfolio = portfolio or PortfolioState()
        results: List[KellyResult] = []

        for inp in sorted_inputs:
            result = self.size(inp, portfolio=running_portfolio)
            results.append(result)

            if result.recommended and result.contracts > 0:
                running_portfolio.add_position(
                    label=inp.label,
                    contracts=result.contracts,
                    price=inp.contract_price,
                    prob=inp.estimated_prob,
                )
                self._daily_deployed += result.dollar_outlay

        return results

    def record_deployment(self, dollars: float) -> None:
        """Track daily exposure after placing a bet."""
        self._reset_daily_if_needed()
        self._daily_deployed += dollars

    def reset_daily(self) -> None:
        """Force-reset daily deployment counter (e.g. at midnight)."""
        self._daily_deployed = 0.0
        self._daily_date = datetime.date.today()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _reset_daily_if_needed(self) -> None:
        today = datetime.date.today()
        if self._daily_date != today:
            self._daily_deployed = 0.0
            self._daily_date = today

    @staticmethod
    def _no_bet_result(
        inp: KellyInput,
        full_kelly_f: float,
        edge: float,
        ev_per_contract: float,
        reason: str,
    ) -> KellyResult:
        """Build a KellyResult for a rejected bet."""
        return KellyResult(
            label=inp.label,
            contracts=0,
            dollar_outlay=0.0,
            bankroll_fraction=0.0,
            full_kelly_fraction=full_kelly_f,
            edge=edge,
            expected_value_per_contract=ev_per_contract,
            max_profit=0.0,
            max_loss=0.0,
            recommended=False,
            reason=reason,
        )


# ---------------------------------------------------------------------------
# Standalone helpers
# ---------------------------------------------------------------------------


def kelly_fraction(estimated_prob: float, contract_price: float) -> float:
    """Raw (full) Kelly fraction for a Kalshi binary YES contract.

    Formula: f* = (p - c) / (1 - c)

    Returns the fraction of bankroll to wager. Negative means no bet.

    Example::

        >>> kelly_fraction(0.92, 0.39)
        0.8688...
    """
    return (estimated_prob - contract_price) / (1.0 - contract_price)


def kelly_contracts(
    bankroll: float,
    estimated_prob: float,
    contract_price: float,
    risk_tolerance: float = 0.5,
) -> int:
    """Quick one-shot Kelly contract count.

    Uses fractional Kelly (default half-Kelly) with no portfolio or
    guardrail logic. Use KellySizer for production sizing.
    """
    f = kelly_fraction(estimated_prob, contract_price)
    if f <= 0:
        return 0
    dollar_bet = bankroll * f * risk_tolerance
    return max(0, int(math.floor(dollar_bet / contract_price)))
