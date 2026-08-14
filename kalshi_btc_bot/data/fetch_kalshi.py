"""Fetch real Kalshi KXBTC15M market data (public endpoints, no auth required).

Two datasets:

  markets      Every settled 15-minute market: strike, settlement value, outcome,
               volume, open interest.  This is ground truth for both the contract
               mechanics and the realised outcomes.

  candlesticks Per-minute yes-bid / yes-ask / trade price for individual markets.
               Used to calibrate the market-pricing model (implied vol, spread)
               and to run the backtest against genuine quotes.

Usage:
    python -m data.fetch_kalshi markets --days 70
    python -m data.fetch_kalshi candles --days 21
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = "KXBTC15M"


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "kalshi-btc-bot/1.0", "Accept": "application/json"})
    return s


def _get(session: requests.Session, url: str, params: dict, retries: int = 5) -> dict:
    delay = 1.0
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=30)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(delay)
                delay *= 2
                continue
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    return {}


def fetch_markets(days: int, series: str = SERIES) -> pd.DataFrame:
    """All settled markets in the trailing `days` window, walking the cursor."""
    session = _session()
    now = int(time.time())
    params = {
        "series_ticker": series,
        "status": "settled",
        "limit": 1000,
        "min_close_ts": now - days * 86400,
        "max_close_ts": now,
    }
    rows, cursor, page = [], None, 0
    while True:
        q = dict(params)
        if cursor:
            q["cursor"] = cursor
        payload = _get(session, f"{BASE}/markets", q)
        batch = payload.get("markets", [])
        rows.extend(batch)
        page += 1
        print(f"  page {page}: +{len(batch)} (total {len(rows)})", flush=True)
        cursor = payload.get("cursor")
        if not cursor or not batch:
            break
        time.sleep(0.12)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    keep = [c for c in [
        "ticker", "event_ticker", "open_time", "close_time", "expiration_value",
        "floor_strike", "strike_type", "result", "volume_fp", "open_interest_fp",
        "last_price_dollars", "settlement_value_dollars", "status",
    ] if c in df.columns]
    df = df[keep].copy()
    for col in ("open_time", "close_time"):
        df[col] = pd.to_datetime(df[col], utc=True, format="mixed")
    for col in ("expiration_value", "floor_strike", "volume_fp", "open_interest_fp",
                "last_price_dollars"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values("close_time").reset_index(drop=True)


def fetch_candles(tickers: list[str], windows: list[tuple[int, int]],
                  series: str = SERIES, pause: float = 0.09,
                  checkpoint: str | None = None) -> pd.DataFrame:
    """Per-minute candlesticks for the given markets. `windows` are (open_ts, close_ts).

    Thousands of markets take a while, so progress is checkpointed to CSV and a
    rerun skips markets already on disk.
    """
    session = _session()
    rows = []
    done: set[str] = set()
    if checkpoint and os.path.exists(checkpoint):
        prev = pd.read_csv(checkpoint)
        if not prev.empty:
            rows = prev.to_dict("records")
            done = set(prev["ticker"].unique())
            print(f"  resuming: {len(done):,} markets already fetched", flush=True)

    for i, (ticker, (start_ts, end_ts)) in enumerate(zip(tickers, windows), 1):
        if ticker in done:
            continue
        url = f"{BASE}/series/{series}/markets/{ticker}/candlesticks"
        try:
            payload = _get(session, url, {
                "start_ts": int(start_ts), "end_ts": int(end_ts), "period_interval": 1,
            })
        except Exception as exc:
            print(f"  ! {ticker}: {exc}", flush=True)
            time.sleep(pause)
            continue

        for c in payload.get("candlesticks", []):
            price, bid, ask = c.get("price", {}), c.get("yes_bid", {}), c.get("yes_ask", {})
            rows.append({
                "ticker": ticker,
                "end_period_ts": c.get("end_period_ts"),
                "price_close": price.get("close_dollars"),
                "price_mean": price.get("mean_dollars"),
                "yes_bid_close": bid.get("close_dollars"),
                "yes_ask_close": ask.get("close_dollars"),
                "volume_fp": c.get("volume_fp"),
                "open_interest_fp": c.get("open_interest_fp"),
            })
        if i % 100 == 0:
            print(f"  {i}/{len(tickers)} markets ({len(rows):,} candles)", flush=True)
            if checkpoint:
                pd.DataFrame(rows).to_csv(checkpoint, index=False)
        time.sleep(pause)

    if checkpoint:
        pd.DataFrame(rows).to_csv(checkpoint, index=False)

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    for col in ("price_close", "price_mean", "yes_bid_close", "yes_ask_close",
                "volume_fp", "open_interest_fp"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["ts"] = pd.to_datetime(df["end_period_ts"], unit="s", utc=True)
    return df


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["markets", "candles"])
    p.add_argument("--days", type=int, default=70)
    p.add_argument("--cache", default="cache")
    args = p.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    if args.mode == "markets":
        df = fetch_markets(args.days)
        out = os.path.join(args.cache, "kalshi_markets.parquet")
        df.to_parquet(out, index=False)
        print(f"Saved {len(df):,} settled markets -> {out}")
        if not df.empty:
            print(f"Range: {df['close_time'].min()} -> {df['close_time'].max()}")
            print(f"YES rate: {(df['result'] == 'yes').mean():.4f}")
        return

    markets_path = os.path.join(args.cache, "kalshi_markets.parquet")
    mk = pd.read_parquet(markets_path)
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=args.days)
    mk = mk[mk["close_time"] >= cutoff].reset_index(drop=True)
    print(f"Fetching candles for {len(mk):,} markets since {cutoff}", flush=True)

    tickers = mk["ticker"].tolist()
    windows = [(int(o.timestamp()), int(c.timestamp()))
               for o, c in zip(mk["open_time"], mk["close_time"])]
    df = fetch_candles(tickers, windows,
                       checkpoint=os.path.join(args.cache, "kalshi_candles_checkpoint.csv"))
    out = os.path.join(args.cache, "kalshi_candles.parquet")
    df.to_parquet(out, index=False)
    print(f"Saved {len(df):,} candles -> {out}")


if __name__ == "__main__":
    main()
