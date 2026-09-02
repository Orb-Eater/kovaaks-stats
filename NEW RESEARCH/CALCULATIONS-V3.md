# How every % is calculated — V3

> **For the implementing agent.** This supersedes `CALCULATIONS.md` (V2). Sections
> marked **[NEW V3]** did not exist in V2. Sections marked **[CHANGED V3]** replace
> a V2 section that was wrong — the V2 behaviour is described so you can recognise
> and remove it. Everything else carries over unchanged.
>
> Normative language: **must** = required, breaking it produces a wrong number the
> user will believe. **should** = strong default, deviate only with a recorded reason.
> **may** = genuinely optional.
>
> Every knob lives in the `TUNING` block at the top of `app/core.js`. Nothing else
> hardcodes these numbers. If you add a constant, it goes there.

**Companion documents:**

- [MEASUREMENT-SPEC-V3.md](MEASUREMENT-SPEC-V3.md) — what we are allowed to claim,
  the evidence base, and the gap list. That file is the target; this one is the build.
- [CHART-SCALING.md](CHART-SCALING.md) — axis rules, aspect ratio, the ±1σ band.
  Unchanged in V3, but see §12 for two interactions.
- [EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf) — citations for every formula below.
- [SPEC-REVISIONS.pdf](SPEC-REVISIONS.pdf) — why V2 was wrong, with the observed
  failure that exposed it.

---

## 0. The V3 change in one paragraph

V2 treated every run as an independent observation. Runs inside one session are not
independent — they share warm-up state, fatigue, mood and hardware — so every
confidence interval V2 produced was too narrow, and got *more* overconfident the
harder you ground a single sitting. V3 makes the **session** the unit of analysis,
fixes four estimator faults found when the V2 formulas were checked against primary
sources, and splits the output into three metrics with different evidential weight
instead of one headline that mixed them.

---

## 1. The unit of analysis **[CHANGED V3]**

> **V2 behaviour being replaced:** runs were pooled directly into window and baseline
> periods and treated as independent. `SE = sd(runs)/sqrt(n_runs)`.

Runs cluster inside sessions. Kish's design effect quantifies the cost:

```
DEFF  = 1 + (m - 1) * ICC          m = mean runs per session in the period
n_eff = n_raw / DEFF
```

At ICC 0.2, the same 41 runs are worth:

| Spread as | DEFF | Effective n |
|---|---|---|
| 1 session x 41 | 9.0 | 4.6 |
| 4 sessions x 10 | 2.8 | 14.6 |
| 10 sessions x 4 | 1.6 | 25.3 |
| 20 sessions x 2 | 1.2 | 34.2 |

**The app must not estimate ICC and apply DEFF.** That is the fragile route. Use the
**summary-measures approach** instead, which absorbs clustering by construction and
needs no ICC estimate:

```
1. group runs into sessions (§4)
2. reduce each session to ONE value  -> session_value  (§3)
3. all downstream statistics operate on session_values, never on runs
```

So:

```
SE(period) = sd(session_values) / sqrt(n_sessions)
```

**Report `n_sessions` everywhere `n_runs` was reported in V2.** The run count stays
visible as volume information, but it must never appear in a standard error, a power
calculation, or a sufficiency gate.

### Session vs day

Session is the correct cluster: it is what shares warm-up state. Day is a coarser
nested level (shares sleep and mood, not warm-up). Use session. Fall back to day
only if session detection proves unstable on the user's own inter-run interval
distribution — which the app should check once and report (§4).

### Consequence for scheduling, surfaced to the user

For a fixed run budget, more sessions with fewer runs each yields more effective
observations. **5 runs x 35 sessions beats 35 runs x 5 sessions** at identical
volume. This coincides with what contextual interference already recommends for
learning (MEASUREMENT-SPEC-V3 §5), so the app may state it as guidance — one of the
few places where the measurement need and the training need agree.

---

## 2. The two periods

Unchanged from V2 except that periods now contain sessions, not runs.

**Previous window** (default, recommended)

```
window   = [ now - N days , now ]
baseline = [ now - 2N days , now - N days ]
```

`now` is the timestamp of the most recent run, not wall clock, so an idle week does
not empty the window.

**First half of window**

```
window   = [ midpoint , now ]
baseline = [ start , midpoint ]
```

