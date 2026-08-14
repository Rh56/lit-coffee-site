"""End-to-end backtest: data -> features -> walk-forward models -> P&L.

    python run_backtest.py --cache cache --out results

Produces two backtests:

  A. REAL-QUOTE   over the period Kalshi's KXBTC15M series has existed, trading
                  against genuine per-minute yes_bid / yes_ask.  This is the
                  honest measurement of whether the edge survives a real spread.

  B. FULL-YEAR    over 12 months of real BTC data, with contracts reconstructed
                  from the published settlement rule and quotes simulated by a
                  market model calibrated on (A).  This measures the strategy
                  across regimes the short real window never saw.
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
from backtest import (BacktestConfig, baseline_strategies, breakdowns,
                      run_backtest)


def _load(cache: str, name: str) -> pd.DataFrame:
    """Load a cached dataset, falling back to a fetcher's in-progress checkpoint."""
    path = os.path.join(cache, name)
    if os.path.exists(path):
        return pd.read_parquet(path)

    ckpt = path.replace(".parquet", "_checkpoint.csv")
    if os.path.exists(ckpt):
        df = pd.read_csv(ckpt)
        print(f"  (using checkpoint for {name}: {len(df):,} rows)")
        if "time" in df.columns and "ts" not in df.columns:
            df["ts"] = pd.to_datetime(df["time"], unit="s", utc=True)
        if "end_period_ts" in df.columns and "ts" not in df.columns:
            df["ts"] = pd.to_datetime(df["end_period_ts"], unit="s", utc=True)
        return df
    return pd.DataFrame()


def _json_safe(obj):
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if np.isnan(obj) else float(obj)
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    if isinstance(obj, float) and np.isnan(obj):
        return None
    return obj


