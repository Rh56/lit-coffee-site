# Kalshi 15-Minute BTC Trading Bot (paper only)

A quantitative bot for Kalshi's **KXBTC15M** series — "BTC price up in next 15
mins?" — a new binary contract every 15 minutes, all day, every day.

It forecasts the settlement probability from the BTC price curve, volatility
structure, microstructure flow, cross-asset context and market sentiment, and
trades only when its probability differs from the market price by more than the
spread plus Kalshi's fee. **It places no live orders**: the trader is paper-only
and holds no credentials.

---

## The contract

From Kalshi's published rules for the series:

> If the simple average of the sixty seconds of CF Benchmarks' BRTI before
> `<close>` is at least the simple average of the sixty seconds of BRTI before
> `<open>`, then the market resolves to Yes.

So each window is an at-the-money 15-minute binary on BTC. Windows are aligned
to :00/:15/:30/:45 UTC and chain end-to-end — the settlement value of one window
is the strike of the next. Fees are Kalshi's quadratic schedule,
`ceil(0.07 × C × P × (1−P))` cents, charged on entry only.

Because the strike is set at-the-money, the contract is close to a coin flip at
open (measured YES rate over the real data: **49.6%**), and virtually all of the
information arrives during the window as price drifts away from the strike.

---

## Data — what is real and what is modelled

| Dataset | Source | Coverage | Real? |
|---|---|---|---|
| BTC 1-minute OHLCV | Coinbase Exchange API | 12 months | real |
| ETH 1-minute OHLCV | Coinbase Exchange API | 12 months | real |
| Crypto Fear & Greed index | alternative.me | daily, full history | real |
| Kalshi settled markets (strike, settlement, outcome) | Kalshi public API | since series launch | real |
| Kalshi per-minute yes bid/ask | Kalshi candlesticks API | since series launch | real |
| Kalshi quotes *before* series launch | calibrated market model | remainder of the year | **modelled** |

**An important limitation, stated up front:** the KXBTC15M series did not exist
a year ago — Kalshi's settled-market history for it begins in **June 2026**. A
year of *real Kalshi quotes* is therefore not obtainable from any source. The
backtest handles this by splitting into two:

* **Backtest A — real quotes.** Over the period the series has existed, the bot
  trades against genuine per-minute `yes_bid`/`yes_ask` from Kalshi. Nothing is
  simulated. This is the honest read on whether the edge survives a real spread.

* **Backtest B — full year.** Contracts are reconstructed for 12 months from
  real BTC data using the published settlement rule, and quotes are simulated by
  a market model whose implied-vol scale, logit bias and spread curve are
  **fitted to the real Kalshi quotes from A**. This measures robustness across
  regimes the short real window never saw, under the stated assumption that
  market-making then would have resembled market-making now.

The reconstruction is validated against Kalshi's real settlements — see
`contract.validate_reconstruction`, whose agreement rate is printed by the
backtest and stored in `results/report.json`.

---

## Method

**Contract-relative view.** The quantity that prices this contract is
standardised moneyness

```
z = ln(P / K) / (σ · √τ)
```

where `P` is spot, `K` the strike, `τ` the minutes remaining, and `σ` a blended
per-minute volatility estimate (EWMA + realized + Parkinson range).

**Three model layers** (`model.py`), kept separable so edge can be attributed:

1. **Analytic** — a scaled Student-t diffusion in `z`, with the vol scale and
   tail parameter fitted to realised moves. Empirically the vol scale lands near
   **0.79**: naively scaling 1-minute vol by `√15` overestimates the true
   15-minute move, because microstructure noise inflates 1-minute variance.
2. **Learned** — LightGBM over ~50 features (trend at 7 horizons, five vol
   estimators, mean-reversion, flow imbalance, jumps, path position within the
   window, time-of-day, ETH lead/lag, Fear & Greed), trained on the analytic
   logit **as an offset** so it only has to model the residual.
3. **Calibration** — isotonic regression fitted out-of-sample. For this strategy
   calibration matters more than accuracy: P&L depends on whether `p` is *right*,
   not on whether it beats 50%.

**Walk-forward evaluation.** Expanding-window retraining in 15-day blocks, with
a 20-day calibration holdout and a purge gap before each test block, so no
window ever informs a prediction about a window overlapping it.

**Lookahead discipline.** A Coinbase bar stamped `T` covers `[T, T+1min)`. At
decision time `T` the most recent *completed* bar is the one stamped `T−1min`.
Features are read from `T−1min` and the trade is priced at `T`, where market
quotes are joined. This one-bar offset is the difference between a plausible
backtest and a fictional one.

**Execution assumptions.** Every fill is a taker fill crossing the real spread —
buy YES at the ask, buy NO at `1 − bid`. Kalshi's quadratic fee is charged on
entry. Positions are held to settlement. Sizing is fractional Kelly capped at a
share of bankroll. Resting-order (maker) fills are *not* assumed anywhere.

---

## Results

Generated numbers live in `results/` — `report.json`, per-trade CSVs, monthly
and hourly breakdowns, the reliability table, and a parameter sweep. See
`RESULTS.md` for the written summary of the run.

---

## Layout

```
contract.py            window construction, settlement rule, Kalshi fee formula
features.py            causal feature panel + per-decision frame
model.py               analytic / learned / ensemble models, walk-forward driver
pricing.py             market model calibrated on real quotes, edge after fees
backtest.py            event-driven engine, sizing, metrics, breakdowns
run_backtest.py        full pipeline: data -> features -> models -> P&L
train.py               fit and persist the production model
paper_trader.py        live paper trading loop (no credentials, no orders)
data/fetch_btc.py      Coinbase 1m OHLCV (resumable)
data/fetch_kalshi.py   Kalshi settled markets + per-minute candlesticks
data/fetch_sentiment.py Fear & Greed index, ETH candles
```

## Usage

```bash
pip install numpy pandas scipy scikit-learn lightgbm pyarrow requests

# 1. data (each is resumable; the BTC/ETH pulls take ~15 min each)
python -m data.fetch_btc --days 366 --out cache/btc_1m.parquet
python -m data.fetch_sentiment eth --days 366
python -m data.fetch_sentiment fng
python -m data.fetch_kalshi markets --days 75
python -m data.fetch_kalshi candles --days 70

# 2. backtest (walk-forward, both regimes, parameter sweep)
python run_backtest.py --cache cache --out results

# 3. train the production model, then paper trade
python train.py --cache cache --out models/live_model.pkl
python paper_trader.py --model models/live_model.pkl --bankroll 10000
```

`paper_trader.py --dry-run` scores live markets and logs decisions without
booking simulated fills.

---

## Caveats

* No live trading path exists in this codebase, by design.
* Backtest B's quotes are modelled, not observed; treat A as the primary result.
* Reconstructed settlements use Coinbase BTC-USD rather than CF Benchmarks BRTI.
  The agreement rate against real Kalshi outcomes is measured and reported
  rather than assumed.
* Fills assume the touch is available at the size traded. The paper trader walks
  real order-book depth; the backtest does not model queue position.
* Past performance over one year of a single regime is weak evidence about the
  future, particularly for a strategy whose edge is a few cents per contract.
