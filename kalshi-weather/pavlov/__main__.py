"""CLI entry point for the Pavlov weather-trading bot.

Run as::

    python -m pavlov <command>

Available commands: collect, predict, execute, settle, status, run.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env (optional) so ${ENV_VAR} references in config.yaml resolve
# ---------------------------------------------------------------------------

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional

# Ensure stdout can handle Unicode on Windows
import io
import os

if os.name == "nt" and hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace"
    )


# ---------------------------------------------------------------------------
# Logging setup (called after config is loaded)
# ---------------------------------------------------------------------------


def _setup_logging(config: dict) -> None:
    """Configure root logger from the ``logging`` section of config."""
    log_cfg = config.get("logging", {})
    level_name = log_cfg.get("level", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    log_file = log_cfg.get("file", "pavlov.log")

    handlers: list[logging.Handler] = [logging.StreamHandler()]
    try:
        handlers.append(logging.FileHandler(log_file))
    except OSError:
        # If the log file path is not writable, just use stderr
        pass

    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=handlers,
    )


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Subcommand implementations
# ---------------------------------------------------------------------------


def cmd_collect(args: argparse.Namespace) -> int:
    """Collect weather data for all configured cities."""
    from pavlov.weather.collect import collect_all

    logger.info("Starting weather data collection...")
    results = collect_all()
    if not results:
        print("No weather data collected.")
        return 1
    print(f"\nCollected weather data for {len(results)} cities.")
    return 0


def cmd_predict(args: argparse.Namespace) -> int:
    """Load weather data and produce prediction prompts (or call API)."""
    from pavlov.config import get_data_dir
    from pavlov.predictor.engine import (
        format_weather_for_prediction,
        parse_prediction_response,
        validate_prediction,
    )
    from pavlov.predictor.prompts import (
        SYSTEM_PROMPT,
        FEW_SHOT_EXAMPLES,
        build_user_prompt,
    )

    today_str = date.today().isoformat()
    data_dir = get_data_dir(today_str)
    weather_path = data_dir / "weather.json"

    if not weather_path.exists():
        print(f"No weather data found at {weather_path}")
        print("Run 'python -m pavlov collect' first.")
        return 1

    with open(weather_path, "r", encoding="utf-8") as f:
        weather_data = json.load(f)

    if not weather_data:
        print("Weather data file is empty.")
        return 1

    config = _load_config(args)

    predictions = []

    for city_data in weather_data:
        city_id = city_data.get("city_id", "unknown")
        city_name = city_data.get("city_name", "unknown")

        # Format weather into a WeatherInput for the prompt builder
        weather_input = format_weather_for_prediction(city_data)
        user_prompt = build_user_prompt(weather_input)

        if args.api:
            # Call Anthropic API directly
            prediction = _call_anthropic_api(
                city_id, today_str, user_prompt, config
            )
            if prediction is not None:
                predictions.append(prediction)
        else:
            # Print prompt for agent to reason about
            print(f"\n{'='*60}")
            print(f"  PREDICTION PROMPT: {city_name} ({city_id})")
            print(f"{'='*60}")
            print(f"\nSYSTEM PROMPT:\n{SYSTEM_PROMPT}\n")
            print(f"USER PROMPT:\n{user_prompt}\n")
            print("="*60)

    if args.api and predictions:
        # Save predictions to file
        predictions_path = data_dir / "predictions.json"
        pred_dicts = []
        for p in predictions:
            pred_dicts.append({
                "city_id": p.city_id,
                "date": p.date,
                "predicted_high_f": p.predicted_high_f,
                "confidence": p.confidence,
                "recommended_bracket": p.recommended_bracket,
                "bracket_probability": p.bracket_probability,
                "adjacent_bracket": p.adjacent_bracket,
                "adjacent_probability": p.adjacent_probability,
                "reasoning_summary": p.reasoning_summary,
                "uncertainty_flags": p.uncertainty_flags,
                "data_sources_used": p.data_sources_used,
                "full_reasoning": p.full_reasoning,
                "raw_response": p.raw_response,
            })
        with open(predictions_path, "w", encoding="utf-8") as f:
            json.dump(pred_dicts, f, indent=2)
        print(f"\nSaved {len(predictions)} predictions to {predictions_path}")
    elif not args.api:
        print("\nPrompts printed above. Paste agent responses into "
              "data/{date}/predictions.json or re-run with --api flag.")

    return 0


def _call_anthropic_api(
    city_id: str,
    date_str: str,
    user_prompt: str,
    config: dict,
):
    """Call Anthropic API to generate a prediction. Returns WeatherPrediction or None."""
    from pavlov.predictor.engine import parse_prediction_response
    from pavlov.predictor.prompts import SYSTEM_PROMPT, FEW_SHOT_EXAMPLES

    try:
        import anthropic
    except ImportError:
        print("ERROR: 'anthropic' package not installed. "
              "Install it with: pip install anthropic")
        return None

    api_key = config.get("anthropic", {}).get("api_key", "")
    if not api_key:
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if not api_key:
        print("ERROR: No Anthropic API key configured. Set ANTHROPIC_API_KEY "
              "in .env or add it to config.yaml under anthropic.api_key")
        return None

    model = config.get("anthropic", {}).get("model", "claude-sonnet-4-20250514")

    client = anthropic.Anthropic(api_key=api_key)

    messages = list(FEW_SHOT_EXAMPLES) + [
        {"role": "user", "content": user_prompt},
    ]

    print(f"  Calling Anthropic API for {city_id}...")
    try:
        response = client.messages.create(
            model=model,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        raw_text = response.content[0].text
    except Exception as exc:
        logger.error("Anthropic API call failed for %s: %s", city_id, exc)
        print(f"  API call failed: {exc}")
        return None

    try:
        prediction = parse_prediction_response(raw_text, city_id, date_str)
        print(f"  Prediction for {city_id}: {prediction.predicted_high_f}F "
              f"(bracket {prediction.recommended_bracket}, "
              f"confidence {prediction.confidence:.0%})")
        return prediction
    except ValueError as exc:
        logger.error("Failed to parse prediction for %s: %s", city_id, exc)
        print(f"  Failed to parse response: {exc}")
        return None


def cmd_execute(args: argparse.Namespace) -> int:
    """Load predictions and execute trades."""
    from pavlov.config import get_data_dir
    from pavlov.trading.execute import execute_daily_trades
    from pavlov.trading.kalshi_client import KalshiClient

    config = _load_config(args)
    today_str = date.today().isoformat()

    # Load predictions
    if args.predictions_file:
        predictions_path = Path(args.predictions_file)
    else:
        data_dir = get_data_dir(today_str)
        predictions_path = data_dir / "predictions.json"

    if not predictions_path.exists():
        print(f"No predictions found at {predictions_path}")
        print("Run 'python -m pavlov predict --api' first.")
        return 1

    with open(predictions_path, "r", encoding="utf-8") as f:
        predictions = json.load(f)

    if not predictions:
        print("Predictions file is empty.")
        return 1

    # Apply paper mode override
    if args.paper:
        config["kalshi"]["paper_mode"] = True

    # Create Kalshi client (only for live mode)
    kalshi_client = None
    kalshi_cfg = config.get("kalshi", {})
    if not kalshi_cfg.get("paper_mode", True):
        try:
            kalshi_client = KalshiClient(kalshi_cfg)
        except Exception as exc:
            logger.error("Failed to create KalshiClient: %s", exc)
            print(f"Failed to connect to Kalshi: {exc}")
            print("Use --paper flag for paper trading.")
            return 1

    print(f"\nExecuting trades for {len(predictions)} predictions...")
    mode = "PAPER" if kalshi_cfg.get("paper_mode", True) else "LIVE"
    print(f"Mode: {mode}\n")

    reports = execute_daily_trades(
        predictions=predictions,
        config=config,
        kalshi_client=kalshi_client,
    )

    # Print execution report
    _print_execution_report(reports)
    return 0


def _print_execution_report(reports: list) -> None:
    """Print a formatted summary of trade execution results."""
    print("\n" + "=" * 60)
    print("  TRADE EXECUTION REPORT")
    print("=" * 60)

    total_outlay = 0.0
    total_trades = 0

    for report in reports:
        city_id = report.get("city_id", "unknown")
        mode = report.get("mode", "unknown")
        skip_reason = report.get("skip_reason")

        if skip_reason:
            print(f"\n  {city_id}: SKIPPED -- {skip_reason}")
            continue

        trades = report.get("trades", [])
        if not trades:
            print(f"\n  {city_id}: No trades executed (Kelly rejected)")
            continue

        print(f"\n  {city_id} ({mode}):")
        for trade in trades:
            bracket = trade.get("bracket", "?")
            contracts = trade.get("contracts", 0)
            price = trade.get("price_cents", 0)
            outlay = trade.get("outlay_dollars", 0)
            status = trade.get("status", "?")
            print(f"    {bracket}: {contracts} contracts @ {price}c "
                  f"= ${outlay:.2f} [{status}]")
            total_trades += 1

        total_outlay += report.get("total_outlay", 0)
        pct = report.get("bankroll_pct_deployed", 0)
        print(f"    Total: ${report.get('total_outlay', 0):.2f} "
              f"({pct:.1f}% of bankroll)")

    print(f"\n{'='*60}")
    print(f"  Total trades: {total_trades}")
    print(f"  Total outlay: ${total_outlay:.2f}")
    print("=" * 60 + "\n")


def cmd_settle(args: argparse.Namespace) -> int:
    """Check and settle open trades."""
    from pavlov.trading.settle import settle_trades
    from pavlov.trading.kalshi_client import KalshiClient

    config = _load_config(args)

    # Apply paper mode override
    if args.paper:
        config["kalshi"]["paper_mode"] = True

    # Create Kalshi client
    kalshi_client = None
    kalshi_cfg = config.get("kalshi", {})
    if not kalshi_cfg.get("paper_mode", True):
        try:
            kalshi_client = KalshiClient(kalshi_cfg)
        except Exception as exc:
            logger.error("Failed to create KalshiClient: %s", exc)
            print(f"Failed to connect to Kalshi: {exc}")
            return 1

    print("Checking for settled trades...")
    results = settle_trades(
        config=config,
        kalshi_client=kalshi_client,
    )

    if not results:
        print("No trades settled.")
        return 0

    # Print settlement results
    print(f"\n{'='*60}")
    print("  SETTLEMENT RESULTS")
    print("=" * 60)

    total_pnl = 0
    for result in results:
        city_id = result.get("city_id", "?")
        bracket = result.get("bracket", "?")
        market_result = result.get("market_result", "?")
        net_pnl = result.get("net_pnl_cents", 0)
        roi = result.get("roi_pct", 0)
        pnl_sign = "+" if net_pnl >= 0 else ""
        print(f"  {city_id} {bracket}: {market_result.upper()} "
              f"-> {pnl_sign}{net_pnl}c ({pnl_sign}{roi:.1f}% ROI)")
        total_pnl += net_pnl

    total_sign = "+" if total_pnl >= 0 else ""
    print(f"\n  Net settlement P&L: {total_sign}{total_pnl}c "
          f"(${total_pnl/100:.2f})")
    print("=" * 60 + "\n")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Print current performance stats from the database."""
    from pavlov.tracker.db import get_db
    from pavlov.tracker.stats import (
        get_current_bankroll,
        get_win_rate,
        get_current_streak,
        get_cumulative_pnl,
        get_total_trades,
        get_daily_report,
        format_report,
    )

    config = _load_config(args)
    risk_cfg = config.get("risk", {})
    default_bankroll = risk_cfg.get("bankroll", 500.0)

    conn = get_db()
    try:
        today_str = date.today().isoformat()
        report = get_daily_report(conn, today_str)
        print(format_report(report))

        # Also print overall summary
        bankroll = get_current_bankroll(conn, default_bankroll)
        win_rate = get_win_rate(conn)
        streak = get_current_streak(conn)
        cum_pnl = get_cumulative_pnl(conn)
        total = get_total_trades(conn)

        print(f"\n  Overall Statistics:")
        print(f"    Total trades:     {total}")
        print(f"    Win rate:         {win_rate:.1%}")
        print(f"    Cumulative P&L:   ${cum_pnl:.2f}")
        print(f"    Current streak:   {streak}")
        print(f"    Current bankroll: ${bankroll:.2f}")
    finally:
        conn.close()

    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """Full daily cycle: collect -> predict -> execute -> settle -> status."""
    from pavlov.config import get_data_dir
    from pavlov.notify import send_daily_report
    from pavlov.tracker.db import get_db
    from pavlov.tracker.stats import get_daily_report

    config = _load_config(args)
    today_str = date.today().isoformat()

    print("=" * 60)
    print(f"  PAVLOV DAILY RUN -- {today_str}")
    print("=" * 60)

    # Step 1: Collect weather data
    print("\n[1/5] Collecting weather data...")
    ret = cmd_collect(args)
    if ret != 0:
        print("Weather collection failed. Aborting.")
        return ret

    # Step 2: Generate predictions
    print("\n[2/5] Generating predictions...")
    # For the full run, always use the API if available
    args.api = True
    ret = cmd_predict(args)
    if ret != 0:
        print("Prediction generation failed. Continuing with settle/status...")

    # Step 3: Execute trades (only if predictions were generated)
    data_dir = get_data_dir(today_str)
    predictions_path = data_dir / "predictions.json"
    if predictions_path.exists():
        print("\n[3/5] Executing trades...")
        args.predictions_file = None  # use default path
        ret = cmd_execute(args)
        if ret != 0:
            print("Trade execution failed.")
    else:
        print("\n[3/5] Skipping trade execution (no predictions available).")

    # Step 4: Settle outstanding trades
    print("\n[4/5] Settling trades...")
    cmd_settle(args)

    # Step 5: Status report
    print("\n[5/5] Daily status:")
    cmd_status(args)

    # Send Discord notification
    try:
        conn = get_db()
        report = get_daily_report(conn, today_str)
        conn.close()
        sent = send_daily_report(config, report)
        if sent:
            print("\nDiscord notification sent.")
    except Exception as exc:
        logger.error("Failed to send notification: %s", exc)

    return 0


