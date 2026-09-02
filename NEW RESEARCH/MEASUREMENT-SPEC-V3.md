# Measurement spec — what we are allowed to claim, and why — V3

> **For the implementing agent.** This supersedes `MEASUREMENT-SPEC.md` (V2).
> Sections marked **[NEW V3]** are additions. **[CHANGED V3]** marks a section whose
> V2 form was wrong or incomplete; the V2 position is stated so you can recognise it.
>
> This file records the *reasoning and the limits*.
> [CALCULATIONS-V3.md](CALCULATIONS-V3.md) records the *formulas as built*.
> Where they disagree, this file is the target and that one is the truth — §12 is
> the todo list.
>
> Sources: `scoring-and-charting-spec.pdf` (Orb Eater, 2026-09-01) for the motor
> learning material; [EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf) for the statistical
> layer, which V2 asserted without citations. Extracted text in
> `planning/source-docs/`.

---

## 1. Purpose

The obvious implementation — average the scores, track the personal best, draw a line
— produces numbers that are misleading in four independent ways:

1. they measure the wrong construct (performance, not learning),
2. they contain a volume artifact (PB grows with run count alone),
3. they are rendered on an arbitrary scale (auto-fit axes),
4. **[NEW V3]** they treat correlated observations as independent, so their stated
   precision is fictional.

> The central design constraint is that the application must be able to say
> **"this is not distinguishable from noise"** and must do so often. A statistics tool
> that always reports a trend is a random number generator with a confident interface.

**V3 adds a second constraint.** Saying it is not enough. On 2026-09-02 the app
correctly computed a +1.0% ceiling change with an interval near ±6% and correctly
rendered it grey — and it was still read as an uptrend. **A correct number, weakly
presented, misleads exactly as much as a wrong one.** See §11.

---

## 2. Performance is not learning

- **Performance** — what is observable during a session. Contaminated by warm-up,
  fatigue, schedule, motivation, volume.
- **Learning** — the relatively permanent change in capability that supports retention
  and transfer.

The two are routinely dissociated: learning can occur with no visible performance
change, performance can improve without producing learning, and some training
manipulations move them in *opposite* directions (Soderstrom & Bjork, 2015). Learning is
measured with a **retention test** — cold performance at a later date.

**Practical consequence:** within-session improvement over 60 runs is largely warm-up,
task familiarity and short-term tuning. It is real, it feels like progress, and it is a
poor predictor of tomorrow. The app must not present it as skill gain.

**Two metric families, never mixed on one axis or in one headline:**

| Family | Definition | Where it belongs |
|---|---|---|
| **Form** | Performance right now | Session panel, "this session" badges, 1–7 day window |
| **Skill** | Retention-based estimate from cold-start runs | "Skill over time", 30+ day comparisons |

---

## 3. Observations are clustered **[NEW V3]**

This is the largest V3 change and it invalidates every V2 confidence interval.

Runs inside one session share warm-up state, fatigue, mood, hardware and time of day.
They are not independent draws. Kish's design effect quantifies the loss:

```
DEFF = 1 + (m - 1) * ICC          m = runs per session
```

Even a small ICC with large clusters produces a substantial design effect. At ICC 0.2,
41 runs in one session carry the information of roughly **4.6** independent
observations. V2 treated them as 41.

The consequence is perverse: **V2 got more overconfident the harder the user ground a
single sitting.** A long focused session, which feels like the most informative thing
you can do, was the least informative per run and the app said the opposite.

**The correction is the summary-measures approach**, not ICC estimation: reduce each
session to one value, then treat sessions as the observations. Clustering is absorbed by
construction. See CALCULATIONS-V3 §1 and §3.

### What this licenses the app to say

For a fixed run budget, more sessions with fewer runs each yields more effective
observations. This coincides with what contextual interference (§6) recommends for
learning. **Two independent lines of reasoning converge on interleaved short blocks**,
which is rare enough to be worth stating to the user as guidance.

### What it forbids

- No standard error may be computed from a raw run count.
- No sufficiency gate may be expressed in runs.
- Volume in runs may still be displayed — it is real information about effort — but it
  must never imply precision.

---

## 4. Confound inventory