Reacts faster, noisier — both halves come from the same short period.

A session is assigned to whichever period contains its **start** timestamp. A session
must never be split across the boundary.

Falls back to first-half-vs-second-half per scenario if the previous window has fewer
than `MIN_SESSIONS_PER_SIDE` sessions, and the card says so. If neither works, `—`.

---

## 3. Reducing a session to one value **[NEW V3]**

Each session contributes exactly one number per (scenario × cm-cluster) cell.

**Preferred — fitted plateau.** Fit the within-session curve from
MEASUREMENT-SPEC-V3 §4.4:

```
score(i) = P * (1 - exp(-i / tau)) - f * max(0, i - i_fatigue)
```

`P` is the session value. It is unbiased by warm-up and by end-of-session fatigue,
both of which contaminate a raw session mean.

**Fallback — trimmed mean of post-warm-up runs.** When the session has fewer than
`FIT_MIN_RUNS` (10) runs, or the fit fails to converge:

```
session_value = trimmed_mean( runs[ceil(tau_user):], TRIM_FRACTION )
```

using the per-install `tau_user` from §5, not a fixed drop. Do not fit the fatigue
term below `FATIGUE_MIN_RUNS` (15).

**Minimum.** A session contributing fewer than `SESSION_MIN_RUNS` (3) runs to a cell
is excluded from that cell. One run is not a session estimate.

**Weighting.** Session values enter unweighted. Weighting by run count would
reintroduce the clustering bias this section exists to remove.

---

## 4. Sessions, warm-up and re-familiarisation **[CHANGED V3]**

### 4a. Session boundaries

Split on a gap of `SESSION_GAP_MIN` (60 min). **On first load, compute the user's
inter-run interval distribution and report where the natural break falls.** It is
bimodal; if the observed trough is far from 60 minutes, say so and offer the observed
value. `SESSION_GAP_MIN` is a convention with no evidence behind it (EVIDENCE-BASE §8)
and should be calibrated, not assumed.

### 4b. Warm-up — fitted, not constant

> **V2 behaviour being replaced:** `WARMUP_DROP: 2`, a fixed count.

A fixed drop creates a **session-length-correlated bias**. If the true warm-up
constant exceeds 2 runs, the surviving contaminated fraction depends on session
length:

| Session length | After dropping 2 | If tau leaves 3 more low | Contaminated share |
|---|---|---|---|
| 15 runs | 13 | 3 | 23% |
| 30 runs | 28 | 3 | 11% |
| 45 runs | 43 | 3 | 7% |

Short sessions are systematically depressed with no change in skill. This was
observed live on 2026-09-02 and is documented in SPEC-REVISIONS.pdf, Finding C.

**Fit `tau` per install** on first launch, cache it, refit monthly. Use
`ceil(tau_user)` as the drop count. The app must display the fitted value and the
effect size it is correcting — if it comes out near zero for a given user, say so.

Interim mitigation if the fit is not ready: exclude sessions below
`SESSION_MIN_RUNS_FOR_COMPARISON` from window comparisons entirely. Either is better
than a fixed 2.

### 4c. Re-familiarisation

Returning to a scenario after `REFAM_GAP_DAYS` (14) produces low scores reflecting
unfamiliarity. Exclude the next `REFAM_DROP` (5) runs on that cell. Both constants are
placeholders awaiting calibration.

### 4d. Run resets

Unchanged. Detected structurally (zero elapsed seconds) and excluded unconditionally.

### 4e. RNG

Not corrected for and needs no correction. Spawn positions and bot speeds are
unbiased, are already in the within-period variance, and are the reason the required
sample sizes in §7 are as large as they are.

---

## 5. Per-cell metrics **[CHANGED V3]**

The unit is the **(scenario × cm-cluster) cell**. Metrics are computed over that
cell's `session_values`.

| Displayed as | Computed as | Min sessions | Becomes a %? |
|---|---|---|---|
| PB (record) | `max` of raw runs | 1 | **No** |
| Ceiling | Harrell-Davis p90 of session values | 8 | yes |
| Typical | 10% trimmed mean of session values | 6 | yes |
| Floor | Harrell-Davis p10 of session values | 8 | yes |

### 5a. Harrell-Davis replaces the traditional quantile

> **V2 behaviour being replaced:** plain p90 / p10 by index interpolation.

