"""KXBTC15M contract mechanics: window construction, settlement, and fees.

The contract (from Kalshi's published rules for the series):

    "If the simple average of the sixty seconds of CF Benchmarks' BRTI before
     <close> is at least the simple average of the sixty seconds of BRTI before
     <open>, then the market resolves to Yes."

So each 15-minute window is a fresh "is BTC up over the next 15 minutes?" bet
whose strike is the previous window's settlement value.  Windows are aligned to
:00 / :15 / :30 / :45 UTC and chain end-to-end: settlement of window k is the
strike of window k+1.

Reference data confirms both properties -- see `validate_reconstruction`, which
scores this module's reconstruction against Kalshi's real settled markets.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

WINDOW_MINUTES = 15


# --------------------------------------------------------------------------
# Fees
# --------------------------------------------------------------------------

def trade_fee(contracts: float, price: float, multiplier: float = 0.07) -> float:
    """Kalshi quadratic trading fee, in dollars.

    fee = ceil(multiplier * C * P * (1 - P)) cents, rounded up to the next cent.
    KXBTC15M reports fee_type="quadratic" with fee_multiplier=1 -> 0.07.
    """
    cents = multiplier * contracts * price * (1.0 - price) * 100.0
    return math.ceil(cents - 1e-9) / 100.0


def maker_fee(contracts: float, rate: float = 0.0025) -> float:
    """Optional maker fee (dollars) for resting orders, if the series charges one."""
    return math.ceil(rate * contracts * 100.0 - 1e-9) / 100.0


def round_trip_cost(contracts: float, entry_price: float,
                    multiplier: float = 0.07) -> float:
    """Fees for entering at `entry_price` and holding to settlement.

    Kalshi charges no fee on settlement, so a held-to-expiry position pays the
    entry fee only.
    """
    return trade_fee(contracts, entry_price, multiplier)


# --------------------------------------------------------------------------
# Window / settlement reconstruction from 1-minute OHLCV
# --------------------------------------------------------------------------

def minute_average_proxy(df: pd.DataFrame, method: str = "ohlc4") -> pd.Series:
    """Proxy for the 60-second average index price within each 1-minute bar."""
    if method == "close":
        return df["close"]
    if method == "hlc3":
        return (df["high"] + df["low"] + df["close"]) / 3.0
    if method == "ohlc4":
        return (df["open"] + df["high"] + df["low"] + df["close"]) / 4.0
    if method == "hl2":
        return (df["high"] + df["low"]) / 2.0
    raise ValueError(f"unknown method {method!r}")


def build_windows(btc_1m: pd.DataFrame, method: str = "ohlc4") -> pd.DataFrame:
    """Reconstruct every 15-minute market from 1-minute BTC data.

    Returns one row per window with:
        open_time, close_time  window boundaries (close_time is expiry)
        strike                 60s average over the minute ending at open_time
        settle                 60s average over the minute ending at close_time
        result                 1 if settle >= strike (YES), else 0

    The "minute ending at T" is the bar whose interval is [T-1min, T), matching
    the rule's "sixty seconds before" language.
    """
    df = btc_1m.copy()
    df["ts"] = pd.to_datetime(df["ts"], utc=True).astype("datetime64[ns, UTC]")
    df = df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)
    df["avg"] = minute_average_proxy(df, method)

    # A bar stamped T covers [T, T+1min); the average over the 60s *before* time B
    # is therefore the bar stamped B - 1min.
    avg_by_ts = df.set_index("ts")["avg"]
    boundary_value = avg_by_ts.copy()
    boundary_value.index = boundary_value.index + pd.Timedelta(minutes=1)

    boundaries = pd.date_range(
        df["ts"].min().ceil("15min"), df["ts"].max().floor("15min"),
        freq="15min", tz="UTC",
    )
    vals = boundary_value.reindex(boundaries)

    win = pd.DataFrame({
        "open_time": boundaries[:-1],
        "close_time": boundaries[1:],
        "strike": vals.values[:-1],
        "settle": vals.values[1:],
    })
    win = win.dropna(subset=["strike", "settle"]).reset_index(drop=True)
    win["result"] = (win["settle"] >= win["strike"]).astype(int)
    win["ret"] = np.log(win["settle"] / win["strike"])
    return win


def validate_reconstruction(windows: pd.DataFrame,
                            kalshi_markets: pd.DataFrame) -> dict:
    """Score reconstructed windows against Kalshi's real settled markets.

    Kalshi settles on CF Benchmarks BRTI; the reconstruction uses Coinbase
    BTC-USD.  This quantifies how much that substitution matters.
    """
    real = kalshi_markets.dropna(subset=["floor_strike", "expiration_value"]).copy()
    real["close_time"] = pd.to_datetime(real["close_time"], utc=True).astype("datetime64[ns, UTC]")
    real["real_result"] = (real["result"] == "yes").astype(int)

    recon = windows[["close_time", "strike", "settle", "result"]].rename(
        columns={"result": "recon_result"})
    merged = real.merge(recon, on="close_time", how="inner")
    if merged.empty:
        return {"n": 0}

    strike_err = merged["strike"] - merged["floor_strike"]
    settle_err = merged["settle"] - merged["expiration_value"]
    agree = (merged["recon_result"] == merged["real_result"])

    # Disagreements should concentrate where the move is tiny (a near-tie where
    # index choice flips the sign).
    move_bps = (np.log(merged["expiration_value"] / merged["floor_strike"]) * 1e4).abs()
    return {
        "n": int(len(merged)),
        "outcome_agreement": float(agree.mean()),
        "strike_err_bps_median": float((strike_err / merged["floor_strike"] * 1e4).abs().median()),
        "settle_err_bps_median": float((settle_err / merged["expiration_value"] * 1e4).abs().median()),
        "disagree_median_move_bps": float(move_bps[~agree].median()) if (~agree).any() else float("nan"),
        "agree_median_move_bps": float(move_bps[agree].median()),
        "real_yes_rate": float(merged["real_result"].mean()),
        "recon_yes_rate": float(merged["recon_result"].mean()),
    }