| Field | Why it matters | Have it? |
|---|---|---|
| `sensitivity_cm360` | Runs at different sensitivities are not one distribution. Pooling inflates σ and corrupts everything downstream. **Hard filter, not a view option.** | ✅ |
| `run_index_in_session` | Warm-up early, fatigue late. Position predicts score independently of skill. | ✅ |
| `session_id` **[NEW V3]** | **The unit of analysis.** Without it no interval in the app is correct. | ✅ via `buildSessions()` |
| `runs_of_scenario_in_session` | Drives the extreme-value artifact in PB and low-average (§5.1). | ⚠ derivable, not stored |
| `cumulative_runs_of_scenario` **[NEW V3]** | The x-axis of the familiarisation curve (§7). Distinguishes "new scenario" from "improving". | ❌ not computed |
| `gap_since_last_session` | Determines whether the first run qualifies as a retention test. | ✅ |
| `schedule_index` | Blocked vs interleaved changes expected in-session performance *by design* (§6). | ❌ not computed |
| `session_total_runs`, `timestamp` | Session length proxies fatigue; time of day is a nuisance variable. | ✅ |
| `is_reset` | With "log every run" on, an abandoned attempt is written as a real run with a partial score — systematically low, unrelated to skill. Detected structurally (zero elapsed) and excluded unconditionally. | ✅ v0.1.0 |

---

## 5. Metric rework

### 5.1 The extreme-value problem **[CHANGED V3]**

Personal best is the maximum of *n* samples. **The expected maximum increases with *n*
even when the underlying distribution has not moved.** Raw PB comparison across sessions
of different length is not a measurement — it is a count of how much the player played.
Low-average has the mirror defect.

> **V2 position, now known to be insufficient:** "replace the max with the 90th
> percentile, which is far more stable at varying *n*."

More stable, but not stable. A traditional quantile picks order statistics **by index**.
Appending one new maximum increments *n*, which walks the index up roughly one
order-statistic spacing — and upper-tail spacings are wide. **Any new PB raises the
ceiling regardless of its value.** Observed as a +1.0% move on 2026-09-02.

The V2 fix removed the artifact from `max` and left an attenuated version in `p90`.
V3 uses the Harrell-Davis estimator, which weights all order statistics and therefore
perturbs smoothly rather than stepping. See CALCULATIONS-V3 §5a.

`pb_surprise` remains the correct way to make a PB interpretable:

```
pb_surprise = (observed_pb - expected_max(n, mu, sigma)) / sigma
```

> **V2 error:** specified Blom's approximation for `expected_max`. Blom is documented as
> highly inaccurate specifically for the maximum in small samples and usable only around
> n > 100. Sessions here are 15–40 runs. **Use an exact precomputed table** (Royston
> AS 177). See CALCULATIONS-V3 §11.

> Mean and σ are unbiased at any sample size. Max, min and tail averages are not. Prefer
> the former as primary metrics; treat the latter as decorated highlights, not evidence.

### 5.2 Regression to the mean

The session after an exceptional session is worse **on average**. This is arithmetic,
not decline.

- Must not render a post-PB dip as a downtrend.
- Must not generate **any** prompt, warning or commentary triggered by a single session
  falling below the previous one.

The 2026-09-02 sequence — a dip across three short sessions, then a recovery with a new
PB — is a textbook instance. Nothing in it requires a skill explanation. This rule was
correct in V2 and the event demonstrates why it exists.

⚠ The session panel and the "▲ avg up X% this session" badge remain single-session
commentary and still need the audit tracked in §12.

### 5.3 Cold-start score — the primary learning metric

Warm-up decrement is a temporary loss of performance following rest, distinct from
forgetting, modelled as a fast transient superimposed on the slow persistent process of
learning (Adams, 1952; Newell et al., 2013). **The first run of a session, after a
sufficient gap, is a naturally occurring retention test the data already contains.**

```
cold_start_runs = [
  first run of scenario S in session
  WHERE gap_since_last_session >= COLD_GAP_HOURS       // default 12
    AND run is among the first RUNS_BEFORE_WARM        // default 1
]

skill_estimate(S) = rolling_mean(cold_start_runs, window = 8 sessions)
```

Individually noisy — inherent to a single trial — but across sessions the cleanest
signal of durable capability available without a dedicated protocol.

**[NEW V3]** This series is *already* session-level and therefore already correct under
§3. It needs no clustering correction. That is a further argument for it being the
Skill metric.

