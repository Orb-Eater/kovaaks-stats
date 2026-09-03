# Measurement spec — what we are allowed to claim, and why

Companion to [CALCULATIONS.md](CALCULATIONS.md) (the formulas as built) and
[CHART-SCALING.md](CHART-SCALING.md) (how they are drawn).

Source: `scoring-and-charting-spec.pdf` (supplied by Orb Eater, 2026-09-01).
Sections 3–8 of that document are **normative** — they are requirements, not
suggestions. Full extracted text lives in `planning/source-docs/`.

This file records the reasoning. `CALCULATIONS.md` records what is actually
implemented today. Where they disagree, this file is the target and
`CALCULATIONS.md` is the truth — the gap table in §10 is the todo list.

---

## 1. Purpose

The obvious implementation — average the scores, track the personal best, draw a
line — produces numbers that are misleading in three independent ways:

1. they measure the wrong construct (performance, not learning),
2. they contain a volume artifact (PB grows with run count alone),
3. they are rendered on an arbitrary scale (auto-fit axes).

> The central design constraint is that the application must be able to say
> **"this is not distinguishable from noise"** and must do so often. A statistics
> tool that always reports a trend is a random number generator with a confident
> interface.

---

## 2. Foundational principle — performance is not learning

- **Performance** — what is observable during a session. Contaminated by
  warm-up, fatigue, schedule, motivation, volume.
- **Learning** — the relatively permanent change in capability that supports
  retention and transfer.

The two are routinely dissociated: learning can occur with no visible
performance change, performance can improve without producing learning, and some
training manipulations move them in *opposite* directions (Soderstrom & Bjork,
2015). Learning is measured with a **retention test** — cold performance at a
later date — not with within-session numbers.

**Practical consequence:** within-session improvement over 60 runs of one
scenario is largely warm-up, task familiarity, and short-term tuning. It is real,
it feels like progress, and it is a poor predictor of tomorrow's capability. The
app must not present it as skill gain.

**Two metric families, never mixed on one axis or in one headline number:**

| Family | Definition | Where it belongs |
|---|---|---|
| **Form** | Performance right now | Session panel, "this session" badges, 1–7 day window |
| **Skill** | Retention-based estimate from cold-start runs | "Skill over time" chart, 30+ day comparisons |

This app currently mixes them. The session panel (Form) and the trend chart
(closer to Skill) sit on the same page with no labelling. Splitting them is
tracked in §10.

---

## 3. Confound inventory

Every one of these must be recorded per run and available to the aggregation
layer. Metrics that ignore them are not comparable across sessions.

| Field | Why it matters | Have it? |
|---|---|---|
| `sensitivity_cm360` | Runs at different sensitivities are not one distribution. Pooling inflates σ and corrupts everything downstream. **Hard filter, not a view option.** | ✅ 100% coverage |
| `run_index_in_session` | Warm-up decrement early, fatigue late. Position in session predicts score independently of skill. | ✅ via `annotateRuns()` |
| `runs_of_scenario_in_session` | Drives the extreme-value artifact in PB and low-average (§4.1). | ⚠ derivable, not stored |
| `gap_since_last_session` | Determines whether the first run qualifies as a retention test. | ✅ via `buildSessions()` |
| `session_schedule_index` | Blocked vs interleaved changes expected in-session performance *by design* (§5). | ❌ not computed |
| `session_total_runs`, `timestamp` | Session length proxies fatigue; time of day is a known nuisance variable. | ✅ |
| `is_reset` | **Not in the source document, but it belongs here.** With "log every run" enabled, an abandoned attempt is written to disk as a real run with a real score. That score is partial progress at the moment of the restart, so it is systematically low and unrelated to skill — a confound in exactly the sense of this section. Detected structurally (zero elapsed seconds) and excluded unconditionally. See `NOTES.md`, "Run resets". | ✅ v0.1.0 |

---

## 4. Metric rework

### 4.1 The extreme-value problem — fix this first

Personal best is the maximum of *n* samples. **The expected maximum increases
with *n* even when the underlying distribution has not moved at all.** A player
taking 60 runs at a scenario sets PBs far more often than one taking 4, at
identical skill. Raw PB comparison across sessions of different length is not a
measurement — it is a count of how much the player played.

Low-average has the mirror defect: more runs means sampling deeper into the left
tail, so a long session produces a worse low-average for free.