A traditional quantile picks two order statistics **by index**. At n=25, p90 sits
between the 22nd and 23rd sorted values; append one new maximum and n=26 moves it to
between the 23rd and 24th. Those values did not change — the index walked up one
order-statistic spacing, and upper-tail spacings are wide.

**Any new PB therefore raises the ceiling regardless of its size.** This is the same
volume artifact V2 correctly removed from `max`, reappearing in attenuated form. It
was observed as a +1.0% ceiling move on a single new PB.

Harrell-Davis weights *all* order statistics via beta weights, so adding an
observation perturbs the estimate smoothly instead of stepping an index. It is also
more efficient than traditional estimators in small samples — the traditional
estimator's standard error is documented as high specifically for light-tailed
distributions, which is this case.

```
a   = (n + 1) * p
b   = (n + 1) * (1 - p)
W_i = I_beta(a, b, i/n) - I_beta(a, b, (i-1)/n)
Q   = sum_i  W_i * x_(i)                      // x sorted ascending
```

Harrell-Davis is not robust to a single corrupted value, since every observation
carries positive weight. Session values are already trimmed means or fitted plateaus,
so the corruption risk is low. If heavy tails appear in practice, switch to the
trimmed Harrell-Davis variant rather than back to the traditional estimator.

### 5b. Standard errors **[CHANGED V3]**

> **V2 behaviour being replaced:** `sqrt(p(1-p)/n) / f(x_p)` with density from
> order-statistic spacings, described as "adequate at these sample sizes". That
> claim was never checked and is not true — at p=0.90 with n=20 the density comes
> from the two or three sparsest points in the sample.

- **Trimmed mean:** `sd(kept) / sqrt(n_kept)`.
- **Harrell-Davis quantiles:** jackknife. Leave one session out, recompute, and
  `SE = sqrt( (n-1)/n * sum_i (Q_(-i) - Q_bar)^2 )`.

Maritz-Jarrett is an acceptable alternative but overestimates error below about 30
observations. That is a conservative failure, so it is allowed, but it must be
labelled where it applies.

### 5c. PB stays out of the percentages

`max` is an extreme order statistic whose expected value rises with sample size
regardless of skill. Shown because people want their record. Never converted to a
percentage. This V2 decision was correct and is retained.

`pb_surprise` (MEASUREMENT-SPEC-V3 §4.1) is the correct way to make a PB
interpretable, and requires the exact expected-max table in §11 — **not Blom**.

### 5d. The percentage itself

```
change% = (window_value - baseline_value) / baseline_value * 100
SE      = sqrt(SE_window^2 + SE_baseline^2) / baseline_value * 100
```

Guarded: `baseline_value` zero or non-finite produces `—`, never `Infinity`.

---

## 6. Displaying a number that is inside the noise **[CHANGED V3]**

> **V2 behaviour being replaced:** grey text when the CI crossed zero.

Grey is too weak. On 2026-09-02 a +1.0% ceiling change with a CI near ±6% was still
read as an uptrend. **The calculation was correct and the presentation failed.**

**A value whose 95% interval contains zero must not render as a number.** It renders
as the words `within noise`. The figure and interval are available on expand or
hover, never in the default view.

```
if (ci95 >= abs(pct)) {
  render("within noise");            // value behind an expand affordance
} else {
  render(pct, ci95, direction);      // green / red permitted here only
}
```

This is the highest-value change in V3 relative to effort. Nothing else matters if a
noise-level number still reads as progress.

---

## 7. How many sessions are needed **[CHANGED V3]**

### 7a. The smallest change worth detecting

> **V2 behaviour being replaced:** `TARGET_EFFECT: 5%`, asserted with no basis.

Sports-science measurement theory defines the smallest worthwhile change as
`0.2 × between-subject SD` or `0.3 × within-subject SD`. Single-person tracking uses
the within-subject form:

```
SWC = SWC_MULTIPLIER * CV_within        // SWC_MULTIPLIER = 0.3
```

Compute `CV_within` per cell from that cell's run-level history after warm-up
exclusion. Note that scenario CVs in the 7–13% range sit at the moderate-to-poor end
of the reliability scale — reference CV for athletic performance tests is 1–5%. Aim
trainer scores are noisier than most laboratory tests. That is a property of the
task, not a defect to engineer around.

### 7b. Required sessions

