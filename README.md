# KovaaK's stats

A local statistics app for KovaaK's aim trainer. It reads your `stats` folder and
tells you whether you are actually improving — **and tells you when it cannot
tell**, which is most of the time on most scenarios.

> See how your floor moves, not just your ceiling.

Everything runs on your own machine. No account, no upload, no network calls.

---

## Why it exists

The obvious implementation — average the scores, track the personal best, draw a
line — produces numbers that are misleading in three independent ways:

1. **It measures the wrong thing.** Within-session improvement is warm-up and task
   familiarity, not durable skill.
2. **It contains a volume artifact.** A personal best is the maximum of *n*
   samples, and the expected maximum rises with *n* even when nothing has changed.
   Play more, "PB" more, learn nothing.
3. **It is drawn on an arbitrary scale.** Auto-fitting a chart to its own min and
   max stretches whatever variation exists to fill the frame, so a flat plateau
   and a genuine breakthrough render identically.

This app fixes all three, and says *"that's within noise"* whenever the data
cannot support a stronger claim.

---

## Running it

**Easiest:** double-click `start.bat`. It finds Python on its own.

**Or:**

```bash
python server.py
```

Then open <http://127.0.0.1:8765/>. On first run, point it at your stats folder —
usually:

```
…\steamapps\common\FPSAimTrainer\FPSAimTrainer\stats
```

It tries to detect that automatically, including across every drive letter and
via Steam's `libraryfolders.vdf`.

Requires **Python 3.8+**. No pip install, no dependencies — standard library only.

### Two views

| URL | What you get |
|---|---|
| `/` | Everything: cm/360 analysis, benchmarks, per-scenario charts, sessions |
| `/simple.html` | The short version: how your floor and ceiling are moving |

---

## What it does

- **Ceiling (p90) / Typical (trimmed mean) / Floor (p10)** with 95% confidence
  intervals, instead of max/mean/min. Raw PB is still shown, labelled
  *"not a measurement"*.
- **Power analysis per scenario** — tells you how many runs you would need to
  detect a 5% change at *your* spread, and refuses to dress up an under-powered
  number as a finding.
- **cm/360 analysis** — filter by exact sensitivity, by range, or by favourites;
  best and worst performing sensitivity bands; per-cm PBs. Runs at different
  sensitivities are not the same distribution, so pooling them is treated as a
  bug, not a view option.
- **Benchmarks** — 216 of them, searchable, with your rank against each threshold.
- **Session tracking** — time in KovaaK's vs time actually playing, gaps between
  runs, restart-spam detection, configurable break reminders.
- **Honest charts** — σ-scaled axes, a ±1σ noise band, PB drawn as a step
  function, 2:1 plot area. *Clearing the band is progress; inside the band is a
  good day.*
- **Confound corrections** — warm-up runs and post-break re-familiarisation runs
  are excluded by default, both toggleable. On real data the warm-up effect
  measured **−8.2%**.

---

## Documentation

| File | Answers |
|---|---|
| [HANDOFF.md](HANDOFF.md) | Where do I start? Read this first. |
| [CALCULATIONS.md](CALCULATIONS.md) | What does each number actually compute? |
| [MEASUREMENT-SPEC.md](MEASUREMENT-SPEC.md) | What are we allowed to claim, and why? |
| [CHART-SCALING.md](CHART-SCALING.md) | Why is the chart that size and that scale? |
| [NOTES.md](NOTES.md) | Architecture, parser quirks, performance traps. |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release. |
| [planning/BACKLOG.md](planning/BACKLOG.md) | What is coming next. |

---

## Releases

Each batch of work is frozen into `releases/vX.Y.Z/` with its own port, so an old
build keeps working untouched while development continues.

```bash
python release.py          # next patch version
python release.py 0.1.0    # explicit
```

The footer of every page prints its build and port, so you always know which one
you are looking at.

---

## Credits

**Orb Eater** did the thinking, **Claude** did everything else.

Inspired by [Evxl.app](https://evxl.app/), Reflek's, Corpserf dashboard and Kova.