The correction compares the observed extreme against the extreme **expected** for
that sample size, using Blom's approximation:

```
expected_max(n, mu, sigma) = mu + sigma * inv_norm_cdf((n - 0.375) / (n + 0.25))

pb_surprise = (observed_pb - expected_max(n, mu, sigma)) / sigma
```

- `pb_surprise ~ 0` — exactly the PB this volume predicts. Not news.
- `pb_surprise > 1` — genuinely above what volume alone explains.
- `pb_surprise < 0` — underperformed the session's own distribution.

Report `pb_surprise` alongside the raw PB, and **never render raw PB as a trend
line without normalising for n**. Acceptable simpler alternatives: compare PBs
only at matched run counts, or replace the max with the 95th percentile, which is
far more stable at varying *n*.

> Mean and σ are unbiased at any sample size. Max, min, and tail averages are
> not. Prefer the former as primary metrics; treat the latter as decorated
> highlights, not evidence.

**What this app already does:** the headline metrics were reworked in v0.0.4 to
Ceiling (p90) / Typical (trimmed mean) / Floor (p10), and raw PB is explicitly
labelled *"not a measurement"*. p90 instead of max is the "acceptable simpler
alternative" above. `pb_surprise` shipped in v0.9.0, gated below n = 10 same as
CV — but using an *exact* expected-max table (numerical integration, 300
values) rather than Blom's approximation above, which this build's own testing
confirms is unreliable at the session-sized `n` (15-40 runs) this app actually
sees; Blom is only trustworthy around n > 100.

### 4.2 Regression to the mean

The session after an exceptional session is worse **on average**. This is
arithmetic, not decline.

- Must not render a post-PB dip as a downtrend.
- Must not generate **any** prompt, warning, or commentary triggered by a single
  session falling below the previous one.

⚠ The v0.0.7 session panel and the "▲ avg up X% this session" badge are
single-session commentary. The badge only fires upward so it does not accuse the
user of decline, but this rule needs an explicit audit — tracked in §10.

### 4.3 Cold-start score — the primary learning metric

Warm-up decrement is a temporary loss of performance following rest, distinct
from forgetting, modelled as a fast transient process superimposed on the slow,
persistent process of learning (Adams, 1952; Newell et al., 2013). That
two-timescale structure is exploitable: **the first run of a session, after a
sufficient gap, is a naturally occurring retention test that the data already
contains.**

```
cold_start_runs = [
  first run of scenario S in session
  WHERE gap_since_last_session >= COLD_GAP_HOURS       // default 12
    AND run is among the first RUNS_BEFORE_WARM        // default 1
]

skill_estimate(S) = rolling_mean(cold_start_runs, window = 8 sessions)
```

Individually these runs are noisy — inherent to a single trial. Across sessions
they are the cleanest signal of durable capability available without a dedicated
test protocol. **This series, not the session average, is what belongs on a
"skill over time" chart.**

Note the tension with the existing "Skip warmup" toggle: that feature *discards*
exactly the runs this metric is built from. Both are correct — warmup runs are
noise for a Form metric and signal for a Skill metric. They must be two separate
series, not one toggle.

### 4.4 Within-session curve and de-trended session level

Fit score against run index to separate the transient from the level:

```
score(i) = P * (1 - exp(-i / tau)) - f * max(0, i - i_fatigue)

// P         plateau level         -> the session's actual performance level
// tau       warm-up time constant -> how many runs to reach form
// f         fatigue slope         -> per-run decline after onset
// i_fatigue fatigue onset index
```

Report **P** as the session level rather than the raw session mean, which is
biased downward by warm-up and by fatigue in long sessions. `tau` and
`i_fatigue` are useful in their own right — they answer *"how long do I need to
warm up"* and *"how long can I train before it stops counting."*

Fall back to a trimmed mean of post-warm-up runs when a session has under ~10
runs. Do not fit the fatigue term at all below ~15 runs.

> **This is the basis for the per-install warm-up calibration Orb Eater asked
> for.** `tau` *is* "how many early runs to exclude for this person". Fitting it
> once on first launch and caching the result replaces the hard-coded
> `WARMUP_DROP: 2`.

---

## 5. Practice schedule is a first-class variable

