# Measurement spec — what we are allowed to claim, and why — V4

> **Replaces `MEASUREMENT-SPEC.md` entirely.** Current conclusions only, no change-markers.
>
> This file records the reasoning. [CALCULATIONS-V4.md](CALCULATIONS-V4.md) records the
> formulas. Where they disagree, this file is the target and that one is the truth — §11 is
> the todo list.
>
> Sources: `scoring-and-charting-spec.pdf` (Orb Eater, 2026-09-01) for the motor-learning
> material; [EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf) for the statistical layer. Extracted text
> in `planning/source-docs/`. The patch chain in `planning/` is provenance only.
>
> Empirical figures are from this user's corpus: **21,772 runs, 449 sessions, 2,118
> scenarios, 2024-11-10 to 2026-09-02.**

---

## 1. Purpose

The obvious implementation — average the scores, track the personal best, draw a line —
produces numbers that are misleading in four independent ways:

1. they measure the wrong construct (performance, not learning),
2. they contain a volume artifact (PB grows with run count alone),
3. they are rendered on an arbitrary scale (auto-fit axes),
4. they treat correlated observations as independent, so their stated precision is fiction.

> The central design constraint is that the application must be able to say
> **"this is not distinguishable from noise"** and must do so often. A statistics tool that
> always reports a trend is a random number generator with a confident interface.

**Saying it is not enough.** A +1.0% ceiling change with an interval near ±6% was correctly
computed, correctly flagged as non-significant, correctly greyed — and read as an uptrend
anyway. **A correct number, weakly presented, misleads exactly as much as a wrong one.**
See §10.

---

## 2. Performance is not learning

- **Performance** — observable during a session. Contaminated by warm-up, schedule,
  motivation, volume.
- **Learning** — the relatively permanent change in capability supporting retention and
  transfer.

The two are routinely dissociated: learning can occur with no visible performance change,
performance can improve without producing learning, and some manipulations move them in
*opposite* directions (Soderstrom & Bjork, 2015). Learning is measured with a **retention
test** — cold performance at a later date.

**Practical consequence:** within-session improvement over 60 runs is largely warm-up and
task familiarity. It is real, it feels like progress, and it is a poor predictor of
tomorrow.

**Two metric families, never mixed on one axis or in one headline:**

| Family | Definition | Where it belongs |
|---|---|---|
| **Form** | Performance right now | Session panel, "this session" badges, 1–7 day window |
| **Skill** | Retention-based estimate from cold-start runs | "Skill over time", 30+ day comparisons |

---

## 3. Observations are clustered

Runs inside one session share warm-up state, fatigue, mood, hardware and time of day. Kish's
design effect quantifies the loss: `DEFF = 1 + (m-1) * ICC`.

Measured: **ICC 0.5811** (n=38 scenarios, p25/p75 0.441/0.643) at a median session of 33
runs, giving **DEFF 19.6** — intervals **4.43x too narrow**. Stratifying by cm bounds it
below at ICC ≥ 0.35, DEFF ≥ 12.

The consequence is perverse: treating runs as independent gets *more* overconfident the
harder the user grinds a single sitting. A long focused session, which feels like the most
informative thing you can do, is the least informative per run.

**The correction is the summary-measures approach**, not ICC estimation: reduce each session
to one value, then treat sessions as the observations.

### 3.1 What this licenses the app to say

For a fixed run budget, more sessions with fewer runs each yields more effective
observations. This coincides with what contextual interference (§5) recommends for learning.
Two independent lines of reasoning converging on interleaved short blocks is rare enough to
state as guidance — flagged as being about *measurement precision*, which is not contested,
rather than about learning, which is.

### 3.2 What it forbids

No standard error, sufficiency gate, or power calculation expressed in runs. Volume in runs
may be displayed; it must never imply precision.

---

## 4. Confound inventory

