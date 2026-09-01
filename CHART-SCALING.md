# Chart scaling — why the charts are sized and scaled the way they are

Companion to [CALCULATIONS.md](CALCULATIONS.md) (what the numbers mean) and
[MEASUREMENT-SPEC.md](MEASUREMENT-SPEC.md) (what we are allowed to claim).
This file is only about **rendering**: axis ranges, chart proportions, and what
gets drawn on top of the data.

Source: `honest-chart-scaling.pdf` + §9 of `scoring-and-charting-spec.pdf`
(supplied by Orb Eater, 2026-09-01). Section numbers below map to that document.
Full extracted text is kept in `planning/source-docs/` so the reasoning survives
without the PDFs.

---

## 1. The problem

Every score-over-time chart makes an implicit claim about **how much** the score
changed. That claim is almost entirely controlled by the y-axis range — and the
default y-axis range in every charting library is "fit the data to the frame".

Auto-fitting min/max is the single biggest source of visual dishonesty in a
progress chart, because it stretches whatever variation exists to fill the
available height. **A flat plateau and a genuine breakthrough render
identically.** The viewer cannot tell them apart.

Tufte's lie factor formalises it:

```
lie_factor = (size of effect shown in graphic) / (size of effect in data)
```

1.0 is honest. Auto-fit axes on noisy data routinely land at 5–20.

The goal is **not** lie_factor = 1 exactly — that makes most real progress
invisible on an aim-trainer score scale. The goal is that the distortion is
**principled and constant** instead of accidental and variable.

### What this app was doing wrong

`spark()` used `lo = min(scores)`, `hi = max(scores)` — textbook auto-fit — and
drew it into a 900×170 viewBox with `preserveAspectRatio="none"`, i.e. roughly
6.6:1, stretched to whatever width the browser gave it. Two scenarios with
wildly different consistency produced visually identical charts. That is fixed
in v0.0.8.

---

## 2. Baseline rules by chart type

| Encoding | Zero baseline | Reason |
|---|---|---|
| Bar / column / area | **Required** | The mark's *length* encodes the value. Truncating the axis makes the length ratio between bars a lie. A bar chart with a cut axis is always wrong. |
| Line / dot / scatter | Not required | *Position* encodes the value and *slope* encodes change. Zero carries no information for scores whose meaningful range is a narrow band far from zero. |

Score progression is a line/dot encoding, so a truncated y-axis is legitimate
here — but it has to be truncated to a **defensible** range, not an auto-fitted
one.

**Rule for this codebase:** if a future chart uses bars or filled areas to encode
magnitude, it must include zero. No exceptions, no "but it looks better".

---

## 3. Core rule — scale by variability, not by range