The **contextual interference effect**: presenting multiple task variants in
randomised order produces *inferior performance during acquisition* but *better
learning*, measured by retention and transfer, compared with blocked practice
(Shea & Morgan, 1979; Magill & Hall, 1990). In a complex bimanual task the
blocked group performed better during acquisition, but the random group
outperformed it at both immediate and delayed retention and showed superior
persistence over a one-week interval (Pauwels et al., 2014). It also holds for
adaptation of already-established skills, not just acquisition (Tsay et al., 2023).

**Therefore:** a shift from long blocks per scenario to a few runs across many
scenarios will *lower in-session scores by design* while improving actual
learning. An app that scores on session averages will report that a better
training schedule is making the player worse.

```
schedule_index(session) = count_scenario_switches(session) / (total_runs - 1)
// ~0 = fully blocked, ~1 = fully interleaved
```

Requirements:

- Compute `schedule_index` per session and store it.
- Never compare session-level performance across materially different schedule
  indices without labelling the difference.
- Cold-start metrics (§4.3) are comparatively robust to schedule and are the
  correct basis for cross-schedule comparison.
- **Do not editorialise a recommendation.** The advantage of random practice
  grows with experience in a complex task; early in practice it can overload
  attention and memory demands (Wulf & Shea, 2002). The prescription is not
  universal.

---

## 6. Transfer — do not attribute gains to per-scenario volume

Improvement on a scenario after only a handful of runs at a related one is **near
transfer**, and transfer is consistently greater following random practice than
blocked (Shea & Morgan, 1979). It is a real effect, not an outlier to filter.

The consequence is a hard limit on causal claims. Any statement of the form
*"you improved at X because you played X a lot"* is confounded by the entire
remaining scenario mix of every session. If the app models this at all, the unit
of analysis is the session's full scenario composition, not the target scenario's
run count. Otherwise: report correlation and volume separately, make no causal
claim.

---

## 7. Time windows and what each can support

| Window | Supported | Not supported | Label |
|---|---|---|---|
| 1–7 days | Current form; consistency (σ); session structure (tau, fatigue onset); volume | Any learning claim — too few sessions, performance factors dominate | **"Form"** — never "improvement" |
| 1–30 days | Learning slope regressed on the cold-start series, reported with a CI; consistency trend | Attribution to any single scenario or schedule change | **"Trend (estimated)"** |
| 30+ vs baseline | Distribution shift: median change, probability of superiority, σ change | Anything computed from PB vs PB (§4.1) | **"Change vs baseline"** |

**Probability of superiority** is the most interpretable long-window statistic —
the chance a random run today beats a random run from the baseline period:

```
P_superiority = norm_cdf( (mu_now - mu_base) / sqrt(sigma_now^2 + sigma_base^2) )
// 0.50 = no change.  0.65 = a today-run beats a baseline-run about 2 times in 3.
```

This is far easier to read than "+1.0% ± 0.9%" and should probably become the
headline number. Tracked in §10.

⚠ The app's 7-day window currently uses the same "increase / improvement"
language as the 90-day window. Per this table that is wrong and must be relabelled.

---

## 8. Statistical gates

Before any improvement is displayed as such, it must clear a threshold. Standard
error of a session-level estimate falls with run count, so the gate is
volume-aware:

```
se(session)   = sigma / sqrt(n_runs)
se_difference = sqrt(se(a)^2 + se(b)^2)
significant   = |mean_b - mean_a| > 1.96 * se_difference
```

When the gate is not met, **the correct output is an explicit statement that the
difference is within noise** — not a smaller arrow, not a hedged trend line.

Additional gates:

- No trend line through fewer than ~20 runs, or fewer than ~6 sessions for a
  cold-start series.
- **Minimum detectable effect** must be surfacable: *"with your current volume,
  this view can detect a change of roughly X points."*
- **Multiple comparisons:** scanning many scenarios for "biggest improvement"
  means some cross threshold by chance. Either correct for the number of
  scenarios tested, or present the ranking without significance claims.

The app implements the CI gate and the minimum-detectable-effect message
(`requiredN`, the `stalewarn` block). It does **not** correct for multiple
comparisons, and the "Biggest gain" sort is exactly the multiple-comparison trap
described above. Tracked in §10.

---

## 9. Rendering rules

Fully covered in [CHART-SCALING.md](CHART-SCALING.md). Summary of the normative
points:

