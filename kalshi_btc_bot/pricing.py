"""Market-side pricing: what the bot has to trade against.

Two regimes:

  REAL    For the period where Kalshi's per-minute candlesticks exist, the
          backtest uses the genuine yes_bid / yes_ask quotes.  Nothing is
          modelled -- fills cross a real spread.

  MODELLED For the rest of the backtest year (the series did not exist yet),
          quotes are simulated.  The model is not invented: its two components
          -- the market's implied volatility scale and its spread as a function
          of time-to-expiry and moneyness -- are *fitted to the real Kalshi
          quote data* by `calibrate_from_real`, then applied to the earlier
          period.  Any result from the modelled regime inherits the assumption
          that market-making behaved then as it does now, which is stated
          alongside the numbers rather than buried.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd
from scipy import stats

from contract import trade_fee

TICK = 0.01


def round_to_tick(p: np.ndarray | float, tick: float = TICK) -> np.ndarray | float:
    return np.round(np.asarray(p, dtype=float) / tick) * tick


@dataclass
class MarketModel:
    """Simulated Kalshi quotes for the pre-launch period."""

    vol_scale: float = 1.0        # market's implied vol vs realised sigma estimate
    nu: float = 5.0               # tail parameter of the market's implied law
    spread_base: float = 0.02     # spread at mid-range, mid-window
    spread_tau_coef: float = 0.0  # extra spread per sqrt(minute) remaining
    spread_edge_coef: float = 0.0 # spread narrowing toward the 0/1 boundaries
    spread_min: float = 0.01
    spread_max: float = 0.10
    bias: float = 0.0             # systematic logit bias of the market mid

    def mid(self, dec: pd.DataFrame) -> np.ndarray:
        z = dec["z_moneyness"].to_numpy(dtype=float) / self.vol_scale
        p = stats.t.cdf(z, df=self.nu)
        p = np.clip(np.nan_to_num(p, nan=0.5), 1e-4, 1 - 1e-4)
        if self.bias:
            odds = np.log(p / (1 - p)) + self.bias
            p = 1.0 / (1.0 + np.exp(-odds))
        return p

    def spread(self, dec: pd.DataFrame, mid: np.ndarray) -> np.ndarray:
        tau = dec["tau_min"].to_numpy(dtype=float)
        dist = np.abs(mid - 0.5)
        s = (self.spread_base
             + self.spread_tau_coef * np.sqrt(np.maximum(tau, 0.0))
             + self.spread_edge_coef * dist)
        return np.clip(s, self.spread_min, self.spread_max)

    def quotes(self, dec: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        mid = self.mid(dec)
        s = self.spread(dec, mid)
        bid = round_to_tick(np.clip(mid - s / 2, 0.01, 0.99))
        ask = round_to_tick(np.clip(mid + s / 2, 0.01, 0.99))
        ask = np.maximum(ask, bid + TICK)
        return bid, ask, mid

    def to_dict(self) -> dict:
        return asdict(self)


def calibrate_from_real(dec_real: pd.DataFrame) -> tuple[MarketModel, dict]:
    """Fit the market model to real Kalshi quotes.

    `dec_real` must carry, per decision row: z_moneyness, tau_min, and the real
    yes_bid / yes_ask observed at that minute.
    """
    d = dec_real.dropna(subset=["z_moneyness", "yes_bid", "yes_ask", "tau_min"]).copy()
    d = d[(d["yes_ask"] > d["yes_bid"]) & (d["yes_bid"] > 0) & (d["yes_ask"] < 1)]
    if d.empty:
        return MarketModel(), {"n": 0}

    d["mid"] = (d["yes_bid"] + d["yes_ask"]) / 2.0
    d["spread"] = d["yes_ask"] - d["yes_bid"]

    # --- implied vol scale: which scale makes t-cdf(z/scale) match the mid? ---
    best, best_err = 1.0, np.inf
    for scale in np.arange(0.5, 2.51, 0.01):
        for nu in (3.0, 4.0, 5.0, 8.0, 15.0):
            pred = stats.t.cdf(d["z_moneyness"] / scale, df=nu)
            err = float(np.mean((pred - d["mid"]) ** 2))
            if err < best_err:
                best_err, best, best_nu = err, scale, nu
    model = MarketModel(vol_scale=float(best), nu=float(best_nu))

    # --- residual logit bias -------------------------------------------------
    pred = np.clip(model.mid(d), 1e-4, 1 - 1e-4)
    obs = np.clip(d["mid"].to_numpy(), 1e-4, 1 - 1e-4)
    model.bias = float(np.median(np.log(obs / (1 - obs)) - np.log(pred / (1 - pred))))

    # --- spread as a linear function of sqrt(tau) and |mid - 0.5| -----------
    X = np.column_stack([
        np.ones(len(d)),
        np.sqrt(d["tau_min"].to_numpy(dtype=float)),
        np.abs(d["mid"].to_numpy() - 0.5),
    ])
    coef, *_ = np.linalg.lstsq(X, d["spread"].to_numpy(dtype=float), rcond=None)
    model.spread_base = float(coef[0])
    model.spread_tau_coef = float(coef[1])
    model.spread_edge_coef = float(coef[2])
    model.spread_min = float(max(d["spread"].quantile(0.05), TICK))
    model.spread_max = float(d["spread"].quantile(0.95))

    diag = {
        "n": int(len(d)),
        "mid_rmse": float(np.sqrt(np.mean((model.mid(d) - d["mid"]) ** 2))),
        "spread_mean": float(d["spread"].mean()),
        "spread_median": float(d["spread"].median()),
        "spread_pred_rmse": float(np.sqrt(np.mean(
            (model.spread(d, d["mid"].to_numpy()) - d["spread"]) ** 2))),
        "implied_vol_scale": model.vol_scale,
        "nu": model.nu,
        "logit_bias": model.bias,
    }
    return model, diag


def market_efficiency(dec_real: pd.DataFrame) -> dict:
    """How well do the real Kalshi mids predict the real outcome?

    This is the bar the bot has to clear: a Brier skill near the market's means
    there is no edge to take.
    """
    d = dec_real.dropna(subset=["yes_bid", "yes_ask", "target"]).copy()
    if d.empty:
        return {"n": 0}
    mid = ((d["yes_bid"] + d["yes_ask"]) / 2.0).clip(1e-4, 1 - 1e-4).to_numpy()
    y = d["target"].to_numpy(dtype=float)
    brier = float(np.mean((mid - y) ** 2))
    base = float(np.mean(y))
    return {
        "n": int(len(d)),
        "market_brier": brier,
        "market_brier_skill": 1 - brier / float(np.mean((base - y) ** 2)),
        "market_log_loss": float(-np.mean(y * np.log(mid) + (1 - y) * np.log(1 - mid))),
        "mean_spread": float((d["yes_ask"] - d["yes_bid"]).mean()),
        "mean_mid": float(mid.mean()),
    }


def net_edge(p: np.ndarray, price: np.ndarray, side: str,
             fee_multiplier: float = 0.07) -> np.ndarray:
    """Expected profit per contract after the Kalshi fee, in dollars.

    YES at ask a: EV = p*(1-a) - (1-p)*a - fee = p - a - fee
    NO  at (1-b): EV = (1-p) - (1-b) - fee    = b - p - fee
    """
    p = np.asarray(p, dtype=float)
    price = np.asarray(price, dtype=float)
    fee = np.array([trade_fee(1.0, float(x), fee_multiplier) for x in price])
    if side == "yes":
        return p - price - fee
    return (1.0 - p) - (1.0 - price) - fee
