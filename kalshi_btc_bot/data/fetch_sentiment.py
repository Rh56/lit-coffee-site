"""Fetch real sentiment / cross-asset context data.

  fng   Crypto Fear & Greed Index (alternative.me), daily, full history.
  eth   ETH-USD 1-minute candles from Coinbase, used for cross-asset lead/lag.

Usage:
    python -m data.fetch_sentiment fng
    python -m data.fetch_sentiment eth --days 366
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

from .fetch_btc import fetch_range

FNG_URL = "https://api.alternative.me/fng/"


def fetch_fng(limit: int = 0) -> pd.DataFrame:
    r = requests.get(FNG_URL, params={"limit": limit, "format": "json"}, timeout=30)
    r.raise_for_status()
    rows = r.json()["data"]
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["timestamp"].astype(int), unit="s", utc=True)
    df["fng"] = df["value"].astype(float)
    df = df[["ts", "fng", "value_classification"]].sort_values("ts").reset_index(drop=True)
    df["fng_chg_1d"] = df["fng"].diff()
    df["fng_chg_7d"] = df["fng"].diff(7)
    df["fng_z_30d"] = ((df["fng"] - df["fng"].rolling(30).mean())
                       / df["fng"].rolling(30).std())
    return df


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["fng", "eth"])
    p.add_argument("--days", type=int, default=366)
    p.add_argument("--cache", default="cache")
    args = p.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    if args.mode == "fng":
        df = fetch_fng()
        out = os.path.join(args.cache, "fng.parquet")
        df.to_parquet(out, index=False)
        print(f"Saved {len(df):,} daily Fear & Greed readings -> {out}")
        print(f"Range: {df['ts'].min()} -> {df['ts'].max()}")
        return

    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = end - timedelta(days=args.days)
    print(f"Fetching ETH-USD 1m candles {start} -> {end}", flush=True)
    df = fetch_range("ETH-USD", start, end,
                     checkpoint=os.path.join(args.cache, "eth_1m_checkpoint.csv"))
    out = os.path.join(args.cache, "eth_1m.parquet")
    df.to_parquet(out, index=False)
    print(f"Saved {len(df):,} rows -> {out}")


if __name__ == "__main__":
    main()
