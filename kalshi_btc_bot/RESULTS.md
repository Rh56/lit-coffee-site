# Results

Everything below comes from `run_backtest.py` and `diagnostics.py` over real
data. Raw outputs are in `results/` (`report.json`, `diagnostics.json`, trade
CSVs, breakdowns).

**Headline, stated plainly: the naive backtest looks spectacular, and it is not
a real expectation.** The bot's apparent profit is a *speed* edge — it picks off
Kalshi quotes that have not yet repriced to spot — and it disappears within about
one minute of latency. The forecasting model is genuinely good; the money is not
genuinely available. Both halves of that sentence are supported below.

---

## 1. The contract reconstruction is faithful

A year of Kalshi 15-minute markets does not exist — the KXBTC15M series begins
**8 June 2026**, about 10 weeks of history. Contracts for the rest of the year
were rebuilt from real Coinbase 1-minute data using Kalshi's published
settlement rule, then scored against the 6,418 real settled markets that overlap:

| metric | value |
|---|---|
| outcome agreement with real Kalshi settlements | **97.20%** |
| median settlement-value error | 1.08 bps |
| median move size when reconstruction *agrees* | 8.75 bps |
| median move size when it *disagrees* | 0.51 bps |
| real YES rate / reconstructed YES rate | 49.64% / 49.55% |

Disagreements are concentrated exactly where they should be — near-ties, where a
half-basis-point difference between Coinbase spot and CF Benchmarks' BRTI flips
the sign. Comparing candidate proxies for the 60-second settlement average,
OHLC4 won (97.2%) over close-only (93.3%).

Across the full year: **35,078 windows, YES rate 49.93%** — an almost perfect
coin flip, as the at-the-money design implies.

## 2. The forecasting model works

Walk-forward, 303,227 out-of-sample decisions (Dec 2025 – Aug 2026), retrained
every 15 days with a purge gap and a separate calibration holdout:

| model | Brier | Brier skill | log loss | accuracy | ECE |
|---|---|---|---|---|---|
| analytic (Student-t diffusion) | 0.14756 | 0.4098 | 0.44328 | 77.57% | 0.0050 |
| **full ensemble** | **0.14750** | **0.4100** | 0.44304 | 77.48% | **0.0035** |

The production model (`train.py`, fitted on 464,138 rows with a 20-day holdout)
scores Brier skill 0.4138 with an ECE of **0.0006** on its holdout.

Calibration is excellent — the reliability table tracks the diagonal across all
ten deciles (e.g. predicted 0.9134 → actual 0.9080; predicted 0.0137 → actual
0.0113).

Two honest observations:

* **The LightGBM layer adds almost nothing.** Brier skill 0.4100 vs 0.4098 for
  the closed-form model alone. Nearly all the predictive power is the diffusion
  in standardised moneyness. The sentiment, cross-asset and microstructure
  features are not earning their keep on this horizon.
* The fitted vol scale is **0.79** — scaling 1-minute volatility by √15
  overestimates true 15-minute movement by ~21%, because microstructure noise
  inflates 1-minute variance. Correcting this is most of the model's advantage.

Against real Kalshi quotes the model is *slightly* sharper than the market
itself, over 81,074 decision rows carrying genuine quotes (8 Jun – 8 Aug 2026):

| | Brier | Brier skill | log loss |
|---|---|---|---|
| Kalshi mid-quote | 0.14531 | 0.4186 | 0.43653 |
| model | **0.14434** | **0.4225** | **0.43486** |

That is a genuine but very thin advantage: 0.0010 of Brier. Mean quoted spread
is 0.79¢ (the series quotes in tenths of a cent near the tails).

## 3. The naive backtest result

Trading against **real per-minute Kalshi bid/ask**, fractional Kelly, taker fills
crossing the real spread, real quadratic fees, held to settlement:

| | Backtest A (real quotes) | Backtest B (full year, modelled quotes) |
|---|---|---|
| trades | 5,070 | 13,059 |
| P&L on $10k | +$44,907 | +$106,529 |
| return | +449% over 61 days | +1,065% over 225 days |
| win rate | 56.9% | 57.7% |
| ROI on turnover | 3.51% | 3.30% |
| Sharpe (daily, ann.) | 6.61 | 5.27 |
| max drawdown | −41.8% | −54.6% |

