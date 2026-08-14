"""Event-driven backtest for the 15-minute BTC market.

Mechanics modelled:
  * one decision per minute inside each 15-minute window
  * fills cross the real (or calibrated) bid/ask -- buying YES lifts the ask,
    buying NO hits the bid side of the yes book
  * Kalshi's quadratic trading fee on entry, no fee at settlement
  * a single position per window, held to expiry, with an optional minimum
    edge, probability band, and liquidity cap
  * fractional-Kelly sizing bounded by a per-trade cap and available bankroll

Deliberately *not* modelled: queue position for resting orders (every fill is a
taker fill, the conservative assumption), and partial fills beyond the size cap.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

from contract import trade_fee


@dataclass
class BacktestConfig:
    bankroll: float = 10_000.0
    min_edge: float = 0.03          # required EV per contract, in dollars, after fees
    kelly_fraction: float = 0.25
    max_stake_frac: float = 0.02    # cap per trade as a share of bankroll
    max_contracts: int = 500
    min_prob: float = 0.05          # skip lottery tickets at the extremes
    max_prob: float = 0.95
    min_tau: int = 1                # minutes to expiry required to enter
    max_tau: int = 14
    fee_multiplier: float = 0.07
    liquidity_cap: int | None = None  # contracts available at the touch
    compound: bool = True
    one_trade_per_window: bool = True
    max_price: float = 0.97         # never pay more than this per contract


@dataclass
class Trade:
    ts: pd.Timestamp
    window_open: pd.Timestamp
    close_time: pd.Timestamp
    side: str
    price: float
    contracts: int
    p_model: float
    market_mid: float
    edge: float
    tau_min: int
    fee: float
    result: int
    pnl: float
    bankroll_after: float


def kelly_size(p: float, price: float, side: str) -> float:
    """Kelly fraction of bankroll for a binary contract.

    Buying at `price` wins (1 - price) with prob q, loses `price` with prob 1-q.
    f* = (q * b - (1 - q)) / b   with b = (1 - price) / price
    """
    q = p if side == "yes" else 1.0 - p
    cost = price if side == "yes" else price
    if cost <= 0 or cost >= 1:
        return 0.0
    b = (1.0 - cost) / cost
    f = (q * b - (1.0 - q)) / b
    return max(f, 0.0)


def run_backtest(dec: pd.DataFrame, config: BacktestConfig,
                 prob_col: str = "p_model") -> tuple[pd.DataFrame, dict]:
    """Run the strategy over a decision frame carrying quotes and probabilities.

    Required columns: ts, window_open, close_time, tau_min, target,
    `prob_col`, yes_bid, yes_ask.
    """
    need = {"ts", "window_open", "close_time", "tau_min", "target",
            prob_col, "yes_bid", "yes_ask"}
    missing = need - set(dec.columns)
    if missing:
        raise ValueError(f"decision frame missing columns: {sorted(missing)}")

    d = dec.dropna(subset=[prob_col, "yes_bid", "yes_ask", "target"]).copy()
    d = d.sort_values(["ts", "window_open"]).reset_index(drop=True)
    d = d[(d["tau_min"] >= config.min_tau) & (d["tau_min"] <= config.max_tau)]

    bankroll = config.bankroll
    peak = bankroll
    trades: list[Trade] = []
    traded_windows: set = set()

    p_all = d[prob_col].to_numpy(dtype=float)
    bid_all = d["yes_bid"].to_numpy(dtype=float)
    ask_all = d["yes_ask"].to_numpy(dtype=float)
    tau_all = d["tau_min"].to_numpy(dtype=int)
    tgt_all = d["target"].to_numpy(dtype=int)
    win_all = d["window_open"].to_numpy()
    ts_all = d["ts"].to_numpy()
    close_all = d["close_time"].to_numpy()

    for i in range(len(d)):
        wkey = win_all[i]
        if config.one_trade_per_window and wkey in traded_windows:
            continue

        p = p_all[i]
        if not (config.min_prob <= p <= config.max_prob):
            continue

        bid, ask = bid_all[i], ask_all[i]
        if not (0 < bid < ask < 1):
            continue

        # Evaluate both sides; take the better one if it clears the bar.
        yes_cost = ask
        no_cost = 1.0 - bid
        yes_fee = trade_fee(1.0, yes_cost, config.fee_multiplier)
        no_fee = trade_fee(1.0, no_cost, config.fee_multiplier)
        yes_edge = p - yes_cost - yes_fee
        no_edge = (1.0 - p) - no_cost - no_fee

        if yes_edge >= no_edge:
            side, cost, edge, fee_unit = "yes", yes_cost, yes_edge, yes_fee
        else:
            side, cost, edge, fee_unit = "no", no_cost, no_edge, no_fee

        if edge < config.min_edge or cost > config.max_price:
            continue

        base = bankroll if config.compound else config.bankroll
        f = kelly_size(p, cost, side) * config.kelly_fraction
        stake = min(f * base, config.max_stake_frac * base)
        contracts = int(stake // cost)
        contracts = min(contracts, config.max_contracts)
        if config.liquidity_cap is not None:
            contracts = min(contracts, config.liquidity_cap)
        if contracts < 1:
            continue

        outlay = contracts * cost
        fee = trade_fee(contracts, cost, config.fee_multiplier)
        if outlay + fee > bankroll:
            continue

        won = (tgt_all[i] == 1) if side == "yes" else (tgt_all[i] == 0)
        payout = contracts * 1.0 if won else 0.0
        pnl = payout - outlay - fee
        bankroll += pnl
        peak = max(peak, bankroll)
        traded_windows.add(wkey)

        trades.append(Trade(
            ts=pd.Timestamp(ts_all[i]), window_open=pd.Timestamp(wkey),
            close_time=pd.Timestamp(close_all[i]), side=side, price=float(cost),
            contracts=contracts, p_model=float(p),
            market_mid=float((bid + ask) / 2), edge=float(edge),
            tau_min=int(tau_all[i]), fee=float(fee), result=int(tgt_all[i]),
            pnl=float(pnl), bankroll_after=float(bankroll),
        ))

        if bankroll <= 0:
            break

    tdf = pd.DataFrame([asdict(t) for t in trades])
    return tdf, summarise(tdf, config)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

def summarise(trades: pd.DataFrame, config: BacktestConfig) -> dict:
    if trades.empty:
        return {"n_trades": 0, "note": "no trades met the entry criteria"}

    t = trades.sort_values("close_time").reset_index(drop=True)
    start_bankroll = config.bankroll
    final = float(t["bankroll_after"].iloc[-1])
    pnl = float(t["pnl"].sum())
    turnover = float((t["contracts"] * t["price"]).sum())

    # Daily aggregation for risk statistics
    daily = (t.set_index("close_time")["pnl"].resample("1D").sum())
    equity = start_bankroll + t["pnl"].cumsum()
    running_peak = equity.cummax()
    dd = (equity - running_peak) / running_peak
    daily_equity = start_bankroll + daily.cumsum()

    days = max((t["close_time"].max() - t["close_time"].min()).days, 1)
    ann = 365.0 / days

    win_rate = float((t["pnl"] > 0).mean())
    avg_win = float(t.loc[t["pnl"] > 0, "pnl"].mean()) if (t["pnl"] > 0).any() else 0.0
    avg_loss = float(t.loc[t["pnl"] <= 0, "pnl"].mean()) if (t["pnl"] <= 0).any() else 0.0

    daily_std = float(daily.std())
    sharpe = float(daily.mean() / daily_std * np.sqrt(365)) if daily_std > 0 else float("nan")
    downside = daily[daily < 0].std()
    sortino = float(daily.mean() / downside * np.sqrt(365)) if downside and downside > 0 else float("nan")

    # Bootstrap CI on total P&L (resample trades with replacement)
    rng = np.random.default_rng(11)
    pnls = t["pnl"].to_numpy()
    boots = rng.choice(pnls, size=(2000, len(pnls)), replace=True).sum(axis=1)

    return {
        "n_trades": int(len(t)),
        "start_bankroll": start_bankroll,
        "final_bankroll": final,
        "total_pnl": pnl,
        "return_on_bankroll": pnl / start_bankroll,
        "annualised_return": (final / start_bankroll) ** ann - 1 if final > 0 else -1.0,
        "turnover": turnover,
        "roi_on_turnover": pnl / turnover if turnover else float("nan"),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": float(t.loc[t["pnl"] > 0, "pnl"].sum()
                               / abs(t.loc[t["pnl"] <= 0, "pnl"].sum()))
        if (t["pnl"] <= 0).any() else float("inf"),
        "avg_edge": float(t["edge"].mean()),
        "realised_edge_per_contract": pnl / float(t["contracts"].sum()),
        "total_fees": float(t["fee"].sum()),
        "max_drawdown": float(dd.min()),
        "max_drawdown_dollars": float((equity - running_peak).min()),
        "sharpe_daily_ann": sharpe,
        "sortino_daily_ann": sortino,
        "trades_per_day": len(t) / days,
        "days_covered": days,
        "pnl_ci95": (float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))),
        "p_pnl_positive": float((boots > 0).mean()),
        "yes_share": float((t["side"] == "yes").mean()),
        "avg_price": float(t["price"].mean()),
        "avg_contracts": float(t["contracts"].mean()),
        "final_daily_equity": float(daily_equity.iloc[-1]),
    }


def breakdowns(trades: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """P&L slices that reveal where the edge actually lives."""
    if trades.empty:
        return {}
    t = trades.copy()
    t["hour"] = t["close_time"].dt.hour
    t["dow"] = t["close_time"].dt.dayofweek
    t["month"] = t["close_time"].dt.to_period("M").astype(str)
    t["edge_bucket"] = pd.cut(t["edge"], [-1, 0.04, 0.06, 0.09, 0.15, 1.0])
    t["price_bucket"] = pd.cut(t["price"], [0, 0.2, 0.4, 0.6, 0.8, 1.0])

    def agg(col: str) -> pd.DataFrame:
        return (t.groupby(col, observed=True)
                .agg(trades=("pnl", "size"), pnl=("pnl", "sum"),
                     win_rate=("pnl", lambda x: (x > 0).mean()),
                     avg_edge=("edge", "mean"))
                .reset_index())

    return {name: agg(name) for name in
            ["hour", "dow", "month", "tau_min", "side", "edge_bucket", "price_bucket"]}


def baseline_strategies(dec: pd.DataFrame, config: BacktestConfig) -> dict:
    """Sanity baselines: always-YES, always-NO, and coin-flip entries."""
    d = dec.dropna(subset=["yes_bid", "yes_ask", "target"]).copy()
    d = d[d["tau_min"] == 7]
    out = {}
    for name in ("always_yes", "always_no", "random"):
        rng = np.random.default_rng(3)
        pnl = 0.0
        n = 0
        for _, row in d.iterrows():
            if name == "always_yes":
                side = "yes"
            elif name == "always_no":
                side = "no"
            else:
                side = "yes" if rng.random() < 0.5 else "no"
            cost = row["yes_ask"] if side == "yes" else 1.0 - row["yes_bid"]
            if not (0 < cost < 1):
                continue
            won = (row["target"] == 1) if side == "yes" else (row["target"] == 0)
            pnl += (1.0 if won else 0.0) - cost - trade_fee(1.0, cost, config.fee_multiplier)
            n += 1
        out[name] = {"n": n, "pnl_per_contract": pnl / n if n else float("nan")}
    return out
