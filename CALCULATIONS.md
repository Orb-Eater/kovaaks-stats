# How every % is calculated

Every knob mentioned here lives in one place: the `TUNING` block at the top of
`app/core.js`. Change a value there and it applies everywhere — nothing else
hardcodes these numbers.

**Companion documents:**

- [MEASUREMENT-SPEC.md](MEASUREMENT-SPEC.md) — *what we are allowed to claim, and
  why.* The measurement design, its evidence base, and a gap list of where this
  build falls short of it. This file describes what is built; that one describes
  what is correct.
- [CHART-SCALING.md](CHART-SCALING.md) — *why the charts are that size and that
  scale.* Axis rules, aspect ratio, the ±1σ noise band.

---

## 1. The two periods

Everything is "this period vs an earlier period". Two ways to pick the earlier
one (the **Compare vs** control):

**Previous window** (default, recommended)

```
window   = [ now - N days , now ]
baseline = [ now - 2N days , now - N days ]
```

Two separate, non-overlapping stretches of time. `now` is the timestamp of your
most recent run, not the wall clock, so an idle week doesn't empty the window.

**First half of window**

```
window   = [ midpoint , now ]
baseline = [ start , midpoint ]
```

Reacts faster but is noisier — both halves come from the same short period.

Runs excluded as warmup or re-familiarisation (§4b) are removed before either
period is built.

## 2. Per-scenario numbers

| Displayed as | Computed as | Min n | Turned into a %? |
|---|---|---|---|
| PB (record) | `max` | 1 | **No** |
| Ceiling | 90th percentile | 15 | yes |
| Typical | 10% trimmed mean | 10 | yes |
| Floor | 10th percentile | 20 | yes |

**PB is deliberately not a measurement.** `max` is an extreme order statistic:
its expected value rises with the number of runs even when nothing about your
skill changed. 40 runs this window against 15 last window produces a positive
"PB increase" from sample size alone. It's shown because people want to see
their record, and never converted to a percentage.

**Floor needs n ≥ 20.** At n = 5, "bottom 10%" is literally the single worst
run — the same one-observation sensitivity as `max`, mirrored.

**Trimmed mean** drops the top and bottom `TRIM_FRACTION` (10% each end). Below
n = 10 that removes nothing, so it is simply not applied there.

Then each measured metric becomes a percentage **with a standard error**:

```
change% = (window_value - baseline_value) / baseline_value * 100
SE      = sqrt(SE_window^2 + SE_baseline^2) / baseline_value * 100
shown as: change% ± 1.96 * SE
```

SE for the trimmed mean is `sd(kept)/sqrt(n_kept)`. SE for a quantile is
`sqrt(p(1-p)/n) / f(x_p)`, with the density `f` estimated from the spacing of
neighbouring order statistics — cheap, and adequate at these sample sizes.

**If the interval crosses zero the number is shown in grey, not green/red**,
because it is not distinguishable from "no change".

Guarded: if `baseline_value` is 0 or non-finite the result is `—`, not
`Infinity`.

## 3. The headline cards — inverse-variance weighted

The unit of analysis is the **(scenario x cm-cluster) cell**, not the scenario.
This controls for cm/360 by construction: if the mix of sensitivities you played
shifted between the two periods, that shift can no longer masquerade as a skill
change in the headline.

Cells are combined by **inverse-variance weighting**:

```
weight_i = 1 / SE_i^2
pooled   = sum(pct_i * weight_i) / sum(weight_i)
SE_pooled = sqrt(1 / sum(weight_i))
```

This is the minimum-variance unbiased estimator of the common effect. Sparse and
noisy cells shrink automatically rather than being excluded, and the most-played
scenario dominates only if it is also *precise* — which is what run-weighting
was really reaching for. It also yields an SE on the headline for free, so the
cards carry intervals like everything else.

(This replaces the earlier equal-weight mean, which let an 8-run scenario count
as much as an 800-run one.)

Derived:

```
Typical vs Ceiling  = Typical change - Ceiling change
Vs prev timeframe   = Typical change (this window) - Typical change (previous)
```

Positive `Typical vs Ceiling` = your floor is catching up to your peak.

## 4. How many runs are actually needed

A single global minimum is wrong, because required n scales with the **square**
of that scenario's own spread. A smooth tracking scenario and a spawn-heavy
click scenario can differ 4x in CV, which is 16x in required runs.

```
n_per_side = POWER_CONST * (CV / TARGET_EFFECT)^2
           = 15.7 * (CV / 5)^2          (80% power, alpha 0.05, detect 5%)
```

| CV | runs/side to detect 5% |
|---|---|
| 4%  | 10 (floor) |
| 6.8% | 29 |
| 9.8% | 61 |
| 13%  | 107 |

Computed per scenario from its full history, with a hard floor of
`HARD_FLOOR_N` (10) because CV itself is badly estimated below that. When a
scenario falls short it still shows its numbers, but says exactly what is
missing: *"needs ~61 runs per side at this scenario's spread (9.8%); you have
47"*. That sentence tells you what to play next; a blank dash doesn't.