Baselines over the same rows lose money as they should: always-YES −2.04¢ per
contract, always-NO −1.89¢, random −2.34¢. Every month of the year is positive.

**Do not believe these numbers.** A Sharpe above 6 is a bug report, not a result.
The rest of this document is the investigation.

## 4. What the diagnostics found

Four checks pass cleanly, and one fails in a way that explains everything.

**Candle alignment — passes.** Kalshi candlesticks are end-labelled: the first
candle of a market lands 1 minute after open, the last exactly at close, and
none at the open itself. No quote is ever read from the future.

**Shuffled-probability control — passes.** Permuting model probabilities across
rows yields **−2.27¢ per contract**. The harness does not pay by itself; crossing
the spread with no signal loses money, as it must.

**Cost stress — passes.** The edge is not a knife-edge fee artifact:

| scenario | per contract |
|---|---|
| baseline | +1.84¢ |
| double the fee | +1.14¢ |
| +1¢ wider spread | +1.60¢ |
| +2¢ wider spread | +1.17¢ |
| double fee **and** +1¢ spread | +1.07¢ |

**Quote staleness — fails, informatively.** Forcing the bot to trade on *older*
quotes should hurt. It helps, enormously:

| quote age | per contract | win rate |
|---|---|---|
| 0 min | +1.86¢ | 56.9% |
| 1 min | +9.86¢ | 62.9% |
| 2 min | +12.80¢ | 65.3% |
| 5 min | +19.06¢ | 71.5% |

The staler the quote, the more the bot makes. That is the signature of one thing:
the profit comes from spot having moved while the quote has not. The bot is not
predicting the future, it is reading the present faster than the order book.

**Execution delay — the number that matters.** If the signal forms at T but the
fill lands at T+N against whatever the book shows by then:

| fill delay | trades | P&L | per contract | win rate |
|---|---|---|---|---|
| 0 min | 5,070 | +$44,907 | **+1.86¢** | 56.9% |
| 1 min | 5,761 | +$9,611 | **+0.34¢** | 43.7% |
| 2 min | 4,408 | −$9,999 | **−1.68¢** | 35.0% |
| 3 min | 5,689 | −$9,999 | −1.05¢ | 28.9% |

**One minute of latency removes ~80% of the edge. Two minutes makes it
negative.** Whatever this strategy is, it is a race.

**One thing that is *not* the explanation:** the first minute after a market
opens (τ=14) accounts for 71% of P&L in the τ breakdown, which looked like a
stale-opening-book artifact. But excluding τ=14 entirely still yields **+1.75¢
per contract over 4,983 trades** — with the first minute unavailable the bot
simply enters those windows later and still profits. The edge is broad across
the window, not a single-minute quirk. It is also broad across weeks (every one
of 9 weeks positive) and both sides (YES and NO each profitable).

## 5. What this actually means

The defensible reading:

1. **The model is sound.** Well calibrated (ECE 0.0035), slightly better than
   Kalshi's own mid, and its advantage comes from a correct, explainable insight
   about volatility scaling at short horizons.
2. **The tradable edge is a latency edge**, worth roughly **1.9¢ per contract at
   zero latency**, decaying to ~0.3¢ at one minute and negative beyond two.
3. **The backtest's fill assumption is the weak link, and it flatters the
   result.** It assumes the displayed quote is always available at the size
   traded. In reality a stale quote is precisely the one a market maker cancels
   first — the fills the bot most wants are the ones least likely to be there.
   Queue position and adverse selection are not modelled, and both cut the same
   way.
4. Therefore the honest expectation for a non-colocated participant polling every
   20 seconds — which is what `paper_trader.py` is — is **at or below break-even,
   not +449% in two months.**

The +449% / Sharpe 6.6 headline should be read as "the backtest's execution model
is too generous," not as a forecast. Paper trading against the live book is the
right next step precisely because it is the test the backtest cannot fake: it
will reveal whether those quotes are actually there when you reach for them.

## 6. The "early flip" variant: cheap underdogs, early in the interval

Tested separately in `flip_strategy.py`: enter only below 50¢ — so every
position sits on the side the market expects to lose — concentrated near 20¢ and
early in the window, where a small move in spot flips the outcome and the cheap
side pays 4–5×. Kalshi's fee schedule genuinely favours this: the quadratic fee
is proportional to `p(1−p)`, so a 20¢ contract is charged ~1.1¢ against ~1.8¢ at
the money.

