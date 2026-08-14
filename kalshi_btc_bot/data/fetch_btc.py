"""Fetch real 1-minute BTC-USD OHLCV history from the Coinbase Exchange public API.

Coinbase caps each candles request at 300 buckets, so a year of 1-minute data is
pulled in ~1750 sequential windows.  Results are cached per-window on disk so an
interrupted run resumes instead of re-downloading.

Usage:
    python -m data.fetch_btc --days 365 --out cache/btc_1m.parquet
"""

from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

API = "https://api.exchange.coinbase.com/products/{product}/candles"
GRANULARITY = 60
MAX_BUCKETS = 300
COLUMNS = ["time", "low", "high", "open", "close", "volume"]


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_window(session: requests.Session, product: str, start: datetime, end: datetime,
                 retries: int = 5) -> list[list[float]]:
    params = {"granularity": GRANULARITY, "start": _iso(start), "end": _iso(end)}
    delay = 1.0
    for attempt in range(retries):
        try:
            r = session.get(API.format(product=product), params=params, timeout=30)
            if r.status_code == 429:
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
    return []


def fetch_range(product: str, start: datetime, end: datetime, pause: float = 0.16,
                progress_every: int = 50, checkpoint: str | None = None) -> pd.DataFrame:
    """Walk the range in 300-bucket windows, checkpointing to CSV as it goes.

    The checkpoint makes a long pull resumable: a rerun reads what is already on
    disk and only fetches the gap to `end`.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "kalshi-btc-bot/1.0"})
    span = timedelta(seconds=GRANULARITY * MAX_BUCKETS)

    rows: list[list[float]] = []
    if checkpoint and os.path.exists(checkpoint):
        done = pd.read_csv(checkpoint)
        if not done.empty:
            rows = done[COLUMNS].values.tolist()
            resume = datetime.fromtimestamp(int(done["time"].max()), tz=timezone.utc)
            if resume > start:
                print(f"  resuming from checkpoint at {_iso(resume)} "
                      f"({len(rows):,} bars)", flush=True)
                start = resume

    cursor = start
    n = 0
    total = int((end - start) / span) + 1
    while cursor < end:
        stop = min(cursor + span, end)
        rows.extend(fetch_window(session, product, cursor, stop))
        n += 1
        if n % progress_every == 0:
            print(f"  {n}/{total} windows  ({_iso(cursor)})", flush=True)
            if checkpoint:
                pd.DataFrame(rows, columns=COLUMNS).drop_duplicates(
                    subset="time").to_csv(checkpoint, index=False)
        cursor = stop
        time.sleep(pause)

    if checkpoint:
        pd.DataFrame(rows, columns=COLUMNS).drop_duplicates(
            subset="time").to_csv(checkpoint, index=False)

    df = pd.DataFrame(rows, columns=COLUMNS)
    if df.empty:
        return df
    df = df.drop_duplicates(subset="time").sort_values("time").reset_index(drop=True)
    df["ts"] = pd.to_datetime(df["time"], unit="s", utc=True)
    return df[["ts", "time", "open", "high", "low", "close", "volume"]]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--product", default="BTC-USD")
    p.add_argument("--days", type=int, default=365)
    p.add_argument("--out", default="cache/btc_1m.parquet")
    args = p.parse_args()

    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = end - timedelta(days=args.days)
    print(f"Fetching {args.product} 1m candles {_iso(start)} -> {_iso(end)}", flush=True)

    ckpt = args.out.replace(".parquet", "_checkpoint.csv")
    df = fetch_range(args.product, start, end, checkpoint=ckpt)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    df.to_parquet(args.out, index=False)

    expected = int((end - start).total_seconds() // 60)
    print(f"Saved {len(df):,} rows to {args.out} "
          f"({len(df) / expected:.1%} of {expected:,} expected minutes)")
    print(f"Range: {df['ts'].min()} -> {df['ts'].max()}")


if __name__ == "__main__":
    main()