# ---------------------------------------------------------------------------
# Config helper
# ---------------------------------------------------------------------------


def _load_config(args: argparse.Namespace) -> dict:
    """Load config from the path specified in args (or default)."""
    from pavlov.config import get_config

    config_path = getattr(args, "config", None)
    config = get_config(config_path)

    # Apply paper mode override from CLI flag
    if getattr(args, "paper", False):
        if "kalshi" in config:
            config["kalshi"]["paper_mode"] = True

    return config


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level argparse parser with all subcommands."""
    parser = argparse.ArgumentParser(
        prog="pavlov",
        description="Pavlov -- Automated Kalshi weather trading bot",
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Path to config YAML file (default: config.yaml in project root)",
    )
    parser.add_argument(
        "--paper", action="store_true", default=False,
        help="Force paper trading mode regardless of config",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # --- collect ---
    sub_collect = subparsers.add_parser(
        "collect",
        help="Collect weather data for all configured cities",
    )

    # --- predict ---
    sub_predict = subparsers.add_parser(
        "predict",
        help="Generate prediction prompts or call Anthropic API",
    )
    sub_predict.add_argument(
        "--api", action="store_true", default=False,
        help="Call Anthropic API directly instead of printing prompts",
    )

    # --- execute ---
    sub_execute = subparsers.add_parser(
        "execute",
        help="Execute trades based on predictions",
    )
    sub_execute.add_argument(
        "--predictions-file", type=str, default=None,
        help="Path to predictions JSON file (default: data/{date}/predictions.json)",
    )

    # --- settle ---
    sub_settle = subparsers.add_parser(
        "settle",
        help="Check and settle open trades",
    )

    # --- status ---
    sub_status = subparsers.add_parser(
        "status",
        help="Show current performance stats",
    )

    # --- run ---
    sub_run = subparsers.add_parser(
        "run",
        help="Full daily cycle: collect -> predict -> execute -> settle -> status",
    )

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    """Parse arguments and dispatch to the appropriate subcommand."""
    parser = build_parser()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return 0

    # Load config early for logging setup
    try:
        config = _load_config(args)
        _setup_logging(config)
    except FileNotFoundError as exc:
        print(f"Config error: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"Config validation error: {exc}", file=sys.stderr)
        return 1

    dispatch = {
        "collect": cmd_collect,
        "predict": cmd_predict,
        "execute": cmd_execute,
        "settle": cmd_settle,
        "status": cmd_status,
        "run": cmd_run,
    }

    handler = dispatch.get(args.command)
    if handler is None:
        parser.print_help()
        return 1

    try:
        return handler(args)
    except KeyboardInterrupt:
        print("\nAborted.")
        return 130
    except Exception as exc:
        logger.exception("Unhandled error in '%s' command", args.command)
        print(f"\nError: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