Other gates: the `Min runs` UI control, the cm/360 filter, and outlier cm
exclusion (`OUTLIER_MIN_RUNS` 5, `OUTLIER_MIN_SHARE` 0.2%).

## 4b. Confounds that are actively corrected

**Warmup** — the first runs of a session are systematically lower. If session
lengths differ between the two periods, that bias alone reads as a skill change.
Sessions are split on a `SESSION_GAP_MIN` (60 min) gap and the first
`WARMUP_DROP` (2) runs of each are excluded. The app measures the effect on your
own data and tells you how big it is.

**Re-familiarisation** — returning to a scenario after `REFAM_GAP_DAYS` (14)
produces low scores that reflect unfamiliarity, not skill. The next
`REFAM_DROP` (5) runs on that scenario are excluded.

Both are toggleable. RNG (spawn positions, bot speeds) is *not* corrected for
and needs no correction: it is unbiased, already reflected in the within-window
variance, and is the reason the required n in §4 is as large as it is.

## 5. Progress-over-time chart

30 points (`TREND_BUCKETS`) across the window. Each point is **cumulative**:
window-start up to that date, compared against the *same* baseline the cards
use. So the right-hand edge equals the card values exactly — if it ever doesn't,
something is wrong.

## 6. cm/360 tables — two different questions

**avg level / pb level** — how a cm performs relative to your own typical result
*on the same scenario*:

```
level% = mean over scenarios of ( value_at_that_cm / value_overall * 100 )
```
100% = exactly your normal standard at that cm. Answers "is this cm good for me?"

**avg change / pb change** — whether your skill *at that cm* moved:

```
bucket runs by cm first, then within each bucket:
change% = (window_value_at_cm - baseline_value_at_cm) / baseline_value_at_cm * 100
```
Answers "am I improving at this cm?" Needs `CM_LEVEL_MIN_N` runs on both sides,
so sparse cms show `—`. Note the headline cards now stratify by cm cell anyway
(§3), so these tables are a *view* of the same correction, not a separate one.

These are independent: a cm can be below your typical level (negative *level*)
while improving fastest (positive *change*).

## 7. cm ranges

Clusters are built from the cms you actually use, not fixed bins. A cluster spans
at most `CM_CLUSTER_RATIO` (1.1 = 10%) times its own minimum, anchored to that
minimum. Boundaries sit at the midpoint of the gap between clusters, so every
value maps somewhere; the outermost are open-ended (`≤14cm`, `87cm+`).

Anchoring to the minimum matters: comparing only against the previous value lets
43→44→45→46→47 chain-drift one cluster arbitrarily wide, which is what made
"best cm range" collapse into whatever range you play most.

## 8. Recommended to play

Replaces the old "biggest drop" sort. A raw drop on its own is usually noise or
a stale number, so it isn't very actionable. This ranks by what would actually
repay a session:

```
score  = min(30, -avgTrend * 2)   if trending down
       + min(30, days_since_played)  if >= STALE_SOFT_DAYS
       + 15                          if there's no baseline yet
       + 10                          if runs < 2x your Min runs
       + min(15, spread / 2)
```

Highest first. It surfaces scenarios that are going backwards, have gone cold,
or don't yet have enough data to judge — rather than whichever number happens to
look worst today.

## 9. Staleness

If a scenario hasn't been played in `STALE_SOFT_DAYS` (7), the card warns that
its % may be out of date; at `STALE_HARD_DAYS` (14) the wording hardens. The
percentage is still computed — it's just measured against an old baseline, so it
describes where you left off rather than where you are.

---

## Things you may want to change

1. **`TARGET_EFFECT`** (5%) — the change size you want to be able to detect.
   Lowering it to 3% roughly triples the runs required; raising it to 8% cuts
   them to a third. This is the single biggest lever on how many scenarios show
   a trustworthy number.
2. **`POWER_CONST`** (15.7 = 80% power). 21.0 for 90%, 11.3 for screening.
3. **`WARMUP_DROP`** (2) — the app reports your measured warmup effect; if it's
   near zero for you, this is doing nothing and can be turned off.
4. **`TRIM_FRACTION`** (0.10) — set to 0 for a true mean.
5. **`CEILING_Q` / `FLOOR_Q`** (0.90 / 0.10) — what counts as a good and a bad run.
6. **`CM_CLUSTER_RATIO`** (1.1) — how wide a cm range is allowed to be.

## Known limitation: no anchored baseline yet

Everything above is *rolling* — "am I improving right now". It cannot answer
"am I better than I was in March", because the reference moves with you. An
anchored baseline (frozen once, stored with its n, mean, sd, date range and cm
cluster, and checked for compatibility before comparing) is designed but **not
implemented**. It needs persistent per-user storage and a compatibility check,
which is a feature rather than a formula change.