On the naive backtest it is the **best configuration found**, by a wide margin
per contract:

| entry band | timing | trades | per contract | flip rate | Sharpe | max DD |
|---|---|---|---|---|---|---|
| **0.10–0.30** | **tau ≥ 12 (first 3 min)** | 218 | **+8.05¢** | 33.9% | 5.96 | −12.2% |
| 0.15–0.50 | tau ≥ 12 | 1,112 | +3.53¢ | 40.6% | 5.76 | −18.4% |
| 0.15–0.50 | any time | 2,861 | +2.60¢ | 35.8% | **7.38** | −32.0% |
| no price cap | any time | 5,064 | +1.84¢ | 53.6% | 6.59 | −42.1% |

The convexity works exactly as intended — average win **$367** against average
loss **$128** — and the flip rate beats its breakeven in every entry bucket:

| entry price | implied flip needed | actual flip | per contract |
|---|---|---|---|
| 0.15–0.20 | 18.7% | 25.0% | +5.2¢ |
| 0.20–0.25 | 22.9% | 33.3% | +9.2¢ |
| 0.25–0.30 | 27.8% | 37.4% | +8.2¢ |

**But three things argue against believing it.**

*The structural premise does not hold.* Checking **every** cheap quote in the
data rather than only the ones the bot chose — no model, no selection — the
underdog does **not** flip more often than its price implies. It flips slightly
*less*:

| band | timing | n | implied | actual | edge |
|---|---|---|---|---|---|
| 0.15–0.20 | tau ≥ 12 | 721 | 17.6% | 18.2% | +0.5pp |
| 0.20–0.25 | tau ≥ 12 | 1,180 | 22.6% | 23.1% | +0.4pp |
| 0.20–0.25 | any time | 5,962 | 22.5% | 21.0% | −1.5pp |
| 0.10–0.15 | any time | 5,708 | 12.5% | 11.2% | −1.3pp |

So there is no free asymmetry sitting in the 20¢ band waiting to be harvested —
Kalshi prices it correctly, slightly in its own favour. The entire +9.3pp flip
edge in the traded subset comes from *model selection*, which means it inherits
the latency problem rather than escaping it.

*The sample is thin.* 218 trades over two months, and the τ=13 bucket alone (77
trades) supplies $7,061 of the $8,771. That is not a base to size on.

*It fails the latency test harder than the baseline.* Same standard as §4:

| fill delay | per contract | flip rate |
|---|---|---|
| 0 min | **+8.05¢** | 33.9% |
| 1 min | **−1.37¢** | 23.6% |
| 2 min | −3.09¢ | 20.9% |

The baseline strategy decayed to +0.34¢ at one minute; this one goes negative.
Cheap entries are more sensitive to staleness, not less, because a 20¢ quote that
has not caught up to spot is further from fair value in relative terms.

**Practical read.** The instinct is sound and the mechanics are right — cheap
entries keep more of any edge because the fee is smaller, and the convexity is
real. But conditional on the edge being a race, concentrating into the cheap
early band raises the stakes on winning that race rather than sidestepping it. If
you want to paper trade this variant, the larger-sample cell is the defensible
one — `--min-price 0.15 --max-price 0.50` with no timing restriction, 2,861
trades at +2.6¢ and the best Sharpe in the grid — and it is wired into the paper
trader:

```bash
python paper_trader.py --model models/live_model.pkl \
    --min-price 0.15 --max-price 0.50          # the robust cell
python paper_trader.py --model models/live_model.pkl \
    --min-price 0.10 --max-price 0.30 --min-tau 12   # the aggressive cell
```

## 7. Where to go next, in order of expected value

1. **Measure real fill rates in paper trading.** Log every intended fill and
   whether the quote survived to the next poll. That single statistic converts
   this from a maybe into a yes or a no.
2. **Become the maker instead of the taker.** The taker side of this trade is a
   race against faster participants. Resting orders that collect the spread flip
   the economics, and the calibrated model is well suited to quoting.
3. **Drop the learned layer or give it a real job.** It contributes ~0.0002 of
   Brier skill for a large complexity cost. Either cut it, or retarget it at
   something the diffusion cannot express.
4. **Model queue position and cancellation** before believing any taker P&L.
