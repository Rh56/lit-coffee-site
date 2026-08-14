"""Adversarial checks on the backtest result.

A Sharpe above 5 on a liquid-ish binary market is far more often a bug than an
edge, so this script attacks the result from several directions before any of it
is believed:

  1. QUOTE ALIGNMENT   Kalshi candles are assumed to be *end*-labelled (the bar
     stamped T covers [T-1min, T)).  If that is backwards, every trade is priced
     with a quote from the future.  Checked directly against market open/close
     boundaries.

  2. QUOTE LAG SWEEP   Re-run the strategy forcing it to trade on quotes that are
     1, 2 and 5 minutes stale.  Genuine mispricing decays gracefully; a
     same-instant race collapses immediately.  This is the single most
     informative test, because it separates "the market is wrong" from "we are
     faster than the market".

  3. SHUFFLE CONTROL   Re-run with model probabilities randomly permuted across
     rows.  Anything materially above zero means the harness itself pays.

  4. FEE / SPREAD STRESS   Double the fee and widen the spread to see how much
     of the edge is cushion.

  5. SUBSAMPLE STABILITY  P&L per contract by time-to-expiry, price bucket and
     week, to see whether the edge is broad or concentrated in a corner.

Usage:
    python diagnostics.py --cache cache --out results
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

import contract
import features as F
import model as M
import pricing as P
from backtest import BacktestConfig, run_backtest
from run_backtest import _json_safe, attach_real_quotes


def check_candle_alignment(markets: pd.DataFrame, candles: pd.DataFrame) -> dict:
    """Are Kalshi candlesticks stamped at the END of their minute?

    If end-labelled, a market open at O and closing at C should produce first
    candle O+1min and last candle C -- never a candle stamped exactly O.
    """
    mk = markets[["ticker", "open_time", "close_time"]].copy()
    c = candles.merge(mk, on="ticker", how="inner")
    c["quote_ts"] = pd.to_datetime(c["end_period_ts"], unit="s", utc=True)
    c["open_time"] = pd.to_datetime(c["open_time"], utc=True)
    c["close_time"] = pd.to_datetime(c["close_time"], utc=True)

    first = c.groupby("ticker")["quote_ts"].min()
    last = c.groupby("ticker")["quote_ts"].max()
    opens = mk.set_index("ticker")["open_time"]
    closes = mk.set_index("ticker")["close_time"]
    opens = pd.to_datetime(opens, utc=True).reindex(first.index)
    closes = pd.to_datetime(closes, utc=True).reindex(last.index)

    first_off = (first - opens).dt.total_seconds() / 60
    last_off = (last - closes).dt.total_seconds() / 60
    return {
        "n_markets": int(len(first)),
        "median_first_candle_minutes_after_open": float(first_off.median()),
        "median_last_candle_minutes_after_close": float(last_off.median()),
        "share_first_candle_at_open_exactly": float((first_off == 0).mean()),
        "verdict": ("end-labelled (expected)" if first_off.median() >= 1
                    else "START-LABELLED -- quotes would be from the future"),
    }


def lag_quotes(real: pd.DataFrame, lag_minutes: int) -> pd.DataFrame:
    """Replace each row's quote with the quote from `lag_minutes` earlier."""
    if lag_minutes == 0:
        return real
    q = real[["close_time", "exec_ts", "yes_bid", "yes_ask"]].copy()
    q["exec_ts"] = q["exec_ts"] + pd.Timedelta(minutes=lag_minutes)
    q = q.rename(columns={"yes_bid": "lag_bid", "yes_ask": "lag_ask"})
    out = real.drop(columns=["yes_bid", "yes_ask"]).merge(
        q, on=["close_time", "exec_ts"], how="inner")
    return out.rename(columns={"lag_bid": "yes_bid", "lag_ask": "yes_ask"})


def delay_execution(real: pd.DataFrame, delay_minutes: int) -> pd.DataFrame:
    """Signal forms at T, but the fill happens `delay_minutes` later.

    This is the realistic scenario for anyone who is not racing at the top of
    the minute: by the time the order lands, the book has repriced.  Time to
    expiry shrinks accordingly, and any row whose window has closed is dropped.
    """
    if delay_minutes == 0:
        return real
    q = real[["close_time", "exec_ts", "yes_bid", "yes_ask"]].copy()
    q["exec_ts"] = q["exec_ts"] - pd.Timedelta(minutes=delay_minutes)
    q = q.rename(columns={"yes_bid": "fill_bid", "yes_ask": "fill_ask"})
    out = real.drop(columns=["yes_bid", "yes_ask"]).merge(
        q, on=["close_time", "exec_ts"], how="inner")
    out = out.rename(columns={"fill_bid": "yes_bid", "fill_ask": "yes_ask"})
    out["tau_min"] = out["tau_min"] - delay_minutes
    return out[out["tau_min"] >= 1]