| Field | Why it matters | Have it? |
|---|---|---|
| `sensitivity_cm360` | Runs at different sensitivities are not one distribution. Measured inflation: **1.140x** CV (n=25). Hard filter, not a view option. | ✅ 91.70% coverage, back to 2024-11-10 |
| `session_id` | **The unit of analysis.** Without it no interval is correct. | ✅ `buildSessions()` |
| `elapsed_seconds_in_session` | Warm-up is time-indexed, not run-indexed (§5.4). | ⚠ derivable from §1.3 durations |
| `run_index_in_session` | Secondary; the worse predictor of the two. | ✅ `annotateRuns()` |
| `cumulative_runs_of_scenario` | x-axis of the familiarisation curve (§6). Distinguishes "new scenario" from "improving". | ❌ not computed |
| `gap_since_last_session` | Determines whether the first run qualifies as a retention test. | ✅ |
| `schedule_index` | Blocked vs interleaved changes in-session performance *by design* (§5). | ❌ not computed |
| `run_duration` | Real elapsed time per run; median 59.4s. Enables true elapsed-play-time indexing. | ❌ derivable, not stored |
| `is_reset` | An abandoned attempt is written as a real run with a partial score — systematically low, unrelated to skill. **Detect via `Avg FPS`, not elapsed seconds.** | ⚠ live detector is wrong |

**The live `is_reset` rule is defective.** `zero elapsed seconds` flags tracking scenarios
for legitimately logging no kill rows. It over-fires roughly 30x: the session panel reported
12 restarts in one sitting where 38 exist across the entire corpus. The `Avg FPS` rule
validates 10/10 on labelled files. True rate: **0.17%**.

---

## 5. Metric rework

### 5.1 The extreme-value problem

Personal best is the maximum of *n* samples. **The expected maximum increases with *n* even
when the underlying distribution has not moved.** Raw PB comparison across periods of
different length is not a measurement — it is a count of how much the player played.

Replacing `max` with a percentile helps but does not solve it. A traditional quantile picks
order statistics **by index**; appending a new maximum increments *n* and walks the index up
roughly one order-statistic spacing, and upper-tail spacings are wide. The Harrell-Davis
estimator is used instead — **for its n-dependent bias, which is systematic, not for PB
sensitivity, where it is measurably worse** (see CALCULATIONS-V4 §4.2 for the figures).

`pb_surprise` remains the correct way to make a PB interpretable, and requires an exact
expected-max table. **Blom's approximation is wrong for this use** — documented as highly
inaccurate for the maximum in small samples, usable only around n > 100, against sessions of
15–40 runs.

> Mean and σ are unbiased at any sample size. Max, min and tail averages are not. Prefer the
> former as primary metrics; treat the latter as decorated highlights, not evidence.

### 5.2 Regression to the mean

The session after an exceptional session is worse **on average**. Arithmetic, not decline.

Measured: after a session more than 1 SD above a scenario's mean, the next averages **0.653
SD** above (n=44). Substantial regression, though exceptional sessions do partly persist.

- Must not render a post-PB dip as a downtrend.
- Must not generate **any** prompt, warning or commentary triggered by a single session
  falling below the previous one.

⚠ The session panel and the "▲ avg up X% this session" badge remain single-session
commentary and need the audit tracked in §11.

### 5.3 Cold-start score — the primary learning metric

Warm-up decrement is a temporary loss following rest, distinct from forgetting, modelled as a
fast transient superimposed on the slow persistent process of learning (Adams, 1952; Newell
et al., 2013). **The first run of a session after a sufficient gap is a naturally occurring
retention test the data already contains.**

```
cold_start_runs = first run of scenario S in a session
                  WHERE gap_since_last_session >= COLD_GAP_HOURS (12)
skill_estimate(S) = rolling_mean(cold_start_runs, window = 8 sessions)
```

Measured: cold-start runs sit at **92.62%** of their scenario's mean (n=128). Measurably
depressed, which is what makes them usable as a retention test — and closely matching the
first-two-minutes figure of 91.0% from two independent directions.

