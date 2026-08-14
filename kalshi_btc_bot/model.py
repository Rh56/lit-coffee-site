"""Probability models for "will BTC settle >= strike in T minutes?".

Three layers, deliberately kept separable so the backtest can attribute edge:

  AnalyticModel   A closed-form baseline. Drift-free diffusion with a Student-t
                  innovation and a variance term structure fitted to realised
                  15-minute moves.  This is "predicting the curve" in the
                  textbook sense and is already a decent price.

  LearnedModel    Gradient-boosted trees over the full feature set (trend,
                  microstructure, cross-asset, sentiment, path).  Its job is to
                  learn the *residual* structure the diffusion misses.  It is
                  trained on the analytic logit as an offset so it only has to
                  model the correction, which is far easier with a modest
                  sample and much less prone to overfitting.

  Ensemble        Logit-space blend of the two, then a probability calibrator
                  fitted out-of-sample.  Calibration matters more than accuracy
                  here: the P&L is driven by whether p is *right*, not whether
                  it beats 50%.

Training is strictly walk-forward with a purge gap, so no window ever informs a
prediction about a window that overlaps it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

try:
    import lightgbm as lgb
    HAVE_LGB = True
except ImportError:  # pragma: no cover
    HAVE_LGB = False

EPS = 1e-6


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def expit(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -35, 35)))


# --------------------------------------------------------------------------
# Analytic diffusion model
# --------------------------------------------------------------------------

@dataclass
class AnalyticModel:
    """P(S_T >= K) under a scaled Student-t diffusion.

    Two fitted quantities:
        vol_scale  multiplicative correction on the blended sigma estimate,
                   absorbing the gap between a 1-minute vol estimate and the
                   actual 15-minute-horizon vol (vol clustering makes the naive
                   sqrt-time scaling biased).
        nu         Student-t degrees of freedom; fat tails pull probabilities
                   toward 0.5 for large |z| relative to a normal.
    """

    vol_scale: float = 1.0
    nu: float = 5.0
    fitted: bool = False

    def fit(self, dec: pd.DataFrame) -> "AnalyticModel":
        d = dec.dropna(subset=["z_moneyness", "settle", "strike", "price",
                               "sigma_blend", "sqrt_tau"])
        if d.empty:
            return self
        # Standardised realised move from decision point to settlement.
        realised = np.log(d["settle"] / d["price"]) / (d["sigma_blend"] * d["sqrt_tau"])
        realised = realised.replace([np.inf, -np.inf], np.nan).dropna()
        if len(realised) < 500:
            return self
        # Robust scale (MAD-based) is stable against the fat tails we then model.
        mad = np.median(np.abs(realised - np.median(realised)))
        self.vol_scale = float(max(mad * 1.4826, 1e-3))
        try:
            nu, _, _ = stats.t.fit(realised / self.vol_scale, floc=0.0, fscale=1.0)
            self.nu = float(np.clip(nu, 2.5, 30.0))
        except Exception:
            self.nu = 5.0
        self.fitted = True
        return self

    def predict_proba(self, dec: pd.DataFrame) -> np.ndarray:
        z = dec["z_moneyness"].to_numpy(dtype=float)
        # P(price moves down by more than the current distance) is the NO region.
        # YES <=> settle >= strike <=> move >= -log_dist  =>  p = P(t > -z/scale)
        scaled = z / self.vol_scale
        p = stats.t.cdf(scaled, df=self.nu)
        return np.clip(np.nan_to_num(p, nan=0.5), EPS, 1 - EPS)


# --------------------------------------------------------------------------
# Learned residual model
# --------------------------------------------------------------------------

@dataclass
class LearnedModel:
    features: list[str] = field(default_factory=list)
    params: dict = field(default_factory=dict)
    n_estimators: int = 400
    booster: object | None = None
    fallback: object | None = None

    DEFAULT_PARAMS = {
        "objective": "binary",
        "learning_rate": 0.02,
        "num_leaves": 15,
        "max_depth": 5,
        "min_data_in_leaf": 400,
        "feature_fraction": 0.6,
        "bagging_fraction": 0.7,
        "bagging_freq": 1,
        "lambda_l1": 0.5,
        "lambda_l2": 5.0,
        "verbosity": -1,
        "seed": 7,
    }

    def fit(self, train: pd.DataFrame, base_logit: np.ndarray) -> "LearnedModel":
        X = train[self.features].astype(float)
        y = train["target"].astype(int).to_numpy()
        if not HAVE_LGB or len(train) < 2000:
            self.fallback = LogisticRegression(max_iter=1000, C=0.1)
            Xf = X.fillna(0.0).to_numpy()
            self.fallback.fit(Xf, y)
            return self

        params = dict(self.DEFAULT_PARAMS)
        params.update(self.params)
        dset = lgb.Dataset(X, label=y, init_score=base_logit, free_raw_data=False)
        self.booster = lgb.train(params, dset, num_boost_round=self.n_estimators)
        return self

    def predict_logit(self, df: pd.DataFrame, base_logit: np.ndarray) -> np.ndarray:
        X = df[self.features].astype(float)
        if self.booster is not None:
            return base_logit + self.booster.predict(X, raw_score=True)
        if self.fallback is not None:
            return self.fallback.decision_function(X.fillna(0.0).to_numpy())
        return base_logit


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

@dataclass
class Calibrator:
    method: str = "isotonic"
    model: object | None = None

    def fit(self, p: np.ndarray, y: np.ndarray) -> "Calibrator":
        p = np.clip(p, EPS, 1 - EPS)
        if self.method == "isotonic":
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0.01, y_max=0.99)
            iso.fit(p, y)
            self.model = iso
        else:
            lr = LogisticRegression(max_iter=1000)
            lr.fit(logit(p).reshape(-1, 1), y)
            self.model = lr
        return self

    def transform(self, p: np.ndarray) -> np.ndarray:
        p = np.clip(p, EPS, 1 - EPS)
        if self.model is None:
            return p
        if self.method == "isotonic":
            return np.clip(self.model.predict(p), 0.01, 0.99)
        return np.clip(self.model.predict_proba(logit(p).reshape(-1, 1))[:, 1], 0.01, 0.99)


# --------------------------------------------------------------------------
# Ensemble + walk-forward driver
# --------------------------------------------------------------------------

@dataclass
class Ensemble:
    features: list[str]
    blend_weight: float = 0.65      # weight on the learned logit
    calibrate: bool = True
    analytic: AnalyticModel = field(default_factory=AnalyticModel)
    learned: LearnedModel | None = None
    calibrator: Calibrator | None = None

    def fit(self, train: pd.DataFrame, calib: pd.DataFrame | None = None) -> "Ensemble":
        self.analytic = AnalyticModel().fit(train)
        base = logit(self.analytic.predict_proba(train))
        self.learned = LearnedModel(features=self.features).fit(train, base)

        if self.calibrate and calib is not None and len(calib) > 500:
            raw = self._raw_proba(calib)
            self.calibrator = Calibrator("isotonic").fit(raw, calib["target"].to_numpy())
        return self

    def _raw_proba(self, df: pd.DataFrame) -> np.ndarray:
        base = logit(self.analytic.predict_proba(df))
        learned = self.learned.predict_logit(df, base) if self.learned is not None else base
        blended = self.blend_weight * learned + (1 - self.blend_weight) * base
        return expit(blended)

    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        p = self._raw_proba(df)
        if self.calibrator is not None:
            p = self.calibrator.transform(p)
        return p


def walk_forward_predict(dec: pd.DataFrame, features: list[str],
                         train_days: int = 120, calib_days: int = 20,
                         step_days: int = 15, purge_minutes: int = 30,
                         min_train_rows: int = 20000,
                         verbose: bool = True) -> pd.DataFrame:
    """Out-of-sample probabilities via expanding walk-forward retraining.

    For each test block, the model sees only data ending `purge_minutes` before
    the block starts.  The last `calib_days` of that history are held out from
    the booster fit and used solely to fit the probability calibrator.
    """
    dec = dec.sort_values("ts").reset_index(drop=True)
    dec["ts"] = pd.to_datetime(dec["ts"], utc=True)

    start = dec["ts"].min()
    first_test = start + pd.Timedelta(days=train_days + calib_days)
    end = dec["ts"].max()
    if first_test >= end:
        raise ValueError("not enough history for the requested train/calib span")

    out = []
    block_start = first_test
    while block_start < end:
        block_end = block_start + pd.Timedelta(days=step_days)
        hist = dec[dec["ts"] <= block_start - pd.Timedelta(minutes=purge_minutes)]
        test = dec[(dec["ts"] > block_start) & (dec["ts"] <= block_end)]
        if test.empty:
            block_start = block_end
            continue

        calib_cut = block_start - pd.Timedelta(days=calib_days)
        train = hist[hist["ts"] <= calib_cut].dropna(subset=["target", "z_moneyness"])
        calib = hist[hist["ts"] > calib_cut].dropna(subset=["target", "z_moneyness"])

        if len(train) < min_train_rows:
            block_start = block_end
            continue

        ens = Ensemble(features=features).fit(train, calib)
        block = test.copy()
        block["p_model"] = ens.predict_proba(block)
        block["p_analytic"] = ens.analytic.predict_proba(block)
        out.append(block)

        if verbose:
            print(f"  block {block_start:%Y-%m-%d} -> {block_end:%Y-%m-%d}: "
                  f"train={len(train):,} calib={len(calib):,} test={len(block):,}",
                  flush=True)
        block_start = block_end

    if not out:
        raise ValueError("walk-forward produced no test blocks")
    return pd.concat(out, ignore_index=True)


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------

def score_probabilities(p: np.ndarray, y: np.ndarray) -> dict:
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    y = np.asarray(y, dtype=float)
    brier = float(np.mean((p - y) ** 2))
    ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    base = float(np.mean(y))
    brier_base = float(np.mean((base - y) ** 2))
    acc = float(np.mean((p > 0.5) == (y > 0.5)))
    # Calibration error over deciles of predicted probability
    df = pd.DataFrame({"p": p, "y": y})
    df["bucket"] = pd.qcut(df["p"], 10, duplicates="drop")
    grp = df.groupby("bucket", observed=True).agg(pred=("p", "mean"), act=("y", "mean"),
                                                  n=("y", "size"))
    ece = float((grp["pred"] - grp["act"]).abs().mul(grp["n"]).sum() / grp["n"].sum())
    return {
        "n": int(len(p)), "brier": brier, "brier_skill": 1 - brier / brier_base,
        "log_loss": ll, "accuracy": acc, "base_rate": base, "ece": ece,
    }


def reliability_table(p: np.ndarray, y: np.ndarray, bins: int = 10) -> pd.DataFrame:
    df = pd.DataFrame({"p": np.asarray(p, dtype=float), "y": np.asarray(y, dtype=float)})
    df["bucket"] = pd.qcut(df["p"], bins, duplicates="drop")
    return (df.groupby("bucket", observed=True)
            .agg(n=("y", "size"), predicted=("p", "mean"), actual=("y", "mean"))
            .reset_index())