Note the tension with the "Skip warmup" toggle: that feature discards exactly the runs
this metric is built from. Both are correct — warm-up runs are noise for Form and signal
for Skill. Two series, not one toggle.

### 5.4 Within-session curve **[CHANGED V3]**

```
score(i) = P * (1 - exp(-i / tau)) - f * max(0, i - i_fatigue)
```

Report **P** as the session level rather than the raw session mean, which is biased
downward by warm-up and by fatigue.

> **V2 treated this as optional.** V3 makes it the **primary session reduction**, because
> §3 requires exactly one value per session and P is the least biased candidate.

`tau` *is* "how many early runs to exclude for this person". Fitting it once and caching
replaces the hard-coded `WARMUP_DROP: 2`, which is not a refinement — the fixed constant
creates a **session-length-correlated bias** that generated a false downtrend on
2026-09-02. Short sessions retain a larger contaminated fraction than long ones.

This is independently required: reliability theory is explicit that systematic
between-trial changes reflecting learning, motivation or fatigue must be removed before
within-subject variation can be estimated at all.

Fall back to a trimmed mean of post-warm-up runs below ~10 runs. Do not fit the fatigue
term below ~15.

---

## 6. Practice schedule is a first-class variable

The **contextual interference effect**: randomised order produces *inferior performance
during acquisition* but *better learning* on retention and transfer, compared with
blocked practice (Shea & Morgan, 1979; Magill & Hall, 1990). In a complex bimanual task
the blocked group performed better during acquisition, but the random group outperformed
it at immediate and delayed retention with superior persistence over a week (Pauwels et
al., 2014). It holds for adaptation of established skills too (Tsay et al., 2023).

```
schedule_index(session) = count_scenario_switches(session) / (total_runs - 1)
// ~0 = fully blocked, ~1 = fully interleaved
```

**Therefore:** a shift from long blocks to a few runs across many scenarios will *lower
in-session scores by design* while improving learning. An app that scores on session
averages will report that a better training schedule is making the player worse.

- Compute and store `schedule_index` per session.
- Never compare session performance across materially different schedule indices without
  labelling it.
- Cold-start metrics (§5.3) are robust to schedule and are the correct cross-schedule basis.
- **Do not editorialise a recommendation.** The advantage of random practice grows with
  experience; early in practice it can overload attention and memory demands (Wulf &
  Shea, 2002). The prescription is not universal.

**[NEW V3] One exception to the no-editorialising rule.** §3 establishes independently
that more sessions with fewer runs each yields more effective observations. Where the
measurement argument and the learning argument agree, the app may state the scheduling
implication — flagged as being about *measurement precision*, which is not contested,
rather than about learning, which is.

---

## 7. Familiarisation is learning, but not the learning being measured **[NEW V3]**

Scenario familiarisation is real. It is also scenario-specific, saturates quickly, and
does not transfer. Aim improvement is general, transfers, and saturates slowly. The
boundary between them **is** transfer.

Merging them penalises a player who rotates scenarios against one who grinds three, at
identical aim. Measure them separately.

**Functional form: exponential, not power law.** Power and exponential functions fitted
to 7,910 learning series from 475 subjects across 24 experiments found the exponential
fit better in *every* unaveraged dataset, with averaging across individuals producing the
apparent power law. This app is n=1; using the power law would import precisely that
artifact. The APEX variant — exponential plus a pre-existing-practice parameter — fit
better still.

```
score(k) = A - B * exp( -(k + E) / lambda )     // k = cumulative runs on this cell
```

`A` is the skill estimate and is comparable across cells. `lambda` answers "how long
until this scenario is worth measuring". `E` is the transfer-in from similar scenarios,
as a fitted quantity rather than a confound — which is the honest form of the intuition
that prior experience raises your starting scores.

**Boundary.** Exponential is right for short-timescale familiarisation. Over years of
complex skill development, exponential is usually the *worst* individual fit and power or
log wins. Use exponential inside a scenario; do not use it for the long-run Skill series.
This maps onto the Form / Skill split.

### Consequence for the V2 early-baseline fallback

> **V2 error:** §2b used a cell's **first 5 runs ever** as a stand-in baseline.