```
n_sessions = POWER_CONST * (CV_session / SWC)^2      // POWER_CONST = 15.7
```

where `CV_session` is the coefficient of variation of that cell's `session_values`.
`POWER_CONST` is `2 * (1.96 + 0.84)^2` for 80% power at alpha .05. Use 21.0 for 90%,
11.3 for screening-grade 70%.

**The run-level equivalent is a trap and must not be shown as a target.** Because SWC
scales with CV, the run-level ratio cancels and produces ~174 runs per side for every
scenario regardless of its noise. That number is correct and useless: it is
unreachable for most cells and identical for all of them, so it cannot guide anything.
The session-level figure varies by cell and is actionable.

### 7c. What to say when it falls short

Never a blank dash. State the gap in sessions:

> needs ~26 sessions per side at this cell's spread; you have 11

Other gates: the `Min sessions` UI control, the cm/360 filter, and outlier cm
exclusion (`OUTLIER_MIN_RUNS` 5, `OUTLIER_MIN_SHARE` 0.2%).

---

## 8. New cells and the basket problem **[CHANGED V3]**

### 8a. The V2 fallback was inverted

> **V2 behaviour being replaced:** §2b used a cell's **first 5 runs ever** as a
> stand-in baseline.

Those are the most familiarisation-contaminated runs that cell will ever produce. Every
new scenario therefore entered with an artificially low baseline and posted inflated
improvement.

It also contradicted §4c directly: V2 dropped 5 runs after a 14-day gap *because they
are unfamiliar*, then anchored baselines on the 5 runs at peak unfamiliarity. Both
rules cannot be right.

**Replacement.** Do not use raw early runs as a baseline. Fit the familiarisation
curve (§9) and use the **fitted asymptote** as the early baseline estimate. If there
is not enough data to fit, show `—` and say the cell is still in familiarisation.

Retain from V2: early estimates carry `se: null` and an `early` flag, render as
`within noise` with an **early** tag, and only ever stand in for the baseline side.

### 8b. Matched basket vs all cells

If the set of cells present in the window differs from the set in the baseline, the
headline compares different baskets. This is the index-number problem.

**Report two headline numbers, always both:**

| Headline | Includes | Meaning |
|---|---|---|
| **Matched** | cells with real data on both sides | defensible skill change |
| **All cells** | plus fitted-asymptote fallbacks, flagged | includes new-scenario movement |

Show basket composition and its change between periods. When matched and all-cells
diverge, **the difference is the familiarisation signal** — surface it as such rather
than hiding it.

---

## 9. Familiarisation as its own metric **[NEW V3]**

Familiarisation is real learning, but it is scenario-specific, saturates, and does not
transfer. Aim improvement is general and transfers. Merging them penalises a player who
rotates scenarios against one who grinds three, at identical aim.

**Functional form: exponential, not power law.** Fitting power and exponential
functions to 7,910 learning series from 475 subjects across 24 experiments, the
exponential fit better in *every* unaveraged dataset; averaging across individuals
produced the bias toward power. This app is n=1, so the power law would be importing
exactly that artifact. The APEX variant, exponential plus a pre-existing-practice
parameter, fit better still.

```
score(k) = A - B * exp( -(k + E) / lambda )        // k = cumulative runs on this cell

// A       asymptote          -> the skill estimate; comparable across cells
// lambda  familiarisation time constant
// E       pre-practice offset -> transfer in from similar scenarios
// B       total familiarisation gain available
```

`E` is the "I already play similar scenarios" effect, as a fitted quantity rather than
a confound.

**Report `A` as the level. Never use raw early scores as a level.** Report `lambda` and
`E` in their own right — they answer "how long until this scenario is worth measuring"
and "how much did my existing skill carry in".

Boundary worth knowing: exponential is right for short-timescale familiarisation. Over
years of complex skill development, exponential is usually the *worst* individual fit
and power or log wins. That maps onto the Form / Skill split — use exponential inside a
scenario, do not use it for the long-run skill series.

Fit only when the cell has at least `FAMILIAR_MIN_RUNS` (25) runs. Mark a cell
**in familiarisation** while `k < 3 * lambda`, and exclude it from the matched basket
until it clears.

---

## 10. The three metrics **[NEW V3]**

V2 produced one headline that mixed evidential weights. V3 produces three, ordered here
by how much they can be trusted.