This series is already session-level and needs no clustering correction, which is a further
argument for it being the Skill metric.

Note the tension with "Skip warmup": that feature discards exactly the runs this metric is
built from. Both are correct — warm-up runs are noise for Form and signal for Skill. Two
series, not one toggle.

### 5.4 Within-session curve

```
score(i) = P * (1 - exp(-i / tau))
```

Report **P** as the session level rather than the raw mean, which is biased downward by
warm-up. This is the **primary session reduction**, because §3 requires exactly one value per
session and `P` is the least biased candidate — it uses every run and corrects for position
rather than discarding.

`tau` *is* "how many early runs to exclude for this person", which replaces any hard-coded
drop.

**Warm-up is time-indexed, not run-indexed.** The minute curve plateaus cleanly after the
first bucket (91.0% → 100.3% → 101.7%); the run curve does not saturate, climbing past 105%
by run 10 and peaking at run 23. The latter is a composition artifact — high positions draw
only from long blocks. Fitted `tau_minutes 0.67`, magnitude 3.95%, `z = 3.39`.

**There is no fatigue term.** An earlier version of this spec carried
`- f * max(0, i - i_fatigue)` on the strength of a claimed long-session collapse. That claim
rested on 9 scenario-blocks. Tested directly with fixed-length blocks and within-block paired
comparison at L = 20/30/45/60, every `|z|` came in under 1.0 with alternating signs and three
of four positive. Struck.

### 5.5 Familiarisation is learning, but not the learning being measured

Scenario familiarisation is real, scenario-specific, saturates, and does not transfer. Aim
improvement is general, transfers, and saturates slowly. The boundary **is** transfer.
Merging them penalises a player who rotates scenarios against one who grinds three, at
identical aim.

**Exponential, not power law.** Fitting both to 7,910 learning series from 475 subjects found
the exponential better in every unaveraged dataset; averaging produces the apparent power
law, and this app is n=1. Confirmed here: **exponential wins 39–6**.

Measured: `lambda = 66.69 runs`, near-asymptote at ~200. With 77 of 2,118 scenarios above 60
runs, **the overwhelming majority of the library has never reached asymptote** — most
scenario-level movement is familiarisation, not aim.

Boundary: exponential suits short-timescale familiarisation. Over years of complex skill
development it is usually the worst individual fit and power or log wins. Use it inside a
scenario, not for the long-run Skill series.

---

## 6. Practice schedule is a first-class variable

The **contextual interference effect**: randomised order produces *inferior performance
during acquisition* but *better learning* on retention and transfer (Shea & Morgan, 1979;
Magill & Hall, 1990). In a complex bimanual task the blocked group performed better during
acquisition, but the random group outperformed it at immediate and delayed retention with
superior persistence over a week (Pauwels et al., 2014). It holds for adaptation of
established skills too (Tsay et al., 2023).

```
schedule_index(session) = count_scenario_switches(session) / (total_runs - 1)
// ~0 = fully blocked, ~1 = fully interleaved
```

**Therefore:** a shift from long blocks to a few runs across many scenarios will *lower
in-session scores by design* while improving learning. An app scoring on session averages
will report that a better training schedule is making the player worse.

- Compute and store `schedule_index` per session.
- Never compare session performance across materially different schedule indices without
  labelling it.
- Cold-start metrics (§5.3) are robust to schedule and are the correct cross-schedule basis.
- **Do not editorialise a recommendation.** The advantage of random practice grows with
  experience; early on it can overload attention and memory demands (Wulf & Shea, 2002).

One exception, per §3.1: where the measurement argument and the learning argument agree, the
scheduling implication may be stated — framed as being about precision, not learning.

---

## 7. Transfer and attribution

Improvement on a scenario after a handful of runs at a related one is **near transfer**, and
transfer is consistently greater following random practice than blocked (Shea & Morgan,
1979). A real effect, not an outlier to filter.