Those are the most familiarisation-contaminated runs the cell will ever produce, so every
new scenario entered with an artificially low baseline and posted inflated improvement.

It also contradicted the re-familiarisation rule directly: V2 dropped 5 runs after a
14-day gap *because they are unfamiliar*, then anchored baselines on the 5 runs at peak
unfamiliarity.

Use the fitted asymptote `A` instead. If there is not enough data to fit, show nothing
and say the cell is in familiarisation.

---

## 8. Transfer — do not attribute gains to per-scenario volume

Improvement on a scenario after only a handful of runs at a related one is **near
transfer**, and transfer is consistently greater following random practice than blocked
(Shea & Morgan, 1979). It is a real effect, not an outlier to filter.

Any statement of the form *"you improved at X because you played X a lot"* is confounded
by the entire remaining scenario mix of every session. If the app models this at all, the
unit of analysis is the session's full scenario composition, not the target scenario's run
count.

**[NEW V3] The attribution view is permitted under four conditions**, all required. The
strong causal claim remains prohibited; what is licensed is hypothesis generation.

1. **Lagged, never contemporaneous.** X-volume in period *t* against outcome change in
   *t+1*, controlling total volume.
2. **Dose-response, not a single contrast.** Monotonicity across volume buckets is much
   harder to manufacture from confounding than one comparison.
3. **Negative controls, mandatory and visible.** Run the identical test against ~10
   scenarios with no plausible relationship and plot the target against that null. This is
   a permutation test; it makes the view self-policing rather than relying on the user to
   remember caveats.
4. **No significance claims.** 40 scenarios × 5 benchmarks is 200 implicit tests. Report
   position in the null distribution, never a p-value.

Phrasing must be *"X sits in the 91st percentile of the null distribution"*, never
*"X improved Y by 3%"*. Offer the alternating-block N-of-1 protocol as the path to an
actual answer.

---

## 9. Time windows and what each supports

| Window | Supported | Not supported | Label |
|---|---|---|---|
| 1–7 days | Current form; consistency (σ); session structure (tau, fatigue onset); volume | Any learning claim — too few **sessions**, performance factors dominate | **"Form"** — never "improvement" |
| 1–30 days | Learning slope on the cold-start series with a CI; consistency trend | Attribution to any single scenario or schedule change | **"Trend (estimated)"** |
| 30+ vs baseline | Distribution shift: median change, probability of superiority, σ change | Anything computed from PB vs PB (§5.1) | **"Change vs baseline"** |

**[CHANGED V3]** The "too few sessions" wording is deliberate. Under §3 a 7-day window
containing 200 runs across 4 sessions has 4 observations, not 200.

**Probability of superiority** is the most interpretable long-window statistic — the
chance a random session today beats a random session from baseline:

```
P_superiority = norm_cdf( (mu_now - mu_base) / sqrt(sigma_now^2 + sigma_base^2) )
// 0.50 = no change.  0.65 = a today-session beats a baseline-session ~2 times in 3.
```

Introduced by Wolfe & Hogg (1971), revisited as the common-language effect size by McGraw
& Wong (1992), named probability of superiority by Grissom (1994) — whose motivating
argument is exactly this one, that it is far easier to read than a standardised
difference. **[CHANGED V3]** Computed over session values, not runs.

⚠ The 7-day window still uses the same "increase / improvement" language as the 90-day
window. Per this table that is wrong and must be relabelled.

---

## 10. Statistical gates **[CHANGED V3]**

```
se(period)    = sd(session_values) / sqrt(n_sessions)
se_difference = sqrt(se(a)^2 + se(b)^2)
significant   = |value_b - value_a| > 1.96 * se_difference
```

> **V2 used `sigma / sqrt(n_runs)`.** Wrong denominator, wrong sigma. See §3.

### The smallest change worth detecting

> **V2 set `TARGET_EFFECT: 5%` by assertion.**

Reliability theory defines the smallest worthwhile change as `0.2 × between-subject SD` or
`0.3 × within-subject SD`. Single-person tracking uses the within-subject form, so
`SWC = 0.3 × CV_within`. At the 7–13% CVs this app sees, that is roughly 2–4%, meaning the
V2 target was 1.5–2.5× larger than the smallest change that would matter: the app was
calibrated to notice only changes that were already large.

