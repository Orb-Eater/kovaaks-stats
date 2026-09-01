# KovaaK's stats

Written by the one and only Orb Eater.
Yes, not AI. (Talking about this reqdme text not everything else) Every line of code and design is by Claude with my input. Read faq Line 54.

"why another KovaaK's app, we already have over 5 different ones ugh"
This was not planned to be public, this was purely for personal use, but since people where interested in the metrics I shared over personal dm's, more than enough people wanted me to give them access. This is beta build, locally run, opens in web browser.
Full application is in the works.

**
Early TL:DR
Stat viewer with science based approach, running in your browser. Enjoy.**


**Long text;**


This isn't ment to be popular, this is still personal use with the ability to extend on its use-cases. 
If information, coding, reasoning, calculation and or anything else related to this is useful for someone else, then I'm more than happy to share. 
If this can help the aim training community in anyway, it might help the gaming community overall. We're all in dying to have proper research in gaming.

This does not mean I will continue updating this app forever nor does it mean I won't. 
I might stop updating the app tomorrow because I've everything I need myself.
But if you have a question or request, dm on discord. Might answer you.


Currently as of 23:15 01.09.2026, there's no active app or website that uses a science based approach to read your KovaaK's scores. Currently, most % increase or improvement metrics is based off of raw data without logic. This isn't the case for every current app/website out there, but none that I've seen or used is using a scientific approach to calculate the metrics of your kovaaks data. At least not saying it.

_**This one does.**_

By using (input study source you sheep) study metrics towards our kovaaks stats, we'll quickly see why adding raw % increase measured by score doesn't actually show what this app does;

•If you're improving, 
•Are in a "slump" (learning phase, this happens when you're performing worse than usual. 
Reasons for this can be your brain adjusting to the new input you've given it. Dependant on player with x amount of playtime.
 There are several reasons and a plethora of factors that can affect ones learning rate and current skill).
•If you're becoming more consistent.
•If you're breaking personal best faster than what your consistent improvement rate is.
•If you're more consistent and closing in on your personal bests.
•And even more reasoning behavior.

This calculation with the scientific graph display size (input source you baffoon) makes it so much easier to see actual progress measuring pb, avg % and low avg %. 
The calculation is made to exclude random non important outlier (10k avg run on controlsphere but has a 2 cm run with 4k in score), while also calculating and removing your own % based warm up runs you yourself need before it actually measures the scores.

For myself, my first 3 runs are 8% worse than 3 runs after on average. So these are not included in calculation. While warming-up can feel like it takes up to 15-20~ minutes, the reasoning and math doesn't think so in terms of score. (muscles warming-up is still happening duh, and is still relevant and equally as important regardless of score stats when it comes to hand health)

one major issue is having enough runs on a scenario to actually see improvement. According to (science input for improving) and adapted to kovaaks, you'll need 60+ runs before 30 day window plus another 60 in current window to determine actual improvement.

This is a lot yes.

however, we can still se early signs. These are marked on the scenario itself so you know you can't fully trust the calculation. You can use it as a ball park.


**short faq**
_"Orb, when did tou become a coder??"_
never have been. This is all with the help of Claude Opus 5. I have no coding experience, only tons of ideas in my head that I wouldn't be able to put together without the use of Claude. (or paying someone thousands of dollars to implement every little thing I want)

_"If Claude is doing everything, couldn't all of this be fake"_
yeah, that's why it's personal use and will highly likely never be promoted in any way shape or form. 
Until everything is checked properly by a human, this could all be pseudo science and completely of the mark for it's actual use.


Thanks for your time.

-------
Everything below here is claudes doing. left it since ion wanna write everything myself yet. still lots work even when an AI is doing the hard part. Some stuff are outdated and wrong, so take this next part with some sand. Every feature you should be able to view on the page itself.


A local statistics app for KovaaK's aim trainer. It reads your `stats` folder and
tells you whether you are actually improving — **and tells you when it cannot
tell**, which is most of the time on most scenarios.

> See how your floor moves, not just your ceiling.

Everything runs on your own machine. No account, and your run data is never
uploaded anywhere — it is read from your stats folder and stays there.

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
  bug, not a view option. Clicking a cm chip under a chart narrows **that
  scenario** to that sensitivity and nothing else on the page — and recomputes
  it properly, confidence intervals and all, rather than filtering the picture
  and leaving the numbers behind.
- **A closer look at one scenario** — every card is expanded by default, and
  **Full width** pushes a single card out to 1920px with the numbers beside the
  chart. The chart keeps its 2:1 aspect there: stretching it to fill the width
  would make every change look bigger than it is, which is the whole thing this
  app exists to avoid.
- **Scenario testing** — Viscose Benchmarks S2 (Medium, Hard, Expert), searchable,
  with your rank against every threshold.
- **Score by cm, per scenario** — your average at each sensitivity with its
  confidence interval, and an explicit warning when two sensitivities were
  played months apart, because then the gap between them is practice rather
  than sensitivity. The interpretations come from a plain-text rules file you
  edit yourself.
- **A month calendar** — this month and the four before it, each with its Typical
  change against the month before, the days you played, and how many scenarios
  you tried for the first time.
- **Explanations you can read** — one yellow warning symbol per scenario opens a
  panel saying exactly what applies to it: how many more runs it needs, whether
  it is leaning on a stand-in baseline, how long since you played it. The menu
  bar has the icon key and the reasoning behind every number.
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
| [CALCULATIONS.md](CALCULATIONS.md) | What does each number actually compute? |
| [MEASUREMENT-SPEC.md](MEASUREMENT-SPEC.md) | What are we allowed to claim, and why? |
| [CHART-SCALING.md](CHART-SCALING.md) | Why is the chart that size and that scale? |
| [NOTES.md](NOTES.md) | Architecture, parser quirks, performance traps. |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release. |
| [planning/BACKLOG.md](planning/BACKLOG.md) | What is coming next. |

---

## Releases

Each batch of work is frozen into `releases/vX.Y.Z/` with its own port and its own
config, so an old build keeps working untouched while development continues.

**That is the point of it.** If a new build has a bug the previous one did not,
you do not have to wait for a fix — open the older release and carry on. They run
side by side on different ports, they share nothing, and a release you already
have can never be changed by later work. A release starts with no stats folder
set and asks on first launch, exactly like a fresh install.

```bash
python release.py          # next feature release  (0.3.0 -> 0.4.0)
python release.py --patch  # next fix release      (0.3.0 -> 0.3.1)
python release.py --verify # what each build on disk actually is
```

The footer of every page prints its build hash and port, so you always know which
one you are looking at.

### Two downloads, not twenty

Only two releases are published at a time:

| Channel | What it is | GitHub |
|---|---|---|
| **Base** | The build that has been used enough to trust. Start here. | marked *Latest* |
| **Beta** | The newest build. New features arrive here first. | marked *Pre-release* |

A new version replaces **beta**. **Base** stays where it is until a beta has
proven itself and is promoted, at which point the old base is retired. So there
is always one boring option and one current option, and never a wall of
half-remembered version numbers to choose between.

`publish.py` implements exactly that — see `--help`. It refuses to do anything
without `--yes`, so it cannot publish by accident.

---

## Licence

[MIT](LICENSE). Use it, change it, ship it, sell it — just keep the copyright
notice. No warranty.

---

## Credits

**Orb Eater** did the thinking, **Claude** did everything else.

Inspired by [Evxl.app](https://evxl.app/),
[Reflek’s](https://refleksapp.com/),
[Corporate Serf Dashboard](https://github.com/MingoDynasty/Corporate-Serf-Dashboard)
and [Kova](https://pyvno.xyz/).