Any statement of the form *"you improved at X because you played X a lot"* is confounded by
the entire remaining scenario mix of every session. The unit of analysis is the session's
full scenario composition, not the target scenario's run count.

**The attribution view is permitted under four conditions**, all required — lagged not
contemporaneous, dose-response not single-contrast, mandatory visible negative controls, and
no significance claims. Detail in CALCULATIONS-V4 §10.3. What is licensed is hypothesis
generation; the causal claim remains prohibited.

---

## 8. Time windows and what each supports

| Window | Supported | Not supported | Label |
|---|---|---|---|
| 1–7 days | Current form; consistency (σ); session structure; volume | Any learning claim — too few **sessions** | **"Form"** — never "improvement" |
| 1–30 days | Learning slope on the cold-start series with a CI; consistency trend | Attribution to any single scenario or schedule change | **"Trend (estimated)"** |
| 30+ vs baseline | Distribution shift: median change, probability of superiority, σ change | Anything computed from PB vs PB (§5.1) | **"Change vs baseline"** |

"Too few **sessions**" is deliberate. Under §3, a 7-day window holding 200 runs across 4
sessions has 4 observations, not 200.

**Probability of superiority** is the most interpretable long-window statistic — the chance a
random session today beats a random session from baseline:

```
P_superiority = norm_cdf( (mu_now - mu_base) / sqrt(sigma_now^2 + sigma_base^2) )
// 0.50 = no change.  0.65 = a today-session beats a baseline-session ~2 times in 3.
```

Introduced by Wolfe & Hogg (1971), revisited as the common-language effect size by McGraw &
Wong (1992), named probability of superiority by Grissom (1994) — whose motivating argument
is exactly this one. Computed over session values, not runs.

⚠ The 7-day window still uses the same "increase / improvement" language as the 90-day
window. Per this table that is wrong and must be relabelled.

---

## 9. Statistical gates

```
se(period)    = sd(session_values) / sqrt(n_sessions)
se_difference = sqrt(se(a)^2 + se(b)^2)
significant   = |value_b - value_a| > 1.96 * se_difference
```

**The smallest change worth detecting is derived, not chosen.** Reliability theory defines
the smallest worthwhile change as 0.3 × within-subject SD for single-person tracking:
`SWC = 0.3 × CV_within`.

Measured: `CV_run 8.88%`, `CV_session 6.82%`, **`SWC 2.66%`**, **103 sessions per side**. At
~20 sessions/month that is ten months per comparison for one cell.

Reference CV for athletic performance tests is 1–5%. Aim-trainer scores at 7–13% are noisier
than most laboratory tests — a property of the task, not a defect to engineer around.

**The run-level figure is a trap.** Because SWC scales with CV, the run-level ratio cancels
to ~174 runs per side for every scenario regardless of noise. Correct and useless. Express
requirements in sessions.

Additional gates:

- No trend line through fewer than ~20 **sessions**, or ~6 sessions for a cold-start series.
- **Minimum detectable effect** must be surfacable.
- **Multiple comparisons:** scanning many cells for "biggest improvement" means some cross
  threshold by chance. Correct for the number tested, or present rankings without
  significance claims. Still not implemented — §11.

---

## 10. Presentation is part of measurement

Computing honestly is not sufficient. **A value whose interval contains zero must not render
as a number.** It renders as the words `within noise`, with the figure behind an expand
affordance. Colour is reserved for values that clear the gate.

The reasoning is not cosmetic. A number on screen asserts that the quantity is known to that
precision. Greying it is a footnote on an assertion already made; removing it withdraws the
assertion, which is what the statistics support.

Given §12.1, this is the dominant render path, not an edge case.

---

## 11. Gap list