Reference CV for athletic performance tests is 1–5%. Aim-trainer scores at 7–13% are
noisier than most laboratory tests. That is a property of the task and sets a ceiling on
what any statistics can extract.

**The run-level sample size is a trap.** Because SWC scales with CV, the run-level ratio
cancels to ~174 runs per side for *every* scenario regardless of noise. Correct and
useless — identical for all cells, unreachable for most, and therefore incapable of
guiding anything. Express requirements in sessions, where the figure varies by cell and is
actionable.

### Additional gates

- No trend line through fewer than ~20 **sessions**, or ~6 sessions for a cold-start series.
- **Minimum detectable effect** must be surfacable: *"with your current volume, this view
  can detect a change of roughly X%."*
- **Multiple comparisons:** scanning many cells for "biggest improvement" means some cross
  threshold by chance. Correct for the number tested, or present rankings without
  significance claims. Still not implemented — §12.

---

## 11. Presentation is part of measurement **[NEW V3]**

V2 assumed that computing honestly was sufficient. The 2026-09-02 event disproved it: a
+1.0% ceiling change with an interval near ±6% was correctly computed, correctly
identified as non-significant, correctly rendered grey — and read as an uptrend anyway.

**A value whose interval contains zero must not render as a number.** It renders as the
words `within noise`, with the figure behind an expand affordance. Colour is reserved for
values that clear the gate.

The reasoning is not cosmetic. A number on screen is an assertion that the quantity is
known to that precision. Greying it is a footnote on an assertion already made. Removing
it withdraws the assertion, which is what the statistics actually support.

This section is normative and is the highest-priority item in §12.

---

## 12. Gap list — spec vs codebase

| # | Gap | § | Effort | Status |
|---|---|---|---|---|
| 1 | Auto-fit y-axis | CHART §9.1 | S | ✅ v0.0.8 |
| 2 | No ±1σ band / raw-dot noise floor | CHART §9.2 | S | ✅ v0.0.8 (band now session-level) |
| 3 | PB as smooth line | CHART §9.2 | XS | ✅ v0.0.8 |
| 4 | Chart aspect ratio | CHART §9.1 | XS | ✅ v0.0.8 |
| 5 | Run resets as real scores | §4 | S | ✅ v0.1.0 |
| **6** | **Sub-threshold values render as numbers** | **§11** | **XS** | ⬜ **do first** |
| **7** | **Fixed `WARMUP_DROP` instead of fitted tau** | **§5.4** | **M** | ⬜ **generating false trends now** |
| **8** | **Run treated as unit of analysis** | **§3** | **L** | ⬜ **invalidates all intervals** |
| **9** | **Traditional p90/p10 instead of Harrell-Davis** | **§5.1** | **M** | ⬜ |
| **10** | **Early baseline uses first 5 runs ever** | **§7** | **S** | ⬜ **inflates new scenarios** |
| 11 | No familiarisation curve → cannot separate it from skill | §7 | M | ⬜ |
| 12 | `TARGET_EFFECT` not SWC-derived | §10 | S | ⬜ |
| 13 | No benchmark aggregate view | CALC §10a | M | ⬜ |
| 14 | No matched-basket / all-cells split | CALC §8b | S | ⬜ |
| 15 | Attribution view without negative controls | §8 | M | ⬜ |
| 16 | No cold-start series → no true Skill metric | §5.3 | M | ⬜ |
| 17 | Windows not labelled Form / Trend / Change vs baseline | §9 | S | ⬜ |
| 18 | `schedule_index` not computed | §6 | S | ⬜ |
| 19 | No multiple-comparison correction on "Biggest gain" | §10 | S | ⬜ |
| 20 | `pb_surprise` not computed; Blom would be wrong anyway | §5.1 | S | ⬜ |
| 21 | Probability of superiority not offered | §9 | S | ⬜ |
| 22 | Single-session commentary audit vs regression to the mean | §5.2 | S | ⬜ |
| 23 | Per-scenario cm/360 filter (global only) | §4 | M | ⬜ |
| 24 | `cumulative_runs_of_scenario` not stored | §4 | XS | ⬜ blocks #11 |

Items 6–10 are the V3 core. 6 is trivial and prevents the observed failure mode. 7 and 8
are the two that make current numbers wrong rather than merely imprecise.

---

## 13. Limitations of the evidence base

