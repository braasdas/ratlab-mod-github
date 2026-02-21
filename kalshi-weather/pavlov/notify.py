"""Notification dispatch (Discord webhook) for trade alerts and daily summaries."""

import logging

import requests

logger = logging.getLogger(__name__)


def send_discord(webhook_url: str, message: str) -> bool:
    """Send a message to a Discord webhook.

    Parameters
    ----------
    webhook_url : str
        Full Discord webhook URL.
    message : str
        Message content (supports Discord Markdown).

    Returns
    -------
    bool
        ``True`` on success, ``False`` on any failure.
    """
    try:
        resp = requests.post(
            webhook_url, json={"content": message}, timeout=10
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error("Discord notification failed: %s", e)
        return False


def send_daily_report(config: dict, report: dict) -> bool:
    """Send the daily report to Discord if notifications are enabled.

    Parameters
    ----------
    config : dict
        Full project configuration.  Expects an optional ``notifications``
        section with ``enabled`` (bool) and ``discord_webhook`` (str).
    report : dict
        Report dict as returned by
        :func:`pavlov.tracker.stats.get_daily_report`.

    Returns
    -------
    bool
        ``True`` if the message was sent successfully, ``False`` if
        notifications are disabled, not configured, or sending failed.
    """
    notifications = config.get("notifications", {})
    if not notifications.get("enabled", False):
        return False

    webhook = notifications.get("discord_webhook", "")
    if not webhook:
        return False

    # Build a concise Discord message
    net_pnl = report.get("net_pnl", 0)
    net_sign = "+" if net_pnl >= 0 else ""
    cum_pnl = report.get("cumulative_pnl", 0)
    cum_sign = "+" if cum_pnl >= 0 else ""

    msg = f"**Pavlov Daily Report -- {report.get('date', 'unknown')}**\n"
    msg += f"Trades: {report.get('trades', 0)}\n"
    msg += f"Wins: {report.get('wins', 0)}/{report.get('trades', 0)}\n"
    msg += f"P&L: {net_sign}${abs(net_pnl):.2f}\n"
    msg += f"Win Rate: {report.get('win_rate', 0):.1f}%\n"

    streak = report.get("current_streak", 0)
    if streak > 0:
        streak_str = f"+{streak} (winning)"
    elif streak < 0:
        streak_str = f"{streak} (losing)"
    else:
        streak_str = "0"
    msg += f"Streak: {streak_str}\n"
    msg += f"Cumulative: {cum_sign}${abs(cum_pnl):.2f}\n"
    msg += f"Bankroll: ${report.get('bankroll', 0):.2f}"

    return send_discord(webhook, msg)
