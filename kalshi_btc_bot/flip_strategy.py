"""The "early flip" variant: buy the underdog cheap, early in the window.

The idea being tested: enter only below 50c -- so every position is on the side
the market currently thinks will lose -- and concentrate around the ~20c band
early in the 15-minute interval, where a modest move in spot flips the outcome
and the cheap side pays 4-5x.

Why it is plausible.  Entry price is roughly the market's probability, so a 20c
entry needs the underdog to "flip" and win ~1 time in 5 to break even. The
payoff is convex: risk 20c to make 80c. If the model's probability in that band
is even slightly better calibrated than the market's, the asymmetry does the
rest -- and the reliability table says it is (predicted 0.218 -> actual 0.223 in
that decile). Kalshi's quadratic fee also *helps* here: it is proportional to
p(1-p), so a 20c contract is charged ~1.1c versus ~1.8c at the money.

What this script measures, on real Kalshi quotes:
  1. a grid over entry-price band x how early the entry is allowed
  2. the flip rate (how often the underdog actually wins) versus what the entry
     price implied it needed to be
  3. the same execution-delay check applied to the best configuration, because
     the headline strategy's edge did not survive one minute of latency and
     this variant must be held to the same standard

Usage:
    python flip_strategy.py --cache cache --out results
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

from backtest import BacktestConfig, run_backtest
from diagnostics import delay_execution
from run_backtest import _json_safe, attach_real_quotes


def per_contract(trades: pd.DataFrame) -> float:
    if trades.empty:
        return float("nan")
    return float(trades["pnl"].sum() / trades["contracts"].sum())


def summarise_flips(trades: pd.DataFrame) -> dict:
    """Flip statistics: how often the underdog we bought actually won."""
    if trades.empty:
        return {"n": 0}
    t = trades
    implied = t["price"]                      # ~ market's probability for our side
    won = t["pnl"] > 0
    return {
        "n": int(len(t)),
        "mean_entry_price": float(implied.mean()),
        "breakeven_flip_rate": float(implied.mean()),
        "actual_flip_rate": float(won.mean()),
        "flip_rate_edge": float(won.mean() - implied.mean()),
        "mean_model_prob": float(t["p_model"].where(t["side"] == "yes",
                                                    1 - t["p_model"]).mean()),
        "avg_win": float(t.loc[won, "pnl"].mean()) if won.any() else 0.0,
        "avg_loss": float(t.loc[~won, "pnl"].mean()) if (~won).any() else 0.0,
        "per_contract": per_contract(t),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--out", default="results")
    ap.add_argument("--bankroll", type=float, default=10_000.0)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report: dict = {}

    pred = pd.read_parquet(os.path.join(args.cache, "walk_forward_predictions.parquet"))
    markets = pd.read_parquet(os.path.join(args.cache, "kalshi_markets.parquet"))
    candles = pd.read_parquet(os.path.join(args.cache, "kalshi_candles.parquet"))
    pred = attach_real_quotes(pred, markets, candles)
    real = pred.dropna(subset=["yes_bid", "yes_ask"]).copy()
    print(f"real-quote decision rows: {len(real):,}")
    print(f"range: {real['exec_ts'].min()} -> {real['exec_ts'].max()}\n")

    # ------------------------------------------------------------------ grid
    print("=" * 86)
    print("GRID: entry-price band x how early in the interval")
    print("=" * 86)
    print("  min_tau is the earliest-entry constraint: min_tau=10 means only")
    print("  minutes 1-5 of the 15, i.e. at least 10 minutes still to run.\n")

    bands = [
        ("cheap 0.10-0.30", 0.10, 0.30),
        ("target 0.15-0.35", 0.15, 0.35),
        ("underdog 0.15-0.50", 0.15, 0.50),
        ("all under 0.50", 0.01, 0.50),
        ("baseline (no cap)", 0.01, 0.97),
    ]
    taus = [
        ("very early (tau>=12)", 12),
        ("early (tau>=10)", 10),
        ("first half (tau>=8)", 8),
        ("any time (tau>=1)", 1),
    ]

    rows = []
    for bname, lo, hi in bands:
        for tname, min_tau in taus:
            cfg = BacktestConfig(bankroll=args.bankroll, min_price=lo, max_price=hi,
                                 min_tau=min_tau, min_edge=0.03)
            trades, summ = run_backtest(real, cfg)
            if not summ.get("n_trades"):
                continue
            rows.append({
                "band": bname, "timing": tname,
                "trades": summ["n_trades"],
                "pnl": round(summ["total_pnl"], 0),
                "per_contract": round(per_contract(trades), 4),
                "win_rate": round(summ["win_rate"], 4),
                "avg_price": round(summ["avg_price"], 3),
                "sharpe": round(summ["sharpe_daily_ann"], 2),
                "max_dd": round(summ["max_drawdown"], 3),
            })
    grid = pd.DataFrame(rows)
    print(grid.to_string(index=False))
    grid.to_csv(os.path.join(args.out, "flip_grid.csv"), index=False)
    report["grid"] = grid.to_dict("records")

    # ------------------------------------------------- best config, detailed
    best = grid.sort_values("per_contract", ascending=False).iloc[0]
    print(f"\nbest by per-contract edge: {best['band']} / {best['timing']}")

    lo, hi = next((l, h) for n, l, h in bands if n == best["band"])
    min_tau = next(t for n, t in taus if n == best["timing"])
    cfg = BacktestConfig(bankroll=args.bankroll, min_price=lo, max_price=hi,
                         min_tau=min_tau, min_edge=0.03)
    trades, summ = run_backtest(real, cfg)

    print("\n" + "=" * 86)
    print("FLIP STATISTICS FOR THE SELECTED CONFIGURATION")
    print("=" * 86)
    flips = summarise_flips(trades)
    for k, v in flips.items():
        print(f"  {k}: {v}")
    report["best_config"] = {"band": best["band"], "timing": best["timing"],
                             "min_price": lo, "max_price": hi, "min_tau": min_tau}
    report["flip_stats"] = flips
    report["best_summary"] = summ

    if not trades.empty:
        t = trades.copy()
        t["entry_bucket"] = pd.cut(t["price"], [0, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50])
        by_entry = (t.groupby("entry_bucket", observed=True)
                    .apply(lambda g: pd.Series({
                        "trades": len(g),
                        "implied_flip": g["price"].mean(),
                        "actual_flip": (g["pnl"] > 0).mean(),
                        "pnl": g["pnl"].sum(),
                        "per_contract": g["pnl"].sum() / g["contracts"].sum()}),
                           include_groups=False)
                    .reset_index())
        print("\n  by entry price (implied vs actual flip rate):")
        print(by_entry.to_string(index=False))
        by_entry.to_csv(os.path.join(args.out, "flip_by_entry.csv"), index=False)
        report["by_entry"] = by_entry.to_dict("records")

        by_tau = (t.groupby("tau_min")
                  .apply(lambda g: pd.Series({
                      "trades": len(g), "pnl": g["pnl"].sum(),
                      "actual_flip": (g["pnl"] > 0).mean(),
                      "per_contract": g["pnl"].sum() / g["contracts"].sum()}),
                         include_groups=False)
                  .reset_index())
        print("\n  by minutes remaining at entry:")
        print(by_tau.to_string(index=False))
        report["by_tau"] = by_tau.to_dict("records")

        trades.to_csv(os.path.join(args.out, "trades_flip.csv"), index=False)

    # --------------------------------------------- the same latency standard
    print("\n" + "=" * 86)
    print("EXECUTION DELAY ON THE SELECTED CONFIGURATION")
    print("=" * 86)
    print("  The headline strategy lost ~80% of its edge to one minute of")
    print("  latency. This variant has to face the same test.\n")
    delay_rows = []
    for delay in (0, 1, 2):
        sub = delay_execution(real, delay)
        trades_d, summ_d = run_backtest(sub, cfg)
        row = {"delay_min": delay, "trades": summ_d.get("n_trades", 0),
               "pnl": round(summ_d.get("total_pnl", 0.0), 2),
               "per_contract": round(per_contract(trades_d), 5),
               "win_rate": round(summ_d.get("win_rate", float("nan")), 4)}
        delay_rows.append(row)
        print(f"  delay={delay}m  trades={row['trades']:5d}  pnl=${row['pnl']:>10,.2f}  "
              f"per_contract=${row['per_contract']:+.5f}  win={row['win_rate']:.4f}")
    report["execution_delay"] = delay_rows

    with open(os.path.join(args.out, "flip_strategy.json"), "w") as fh:
        json.dump(_json_safe(report), fh, indent=2)
    print(f"\nWrote {args.out}/flip_strategy.json")


if __name__ == "__main__":
    main()
