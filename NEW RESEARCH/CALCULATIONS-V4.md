# How every number is calculated — V4

> **Replaces `CALCULATIONS.md` entirely.** This is the only calculation document.
> It states current conclusions with no change-markers and no superseded sections.
>
> The patch chain that produced it (`V3.1-ADDENDUM` … `V3.5-FATIGUE-STRUCK`,
> `SPEC-REVISIONS`, `V3.4-FATIGUE-RECHECK`) is provenance and belongs in
> `planning/`. **Do not hand those to an implementing agent** — three of their
> claims were later retracted and the chain contains contradictions that only
> resolve if read in order.
>
> Every constant lives in the `TUNING` block at the top of `app/core.js`.
> Nothing else hardcodes them.

**Companions:** [MEASUREMENT-SPEC-V4.md](MEASUREMENT-SPEC-V4.md) — what may be claimed and
why. [CHART-SCALING.md](CHART-SCALING.md) — rendering; unchanged, see §12.
[EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf) — citations.

Every empirical figure below was measured against this user's corpus: **21,772 runs,
449 sessions, 2,118 scenarios, 2024-11-10 to 2026-09-02.** Figures carry their `n`.

---

## 1. Parsing

### 1.1 The separator is `:,`

```
Score:,10524.0
       ^^ colon AND comma
```

A regex matching one separator character (`[:,]`) captures the colon then fails on the
comma. This silently broke every field except `Score` in an earlier build.

```js
const kv = k => {
  const m = text.match(new RegExp(
    '^' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ':\\s*,\\s*([^\\r\\n]*)', 'm'));
  return m ? m[1].trim() : null;
};
```

Line endings are mixed — `\r\n` between blocks, bare `\n` inside the summary block. Match
`[^\r\n]*`, never a naive `.*$`.

Fields vary by scenario type: clicking scenarios populate `Kills`/`Avg TTK`, tracking
scenarios leave them zero and log no kill rows. Treat all as optional. Required: `Score`,
filename timestamp, `Sens Scale` + `Horiz Sens`, `Avg FPS`.

### 1.2 cm/360

```
Sens Scale:,cm/360
Horiz Sens:,40.0
```

When `Sens Scale` is `cm/360`, **`Horiz Sens` is the cm value directly** — no yaw
constant, no DPI arithmetic.

```js
o.cm = (o.scale && /cm\s*\/\s*360/i.test(o.scale) && o.sens > 0) ? o.sens : null;
```

`FOVScale` is a separate, unrelated field. If `Sens Scale` names a game instead, return
`null` and exclude rather than guessing a yaw constant.

**Coverage: 91.70%, earliest 2024-11-10** — the first day of the corpus. The field was
never missing from older exports.

### 1.3 Run duration

Not stored; recoverable as `filename_timestamp − Challenge Start`. The filename timestamp
is the file write time, i.e. when the run ended.

```js
function runDuration(date, challStart){
  if(!date || !challStart || !/^\d\d:\d\d:\d\d/.test(challStart)) return null;
  const b = challStart.split(':').map(parseFloat);
  const end = date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds();
  let d = end - (b[0]*3600 + b[1]*60 + b[2]);
  if(d < -43200) d += 86400;
  if(d >  43200) d -= 86400;
  return d;
}
```

Validated: **median 59.4s** across completed runs, matching 60s scenario lengths.

### 1.4 Filenames

Real files use dots and spaces; upload and download paths often sanitise to underscores.
Accept both:

```js
const TS = /(\d{4})[._\-](\d{2})[._\-](\d{2})[-_ ](\d{2})[._:](\d{2})[._:](\d{2})/;
// scenario split on  [\s_]*-[\s_]*(Challenge|Ultimate|Scenario)[\s_]*-[\s_]*
```

The in-file `Scenario:` field is more reliable when populated, but is empty on degenerate
resets — keep the filename as fallback.

---

## 2. Exclusions

### 2.1 Resets — use `Avg FPS`, not elapsed time

There is no explicit reset flag. KovaaK's finalises `Avg FPS` only on completion; abandon a
run and it writes `0.0`, or omits the line entirely on a very early reset.