### 10a. Benchmark aggregate — the primary metric

Statistically the strongest view in the app, for four reasons:

1. **Fixed basket.** Benchmark suites do not change composition, so §8b does not apply.
2. **Post-familiarisation by design.** These are played repeatedly and sit near asymptote.
3. **Noise averages down.** With `k` scenarios at mean pairwise correlation `r`:
   `CV_agg = CV * sqrt((1 + (k-1)*r) / k)`. At k=18, r=0.3, CV=8% this is ~4.7%,
   roughly 40% quieter than any single cell.
4. **Externally anchored effect size.** A rank threshold is defined outside the user's
   own variance, so the SWC cancellation in §7b does not occur. **This is the only
   metric in the app with a tractable sample size**, and it is why it is primary.

Implementation:

```
1. use the suite's own normalised per-scenario scoring, not raw scores
2. reduce each scenario to session_values as in §3
3. aggregate across the suite's scenarios per session
4. apply §1 clustering, §5 estimators, §6 rendering as normal
5. report progress toward the next rank threshold in addition to %
```

The rank-threshold readout is the headline number the app should lead with.

### 10b. Free-scenario aggregate — secondary

The V2 headline, retained but demoted, with §8b's matched/all-cells split and §1's
session unit. Useful, weaker than benchmarks, and must be labelled as such.

### 10c. Attribution — hypothesis generation only

"Did playing X help Y?" is causal inference from observational data. MEASUREMENT-SPEC
§6 already prohibits the strong claim. The confounders are severe: sessions containing X
are also sessions where the user had time, was rested, was motivated, and played five
other things. Reverse causation is live — people play X more when already improving.

Build it with the self-diagnostic wired in. All four are required:

- **Lagged, never contemporaneous.** X-volume in period *t* against outcome change in
  *t+1*, controlling total volume.
- **Dose-response, not a single contrast.** Bucket by X-volume and test monotonicity.
  Monotonic patterns are far harder to manufacture from confounding.
- **Negative controls, mandatory and visible.** For every query, run the identical test
  against `NEG_CONTROL_N` (10) scenarios with no plausible relationship to the outcome,
  and plot the target against that null distribution. This is a permutation test and it
  makes the view self-policing.
- **No significance claims.** 40 scenarios × 5 benchmarks is 200 implicit tests. Drop
  p-values entirely; report position in the null distribution instead.

Output phrasing must be of the form:

> X sits in the 91st percentile of the null distribution

never

> X improved Y by 3%

Offer the alternating-block N-of-1 protocol as the path to an actual answer. This view
generates hypotheses; it does not test them.

---

## 11. Expected maximum **[CHANGED V3]**

> **V2 behaviour being replaced:** Blom's approximation with alpha = 0.375.

The transcription was right, the method is wrong for this use. Comparative evaluation
across twelve approaches finds Blom highly inaccurate specifically for the **maximum**
in small samples, usable only around n > 100. Sessions here are 15–40 runs, which is
exactly the failing regime.

**Precompute exact expected normal order statistics by numerical integration for
n = 1..300 and ship the lookup table.** A few hundred floats, computed once. Rescale by
sample mu and sigma at call time. Royston's AS 177 is the reference algorithm and is
validated to n = 2000.

```
pb_surprise = (observed_pb - expected_max_exact(n, mu, sigma)) / sigma
```

---

## 12. Charts

[CHART-SCALING.md](CHART-SCALING.md) is unchanged in V3. Two interactions to honour:

- The **±1σ band** is now computed over `session_values`, not raw runs. Raw runs remain
  as the faint dot layer — they are the noise floor and must stay visible — but the band
  describes session-level spread.
- **Trend lines still require ~20 observations**, which now means 20 *sessions*, not
  20 runs. This will remove trend lines from many cards. That is correct.

---

## 13. Aggregating cells — unchanged from V2

Inverse-variance weighting, which is the minimum-variance unbiased estimator:

```
weight_i  = 1 / SE_i^2
pooled    = sum(pct_i * weight_i) / sum(weight_i)
SE_pooled = sqrt(1 / sum(weight_i))
```

Sparse and noisy cells shrink automatically; the most-played cell dominates only if it
is also precise. Verified correct against the meta-analysis literature.

---

## 14. Retained from V2 without change