def attach_real_quotes(dec: pd.DataFrame, markets: pd.DataFrame,
                       candles: pd.DataFrame) -> pd.DataFrame:
    """Join genuine Kalshi bid/ask onto decision rows via (window, exec time)."""
    if markets.empty or candles.empty:
        return dec.assign(yes_bid=np.nan, yes_ask=np.nan)

    mk = markets[["ticker", "open_time", "close_time"]].copy()
    mk["close_time"] = pd.to_datetime(mk["close_time"], utc=True)
    c = candles.merge(mk, on="ticker", how="inner")
    c["quote_ts"] = pd.to_datetime(c["end_period_ts"], unit="s", utc=True)
    c = c.rename(columns={"yes_bid_close": "yes_bid", "yes_ask_close": "yes_ask"})
    c = c[["close_time", "quote_ts", "yes_bid", "yes_ask", "price_close", "volume_fp"]]
    c = c.dropna(subset=["yes_bid", "yes_ask"]).drop_duplicates(
        subset=["close_time", "quote_ts"])

    out = dec.merge(
        c, left_on=["close_time", "exec_ts"], right_on=["close_time", "quote_ts"],
        how="left",
    )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--out", default="results")
    ap.add_argument("--min-edge", type=float, default=0.03)
    ap.add_argument("--kelly", type=float, default=0.25)
    ap.add_argument("--bankroll", type=float, default=10_000.0)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report: dict = {}

    # ---------------------------------------------------------------- data
    print("=" * 78)
    print("LOADING DATA")
    print("=" * 78)
    btc = _load(args.cache, "btc_1m.parquet")
    eth = _load(args.cache, "eth_1m.parquet")
    fng = _load(args.cache, "fng.parquet")
    markets = _load(args.cache, "kalshi_markets.parquet")
    candles = _load(args.cache, "kalshi_candles.parquet")

    print(f"BTC 1m bars      : {len(btc):,}  {btc['ts'].min()} -> {btc['ts'].max()}")
    print(f"ETH 1m bars      : {len(eth):,}")
    print(f"Fear & Greed days: {len(fng):,}")
    print(f"Kalshi markets   : {len(markets):,}")
    print(f"Kalshi candles   : {len(candles):,}")
    report["data"] = {
        "btc_bars": len(btc), "eth_bars": len(eth), "fng_days": len(fng),
        "kalshi_markets": len(markets), "kalshi_candles": len(candles),
        "btc_start": str(btc["ts"].min()), "btc_end": str(btc["ts"].max()),
    }

    # -------------------------------------------------------- contract build
    print("\n" + "=" * 78)
    print("CONTRACT RECONSTRUCTION")
    print("=" * 78)
    best_method, best_val = None, None
    for method in ("ohlc4", "close", "hlc3", "hl2"):
        w = contract.build_windows(btc, method=method)
        v = contract.validate_reconstruction(w, markets)
        print(f"  {method:6s} n={v.get('n', 0):5d}  outcome agreement="
              f"{v.get('outcome_agreement', float('nan')):.4f}  "
              f"settle err={v.get('settle_err_bps_median', float('nan')):.2f} bps")
        if best_val is None or v.get("outcome_agreement", 0) > best_val.get("outcome_agreement", 0):
            best_method, best_val, windows = method, v, w

    print(f"\n  chosen proxy: {best_method}")
    for k, v in best_val.items():
        print(f"    {k}: {v}")
    windows = contract.build_windows(btc, method=best_method)
    print(f"  reconstructed windows: {len(windows):,}  YES rate={windows['result'].mean():.4f}")
    report["reconstruction"] = {"method": best_method, **best_val,
                                "n_windows": len(windows),
                                "yes_rate": float(windows["result"].mean())}

    # ------------------------------------------------------------- features
    print("\n" + "=" * 78)
    print("FEATURES")
    print("=" * 78)
    panel = F.minute_features(btc, eth if not eth.empty else None,
                              fng if not fng.empty else None)
    print(f"  minute panel: {panel.shape}")
    dec = F.decision_frame(panel, windows)
    feats = F.available_features(dec)
    print(f"  decision rows: {len(dec):,} over {dec['window_open'].nunique():,} windows")
    print(f"  features: {len(feats)}")
    report["features"] = {"n_features": len(feats), "n_decision_rows": len(dec),
                          "feature_names": feats}

    # -------------------------------------------------- walk-forward models
    print("\n" + "=" * 78)
    print("WALK-FORWARD MODEL TRAINING")
    print("=" * 78)
    dec = dec.dropna(subset=["z_moneyness", "target"]).reset_index(drop=True)
    pred = M.walk_forward_predict(dec, feats, train_days=120, calib_days=20,
                                  step_days=15)
    print(f"\n  out-of-sample rows: {len(pred):,}")
    print(f"  OOS range: {pred['ts'].min()} -> {pred['ts'].max()}")

    sc_model = M.score_probabilities(pred["p_model"], pred["target"])
    sc_analytic = M.score_probabilities(pred["p_analytic"], pred["target"])
    print("\n  ensemble  :", {k: round(v, 5) for k, v in sc_model.items() if k != "n"})
    print("  analytic  :", {k: round(v, 5) for k, v in sc_analytic.items() if k != "n"})
    report["model_scores"] = {"ensemble": sc_model, "analytic": sc_analytic}

    rel = M.reliability_table(pred["p_model"].to_numpy(), pred["target"].to_numpy())
    print("\n  reliability (out-of-sample):")
    print(rel.to_string(index=False))
    rel.to_csv(os.path.join(args.out, "reliability.csv"), index=False)

    # ------------------------------------------------------- real quotes
    print("\n" + "=" * 78)
    print("REAL KALSHI QUOTES")
    print("=" * 78)
    pred = attach_real_quotes(pred, markets, candles)
    real = pred.dropna(subset=["yes_bid", "yes_ask"]).copy()
    print(f"  decision rows with real quotes: {len(real):,}")
    report["real_quote_rows"] = len(real)

    market_model = P.MarketModel()
    if len(real) > 1000:
        print(f"  real-quote range: {real['exec_ts'].min()} -> {real['exec_ts'].max()}")
        eff = P.market_efficiency(real)
        print("  market efficiency:", {k: round(v, 5) for k, v in eff.items() if k != "n"})
        report["market_efficiency"] = eff

        sc_real = M.score_probabilities(real["p_model"], real["target"])
        print("  model over same rows:", {k: round(v, 5) for k, v in sc_real.items() if k != "n"})
        report["model_scores"]["ensemble_real_window"] = sc_real

        market_model, diag = P.calibrate_from_real(real)
        print("  calibrated market model:", {k: round(v, 5) if isinstance(v, float) else v
                                             for k, v in diag.items()})
        report["market_model"] = {**market_model.to_dict(), "calibration": diag}

        cfg = BacktestConfig(bankroll=args.bankroll, min_edge=args.min_edge,
                             kelly_fraction=args.kelly)
        trades_real, summ_real = run_backtest(real, cfg)
        print("\n  --- BACKTEST A: real quotes ---")
        for k, v in summ_real.items():
            print(f"    {k}: {v}")
        report["backtest_real"] = summ_real
        report["backtest_real_config"] = cfg.__dict__
        if not trades_real.empty:
            trades_real.to_csv(os.path.join(args.out, "trades_real_quotes.csv"), index=False)
            for name, tbl in breakdowns(trades_real).items():
                tbl.to_csv(os.path.join(args.out, f"breakdown_real_{name}.csv"), index=False)
        print("\n  baselines (per contract, 7 min to expiry):",
              baseline_strategies(real, cfg))
        report["baselines_real"] = baseline_strategies(real, cfg)
    else:
        print("  ! not enough real quote data; skipping backtest A")

    # ------------------------------------------------- full-year modelled
    print("\n" + "=" * 78)
    print("FULL-YEAR BACKTEST (modelled quotes calibrated on real data)")
    print("=" * 78)
    sim = pred.copy()
    bid, ask, mid = market_model.quotes(sim)
    # Where real quotes exist, prefer them; simulate only the rest.
    has_real = sim["yes_bid"].notna() & sim["yes_ask"].notna()
    sim["yes_bid"] = np.where(has_real, sim["yes_bid"], bid)
    sim["yes_ask"] = np.where(has_real, sim["yes_ask"], ask)
    sim["market_mid_model"] = mid
    print(f"  rows: {len(sim):,}  ({has_real.mean():.1%} using real quotes)")

    cfg = BacktestConfig(bankroll=args.bankroll, min_edge=args.min_edge,
                         kelly_fraction=args.kelly)
    trades_sim, summ_sim = run_backtest(sim, cfg)
    print("\n  --- BACKTEST B: full year ---")
    for k, v in summ_sim.items():
        print(f"    {k}: {v}")
    report["backtest_full_year"] = summ_sim
    report["backtest_full_year_config"] = cfg.__dict__

    if not trades_sim.empty:
        trades_sim.to_csv(os.path.join(args.out, "trades_full_year.csv"), index=False)
        bd = breakdowns(trades_sim)
        for name, tbl in bd.items():
            tbl.to_csv(os.path.join(args.out, f"breakdown_year_{name}.csv"), index=False)
        print("\n  monthly P&L:")
        print(bd["month"].to_string(index=False))
        report["monthly_pnl"] = bd["month"].to_dict(orient="records")

        eq = trades_sim.sort_values("close_time")[["close_time", "bankroll_after", "pnl"]]
        eq.to_csv(os.path.join(args.out, "equity_curve.csv"), index=False)

    # ------------------------------------------------------ parameter sweep
    print("\n" + "=" * 78)
    print("PARAMETER SENSITIVITY (full year)")
    print("=" * 78)
    sweep = []
    for min_edge in (0.02, 0.03, 0.04, 0.05, 0.07):
        for kelly in (0.15, 0.25, 0.40):
            c = BacktestConfig(bankroll=args.bankroll, min_edge=min_edge,
                               kelly_fraction=kelly)
            _, s = run_backtest(sim, c)
            if s.get("n_trades"):
                sweep.append({
                    "min_edge": min_edge, "kelly": kelly, "n_trades": s["n_trades"],
                    "total_pnl": round(s["total_pnl"], 2),
                    "return": round(s["return_on_bankroll"], 4),
                    "sharpe": round(s["sharpe_daily_ann"], 3),
                    "max_dd": round(s["max_drawdown"], 4),
                    "win_rate": round(s["win_rate"], 4),
                    "p_positive": round(s["p_pnl_positive"], 4),
                })
    sweep_df = pd.DataFrame(sweep)
    print(sweep_df.to_string(index=False))
    sweep_df.to_csv(os.path.join(args.out, "parameter_sweep.csv"), index=False)
    report["parameter_sweep"] = sweep

    with open(os.path.join(args.out, "report.json"), "w") as fh:
        json.dump(_json_safe(report), fh, indent=2)
    print(f"\nWrote {args.out}/report.json and supporting CSVs.")


if __name__ == "__main__":
    main()