| # | Gap | § | Effort | Status |
|---|---|---|---|---|
| 1 | Auto-fit y-axis | CHART §9.1 | S | ✅ v0.0.8 |
| 2 | ±1σ band / raw-dot noise floor | CHART §9.2 | S | ✅ v0.0.8 (band must move to session values) |
| 3 | PB as smooth line | CHART §9.2 | XS | ✅ v0.0.8 |
| 4 | Chart aspect ratio | CHART §9.1 | XS | ✅ v0.0.8 |
| **5** | **`is_reset` uses zero-elapsed; over-fires ~30x** | **§4** | **XS** | ⬜ **do first** |
| **6** | **Sub-threshold values render as numbers** | **§10** | **XS** | ⬜ |
| **7** | **Run treated as unit of analysis** | **§3** | **L** | ⬜ **invalidates all intervals** |
| **8** | **Fixed warm-up drop, and run-indexed** | **§5.4** | **M** | ⬜ |
| **9** | **Traditional p90/p10 instead of Harrell-Davis** | **§5.1** | **M** | ⬜ |
| **10** | **Early baseline uses first 5 runs ever** | **§5.5** | **S** | ⬜ **inflates new scenarios** |
| 11 | No fragmentation readout | §12.1 | S | ⬜ |
| 12 | No familiarisation curve | §5.5 | M | ⬜ |
| 13 | `TARGET_EFFECT` not SWC-derived | §9 | S | ⬜ |
| 14 | No benchmark aggregate view | CALC §10.1 | M | ⬜ |
| 15 | No matched-basket / all-cells split | CALC §6.1 | S | ⬜ |
| 16 | Attribution view without negative controls | §7 | M | ⬜ |
| 17 | No cold-start series → no true Skill metric | §5.3 | M | ⬜ |
| 18 | Windows not labelled Form / Trend / Change vs baseline | §8 | S | ⬜ |
| 19 | `schedule_index` not computed | §6 | S | ⬜ |
| 20 | No multiple-comparison correction on "Biggest gain" | §9 | S | ⬜ |
| 21 | `pb_surprise` not computed; Blom would be wrong anyway | §5.1 | S | ⬜ |
| 22 | Probability of superiority not offered | §8 | S | ⬜ |
| 23 | Single-session commentary audit | §5.2 | S | ⬜ |
| 24 | Per-scenario cm/360 filter (global only) | §4 | M | ⬜ |
| 25 | `cumulative_runs_of_scenario` not stored | §4 | XS | ⬜ blocks #12 |
| 26 | `run_duration` not stored | §4 | XS | ⬜ blocks #8 |

Items 5–10 are the core. 5 is trivial and visibly wrong today. 7 and 8 make current numbers
*wrong* rather than merely imprecise.

---

## 12. What the corpus settled

### 12.1 Reachability

**0 of 70 scenarios currently qualify** for their own SWC. This is **fragmentation, not
noise**: 2,118 scenarios across 90 distinct cm values, top 8 covering 67% of runs, ~10 runs
per scenario before cm stratification. At `CM_CLUSTER_RATIO 1.1` the 20–64 cm range alone
spans ~13 clusters.

No estimator fixes this. The cell space is larger than the run count can populate.

Three consequences: the benchmark aggregate becomes the only viable primary metric; the app
must explain *why* everything says `within noise`; and `CM_CLUSTER_RATIO` becomes a live
user-visible trade rather than a silent default.

### 12.2 Confirmed

| Claim | Result |
|---|---|
| Session clustering is real | ICC 0.5811 pooled, ≥0.35 stratified; DEFF 12–20 |
| Warm-up exists and is time-indexed | z = 3.39, `tau` 0.67 min, first 2 min at 91.0% |
| Cold starts are depressed | 92.62% of scenario mean (n=128) |
| Familiarisation is exponential | 39–6 over power law; lambda 67 runs |
| 60-min session boundary is safe | 0.53% of gaps in the 30–120 min band |
| cm pooling inflates variance | 1.140x (n=25) — real but modest |
| Regression to the mean is real | next-session z = 0.653 (n=44) |
| Harrell-Davis reduces n-bias | swing 0.273% → 0.125%; also far more stable across runs |

