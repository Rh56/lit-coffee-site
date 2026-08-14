"""Feature engineering for the 15-minute BTC up/down market.

Everything here is causal: a feature stamped at minute t uses only bars with
timestamp <= t.  The construction is deliberately two-staged:

  1. `minute_features` builds a panel indexed by every 1-minute bar -- trend,
     volatility, microstructure, cross-asset and sentiment state.  These are
     window-agnostic.

  2. `decision_frame` expands that panel into one row per (window, decision
     minute) and adds the features that only exist relative to a live contract:
     moneyness, time to expiry, path position within the window.

The star feature is standardised moneyness  z = ln(P/S) / (sigma * sqrt(tau)),
which is what actually prices this contract; the learned model's job is to
correct z for the effects a lognormal random walk misses (vol misestimation,
short-horizon drift, mean reversion, time-of-day, sentiment).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

WINDOW_MINUTES = 15
MINUTES_PER_YEAR = 365.25 * 24 * 60


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _utc_ns(s: pd.Series) -> pd.Series:
    """Normalise a timestamp column to nanosecond UTC.

    Parquet round-trips can hand back second- or millisecond-resolution
    datetimes, and pandas refuses to merge across resolutions.
    """
    return pd.to_datetime(s, utc=True).astype("datetime64[ns, UTC]")


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    return (100.0 - 100.0 / (1.0 + rs)).fillna(50.0)


def _parkinson(high: pd.Series, low: pd.Series, window: int) -> pd.Series:
    """Parkinson range volatility (per-minute sigma), efficient with OHLC bars."""
    hl = np.log(high / low) ** 2
    return np.sqrt(hl.rolling(window).mean() / (4.0 * np.log(2.0)))


def _garman_klass(df: pd.DataFrame, window: int) -> pd.Series:
    hl = 0.5 * np.log(df["high"] / df["low"]) ** 2
    co = (2 * np.log(2) - 1) * np.log(df["close"] / df["open"]) ** 2
    return np.sqrt((hl - co).rolling(window).mean().clip(lower=0.0))


def _zscore(series: pd.Series, window: int) -> pd.Series:
    mean = series.rolling(window).mean()
    std = series.rolling(window).std()
    return (series - mean) / std.replace(0.0, np.nan)


# --------------------------------------------------------------------------
# stage 1: per-minute panel
# --------------------------------------------------------------------------

def minute_features(btc: pd.DataFrame, eth: pd.DataFrame | None = None,
                    fng: pd.DataFrame | None = None) -> pd.DataFrame:
    """Causal per-minute feature panel from 1-minute BTC (plus ETH, sentiment)."""
    df = btc.copy()
    df["ts"] = _utc_ns(df["ts"])
    df = df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)

    close = df["close"]
    logp = np.log(close)
    df["ret_1m"] = logp.diff()

    # ---- trend / momentum over several horizons -------------------------
    for h in (3, 5, 15, 30, 60, 240, 1440):
        df[f"ret_{h}m"] = logp.diff(h)

    df["ema_fast"] = close.ewm(span=10, adjust=False).mean()
    df["ema_slow"] = close.ewm(span=60, adjust=False).mean()
    df["ema_spread"] = np.log(df["ema_fast"] / df["ema_slow"])
    df["macd"] = (close.ewm(span=12, adjust=False).mean()
                  - close.ewm(span=26, adjust=False).mean()) / close
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]
    df["rsi_14"] = _rsi(close, 14)
    df["rsi_60"] = _rsi(close, 60)

    # ---- volatility, several estimators and horizons --------------------
    for h in (5, 15, 30, 60, 240, 1440):
        df[f"rv_{h}m"] = df["ret_1m"].rolling(h).std()
    df["park_15m"] = _parkinson(df["high"], df["low"], 15)
    df["park_60m"] = _parkinson(df["high"], df["low"], 60)
    df["gk_60m"] = _garman_klass(df, 60)
    # EWMA (RiskMetrics-style) vol: reacts fastest, matters most at 15m horizon
    df["ewma_var"] = (df["ret_1m"] ** 2).ewm(alpha=0.06, adjust=False).mean()
    df["ewma_vol"] = np.sqrt(df["ewma_var"])
    df["vol_ratio_15_240"] = df["rv_15m"] / df["rv_240m"].replace(0.0, np.nan)
    df["vol_ratio_60_1440"] = df["rv_60m"] / df["rv_1440m"].replace(0.0, np.nan)
    df["vol_of_vol"] = df["rv_15m"].rolling(240).std() / df["rv_15m"].rolling(240).mean()

    # ---- mean reversion / position in range -----------------------------
    for h in (15, 60, 240):
        ma = close.rolling(h).mean()
        sd = close.rolling(h).std()
        df[f"bb_pos_{h}m"] = (close - ma) / sd.replace(0.0, np.nan)
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    for h in (15, 60):
        vwap = ((typical * df["volume"]).rolling(h).sum()
                / df["volume"].rolling(h).sum().replace(0.0, np.nan))
        df[f"vwap_dev_{h}m"] = np.log(close / vwap)
    # Lag-1 autocorrelation of 1m returns: negative = choppy/mean-reverting,
    # positive = trending.  Vectorised rolling correlation against the lagged
    # series -- a rolling .apply here costs minutes on a year of data.
    df["autocorr_60m"] = df["ret_1m"].rolling(60).corr(df["ret_1m"].shift(1))

    # ---- microstructure / flow sentiment --------------------------------
    body = close - df["open"]
    rng = (df["high"] - df["low"]).replace(0.0, np.nan)
    df["body_frac"] = body / rng
    df["signed_flow"] = df["body_frac"] * df["volume"]
    for h in (15, 60):
        df[f"flow_imb_{h}m"] = (df["signed_flow"].rolling(h).sum()
                                / df["volume"].rolling(h).sum().replace(0.0, np.nan))
        df[f"up_min_ratio_{h}m"] = (df["ret_1m"] > 0).rolling(h).mean()
    df["vol_z_60m"] = _zscore(df["volume"], 60)
    df["vol_z_1440m"] = _zscore(df["volume"], 1440)
    df["range_z_60m"] = _zscore(rng / close, 60)
    df["run_len"] = (np.sign(df["ret_1m"])
                     .groupby((np.sign(df["ret_1m"]) != np.sign(df["ret_1m"]).shift()).cumsum())
                     .cumcount() + 1) * np.sign(df["ret_1m"])

    # ---- jump / tail activity -------------------------------------------
    df["abs_ret_z"] = df["ret_1m"].abs() / df["rv_240m"].replace(0.0, np.nan)
    df["jump_count_60m"] = (df["abs_ret_z"] > 3).rolling(60).sum()

    # ---- calendar --------------------------------------------------------
    minute_of_day = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    df["tod_sin"] = np.sin(2 * np.pi * minute_of_day / 1440)
    df["tod_cos"] = np.cos(2 * np.pi * minute_of_day / 1440)
    df["dow"] = df["ts"].dt.dayofweek
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    df["hour_utc"] = df["ts"].dt.hour

    # ---- cross-asset: ETH lead/lag ---------------------------------------
    if eth is not None and not eth.empty:
        e = eth.copy()
        e["ts"] = _utc_ns(e["ts"])
        e = e.drop_duplicates("ts").sort_values("ts")
        e_log = np.log(e.set_index("ts")["close"])
        eth_feat = pd.DataFrame(index=e_log.index)
        for h in (1, 5, 15, 60):
            eth_feat[f"eth_ret_{h}m"] = e_log.diff(h)
        eth_feat["eth_rv_60m"] = e_log.diff().rolling(60).std()
        df = df.merge(eth_feat.reset_index(), on="ts", how="left")
        # BTC-ETH divergence: ETH moving without BTC often precedes a BTC follow.
        df["btc_eth_div_5m"] = df["ret_5m"] - df["eth_ret_5m"]
        df["btc_eth_div_15m"] = df["ret_15m"] - df["eth_ret_15m"]
        df["btc_eth_corr_240m"] = (df["ret_1m"].rolling(240)
                                   .corr(df["eth_ret_1m"]))

    # ---- daily sentiment: Fear & Greed -----------------------------------
    if fng is not None and not fng.empty:
        f = fng.copy()
        f["ts"] = _utc_ns(f["ts"])
        f = f.sort_values("ts")
        # merge_asof with the *previous* published reading only (no lookahead)
        df = pd.merge_asof(
            df.sort_values("ts"),
            f[["ts", "fng", "fng_chg_1d", "fng_chg_7d", "fng_z_30d"]].sort_values("ts"),
            on="ts", direction="backward",
        )

    return df


# --------------------------------------------------------------------------
# stage 2: per-decision rows
# --------------------------------------------------------------------------

FEATURE_COLUMNS = [
    # contract state
    "z_moneyness", "log_dist", "tau_min", "sqrt_tau", "minutes_elapsed",
    "sigma_blend", "sigma_ewma_ann", "vol_ratio_15_240", "vol_ratio_60_1440",
    "vol_of_vol",
    # path within the window
    "path_frac_above", "excursion_up", "excursion_down", "excursion_ratio",
    "window_ret_so_far", "cross_count",
    # trend
    "ret_3m", "ret_5m", "ret_15m", "ret_30m", "ret_60m", "ret_240m", "ret_1440m",
    "ema_spread", "macd_hist", "rsi_14", "rsi_60",
    # mean reversion
    "bb_pos_15m", "bb_pos_60m", "bb_pos_240m", "vwap_dev_15m", "vwap_dev_60m",
    "autocorr_60m",
    # microstructure / flow
    "flow_imb_15m", "flow_imb_60m", "up_min_ratio_15m", "up_min_ratio_60m",
    "vol_z_60m", "vol_z_1440m", "range_z_60m", "run_len", "abs_ret_z",
    "jump_count_60m",
    # calendar
    "tod_sin", "tod_cos", "dow", "is_weekend",
    # cross-asset
    "eth_ret_1m", "eth_ret_5m", "eth_ret_15m", "eth_ret_60m",
    "btc_eth_div_5m", "btc_eth_div_15m", "btc_eth_corr_240m",
    # sentiment
    "fng", "fng_chg_1d", "fng_chg_7d", "fng_z_30d",
]


def blended_sigma(panel: pd.DataFrame) -> pd.Series:
    """Per-minute volatility estimate used for moneyness standardisation.

    A blend of EWMA, short realized and Parkinson range vol: EWMA reacts fast,
    Parkinson is efficient with OHLC bars, and the 60m realized term anchors it.
    """
    parts = [panel["ewma_vol"], panel["rv_15m"], panel["park_15m"],
             panel["rv_60m"], panel["park_60m"]]
    weights = [0.35, 0.20, 0.20, 0.15, 0.10]
    stacked = pd.concat(parts, axis=1)
    sigma = (stacked * weights).sum(axis=1) / sum(weights)
    # Guard against degenerate quiet patches
    floor = panel["rv_1440m"].fillna(sigma) * 0.25
    return sigma.clip(lower=floor.fillna(1e-6)).replace(0.0, np.nan)


def decision_frame(panel: pd.DataFrame, windows: pd.DataFrame,
                   decision_minutes: tuple[int, ...] = tuple(range(1, 15))) -> pd.DataFrame:
    """One row per (window, decision minute).

    `decision_minutes` are minutes elapsed since the window opened.  Minute m
    means: act at wall-clock time `open_time + m`, with `15 - m` minutes left.

    Timestamp discipline (this is where lookahead bugs live).  A Coinbase bar
    stamped T covers the interval [T, T+1min), so at decision time
    `exec_ts = open_time + m` the most recent *completed* bar is the one stamped
    `exec_ts - 1min`.  Features are therefore read from `ts = exec_ts - 1min`
    and the trade is priced at `exec_ts`.  Everything downstream joins market
    quotes on `exec_ts`.
    """
    panel = panel.copy()
    panel["sigma_blend"] = blended_sigma(panel)
    panel["sigma_ewma_ann"] = panel["ewma_vol"] * np.sqrt(MINUTES_PER_YEAR)
    panel = panel.set_index("ts")

    win = windows.copy()
    win["open_time"] = _utc_ns(win["open_time"])
    win["close_time"] = _utc_ns(win["close_time"])

    rows = []
    for m in decision_minutes:
        exec_ts = win["open_time"] + pd.Timedelta(minutes=m)
        feat_ts = exec_ts - pd.Timedelta(minutes=1)
        sub = pd.DataFrame({
            "window_open": win["open_time"].values,
            "close_time": win["close_time"].values,
            "ts": feat_ts.values,
            "exec_ts": exec_ts.values,
            "strike": win["strike"].values,
            "settle": win["settle"].values,
            "result": win["result"].values,
            "minutes_elapsed": m,
            "tau_min": WINDOW_MINUTES - m,
        })
        rows.append(sub)

    dec = pd.concat(rows, ignore_index=True)
    # .values on a tz-aware column drops the tz; restore it before merging.
    for col in ("window_open", "close_time", "ts", "exec_ts"):
        dec[col] = _utc_ns(dec[col])
    dec = dec.merge(panel.reset_index(), on="ts", how="inner", suffixes=("", "_p"))

    # ---- contract-relative features --------------------------------------
    dec["price"] = dec["close"]
    dec["log_dist"] = np.log(dec["price"] / dec["strike"])
    dec["sqrt_tau"] = np.sqrt(dec["tau_min"])
    dec["z_moneyness"] = dec["log_dist"] / (dec["sigma_blend"] * dec["sqrt_tau"])
    dec["window_ret_so_far"] = dec["log_dist"]

    # ---- path features inside the window ---------------------------------
    dec = _add_path_features(dec, panel)

    dec["target"] = dec["result"].astype(int)
    return dec.replace([np.inf, -np.inf], np.nan)


def _add_path_features(dec: pd.DataFrame, panel: pd.DataFrame) -> pd.DataFrame:
    """Fraction of the elapsed window spent above the strike, and excursions.

    Computed from the per-minute closes between window open and the decision
    minute -- strictly backward looking.
    """
    closes = panel["close"]
    highs = panel["high"]
    lows = panel["low"]

    idx = closes.index
    pos_by_ts = pd.Series(np.arange(len(idx)), index=idx)

    open_pos = pos_by_ts.reindex(dec["window_open"]).values
    dec_pos = pos_by_ts.reindex(dec["ts"]).values

    close_vals = closes.values
    high_vals = highs.values
    low_vals = lows.values
    strikes = dec["strike"].values

    frac_above = np.full(len(dec), np.nan)
    exc_up = np.full(len(dec), np.nan)
    exc_dn = np.full(len(dec), np.nan)
    crosses = np.full(len(dec), np.nan)

    for i in range(len(dec)):
        a, b = open_pos[i], dec_pos[i]
        if np.isnan(a) or np.isnan(b):
            continue
        a, b = int(a), int(b)
        if b < a:
            continue
        seg_c = close_vals[a:b + 1]
        seg_h = high_vals[a:b + 1]
        seg_l = low_vals[a:b + 1]
        k = strikes[i]
        above = seg_c >= k
        frac_above[i] = above.mean()
        exc_up[i] = np.log(seg_h.max() / k)
        exc_dn[i] = np.log(seg_l.min() / k)
        crosses[i] = int(np.sum(above[1:] != above[:-1])) if len(above) > 1 else 0

    span = exc_up - exc_dn
    dec["path_frac_above"] = frac_above
    dec["excursion_up"] = exc_up
    dec["excursion_down"] = exc_dn
    # Where in the window's realised range does the strike sit? 0.5 = centred.
    dec["excursion_ratio"] = np.divide(exc_up, span, out=np.full_like(exc_up, np.nan),
                                       where=np.abs(span) > 1e-12)
    dec["cross_count"] = crosses
    return dec


def available_features(dec: pd.DataFrame) -> list[str]:
    return [c for c in FEATURE_COLUMNS if c in dec.columns]
