"""Train the production model on all cached history and persist it.

    python train.py --cache cache --out models/live_model.pkl

The saved bundle holds the fitted ensemble, the feature list, and provenance
(training range, row count, out-of-sample scores from the most recent holdout)
so the paper trader can report what it is running.
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
from datetime import datetime, timezone

import pandas as pd

import contract
import features as F
import model as M


def build_decisions(cache: str) -> tuple[pd.DataFrame, list[str]]:
    btc = pd.read_parquet(os.path.join(cache, "btc_1m.parquet"))
    eth_path = os.path.join(cache, "eth_1m.parquet")
    fng_path = os.path.join(cache, "fng.parquet")
    eth = pd.read_parquet(eth_path) if os.path.exists(eth_path) else None
    fng = pd.read_parquet(fng_path) if os.path.exists(fng_path) else None

    windows = contract.build_windows(btc, method="ohlc4")
    panel = F.minute_features(btc, eth, fng)
    dec = F.decision_frame(panel, windows)
    dec = dec.dropna(subset=["z_moneyness", "target"]).reset_index(drop=True)
    return dec, F.available_features(dec)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--out", default="models/live_model.pkl")
    ap.add_argument("--holdout-days", type=int, default=20,
                    help="most recent days reserved for calibration + scoring")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    dec, feats = build_decisions(args.cache)
    print(f"decision rows: {len(dec):,}  features: {len(feats)}")

    cut = dec["ts"].max() - pd.Timedelta(days=args.holdout_days)
    train = dec[dec["ts"] <= cut]
    calib = dec[dec["ts"] > cut]
    print(f"train: {len(train):,} rows up to {cut}")
    print(f"calib: {len(calib):,} rows")

    ens = M.Ensemble(features=feats).fit(train, calib)
    scores = M.score_probabilities(ens.predict_proba(calib), calib["target"])
    print("holdout scores:", {k: round(v, 5) for k, v in scores.items()})

    bundle = {
        "ensemble": ens,
        "features": feats,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "train_rows": int(len(train)),
        "train_start": str(train["ts"].min()),
        "train_end": str(train["ts"].max()),
        "holdout_scores": scores,
        "analytic": {"vol_scale": ens.analytic.vol_scale, "nu": ens.analytic.nu},
    }
    with open(args.out, "wb") as fh:
        pickle.dump(bundle, fh)
    meta_path = args.out.replace(".pkl", "_meta.json")
    with open(meta_path, "w") as fh:
        json.dump({k: v for k, v in bundle.items() if k != "ensemble"}, fh,
                  indent=2, default=str)
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