def per_contract(trades: pd.DataFrame) -> float:
    if trades.empty:
        return float("nan")
    return float(trades["pnl"].sum() / trades["contracts"].sum())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--out", default="results")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report: dict = {}

    markets = pd.read_parquet(os.path.join(args.cache, "kalshi_markets.parquet"))
    cpath = os.path.join(args.cache, "kalshi_candles.parquet")
    if os.path.exists(cpath):
        candles = pd.read_parquet(cpath)
    else:
        candles = pd.read_csv(os.path.join(args.cache, "kalshi_candles_checkpoint.csv"))

    # ---------------------------------------------------------- 1. alignment
    print("=" * 78)
    print("1. CANDLE TIMESTAMP ALIGNMENT")
    print("=" * 78)
    align = check_candle_alignment(markets, candles)
    for k, v in align.items():
        print(f"  {k}: {v}")
    report["candle_alignment"] = align

    # ------------------------------------------------ predictions (cached)
    pred_cache = os.path.join(args.cache, "walk_forward_predictions.parquet")
    if os.path.exists(pred_cache):
        pred = pd.read_parquet(pred_cache)
        print(f"\nreusing cached walk-forward predictions: {len(pred):,} rows")
    else:
        print("\nno cached predictions; running walk-forward (slow)...")
        btc = pd.read_parquet(os.path.join(args.cache, "btc_1m.parquet"))
        eth = pd.read_parquet(os.path.join(args.cache, "eth_1m.parquet"))
        fng = pd.read_parquet(os.path.join(args.cache, "fng.parquet"))
        windows = contract.build_windows(btc, method="ohlc4")
        panel = F.minute_features(btc, eth, fng)
        dec = F.decision_frame(panel, windows)
        dec = dec.dropna(subset=["z_moneyness", "target"]).reset_index(drop=True)
        pred = M.walk_forward_predict(dec, F.available_features(dec),
                                      train_days=120, calib_days=20, step_days=15)
        pred.to_parquet(pred_cache, index=False)

    pred = attach_real_quotes(pred, markets, candles)
    real = pred.dropna(subset=["yes_bid", "yes_ask"]).copy()
    print(f"real-quote rows: {len(real):,}")

    base_cfg = BacktestConfig()

    # -------------------------------------------------------- 2. quote lag
    print("\n" + "=" * 78)
    print("2. QUOTE STALENESS SWEEP")
    print("=" * 78)
    print("  Trading on quotes that are N minutes old. A real mispricing decays")
    print("  slowly; a same-instant race against a slow book dies at N=1.\n")
    lag_rows = []
    for lag in (0, 1, 2, 5):
        sub = lag_quotes(real, lag)
        trades, summ = run_backtest(sub, base_cfg)
        row = {
            "lag_min": lag, "rows": len(sub), "n_trades": summ.get("n_trades", 0),
            "pnl": round(summ.get("total_pnl", 0.0), 2),
            "per_contract": round(per_contract(trades), 5),
            "win_rate": round(summ.get("win_rate", float("nan")), 4),
            "sharpe": round(summ.get("sharpe_daily_ann", float("nan")), 3),
        }
        lag_rows.append(row)
        print(f"  lag={lag}m  trades={row['n_trades']:5d}  pnl=${row['pnl']:>10,.2f}  "
              f"per_contract=${row['per_contract']:+.5f}  win={row['win_rate']:.4f}")
    report["quote_lag_sweep"] = lag_rows

    # ------------------------------------------------ 2b. execution delay
    print("\n" + "=" * 78)
    print("2b. EXECUTION DELAY (the realistic slow-trader case)")
    print("=" * 78)
    print("  Signal forms at T; the fill lands at T+N against whatever the book")
    print("  shows by then. If the edge is a race, it dies here.\n")
    delay_rows = []
    for delay in (0, 1, 2, 3):
        sub = delay_execution(real, delay)
        trades_d, summ_d = run_backtest(sub, base_cfg)
        row = {
            "delay_min": delay, "rows": len(sub), "n_trades": summ_d.get("n_trades", 0),
            "pnl": round(summ_d.get("total_pnl", 0.0), 2),
            "per_contract": round(per_contract(trades_d), 5),
            "win_rate": round(summ_d.get("win_rate", float("nan")), 4),
        }
        delay_rows.append(row)
        print(f"  delay={delay}m  trades={row['n_trades']:5d}  pnl=${row['pnl']:>10,.2f}  "
              f"per_contract=${row['per_contract']:+.5f}  win={row['win_rate']:.4f}")
    report["execution_delay"] = delay_rows

    # --------------------------------- 2c. first-minute (tau=14) dependence
    print("\n" + "=" * 78)
    print("2c. EXCLUDING THE FIRST MINUTE AFTER OPEN")
    print("=" * 78)
    excl = real[real["tau_min"] <= 13]
    trades_e, summ_e = run_backtest(excl, base_cfg)
    print(f"  tau<=13 only: trades={summ_e.get('n_trades', 0)}  "
          f"pnl=${summ_e.get('total_pnl', 0):,.2f}  "
          f"per_contract=${per_contract(trades_e):+.5f}")
    report["excluding_first_minute"] = {
        "n_trades": summ_e.get("n_trades", 0),
        "pnl": summ_e.get("total_pnl", 0.0),
        "per_contract": per_contract(trades_e),
    }

    # ---------------------------------------------------- 3. shuffle control
    print("\n" + "=" * 78)
    print("3. SHUFFLED-PROBABILITY CONTROL")
    print("=" * 78)
    rng = np.random.default_rng(17)
    shuffled = real.copy()
    shuffled["p_model"] = rng.permutation(shuffled["p_model"].to_numpy())
    trades_s, summ_s = run_backtest(shuffled, base_cfg)
    print(f"  trades={summ_s.get('n_trades', 0)}  pnl=${summ_s.get('total_pnl', 0):,.2f}  "
          f"per_contract=${per_contract(trades_s):+.5f}")
    print("  (should be clearly negative: crossing the spread with no signal)")
    report["shuffle_control"] = {
        "n_trades": summ_s.get("n_trades", 0),
        "pnl": summ_s.get("total_pnl", 0.0),
        "per_contract": per_contract(trades_s),
    }

    # ------------------------------------------------------ 4. cost stress
    print("\n" + "=" * 78)
    print("4. COST STRESS")
    print("=" * 78)
    stress = []
    for label, fee_mult, widen in [
        ("baseline", 0.07, 0.0),
        ("2x fee", 0.14, 0.0),
        ("+1c spread", 0.07, 0.01),
        ("+2c spread", 0.07, 0.02),
        ("2x fee +1c", 0.14, 0.01),
    ]:
        sub = real.copy()
        sub["yes_bid"] = (sub["yes_bid"] - widen / 2).clip(0.01, 0.99)
        sub["yes_ask"] = (sub["yes_ask"] + widen / 2).clip(0.01, 0.99)
        cfg = BacktestConfig(fee_multiplier=fee_mult)
        trades_c, summ_c = run_backtest(sub, cfg)
        row = {"scenario": label, "n_trades": summ_c.get("n_trades", 0),
               "pnl": round(summ_c.get("total_pnl", 0.0), 2),
               "per_contract": round(per_contract(trades_c), 5)}
        stress.append(row)
        print(f"  {label:12s} trades={row['n_trades']:5d}  pnl=${row['pnl']:>10,.2f}  "
              f"per_contract=${row['per_contract']:+.5f}")
    report["cost_stress"] = stress

    # ------------------------------------------------- 5. where the edge is
    print("\n" + "=" * 78)
    print("5. EDGE DISTRIBUTION")
    print("=" * 78)
    trades, _ = run_backtest(real, base_cfg)
    if not trades.empty:
        t = trades.copy()
        by_tau = (t.groupby("tau_min")
                  .apply(lambda g: pd.Series({
                      "trades": len(g), "pnl": g["pnl"].sum(),
                      "per_contract": g["pnl"].sum() / g["contracts"].sum()}),
                         include_groups=False)
                  .reset_index())
        print("\n  by minutes to expiry:")
        print(by_tau.to_string(index=False))

        t["price_bucket"] = pd.cut(t["price"], [0, 0.2, 0.4, 0.6, 0.8, 1.0])
        by_px = (t.groupby("price_bucket", observed=True)
                 .apply(lambda g: pd.Series({
                     "trades": len(g), "pnl": g["pnl"].sum(),
                     "per_contract": g["pnl"].sum() / g["contracts"].sum()}),
                        include_groups=False)
                 .reset_index())
        print("\n  by entry price:")
        print(by_px.to_string(index=False))

        t["week"] = t["close_time"].dt.isocalendar().week
        by_week = (t.groupby("week")
                   .apply(lambda g: pd.Series({
                       "trades": len(g), "pnl": g["pnl"].sum(),
                       "per_contract": g["pnl"].sum() / g["contracts"].sum()}),
                          include_groups=False)
                   .reset_index())
        print("\n  by week:")
        print(by_week.to_string(index=False))

        report["by_tau"] = by_tau.to_dict("records")
        report["by_price"] = by_px.to_dict("records")
        report["by_week"] = by_week.to_dict("records")
        by_tau.to_csv(os.path.join(args.out, "diag_by_tau.csv"), index=False)
        by_week.to_csv(os.path.join(args.out, "diag_by_week.csv"), index=False)

    with open(os.path.join(args.out, "diagnostics.json"), "w") as fh:
        json.dump(_json_safe(report), fh, indent=2)
    print(f"\nWrote {args.out}/diagnostics.json")


if __name__ == "__main__":
    main()