cm cluster construction (`CM_CLUSTER_RATIO` 1.1, anchored to cluster minimum, midpoint
boundaries, open-ended outermost); the cm level and change tables; staleness warnings
(`STALE_SOFT_DAYS` 7, `STALE_HARD_DAYS` 14); the progress-over-time chart's cumulative
construction; and Recommended-to-play, which remains explicitly heuristic and must not
be presented as anything else.

---

## 15. TUNING

| Key | V2 | V3 | Section |
|---|---|---|---|
| unit of analysis | run | **session** | §1 |
| `SESSION_MIN_RUNS` | — | 3 | §3 |
| `FIT_MIN_RUNS` | — | 10 | §3 |
| `FATIGUE_MIN_RUNS` | — | 15 | §3 |
| `SESSION_GAP_MIN` | 60 | 60, calibrated on load | §4a |
| `WARMUP_DROP` | 2 fixed | `ceil(tau_user)` fitted | §4b |
| Ceiling / Floor estimator | traditional p90 / p10 | **Harrell-Davis** | §5a |
| `CEILING_MIN_N` | 15 runs | 8 sessions | §5 |
| `FLOOR_MIN_N` | 20 runs | 8 sessions | §5 |
| `TYPICAL_MIN_N` | 10 runs | 6 sessions | §5 |
| quantile SE | density from spacings | **HD jackknife** | §5b |
| sub-threshold render | grey number | **"within noise"** | §6 |
| `TARGET_EFFECT` | 5% global | `0.3 * CV_within` per cell | §7a |
| `SWC_MULTIPLIER` | — | 0.3 | §7a |
| `POWER_CONST` | 15.7 | 15.7 (unchanged) | §7b |
| `MIN_SESSIONS_PER_SIDE` | — | 5 | §2 |
| early baseline | first 5 runs ever | **fitted asymptote** | §8a |
| headline count | 1 | **2 (matched / all)** | §8b |
| `FAMILIAR_MIN_RUNS` | — | 25 | §9 |
| `NEG_CONTROL_N` | — | 10 | §10c |
| `expected_max` | Blom | **exact lookup table** | §11 |
| `TRIM_FRACTION` | 0.10 | 0.10 (unchanged) | §3 |
| `CM_CLUSTER_RATIO` | 1.1 | 1.1 (unchanged) | §14 |

---

## 16. Build order

1. **§6 sub-threshold rendering.** Smallest change, largest effect on being misled.
2. **§4b fitted warm-up.** Actively generating false trends today.
3. **§1 + §3 session unit.** Touches everything downstream; do it before the estimators.
4. **§5a + §5b Harrell-Davis.** One change fixes the estimator and its standard error.
5. **§8a fallback replacement + §9 familiarisation fit.** Same curve serves both.
6. **§7a SWC target.** Cheap, but forces a product decision about how many cells can
   honestly be tracked.
7. **§10a benchmark aggregate.** New primary view.
8. **§8b matched / all split.**
9. **§10c attribution with negative controls.**
10. **§11 exact expected-max table.** Only matters once `pb_surprise` ships.

---

## 17. Acceptance criteria

The build is V3-conformant when all of these hold:

- [ ] No standard error anywhere is computed from a raw run count.
- [ ] A value whose CI contains zero renders as words, not a number.
- [ ] Adding one new PB to a cell does not move that cell's Ceiling by more than its
      jackknife SE.
- [ ] Session length is uncorrelated with session value, after warm-up correction,
      on the user's own data. Test this and report it.
- [ ] A brand-new scenario shows `—` or `within noise`, never a large positive change.
- [ ] Matched and all-cells headlines are both present and separately labelled.
- [ ] Every attribution result is accompanied by its negative-control distribution.
- [ ] `n_sessions` appears wherever sufficiency is discussed.
- [ ] No p-value appears anywhere in the UI.

---

## 18. Standing caveat

None of this makes the data less noisy. The real finding from the V3 review is §7:
at a 7–13% CV, the smallest change worth caring about needs volumes most players will
not reach on most scenarios. A tool that reports this honestly shows far fewer verdicts
than one that does not, and that is the correct outcome rather than a shortfall. The
benchmark aggregate (§10a) is the one place where an externally anchored threshold makes
the problem tractable, which is why it is the primary metric rather than a side view.