```js
o.avgFps  = kv('Avg FPS') === null || kv('Avg FPS') === '' ? null : parseFloat(kv('Avg FPS'));
o.isReset = o.avgFps === null || !isFinite(o.avgFps) || o.avgFps <= 0;
```

**Validated 10/10 on labelled files** — 6 resets caught, 4 completed runs passed.

**Do not use zero-elapsed-seconds.** That heuristic flags tracking scenarios for
legitimately logging no kill rows and over-fires by roughly 30x.

Measured rate: **38 / 21,810 runs (0.17%)**. Resets are a real but negligible
contaminant here. Exclude them — it is free and correct — but do not prioritise the work.

A secondary signature exists (empty `Scenario:`, empty `Hash:`,
`Challenge Start: 00:00:00.000`) but catches only 5.3% of resets. Store as
`o.degenerate` for cross-checking; gate exclusion on `Avg FPS` alone.

### 2.2 Warm-up — indexed on elapsed time

Measured on this corpus:

```
warmup_z          3.39      distinguishable: YES
magnitude         3.95%
first 2 min       91.0% of block mean
tau_minutes       0.67      tau_runs 1.92 (worse fit)
```

The minute-indexed curve plateaus cleanly after the first bucket. The run-indexed curve
does not saturate — it climbs past 105% by run 10 and peaks at run 23, which is a
composition artifact: high positions draw only from long blocks. Independent
corroboration: cold-start runs sit at **92.62%**, matching the first minute bucket.

```
WARMUP_MODE     = 'elapsed'
WARMUP_SECONDS  = 120        // fitted per install, recalibrated monthly
// exclude runs starting < WARMUP_SECONDS after session start
```

**Gate the correction on evidence.** Dropping runs costs sample size; correcting an effect
that isn't there is strictly negative.

```
warmup_z = (plateau - first_bucket) / sqrt(se_first^2 + se_plateau^2)
if |warmup_z| < 1.96:  WARMUP_SECONDS = 0, flag "no measurable warm-up"
```

Display the fitted profile — `tau`, peak position, magnitude. "You're warm after about two
minutes; the first two minutes cost you ~9%" is directly useful and falls out for free.

### 2.3 Re-familiarisation

Returning to a scenario after a long gap produces low scores reflecting unfamiliarity.
Same evidence gate as §2.2.

**Do not use a fixed drop count.** Measured `lambda = 66.69 runs` (§8), so a 5-run drop
addresses roughly 7% of the effect. Subtract the fitted familiarisation term instead of
discarding 67 runs.

### 2.4 RNG

Not corrected and needs no correction. Spawn positions and bot speeds are unbiased, already
in the within-period variance, and are why the sample sizes in §7 are as large as they are.

---

## 3. The unit of analysis is the session

Runs inside a session share warm-up state, fatigue, mood, hardware and time of day. They
are not independent. Kish's design effect:

```
DEFF  = 1 + (m - 1) * ICC
n_eff = n_raw / DEFF
```

Measured: **ICC 0.5811** pooled (n=38 scenarios, p25/p75 0.441/0.643), median session 33
runs, **DEFF 19.6**, intervals **4.43x too narrow**. Stratifying by cm gives a lower bound
of ICC ≥ 0.35, DEFF ≥ 12. The conclusion holds at either end.

**Do not estimate ICC and apply DEFF.** Use the summary-measures approach, which absorbs
clustering by construction:

```
1. group runs into sessions (§3.2)
2. reduce each session to ONE value          -> session_value
3. all downstream statistics use session_values, never runs

SE(period) = sd(session_values) / sqrt(n_sessions)
```

**No standard error, power calculation, or sufficiency gate may use a raw run count.** Run
counts remain visible as volume information; they must never imply precision.

### 3.1 Reducing a session to one value

**Preferred — fitted plateau.**

```
score(i) = P * (1 - exp(-i / tau))
```

`P` is the session value. It uses every run including warm-up ones and corrects for
position, rather than discarding. Strictly more efficient than trimming.