### 12.3 Refuted, and why it matters

| Earlier claim | Outcome |
|---|---|
| Long-session fatigue collapse | **Struck.** Rested on 9 blocks; direct test gave all `\|z\|` < 1.0 |
| 10-point short-session penalty | **~3 points.** The 109.1 end was n=7 |
| Resets are ~26% of runs | **0.17%.** The 26% came from a broken elapsed-time proxy |
| HD fixes PB sensitivity | **False** — 2.1x worse. It fixes n-bias, which is the real defect |
| Ceiling bias explains the observed +1.0% | **Withdrawn.** Accounted effects total 0.37–0.69% against a ±6% interval |

All five shared one cause: **a number quoted without its sample size.** The band table
printed means with no `n` for three consecutive validation runs; adding one column retired
two claims immediately.

**This applies to the specs, not only to the app.** §10 requires user-facing values to carry
their uncertainty. The same standard applies here: **any figure this document or
CALCULATIONS-V4 cites carries its `n`.**

---

## 13. Limitations of the evidence base

- **Domain transfer.** None of the motor-learning work studies aim trainers. It comes from
  laboratory tasks, sport skills and rehabilitation. The constructs — warm-up decrement,
  contextual interference, the learning/performance dissociation, the exponential practice
  function — are robust and general, but **effect sizes and time constants for this task must
  be estimated from the user's own data rather than assumed.** This is the direct
  justification for per-install calibration.

- **Group effects, single subject.** Every cited result is a group-level average. This app
  operates on n = 1, where between-individual variation is large. Everything it reports is an
  estimate with wide uncertainty **and it should say so rather than presenting verdicts.**

- **The statistical layer is standard; its application here is not.** The formulas are
  textbook and correctly cited. What was untested was whether session-level clustering,
  exponential familiarisation and SWC-scaled targets behave as expected on aim-trainer data.
  §12.2 answers most of that. The benchmark `CV_agg` claim (CALCULATIONS-V4 §10.1) remains
  unmeasured.

- **Unsourced conventions, stated so they are not mistaken for evidence:** `COLD_GAP_HOURS`
  12, `CM_CLUSTER_RATIO` 1.1, `NEG_CONTROL_N` 10, and every weight in Recommended-to-play.
  Not errors — placeholders awaiting calibration. `SESSION_GAP_MIN` 60 min started as one and
  has since been validated (§12.2).

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
9. Heathcote, A., Brown, S., & Mewhort, D. J. K. (2000). The power law repealed: The case for an exponential law of practice. *Psychonomic Bulletin & Review*, 7(2), 185–207.

**Statistical layer** — detail in [EVIDENCE-BASE.pdf](EVIDENCE-BASE.pdf)

10. Hopkins, W. G. (2000). Measures of reliability in sports medicine and science. *Sports Medicine*, 30(1), 1–15.
11. Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences* (2nd ed.).
12. Kish, L. (1965). *Survey Sampling*. Wiley. — design effect, §3.
13. Harrell, F. E., & Davis, C. E. (1982). A new distribution-free quantile estimator. *Biometrika*, 69, 635–640.
14. Royston, J. P. (1982). Algorithm AS 177: Expected normal order statistics. *Applied Statistics*, 31(2).
15. Hedges, L. V., & Olkin, I. (1985). *Statistical Methods for Meta-Analysis*.
16. McGraw, K. O., & Wong, S. P. (1992). A common language effect size statistic. *Psychological Bulletin*, 111, 361–365.
17. Grissom, R. J. (1994). Probability of the superior outcome of one treatment over another. *Journal of Applied Psychology*, 79, 314–316.
18. Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate. *JRSS-B*, 57(1), 289–300.

**Rendering**

19. Tufte, E. R. (1983). *The Visual Display of Quantitative Information*.
20. Cleveland, W. S. (1993). *Visualizing Data*.