A score is not a fixed quantity. It is a sample from a distribution whose spread
reflects consistency, warm-up state, and luck. So the unit of "how big is this
change" should be the **standard deviation of that distribution** — the same
idea as an effect size (Cohen's *d*).

```
mu    = mean(runs_in_sigma_window)
sigma = stddev(runs_in_sigma_window)

span  = max(K * sigma, MIN_SPAN_PCT * mu)     // K = 3.5, MIN_SPAN_PCT = 0.04
y_min = min(mu - span, min(visible_points))
y_max = max(mu + span, max(visible_points))
```

Consequences, all of them wanted:

- A 2σ improvement occupies twice the vertical distance of a 1σ improvement.
  **Improvements become visually comparable to each other**, within a scenario
  and across scenarios.
- Run-to-run noise renders as noise. It takes up a small, consistent fraction of
  the frame instead of filling it.
- A consistent player (small σ) gets a tighter axis, so their smaller-but-real
  gains stay visible. A streaky player gets a wider axis, so their swings do not
  read as progress.
- **A genuinely flat period looks flat.** This is the property auto-fit destroys
  and the main reason for the whole change.

### The two clamps, and why each exists

- `MIN_SPAN_PCT * mu` — if σ is tiny (few runs, or a freakishly consistent
  streak) the axis collapses and re-amplifies noise. The floor of 4% of the mean
  stops that.
- `min(visible_points)` / `max(visible_points)` — the frame must always contain
  every plotted point. We expand the range rather than clipping the line,
  because a clipped line silently hides the very run the user is looking for.
  One wild outlier therefore *can* widen the frame. That is accepted: the
  outlier is real data and hiding it would be worse than the extra whitespace.

### Tuning K

Lower K (2.5–3) magnifies change and suits short windows. Higher K (4–5) is more
conservative. In `TUNING`:

```js
CHART_K: 3.5,            // half-height of the y-axis in sigmas
CHART_MIN_SPAN_PCT: 0.04 // floor on the span, as a fraction of mu
```

Exposed as tuning constants, defaulted, and **never** allowed to fall back to
min/max.

---

## 4. Freeze the σ window so the axis does not jitter

If σ is recomputed over all visible data on every render, the axis changes shape
every session and two screenshots a week apart are not comparable.

σ is computed over a **fixed trailing window** — the last `CHART_SIGMA_N` runs
(default 50) — and held while the time axis changes.

```js
CHART_SIGMA_N: 50
```

> **Zooming the x-axis must never rescale the y-axis.** If it does, the same
> improvement changes apparent size depending on how far the user has scrolled,
> which is exactly the distortion this document exists to prevent.

This app has no x-zoom yet, but it does have a Window selector, which is the same
thing: switching 30 days → 90 days must not change how big a 5-point gain looks.
Hence σ from the trailing 50 runs of the scenario rather than from the runs
currently in the window.

---

## 5. Draw the noise floor explicitly

**This is the highest-value change in the document**, because it makes the chart
self-calibrating. Instead of asking the viewer to trust the axis, show the spread
directly:

- Plot **every individual run** as a small low-opacity dot behind the aggregate
  lines.
- Draw a shaded band at **±1σ around the rolling mean**.
- Keep PB, average and low-average as distinct lines on top.

The interpretation then becomes visual and immediate:

> **A point or trend that clears the band is real progress. One that sits inside
> the band is a good day.**

No axis choice can mislead a viewer who can see the noise floor, which is what
makes this robust in a way that axis rules alone are not.

### Two deliberate deviations from the source document

1. **The band is centred on the rolling median, not the rolling mean.** The
   document says rolling mean. The chart already draws a rolling median line,
   and a band centred somewhere other than the line the eye is following breaks
   the "did this clear the band" reading that makes the band useful. The median
   is also robust to the single catastrophic run that aim trainers produce
   regularly. σ itself is still the ordinary standard deviation.
2. **One outlier can widen the frame.** §3's `min(visible_points)` clamp means a
   single disastrous run pushes the axis out and squashes everything else into
   the upper half. This is accepted rather than fixed: the alternative is
   clipping the line, which hides the exact run the user went looking for. If it
   becomes a real annoyance, the fix is a clipped-point marker at the frame edge
   — never a return to auto-fit.

### PB is a step function

A single PB is an extreme-value statistic and is inherently noisier than a mean —
see [MEASUREMENT-SPEC.md §4.1](MEASUREMENT-SPEC.md). PB lines will always look
jumpier than average lines even when nothing has changed. Rendering PB as a
**step function** rather than a smooth line makes its ratchet nature explicit and
discourages reading slope into it. A diagonal segment between two PBs is a claim
about the runs in between, and that claim is false — nothing happened there.

---

## 6. Aspect ratio — bank to 45°

Cleveland's result on slope perception: people judge rate of change most
accurately when the average line segment sits near 45°. Very wide, short charts
flatten trends; tall, narrow charts exaggerate them. **Aspect ratio is part of
the honesty of the chart, not part of its styling.**

Full auto-banking:

```
median_abs_slope = median(|y[i+1] - y[i]|)   // per x step, in data units
target: (median_abs_slope / y_span) * plot_height
        ~= (1 / n_visible_points) * plot_width
```

That is impractical in a fixed layout with a variable number of scenario cards,
so we use the documented approximation: **keep the plot area near 2:1
width:height**, and if the visible window is very long, aggregate points or allow
horizontal scrolling rather than compressing more points into the same width.

In this app:

- `.spark` — per-scenario chart, capped at 680×340 (2:1) instead of the old
  full-width 170px strip.
- `.tchart` — overall progress chart, 700×340 in its grid column (~2:1).

---

## 7. Comparing across scenarios

Raw scores are not comparable between scenarios: different scoring formulas
produce wildly different scales and different natural variances. Any
multi-scenario view must normalise.

| Transform | Formula | Use when |
|---|---|---|
| Percent change from baseline | `(x - x0) / x0` | Communicating progress to a person. Intuitive, directly readable. |
| Z-score | `(x - mu) / sigma` | Asking "where am I strong or weak". Puts every scenario in units of its own noise. |
| Log scale | `log(x)` | Gains are multiplicative; equal vertical distance = equal percentage gain. |

Percent change is the better default for a **progress** view; z-scores for a
**comparison** view. **Never mix them on one axis.**

The overall "Progress over time" chart is already in percent-change units and
anchored at 0, which is correct for a progress view. The planned baseline page
(Batch 6) is a comparison view and should use z-scores.

---

## 8. Sensitivity is a confound, not a filter option

Runs at different cm/360 values are not samples from the same distribution.
Pooling them inflates σ and corrupts **every** calculation above — the band, the
axis, the effect sizes.

Filtering to a single sensitivity before computing statistics is a
**precondition for this whole scheme, not an optional view setting.** If a chart
shows mixed sensitivities it must either split into separate series or label the
scale as uncomparable.

Current state: the per-scenario chart colours dots by cm/360 when more than one
sensitivity is present, and the σ band is computed over the pooled runs. That is
a labelled compromise, not compliance. Making per-scenario cm selection the
default path is Batch 5 (`Extras → per-scenario cm picker`).

---

## 9. Implementation checklist

1. Filter runs to one scenario and one cm/360.
2. Compute µ and σ over a fixed trailing window (default: last 50 runs).
3. Set y-range to µ ± max(3.5σ, 4% of µ), expanded to contain all visible points.
4. Hold that y-range constant across x-axis zoom, pan, and window changes.
5. Render individual runs as faint dots; render a ±1σ band around the rolling mean.
6. Render average and low-average as lines; render PB as a **step function**.
7. Keep the plot area near 2:1; aggregate or scroll rather than compressing points.
8. Never use a bar chart with a truncated axis.
9. For cross-scenario views, switch to percent change or z-scores.

### Status in this codebase (v0.0.8)

| # | Item | Status |
|---|---|---|
| 1 | one scenario + one cm | ⚠ partial — global cm filter only; per-scenario picker is backlog |
| 2 | µ/σ over fixed trailing 50 | ✅ |
| 3 | µ ± max(3.5σ, 4%µ), expanded to contain points | ✅ |
| 4 | y-range held across window changes | ✅ |
| 5 | raw dots + ±1σ band | ✅ |
| 6 | PB as step function | ✅ |
| 7 | plot area near 2:1 | ✅ |
| 8 | no truncated bar charts | ✅ (no bar charts exist) |
| 9 | cross-scenario views normalised | ✅ progress view is % change; z-score view is backlog |

---

## 10. Anti-patterns — do not reintroduce these

- **Auto-fit min/max y-axis.** The default in most charting libraries. Disable it
  explicitly. This is the one that was live in this app until v0.0.8.
- **Y-axis rescaling on zoom / window change.** Makes the same change appear
  different sizes at different zoom levels.
- **Truncated bar charts.** Always a lie factor greater than 1.
- **Heavy smoothing without showing raw points.** A smoothed line implies a
  precision the data does not have; the reader loses all sense of the noise floor.
- **Trend lines fitted through fewer than ~20 runs.** Slope estimates on small
  samples are dominated by noise and will confidently show progress that is not
  there.
- **Pooling sensitivities.** Inflates σ and makes the band meaningless.

---

## References

- Tufte, E. R. (1983). *The Visual Display of Quantitative Information*. Graphics
  Press. (Lie factor.)
- Cleveland, W. S. (1993). *Visualizing Data*. Hobart Press. (Banking to 45°.)
