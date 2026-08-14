"""Live paper trader for Kalshi's KXBTC15M market.

Reads real market state (Kalshi public API) and real BTC prices (Coinbase),
scores the live contract with the trained model, and books simulated fills
against the genuine order book -- walking real depth, paying the real Kalshi
fee.  No credentials, no orders: nothing here can place a trade.

    python paper_trader.py --model models/live_model.pkl --state results/paper_state.json

State persists to JSON, so the process can be restarted without losing the
portfolio.  Positions are held to settlement and marked when Kalshi finalises
the market.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

import contract
import features as F
from backtest import BacktestConfig, kelly_size
from data.fetch_btc import fetch_range
from data.fetch_sentiment import fetch_fng

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = "KXBTC15M"
FEATURE_LOOKBACK_MIN = 1500          # enough history for the 1440m features
_running = True


def _stop(signum, frame):  # noqa: ARG001
    global _running
    _running = False
    print("\nstopping after current iteration...", flush=True)


# --------------------------------------------------------------------------
# Market data
# --------------------------------------------------------------------------

def get_open_market(session: requests.Session) -> dict | None:
    r = session.get(f"{KALSHI}/markets",
                    params={"series_ticker": SERIES, "status": "open", "limit": 5},
                    timeout=20)
    r.raise_for_status()
    markets = r.json().get("markets", [])
    if not markets:
        return None
    now = datetime.now(timezone.utc)
    live = []
    for m in markets:
        close = pd.Timestamp(m["close_time"]).tz_convert("UTC")
        open_t = pd.Timestamp(m["open_time"]).tz_convert("UTC")
        if open_t <= now < close:
            live.append((close, m))
    if not live:
        return None
    return sorted(live)[0][1]


def get_orderbook(session: requests.Session, ticker: str, depth: int = 10) -> dict:
    r = session.get(f"{KALSHI}/markets/{ticker}/orderbook",
                    params={"depth": depth}, timeout=20)
    r.raise_for_status()
    return r.json().get("orderbook_fp", {}) or {}


def top_of_book(ob: dict) -> tuple[float | None, float | None]:
    """Best yes bid and yes ask from Kalshi's two-sided book.

    Kalshi quotes each side as its own bid ladder: `yes_dollars` are bids to buy
    YES, `no_dollars` are bids to buy NO.  The best offer on YES is therefore
    1 - (best NO bid).
    """
    yes_levels = ob.get("yes_dollars") or []
    no_levels = ob.get("no_dollars") or []
    yes_bid = max((float(p) for p, _ in yes_levels), default=None)
    no_bid = max((float(p) for p, _ in no_levels), default=None)
    yes_ask = (1.0 - no_bid) if no_bid is not None else None
    return yes_bid, yes_ask


def walk_book(ob: dict, side: str, contracts: int) -> tuple[float, int]:
    """Average fill price walking real depth. Returns (avg_price, filled)."""
    levels = (ob.get("no_dollars") or []) if side == "yes" else (ob.get("yes_dollars") or [])
    # To buy YES you lift the NO bids (cost = 1 - no_bid); to buy NO you lift
    # the YES bids (cost = 1 - yes_bid).  Best (cheapest) first.
    book = sorted(((1.0 - float(p), float(sz)) for p, sz in levels), key=lambda x: x[0])
    filled, cost = 0, 0.0
    for price, size in book:
        take = min(contracts - filled, int(size))
        if take <= 0:
            continue
        filled += take
        cost += take * price
        if filled >= contracts:
            break
    if filled == 0:
        return float("nan"), 0
    return cost / filled, filled


# --------------------------------------------------------------------------
# Feature pipeline for the live contract
# --------------------------------------------------------------------------

class LiveFeatures:
    """Maintains a rolling BTC/ETH window and builds one live decision row."""

    def __init__(self, cache: str = "cache"):
        self.cache = cache
        self.fng = self._load_fng()
        self.btc: pd.DataFrame | None = None
        self.eth: pd.DataFrame | None = None
        self.last_refresh = datetime.min.replace(tzinfo=timezone.utc)

    def _load_fng(self) -> pd.DataFrame:
        try:
            return fetch_fng()
        except Exception:
            path = os.path.join(self.cache, "fng.parquet")
            return pd.read_parquet(path) if os.path.exists(path) else pd.DataFrame()

    def refresh(self, force: bool = False) -> None:
        now = datetime.now(timezone.utc)
        if not force and (now - self.last_refresh) < timedelta(seconds=45):
            return
        end = now.replace(second=0, microsecond=0)
        start = end - timedelta(minutes=FEATURE_LOOKBACK_MIN)
        self.btc = fetch_range("BTC-USD", start, end, pause=0.12)
        try:
            self.eth = fetch_range("ETH-USD", start, end, pause=0.12)
        except Exception:
            self.eth = None
        self.last_refresh = now

    def decision_row(self, market: dict) -> pd.DataFrame | None:
        """Build the single decision row for the currently open market."""
        self.refresh()
        if self.btc is None or self.btc.empty:
            return None

        open_t = pd.Timestamp(market["open_time"]).tz_convert("UTC")
        close_t = pd.Timestamp(market["close_time"]).tz_convert("UTC")
        strike = float(market["floor_strike"])

        panel = F.minute_features(self.btc, self.eth, self.fng)
        # Latest completed bar is the feature timestamp; we act one minute later.
        feat_ts = panel["ts"].max()
        exec_ts = feat_ts + pd.Timedelta(minutes=1)
        minutes_elapsed = int(round((exec_ts - open_t).total_seconds() / 60))
        tau = int(round((close_t - exec_ts).total_seconds() / 60))
        if not (1 <= minutes_elapsed <= 14) or tau < 1:
            return None

        win = pd.DataFrame({
            "open_time": [open_t], "close_time": [close_t],
            "strike": [strike], "settle": [np.nan], "result": [0],
        })
        dec = F.decision_frame(panel, win, decision_minutes=(minutes_elapsed,))
        if dec.empty:
            return None
        dec = dec[dec["exec_ts"] == exec_ts]
        return dec if not dec.empty else None


# --------------------------------------------------------------------------
# Portfolio
# --------------------------------------------------------------------------

class PaperPortfolio:
    def __init__(self, path: str, bankroll: float):
        self.path = path
        self.state = {
            "bankroll": bankroll, "start_bankroll": bankroll,
            "open_positions": {}, "closed": [], "skipped": 0,
            "created": datetime.now(timezone.utc).isoformat(),
        }
        if os.path.exists(path):
            with open(path) as fh:
                self.state.update(json.load(fh))

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = f"{self.path}.tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh, indent=2, default=str)
        os.replace(tmp, self.path)

    def has_position(self, ticker: str) -> bool:
        return ticker in self.state["open_positions"]

    def enter(self, ticker: str, rec: dict) -> None:
        self.state["open_positions"][ticker] = rec
        self.state["bankroll"] -= rec["outlay"] + rec["fee"]
        self.save()

    def settle(self, ticker: str, result: str) -> dict | None:
        pos = self.state["open_positions"].pop(ticker, None)
        if pos is None:
            return None
        won = (result == "yes") == (pos["side"] == "yes")
        payout = pos["contracts"] * 1.0 if won else 0.0
        pnl = payout - pos["outlay"] - pos["fee"]
        self.state["bankroll"] += payout
        pos.update({"result": result, "won": bool(won), "payout": payout, "pnl": pnl,
                    "settled_at": datetime.now(timezone.utc).isoformat(),
                    "bankroll_after": self.state["bankroll"]})
        self.state["closed"].append(pos)
        self.save()
        return pos

    def summary(self) -> dict:
        closed = self.state["closed"]
        if not closed:
            return {"trades": 0, "bankroll": self.state["bankroll"]}
        pnl = [c["pnl"] for c in closed]
        return {
            "trades": len(closed),
            "bankroll": round(self.state["bankroll"], 2),
            "total_pnl": round(sum(pnl), 2),
            "win_rate": round(np.mean([c["won"] for c in closed]), 4),
            "avg_pnl": round(float(np.mean(pnl)), 4),
            "open": len(self.state["open_positions"]),
        }


# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------

def settle_pending(session: requests.Session, port: PaperPortfolio) -> None:
    for ticker in list(port.state["open_positions"]):
        try:
            r = session.get(f"{KALSHI}/markets/{ticker}", timeout=20)
            r.raise_for_status()
            m = r.json().get("market", {})
        except Exception as exc:
            print(f"  settle check failed for {ticker}: {exc}", flush=True)
            continue
        result = m.get("result")
        if result in ("yes", "no"):
            pos = port.settle(ticker, result)
            if pos:
                print(f"  SETTLED {ticker} -> {result.upper()}  "
                      f"pnl=${pos['pnl']:+.2f}  bankroll=${port.state['bankroll']:,.2f}",
                      flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/live_model.pkl")
    ap.add_argument("--state", default="results/paper_state.json")
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--bankroll", type=float, default=10_000.0)
    ap.add_argument("--min-edge", type=float, default=0.03)
    ap.add_argument("--kelly", type=float, default=0.25)
    ap.add_argument("--poll", type=float, default=20.0)
    ap.add_argument("--max-iterations", type=int, default=0, help="0 = run forever")
    ap.add_argument("--dry-run", action="store_true",
                    help="score markets and log decisions without booking fills")
    args = ap.parse_args()

    import pickle
    with open(args.model, "rb") as fh:
        bundle = pickle.load(fh)
    ens, feats = bundle["ensemble"], bundle["features"]
    print(f"model trained {bundle['trained_at']} on {bundle['train_rows']:,} rows")
    print(f"holdout: {bundle['holdout_scores']}")

    cfg = BacktestConfig(bankroll=args.bankroll, min_edge=args.min_edge,
                         kelly_fraction=args.kelly)
    port = PaperPortfolio(args.state, args.bankroll)
    live = LiveFeatures(args.cache)
    session = requests.Session()
    session.headers.update({"User-Agent": "kalshi-btc-bot/1.0"})

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    print(f"\nPAPER TRADING {SERIES} -- no credentials, no live orders")
    print(f"bankroll ${port.state['bankroll']:,.2f}  min_edge ${cfg.min_edge:.3f}  "
          f"kelly {cfg.kelly_fraction}\n")

    it = 0
    while _running:
        it += 1
        if args.max_iterations and it > args.max_iterations:
            break
        try:
            settle_pending(session, port)

            market = get_open_market(session)
            if market is None:
                time.sleep(args.poll)
                continue
            ticker = market["ticker"]

            row = live.decision_row(market)
            if row is None or row.empty:
                time.sleep(args.poll)
                continue

            p = float(ens.predict_proba(row)[0])
            ob = get_orderbook(session, ticker)
            yes_bid, yes_ask = top_of_book(ob)
            if yes_bid is None or yes_ask is None:
                time.sleep(args.poll)
                continue

            tau = int(row["tau_min"].iloc[0])
            yes_cost, no_cost = yes_ask, 1.0 - yes_bid
            yes_edge = p - yes_cost - contract.trade_fee(1.0, yes_cost, cfg.fee_multiplier)
            no_edge = (1 - p) - no_cost - contract.trade_fee(1.0, no_cost, cfg.fee_multiplier)
            side, cost, edge = (("yes", yes_cost, yes_edge) if yes_edge >= no_edge
                                else ("no", no_cost, no_edge))

            stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
            print(f"[{stamp}] {ticker} tau={tau:2d}m  strike={market['floor_strike']:,.2f} "
                  f"px={row['price'].iloc[0]:,.2f}  p={p:.3f}  "
                  f"book={yes_bid:.2f}/{yes_ask:.2f}  best={side} edge=${edge:+.4f}",
                  flush=True)

            if port.has_position(ticker) or edge < cfg.min_edge \
                    or not (cfg.min_prob <= p <= cfg.max_prob) \
                    or cost > cfg.max_price or tau < cfg.min_tau:
                time.sleep(args.poll)
                continue

            base = port.state["bankroll"]
            f = kelly_size(p, cost, side) * cfg.kelly_fraction
            stake = min(f * base, cfg.max_stake_frac * base)
            want = min(int(stake // cost), cfg.max_contracts)
            if want < 1:
                time.sleep(args.poll)
                continue

            avg_price, filled = walk_book(ob, side, want)
            if filled < 1 or not np.isfinite(avg_price):
                time.sleep(args.poll)
                continue

            outlay = filled * avg_price
            fee = contract.trade_fee(filled, avg_price, cfg.fee_multiplier)
            if outlay + fee > port.state["bankroll"]:
                time.sleep(args.poll)
                continue

            rec = {
                "ticker": ticker, "side": side, "contracts": filled,
                "price": round(avg_price, 4), "outlay": round(outlay, 2),
                "fee": fee, "p_model": round(p, 4), "edge": round(edge, 4),
                "tau_min": tau, "strike": market["floor_strike"],
                "btc_price": float(row["price"].iloc[0]),
                "entered_at": datetime.now(timezone.utc).isoformat(),
                "close_time": market["close_time"],
            }
            if args.dry_run:
                print(f"  DRY RUN would buy {filled} {side.upper()} @ {avg_price:.3f}",
                      flush=True)
            else:
                port.enter(ticker, rec)
                print(f"  >>> BOUGHT {filled} {side.upper()} @ {avg_price:.4f} "
                      f"(fee ${fee:.2f})  bankroll=${port.state['bankroll']:,.2f}",
                      flush=True)
                print(f"      {port.summary()}", flush=True)

        except requests.RequestException as exc:
            print(f"  network error: {exc}", flush=True)
            time.sleep(5)
        except Exception as exc:  # keep the loop alive
            print(f"  error: {type(exc).__name__}: {exc}", flush=True)
            time.sleep(5)

        time.sleep(args.poll)

    print("\nfinal:", port.summary())
    port.save()


if __name__ == "__main__":
    main()