**There is no fatigue term.** See §3.3.

**Fallback** — trimmed mean of post-warm-up runs, when a session has under `FIT_MIN_RUNS`
(10) runs or the fit fails.

**Never trim when you can fit.** Ranking: fitted `P` > trimmed mean > raw mean (correct
only when §2.2's gate says there is nothing to correct).

A session contributing fewer than `SESSION_MIN_RUNS` (3) runs to a cell is excluded from
that cell. Session values enter unweighted — weighting by run count reintroduces the
clustering bias this section removes.

### 3.2 Session boundaries

Split on `SESSION_GAP_MIN` (60 min). Validated: **0.53% of inter-run gaps fall in the
30–120 min band**, so the boundary sits in a clean trough. 84.6% of gaps are under 2
minutes.

### 3.3 There is no fatigue term

Tested directly with fixed-length blocks and within-block paired comparison, which removes
the composition artifact:

```
L=20  n=91  mid=100.75  last=101.78  delta=+1.04  z= 0.41
L=30  n=43  mid=100.06  last= 99.11  delta=-0.95  z=-0.22
L=45  n=23  mid= 99.02  last=104.85  delta=+5.83  z= 0.99
L=60  n=17  mid= 97.70  last=100.44  delta=+2.74  z= 0.68
```

Every `|z|` under 1.0, signs alternating, three of four positive. **Do not implement `f` or
`i_fatigue`.** An earlier claim of a long-session collapse rested on 9 scenario-blocks and
did not survive re-examination.

### 3.4 Session length and composition

A residual short-session penalty exists but is small:

```
5-10 runs    98.9%  (n=251)
11-20 runs  101.9%  (n=107)
difference    3.0 points, SE ~1.15  ->  marginal
```

Mechanically expected — a short block retains proportionally more warm-up contamination
after a fixed drop. Elapsed-time-indexed exclusion (§2.2) addresses it directly.

Bands above 20 runs are too thin to read (n=35, n=7, n=9) and must not be quoted.

---

## 4. Per-cell metrics

The unit is the **(scenario × cm-cluster) cell**. Metrics are computed over that cell's
`session_values`.

| Displayed as | Computed as | Min sessions | Becomes a %? |
|---|---|---|---|
| PB (record) | `max` of raw runs | 1 | **No** |
| Ceiling | Harrell-Davis p90 of session values | 8 | yes |
| Typical | 10% trimmed mean of session values | 6 | yes |
| Floor | Harrell-Davis p10 of session values | 8 | yes |

### 4.1 PB is not a measurement

`max` is an extreme order statistic whose expected value rises with sample size regardless
of skill. Shown because people want their record; never converted to a percentage.

`pb_surprise` is the correct way to make a PB interpretable:

```
pb_surprise = (observed_pb - expected_max_exact(n, mu, sigma)) / sigma
```

**Use an exact precomputed table, not Blom's approximation.** Blom is documented as highly
inaccurate for the *maximum* in small samples and usable only around n > 100; sessions here
are 15–40 runs. Precompute exact expected normal order statistics by numerical integration
for n = 1..300 and ship the table — a few hundred floats. Royston AS 177 is the reference
algorithm.

### 4.2 Harrell-Davis for the quantiles

```
a   = (n + 1) * p
b   = (n + 1) * (1 - p)
W_i = I_beta(a, b, i/n) - I_beta(a, b, (i-1)/n)
Q   = sum_i  W_i * x_(i)              // x sorted ascending
```

**The reason is n-dependent bias, not PB sensitivity.** Measured on this corpus:

```
                     traditional   Harrell-Davis
bias vs full, n=15      -0.609%        +0.310%
bias vs full, n=25      -0.772%        +0.296%
bias vs full, n=40      -0.336%        +0.186%
n-driven swing           0.273%         0.125%
one added max            0.099%         0.210%
```

The traditional p90 systematically underestimates, and the bias shrinks with n — so a
window with fewer sessions than its baseline shows a spurious positive change from bias
alone. HD is smaller and flatter in n.

**HD is 2.1x worse on the added-max shift.** It weights all order statistics, so a new
maximum pulls it directly. That is an accepted trade: n-bias is systematic, added-max is
occasional.

HD is also markedly more stable between runs (0.123 / 0.125 across repeats, against 0.594 /
0.273 for traditional), which is a second argument for it.

### 4.3 n-matching

Neither estimator is stable to a single run at these sample sizes. When periods differ
materially in session count:

```
if (n_window / n_baseline > N_MATCH_RATIO ||
    n_baseline / n_window > N_MATCH_RATIO) {          // N_MATCH_RATIO = 1.5
  // subsample the larger side to the smaller side's n,
  // average over N_MATCH_REPS (200) draws, widen the SE accordingly
}
```

200 replications, not 25 — at 25 the estimate itself swings by a factor of two between
identical runs.

### 4.4 Standard errors

- **Trimmed mean:** `sd(kept) / sqrt(n_kept)`.
- **Harrell-Davis quantiles:** jackknife. Leave one session out, recompute,
  `SE = sqrt((n-1)/n * sum_i (Q_(-i) - Q_bar)^2)`.

Do not estimate quantile SE from order-statistic spacings. At p=0.90 with n=20 the density
comes from the two or three sparsest points in the sample and has no error
characterisation.

### 4.5 The percentage

```
change% = (window_value - baseline_value) / baseline_value * 100
SE      = sqrt(SE_window^2 + SE_baseline^2) / baseline_value * 100
```

`baseline_value` zero or non-finite produces `—`, never `Infinity`.

---

## 5. Rendering a value inside the noise band

**A value whose 95% interval contains zero must not render as a number.**

```js
if (ci95 >= Math.abs(pct)) {
  render("within noise");        // figure and interval behind an expand affordance
} else {
  render(pct, ci95, direction);  // colour permitted here only
}
```

Grey text is insufficient. A +1.0% ceiling change with an interval near ±6% was correctly
computed, correctly identified as non-significant, correctly greyed — and read as an
uptrend anyway. Greying is a footnote on an assertion already made; removing the number
withdraws the assertion, which is what the statistics support.

This is the highest-value change in V4 relative to effort. Given §7, it is the dominant
render path rather than an edge case.

---

## 6. Aggregating cells

Inverse-variance weighting, the minimum-variance unbiased estimator:

```
weight_i  = 1 / SE_i^2
pooled    = sum(pct_i * weight_i) / sum(weight_i)
SE_pooled = sqrt(1 / sum(weight_i))
```

Sparse and noisy cells shrink automatically; the most-played cell dominates only if it is
also precise. Yields an SE on the headline for free.

Derived:

```
Typical vs Ceiling  = Typical change - Ceiling change     // positive = floor catching up
Vs prev timeframe   = Typical change (this) - Typical change (previous)
```

### 6.1 Matched basket vs all cells

If the set of cells in the window differs from the baseline's, the headline compares
different baskets — the index-number problem.

**Report two headline numbers, always both:**

| Headline | Includes | Meaning |
|---|---|---|
| **Matched** | cells with real data both sides | defensible skill change |
| **All cells** | plus fitted-asymptote fallbacks, flagged | includes new-scenario movement |

Show basket composition and its change. When the two diverge, **the difference is the
familiarisation signal** — surface it rather than hiding it.

---

## 7. How many sessions are needed

### 7.1 The smallest worthwhile change

```
SWC = SWC_MULTIPLIER * CV_within         // SWC_MULTIPLIER = 0.3
```

Reliability theory defines the smallest worthwhile change as 0.2 × between-subject SD or
0.3 × within-subject SD; single-person tracking uses the latter.

Measured: `CV_run 8.88%` (p25/p75 6.8/12.3), `CV_session 6.82%`, **`SWC 2.66%`**.

Reference CV for athletic performance tests is 1–5%. Aim-trainer scores at 7–13% sit at the
moderate-to-poor end. That is a property of the task and caps what any statistics can
extract.

### 7.2 Required sessions

```
n_sessions = POWER_CONST * (CV_session / SWC)^2       // POWER_CONST = 15.7
```

`POWER_CONST` is `2 * (1.96 + 0.84)^2` for 80% power at α .05. Use 21.0 for 90%, 11.3 for
screening.

Measured for this corpus: **103 sessions per side.** At ~20 sessions/month that is five
months per side, ten months per comparison, for one cell.

**Never show the run-level equivalent as a target.** Because SWC scales with CV, the
run-level ratio cancels to ~174 runs per side for every scenario regardless of noise —
correct, identical for all cells, unreachable for most, and therefore incapable of guiding
anything.

### 7.3 When it falls short

Never a blank dash. State the gap in sessions:

> needs ~26 sessions per side at this cell's spread; you have 11

### 7.4 Current reachability

**0 of 70 scenarios currently qualify.** The nearest is 10 sessions against 12 required.

This is **fragmentation, not noise**. With 2,118 scenarios and 90 distinct cm values (top 8
covering 67% of runs), the cell space is larger than the run count can populate. No
estimator fixes it. See §10.1 and §11.

---

## 8. New cells and familiarisation

**Do not use raw early runs as a baseline.** An earlier design used a cell's first 5 runs
ever, which are the most familiarisation-contaminated runs it will ever produce, so every
new scenario posted inflated improvement. It also contradicted the re-familiarisation rule
directly.

Fit the familiarisation curve and use the **fitted asymptote** as the early baseline. If
there is not enough data to fit, show nothing and say the cell is in familiarisation.

```
score(k) = A - B * exp( -(k + E) / lambda )     // k = cumulative runs on this cell

// A       asymptote           -> the skill estimate; comparable across cells
// lambda  familiarisation time constant
// E       pre-practice offset -> transfer in from similar scenarios
```

**Exponential, not power law.** Fitting both to 7,910 learning series from 475 subjects
found the exponential better in every unaveraged dataset; averaging produces the apparent
power law, and this app is n=1. Confirmed on this corpus: **exponential wins 39–6**.

Measured: **`lambda = 66.69 runs`, near-asymptote at ~200 runs.**

`E` is the "I already play similar scenarios" effect as a fitted quantity rather than a
confound.

Fit only at `FAMILIAR_MIN_RUNS` (25) runs or more. Mark a cell **in familiarisation** while
`k < 3 * lambda` (~200 runs) and exclude it from the matched basket until it clears. With
77 of 2,118 scenarios above 60 runs, this excludes nearly everything — that is correct and
must not be softened.

Report `A` as the level, never raw early scores. Report `lambda` and `E` in their own right.

Boundary: exponential is right for short-timescale familiarisation. Over years of complex
skill development it is usually the worst individual fit and power or log wins. Do not use
it for the long-run Skill series.

---

## 9. cm/360 clusters

Clusters are built from the cm values actually used, not fixed bins. A cluster spans at most
`CM_CLUSTER_RATIO` times its own minimum, anchored to that minimum. Boundaries sit at the
midpoint of the gap between clusters; outermost are open-ended.

Anchoring to the minimum matters: comparing only against the previous value lets
43→44→45→46→47 chain-drift one cluster arbitrarily wide.

Measured: pooling sensitivities inflates CV by **1.140x** (n=25 scenarios) — a real but
modest confound. The hard filter is justified, not load-bearing.

**`CM_CLUSTER_RATIO` is a live product decision.** At 1.1, this user's 20–64 cm range splits
into ~13 clusters, which is a primary driver of §7.4. At 1.25 it is ~7, roughly doubling
runs per cell. This trades cm precision for measurability and should be user-visible, not a
silent default.

---

## 10. The three metrics

Ordered by how much they can be trusted.

### 10.1 Benchmark aggregate — primary

The only metric in the app with a tractable sample size, for four reasons:

1. **Fixed basket** — no index-number problem.
2. **Post-familiarisation by design** — played repeatedly, near asymptote.
3. **Noise averages down** — `CV_agg = CV * sqrt((1 + (k-1)*r) / k)`. At k=18, r=0.3,
   CV=8% this is ~4.7%.
4. **Externally anchored effect size** — a rank threshold is defined outside the user's own
   variance, so the SWC cancellation in §7.2 does not occur.

Point 4 is why it is primary rather than merely best. Lead with progress toward the next
rank threshold.

```
1. use the suite's own normalised per-scenario scoring, not raw scores
2. reduce each scenario to session_values per §3.1
3. aggregate across the suite per session
4. apply §3 clustering, §4 estimators, §5 rendering as normal
```

The `CV_agg` formula is theoretical — not yet measured on this corpus, as the validator has
no benchmark identification. The case for making it primary rests on point 4, which does
not depend on it.

### 10.2 Free-scenario aggregate — secondary

The former headline, retained and demoted, with §6.1's matched/all split and §3's session
unit. Must be labelled as weaker.

### 10.3 Attribution — hypothesis generation only

"Did playing X help Y?" is causal inference from observational data. Sessions containing X
are also sessions where the user had time, was rested, was motivated, and played five other
things. Reverse causation is live — people play X more when already improving.

All four conditions required:

- **Lagged, never contemporaneous.** X-volume in period *t* against outcome change in *t+1*,
  controlling total volume.
- **Dose-response, not a single contrast.** Monotonicity across volume buckets is far harder
  to manufacture from confounding.
- **Negative controls, mandatory and visible.** Run the identical test against
  `NEG_CONTROL_N` (10) scenarios with no plausible relationship, and plot the target against
  that null. This is a permutation test; it makes the view self-policing.
- **No significance claims.** 2,118 scenarios × 5 benchmarks is a vast search space. Report
  `n_comparisons` in the UI, rank without thresholding, and require the effect to exceed the
  SWC before listing a candidate at all.

Phrasing must be *"X sits in the 91st percentile of the null distribution"*, never
*"X improved Y by 3%"*. Offer the alternating-block N-of-1 protocol as the path to an actual
answer.

---

## 11. Fragmentation readout

Given §7.4, the app must explain *why* everything says `within noise`:

> Your data covers 2,118 scenarios across 90 sensitivity values. At the current cluster
> ratio that is N cells, of which 0 have enough sessions on both sides to measure a
> change.

Pair it with a **tracked-scenarios list** — 2 or 3 the user commits to at one cm — showing
progress toward measurability rather than a fabricated percentage. This is the only path to
a scenario-level number.

---

## 12. Progress chart and staleness

**Progress over time:** `TREND_BUCKETS` (30) points across the window, each cumulative from
window-start, compared against the same baseline the cards use. The right-hand edge must
equal the card values exactly.

**Staleness:** `STALE_SOFT_DAYS` (7) warns the percentage may be out of date;
`STALE_HARD_DAYS` (14) hardens the wording. The percentage is still computed — it describes
where the user left off, not where they are.

**Recommended to play** remains explicitly heuristic and must not be presented otherwise.
Note that ranking partly by declining trend selects scenarios that look bad, which will on
average look better on remeasurement regardless of what the user does.

**Charts:** [CHART-SCALING.md](CHART-SCALING.md) is unchanged. Two interactions:

- The ±1σ band is computed over `session_values`. Raw runs stay as the faint dot layer —
  they are the noise floor and must remain visible.
- Trend lines require ~20 **sessions**, not 20 runs. This removes trend lines from most
  cards. That is correct.

---

## 13. TUNING

| Key | Value | § |
|---|---|---|
| unit of analysis | session | 3 |
| `SESSION_GAP_MIN` | 60 min (validated) | 3.2 |
| `SESSION_MIN_RUNS` | 3 | 3.1 |
| `FIT_MIN_RUNS` | 10 | 3.1 |
| `WARMUP_MODE` | `'elapsed'` | 2.2 |
| `WARMUP_SECONDS` | 120, fitted per install, gated on z | 2.2 |
| reset detector | `Avg FPS <= 0 \|\| missing` | 2.1 |
| Ceiling / Floor estimator | Harrell-Davis | 4.2 |
| `CEILING_MIN_N` / `FLOOR_MIN_N` | 8 sessions | 4 |
| `TYPICAL_MIN_N` | 6 sessions | 4 |
| quantile SE | HD jackknife | 4.4 |
| `N_MATCH_RATIO` | 1.5 | 4.3 |
| `N_MATCH_REPS` | 200 | 4.3 |
| sub-threshold render | `"within noise"` | 5 |
| `SWC_MULTIPLIER` | 0.3 | 7.1 |
| `TARGET_EFFECT` | `0.3 * CV_within` per cell | 7.1 |
| `POWER_CONST` | 15.7 | 7.2 |
| `MIN_SESSIONS_PER_SIDE` | 5 | 3 |
| early baseline | fitted asymptote | 8 |
| `FAMILIAR_MIN_RUNS` | 25 | 8 |
| `expected_max` | exact lookup table | 4.1 |
| `CM_CLUSTER_RATIO` | 1.1 — user-visible, consider 1.25 | 9 |
| `NEG_CONTROL_N` | 10 | 10.3 |
| `TRIM_FRACTION` | 0.10 | 3.1 |
| `TREND_BUCKETS` | 30 | 12 |
| `STALE_SOFT_DAYS` / `STALE_HARD_DAYS` | 7 / 14 | 12 |
| `OUTLIER_MIN_RUNS` / `OUTLIER_MIN_SHARE` | 5 / 0.2% | 9 |

**Retired:** `WARMUP_DROP`, `REFAM_DROP`, `REFAM_GAP_DAYS`, `FATIGUE_MIN_RUNS`,
`EARLY_BASELINE_N`, `HARD_FLOOR_N`, `CM_LEVEL_MIN_N`, and any run-count-based `MIN_RUNS`
gate.

---

## 14. Build order

1. **Replace the reset detector** (§2.1). The live `zero elapsed seconds` rule over-fires
   ~30x and is visibly wrong in the session panel.
2. **Sub-threshold rendering** (§5). Trivial; prevents the observed failure mode.
3. **Fragmentation readout** (§11). Cheap, and explains everything else.
4. **Session unit** (§3). Touches everything downstream; do it before the estimators.
5. **Time-indexed warm-up** (§2.2), using real durations from §1.3.
6. **Harrell-Davis + n-matching** (§4.2, §4.3).
7. **SWC-derived target** (§7.1). Forces the product decision in §11.
8. **Familiarisation curve** (§8). Replaces the early-baseline fallback and the refam drop.
9. **Benchmark aggregate as headline** (§10.1).
10. **Matched / all-cells split** (§6.1).
11. **Attribution with negative controls** (§10.3).
12. **Exact expected-max table** (§4.1). Only matters once `pb_surprise` ships.

---

## 15. Acceptance criteria

- [ ] No standard error is computed from a raw run count.
- [ ] A value whose CI contains zero renders as words, not a number.
- [ ] The reset detector uses `Avg FPS`; the session panel's restart count matches the file
      count.
- [ ] Adding one new PB does not move a cell's Ceiling by more than its jackknife SE.
- [ ] Session length is uncorrelated with session value after warm-up correction. Test and
      report it.
- [ ] A brand-new scenario shows `—` or `within noise`, never a large positive change.
- [ ] Matched and all-cells headlines are both present and separately labelled.
- [ ] Every attribution result carries its negative-control distribution and
      `n_comparisons`.
- [ ] `n_sessions` appears wherever sufficiency is discussed.
- [ ] No p-value appears anywhere in the UI.
- [ ] **Every displayed figure carries its `n`.**

---

## 16. Standing caveat

None of this makes the data less noisy. At a 7–13% CV, the smallest change worth caring
about needs volumes most players will not reach on most scenarios, and this corpus reaches
it on none. A tool that reports that honestly shows far fewer verdicts than one that does
not, and that is the correct outcome rather than a shortfall.

There is also a genuine tension the app should not paper over: varied sensitivity is good
for *learning*, and this user's 90 distinct cm values reflect that advice followed
thoroughly. It is also precisely what makes scenario-level measurement impossible. The
benchmark aggregate escapes it only because the basket is fixed and the threshold external.