- Scale by σ over a fixed trailing window, never auto-fit.
- Bars/areas need zero; lines/dots do not.
- Plot area near 2:1.
- Every score chart: raw run dots + ±1σ band. PB as a step function.
- Cross-scenario: percent change (progress) or z-score (comparison). Never mixed.

---

## 10. Gap list — spec vs this codebase

Ordered by how much the gap distorts what the user is told.

| # | Gap | Spec § | Effort | Status |
|---|---|---|---|---|
| 1 | Auto-fit y-axis on every chart | §9.1 | S | ✅ **fixed v0.0.8** |
| 2 | No ±1σ band or raw-dot noise floor on the trend chart | §9.2 | S | ✅ **fixed v0.0.8** (per-scenario); trend chart is % units, band pending |
| 3 | PB drawn as a smooth line | §9.2 | XS | ✅ **fixed v0.0.8** |
| 4 | Chart aspect ratio ~6.6:1 | §9.1 | XS | ✅ **fixed v0.0.8** |
| 5 | No cold-start series → no true Skill metric | §4.3 | M | ⬜ backlog |
| 6 | Per-install warm-up calibration (fit `tau`) instead of `WARMUP_DROP: 2` | §4.4 | M | ⬜ backlog (requested) |
| 7 | Windows not labelled Form / Trend / Change vs baseline | §7 | S | ⬜ backlog |
| 8 | `schedule_index` not computed | §5 | S | ⬜ backlog |
| 9 | No multiple-comparison correction on "Biggest gain" | §8 | S | ⬜ backlog |
| 10 | `pb_surprise` not computed | §4.1 | S | ✅ **fixed v0.9.0** (exact table, not Blom) |
| 11 | Probability of superiority not offered | §7 | S | ⬜ backlog |
| 12 | Single-session commentary audit vs regression to the mean | §4.2 | S | ⬜ backlog |
| 13 | Per-scenario cm/360 filter (currently global only) | §3 | M | ⬜ backlog |
| 14 | Run resets counted as real scores | §3 | S | ✅ **fixed v0.1.0** |

---

## 11. Limitations of the evidence base

Two caveats that shape how confidently the app may phrase anything:

- **Domain transfer.** None of the cited work studies aim trainers. It comes from
  laboratory motor tasks, sport skills, and rehabilitation. The constructs —
  warm-up decrement, contextual interference, the learning/performance
  dissociation — are robust and general, but **effect sizes and time constants
  for this specific task are unknown and should be estimated from the user's own
  data rather than assumed.** This is the direct justification for calibrating
  warm-up per install rather than shipping a constant.
- **Group effects, single subject.** Every result cited is a group-level average.
  This app operates on n = 1, where between-individual variation is large.
  Everything it reports is an estimate with wide uncertainty, **and it should say
  so rather than presenting verdicts.**

---

## 12. References

1. Soderstrom, N. C., & Bjork, R. A. (2015). Learning versus performance: An integrative review. *Perspectives on Psychological Science*, 10(2), 176–199.
2. Shea, J. B., & Morgan, R. L. (1979). Contextual interference effects on the acquisition, retention, and transfer of a motor skill. *Journal of Experimental Psychology: Human Learning and Memory*, 5, 179–187.
3. Magill, R. A., & Hall, K. G. (1990). A review of the contextual interference effect in motor skill acquisition. *Human Movement Science*, 9, 241–289.
4. Pauwels, L., Swinnen, S. P., & Beets, I. A. M. (2014). Contextual interference in complex bimanual skill learning leads to better skill persistence. *PLOS ONE*, 9(6), e100906.
5. Tsay, J. S., et al. (2023). Signatures of contextual interference in implicit sensorimotor adaptation. *Proceedings of the Royal Society B*.
6. Wulf, G., & Shea, C. H. (2002). Principles derived from the study of simple skills do not generalize to complex skill learning. *Psychonomic Bulletin & Review*, 9(2), 185–211.
7. Adams, J. A. (1952). Warm-up decrement in performance on the pursuit-rotor. *American Journal of Psychology*, 65(3), 404–414.
8. Newell, K. M., et al. (2013). Task difficulty and the time scales of warm-up and motor learning. *Journal of Motor Behavior*, 45(3).
9. Tufte, E. R. (1983). *The Visual Display of Quantitative Information*. Graphics Press.
10. Cleveland, W. S. (1993). *Visualizing Data*. Hobart Press.