- **Domain transfer.** None of the motor-learning work studies aim trainers. It comes from
  laboratory tasks, sport skills and rehabilitation. The constructs — warm-up decrement,
  contextual interference, the learning/performance dissociation, the exponential practice
  function — are robust and general, but **effect sizes and time constants for this task
  are unknown and must be estimated from the user's own data rather than assumed.** This
  is the direct justification for per-install calibration of tau, and for reporting the
  measured warm-up effect rather than asserting one.

- **Group effects, single subject.** Every cited result is a group-level average. This app
  operates on n = 1, where between-individual variation is large. Everything it reports is
  an estimate with wide uncertainty **and it should say so rather than presenting
  verdicts.**

- **[NEW V3] The statistical layer is standard; its application here is not.** The
  formulas in CALCULATIONS-V3 are textbook and correctly cited. What is untested is whether
  session-level clustering, exponential familiarisation and SWC-scaled targets behave as
  expected on aim-trainer data specifically. The acceptance criteria in CALCULATIONS-V3 §17
  exist to catch it if they do not.

- **[NEW V3] Unsourced conventions, stated so they are not mistaken for evidence:**
  `SESSION_GAP_MIN` 60 min, `REFAM_GAP_DAYS` 14, `REFAM_DROP` 5, `CM_CLUSTER_RATIO` 1.1,
  and every weight in Recommended-to-play. None are errors. All are placeholders awaiting
  per-install calibration.

---

## 14. References

**Motor learning**

1. Soderstrom, N. C., & Bjork, R. A. (2015). Learning versus performance: An integrative review. *Perspectives on Psychological Science*, 10(2), 176–199.
2. Shea, J. B., & Morgan, R. L. (1979). Contextual interference effects on the acquisition, retention, and transfer of a motor skill. *JEP: Human Learning and Memory*, 5, 179–187.
3. Magill, R. A., & Hall, K. G. (1990). A review of the contextual interference effect in motor skill acquisition. *Human Movement Science*, 9, 241–289.
4. Pauwels, L., Swinnen, S. P., & Beets, I. A. M. (2014). Contextual interference in complex bimanual skill learning leads to better skill persistence. *PLOS ONE*, 9(6), e100906.
5. Tsay, J. S., et al. (2023). Signatures of contextual interference in implicit sensorimotor adaptation. *Proc. R. Soc. B*.
6. Wulf, G., & Shea, C. H. (2002). Principles derived from the study of simple skills do not generalize to complex skill learning. *Psychonomic Bulletin & Review*, 9(2), 185–211.
7. Adams, J. A. (1952). Warm-up decrement in performance on the pursuit-rotor. *American Journal of Psychology*, 65(3), 404–414.
8. Newell, K. M., et al. (2013). Task difficulty and the time scales of warm-up and motor learning. *Journal of Motor Behavior*, 45(3).
9. **[NEW V3]** Heathcote, A., Brown, S., & Mewhort, D. J. K. (2000). The power law repealed: The case for an exponential law of practice. *Psychonomic Bulletin & Review*, 7(2), 185–207.
10. **[NEW V3]** Newell, A., & Rosenbloom, P. S. (1981). Mechanisms of skill acquisition and the law of practice. — the power law this app does *not* use, and why.

**Statistical layer** — full detail in [EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf)

11. Hopkins, W. G. (2000). Measures of reliability in sports medicine and science. *Sports Medicine*, 30(1), 1–15.
12. Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences* (2nd ed.).
13. Kish, L. (1965). *Survey Sampling*. Wiley. — design effect, §3.
14. Harrell, F. E., & Davis, C. E. (1982). A new distribution-free quantile estimator. *Biometrika*, 69, 635–640.
15. Royston, J. P. (1982). Algorithm AS 177: Expected normal order statistics. *Applied Statistics*, 31(2).
16. Hedges, L. V., & Olkin, I. (1985). *Statistical Methods for Meta-Analysis*.
17. McGraw, K. O., & Wong, S. P. (1992). A common language effect size statistic. *Psychological Bulletin*, 111, 361–365.
18. Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate. *JRSS-B*, 57(1), 289–300.

**Rendering**

19. Tufte, E. R. (1983). *The Visual Display of Quantitative Information*.
20. Cleveland, W. S. (1993). *Visualizing Data*.
