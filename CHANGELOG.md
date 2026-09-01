# Changelog

Newest first. Each frozen release carries a copy of this file plus a
`WHATS-NEW.txt` containing just its own section.

---

## v0.3.0 - 2026-09-01

**TL;DR - "not enough baseline yet" almost never shows a blank dash any more.
Warnings are now icons you hover, not paragraphs you scroll past. Cards have
an Expand button, cm chips are clickable, and two rough edges — a "0.0%"
session badge and a wall you might be mostly idle during — are fixed.**

Batch 8: the rest of the UI declutter (your words: *"We need to remove all the
text clutter everywhere"*).

### A % is (almost) always shown now

- **Early-baseline fallback.** A cell with no real earlier period to compare
  against used to show `—`. It now falls back to your first 5 runs of that
  scenario/cm as a standing reference point, tagged **early** instead of given
  a confidence interval it can't earn — see
  [CALCULATIONS.md §2b](CALCULATIONS.md). Applied to the scenario cards and
  the by-cm "avg/pb change" tables alike.
- This does **not** invent numbers where there's no current data either — a
  metric still needs enough *window*-side runs to compute at all; only the
  baseline side got more forgiving.

### Icons instead of paragraphs

- **"Not enough baseline yet"** is now an ℹ️ next to the scenario name,
  hover/focus for the explanation, only shown when a % on that card actually
  used the early-baseline fallback above.
- **The under-powered paragraph is now a ⚠️.** Its tooltip says only the
  concrete thing — how many more comparable runs, and roughly how many days
  at your recent pace — instead of a sentence with spread, target effect and
  required-n all spelled out.

### Expand, and clickable cm chips

- **Expand** button, top-right of every scenario card: same content, larger
  text and a wider chart, for a closer look without opening a separate page.
- **The per-scenario cm chips are now clickable** — picking one sets the
  app's Specific-cm filter to that value, so "just this scenario at just this
  cm" is one click instead of hunting through the picker.

### Two small fixes

- **The "▲ avg up 0.0%" session badge is gone.** When the scenario-wide
  figure would round to a flat 0.0%, the badge now shows your session
  progress at the cm/360 you're actually playing right now instead of
  disappearing outright (only when that figure is itself non-zero).
- **"Mostly idle this session" popup** when under 40% of a session (at least
  10 minutes long) has actually been spent playing — not a judgement, just a
  flag, dismissible, and shown at most once per session.

### Also

- Fixed a stray NUL byte in `core.js` (a cell key separator that should have
  been a space) — harmless to the app, but it made the file look binary to
  standard search tools.

## v0.2.1 - 2026-09-01

**TL;DR - the Browse button now actually shows you a folder window. It was
opening one the whole time, behind the browser, where nobody could see it.**

First PATCH release under the new scheme: a fix between batches, so the last
digit moves rather than the middle one.

### The Browse button

- **The dialog was opening and rendering behind the browser.** Measured: the
  PowerShell call blocked for the full 12 seconds of a test, so a window really
  was up and waiting - it just had nothing to sit in front of. The server has no
  UI of its own, and Windows will not let a background process take focus, so
  the window went straight to the back and the button looked dead.
- **Fixed by owning the dialog with a hidden topmost window** - 1x1, off-screen,
  `WS_EX_TOPMOST`. A topmost window draws above normal ones no matter what has
  focus, which is the honest way for a background process to be seen. Verified
  on screen: visible, topmost, 960x540, at (0,0), correct title.
- **It is now the real Explorer window**, not the 1990s tree widget. Windows gets
  `IFileOpenDialog` in folder-pick mode via ctypes - sidebar, address bar,
  search, and no subprocess or console flash. PowerShell's `FolderBrowserDialog`
  drops to second place (and its owner Form is now `Show()`n before being used
  as an owner - an unshown Form has no window handle, so `TopMost` did nothing);
  tkinter is last, and is absent from your Python anyway.
- **The page says what is happening.** Browse disables itself and reports "A
  folder window has opened", escalating after 6s to "check behind this window or
  on your other monitor - try Alt+Tab", and after 25s to an offer to paste the
  path instead. Cancelling now says so rather than looking like a failure.
- **The request no longer wedges for five minutes.** The dialog timeout drops
  from 310s to 150s, and a timeout returns a message that tells you where to
  look instead of a bare error.

Tested end to end through `POST /api/browse` with the dialog auto-cancelled:
opens in 1.3s, cancel returns cleanly, all three pickers failing produces a
readable message rather than a crash.

## v0.2.0 - 2026-09-01

**TL;DR - a NeverMiss 0 is a real run again: you can see it, but it no longer
drags your averages down. The wall of explanatory text is behind two buttons.
And there is an installer.**

### Zero-score runs

- **A score of 0 is now visible but never counted.** v0.1.0 lumped every
  zero-length run in with restarts and hid them all. On a NeverMiss, missing the
  first shot ends the run instantly with a 0 - that is a real run, and you asked
  to still see it. Two separate questions now:
  - `runVisible` — did you play this? Only a **restart** fails. **5 across your
    whole history** (down from 40) — a zero-length run is only treated as an
    abandoned attempt when it actually scored something.
  - `runUsable` — may it enter a percentage? Everything visible, minus zeros.
    **176 runs** are shown but not counted, 141 of which were previously being
    averaged in and pulling your floor down.
- Zeros render as **hollow marks along the bottom of the chart**, placed at the
  time they happened, with a tooltip. They take no part in the axis scale, the
  rolling lines or the sigma band — letting a 0 set the axis floor would squash
  every real run into the top of the frame.
- Each scenario header says **"+N scored 0"** when it has any.

### Charts

- **End labels stop colliding.** All three series usually finish within a point
  or two of each other and their labels landed on top of one another. They now
  spread to a minimum spacing and run a **leader line** back to the true value,
  in the right-hand margin that was previously empty.
- **The "how to read this" panel gets real space** — a wider column and larger
  text instead of a squeezed strip of two-word lines.

### Less clutter

- **"Show explanation"** collapses the Window / Compare-vs paragraph.
- **"Show figure explanation"** collapses the headline-figures caveats. Only
  appears when there is something to say.
- Both remember your choice per build.
- **"Follow current scenario" now hides with the session panel** instead of
  floating over a collapsed section.

### Install and distribution

- **`install.bat`** — finds Python or offers to install it with winget, then
  creates a Desktop shortcut and Start Menu entry. Not required to run the app;
  `start.bat` still works on its own.
- Repository prepared for GitHub, private.

### Fixes

- Footer credit reads **Corporate Serf Dashboard**, its actual name.
- `NOTES.md` no longer implies the malformed `STS 2 - Pokeball & Flicker.json`
  was repaired. It was edited until it parsed, which is not the same thing, and
  ~30 scenarios were lost. Same correction applied to the Viscose S2 Medium note.

## v0.1.0 - 2026-09-01

**TL;DR - restarts are detected and kept out of your stats, an old build can no
longer masquerade as a new one, the folder button works without tkinter, and
`?selftest=1` proves the maths still does what it says.**

First MINOR release: from here a batch of features bumps the middle digit and a
fix between batches bumps the last one. See NOTES.md, "Versioning".

### Run resets

- **Restarts are now detected** - structurally, not by score. On a restart
  KovaaK's stamps the file with the *new* challenge's start time, so the run
  measures zero elapsed seconds while a real run measures the scenario length.
  Score could never have worked: your three restarts tonight scored 456, 3834
  and 8118 against a completed 10548.
- **They are excluded from every statistic**, unconditionally. A restart score is
  whatever you had accumulated when you bailed - there is no reading of the data
  where including it is correct. **40 were found across your 21,635 runs**, which
  means they have been quietly dragging your floor down until now.
- **They are counted in the session panel** instead: "32 runs +3 restarts", with
  the longest streak beside it.
- **STOP CHASING RNG PBs** fires when you restart more than 5 times in a row
  without finishing a run, or more than 5 times per completed run over a session.
  Tonight's 3 restarts across 32 runs does not trigger it, which is correct.
- The threshold is **exactly zero seconds** and that was measured, not guessed:
  40 runs sit at 0s, then 294 at 1s and 270 at 2s - and those are real NeverMiss
  runs that ended on the first miss. A +-2s window would have deleted 743 real runs.

### Release isolation

- **`Cache-Control: no-store` on everything**, not just the API. `core.js` was
  served with only `Last-Modified`, so browsers cached it heuristically - and
  since releases were numbered from 8801 in every copy of the project, two
  different builds on two drives shared an origin *and its cache*. That is why an
  old build appeared to have new features.
- **Ports are derived from the version string**, so one origin means exactly one
  build on every machine, forever.
- **localStorage keys carry the build** (`kva_break@0.1.0`), with the previous
  build's value inherited on first run so an update never resets your settings.
- **`python release.py --verify`** prints every release's port, build hash and
  core.js hash, plus a per-function hash of the statistics path that says which
  calculation last changed and in which release. It also warns if any two builds
  share a port.
- The footer build stamp now carries the content hash: `build 0.1.0 · a1b2c3 · port 41337`.

### Fixes and additions

- **The folder dialog no longer dies without tkinter.** Your Python has no
  tkinter at all, so the button just errored. It now falls back to the Windows
  folder browser via PowerShell, which is part of the OS and works regardless of
  how Python was built. Pressing Cancel is treated as a choice, not a failure.
- **`?selftest=1`** on any page runs 36 checks over fixed synthetic data with
  expected values worked out from the formulas by hand, and prints a pass/fail
  table. Between that and `--verify`, "did the maths change?" is answerable in
  seconds instead of by reading diffs.
- The parsed-row format gained a column, so the disk cache is now schema-versioned
  and re-reads itself when the parser changes rather than serving stale shapes.

## v0.0.9 - 2026-09-01

**TL;DR - the PB card stops vanishing before you can read it, the cm your record
was set on is finally visible, and the custom date range is three dropdowns you
can scroll both ways instead of a calendar you cannot back out of.**

- **PB card moved under the session panel** - where you are already looking, not
  above the fold. Up for **15 seconds** instead of 3, with **10 seconds of
  confetti** and a **blinking border**. Under `prefers-reduced-motion` the blink
  slows down rather than disappearing, so you still see it.
- **Now playing** line in the session panel with a live dot, naming the scenario
  the watcher last saw, its cm and its score. Goes to "Last played - N min ago"
  once it is stale.
- **Follow current scenario** toggle in the session header. Turn it off and the
  app stops naming what you are playing and stops popping up new-run notices.
  Remembered between sessions.
- **Most played** badge on the cm legend, so on a scenario with eight
  sensitivities you can see at a glance where the volume actually is.
- **PB cm** shown next to the PB value and tagged in the cm legend. Working out
  which sensitivity a record came from used to mean squinting at coloured dots.
- **Scenario cards per page: 20 -> 5.** Each card draws a chart; five is readable,
  twenty is a wall. "Show all" is unchanged.
- **Custom range is now dd/mm/yy dropdowns.** The native calendar drills
  month -> day with no way back once you are picking days. Three plain selects
  scroll in either direction, in any order, and grey out days that do not exist
  in the chosen month - 31 February included, leap years handled.
- **Footer links are real now**: Reflek's, Corpserf dashboard and Kova all point
  somewhere. Personal Kova link on the socials line, X logo linking to
  @OrbEater_, Discord removed.

## v0.0.8 - 2026-09-01

**TL;DR - the charts were lying. Every score chart now scales by how noisy your
scores actually are, instead of stretching whatever variation exists to fill the
frame. A flat month finally looks flat.**

- **No more auto-fit axes.** The y-axis was `min(scores)` to `max(scores)`, which
  is the single biggest source of visual dishonesty in a progress chart: a
  plateau and a real breakthrough rendered identically. The axis is now
  **mean +/- 3.5 sigma**, with a 4%-of-mean floor so a very consistent streak
  cannot collapse it, expanded when needed so no run is ever clipped off.
- **sigma is frozen.** It comes from your last 50 runs on that scenario and is
  held fixed, so switching Window from 30 days to 90 days no longer changes how
  big a given gain looks. Two screenshots a week apart are comparable now.
- **The noise floor is drawn.** Every chart has a shaded **+/-1 sigma band**
  around the rolling median. The reading is immediate: *clearing the band is
  progress, sitting inside the band is a good day.*
- **PB is a step function**, not a smooth line. It is a ratchet - a diagonal
  between two PBs was a claim about runs where nothing happened.
- **Charts are 2:1 instead of 6.6:1.** Slope is judged most accurately when the
  average segment sits near 45 degrees; the old wide, short strip flattened every
  trend it drew.
- **Axis labels and a plain-English scale note** under each chart, saying what
  the mean and sigma are and what the band means.
- **The overall Progress-over-time chart** gets the same treatment, in % units,
  with zero always on the axis.
- **Footer** - Orb Eater did the thinking, Claude did everything else. Socials
  and inspirations, plus a **build stamp** showing which frozen release and port
  you are actually looking at.

Reasoning for all of the above is written up in **CHART-SCALING.md** and
**MEASUREMENT-SPEC.md**, next to CALCULATIONS.md.

## v0.0.7 — 2026-09-01

**TL;DR — session tracking. Turns out you spend far more time in KovaaK's than
actually playing, and now you can see it.**

- **Run durations** are now read from the CSVs (`Challenge Start` vs the file's
  timestamp), found for 99.8% of runs.
- **Session panel**: runs, time in KovaaK's, time actually playing with an
  **active %**, median gap between runs, scenarios touched, and a daily total
  across every session that day.
- **Restart-spam warning** — if the median gap between runs stays under 5s for
  roughly an hour, it says so and suggests longer gaps.
- **Idle nudge** — no completed run for 8+ minutes mid-session gets
  "that's chasing an RNG PB rather than practising".
- **Break reminders, configured by you.** The fixed 1h20 timer is gone. Set a
  run count (default 30) and/or a timer (15/30/45/60 min) — **they fire
  independently**, so the timer keeps running whether you played 5 runs or 50.
  Optional autostart from your first run. Settings persist.

## v0.0.6 — 2026-09-01

**TL;DR — new-score celebrations, tiered so a 2nd-ever run doesn't get confetti.**

- **Tiered achievements** on every new run the watcher picks up:
  - 0 prior runs → **"First score!"**
  - runs 2–5 → **"New highest score"** (no confetti)
  - 5+ prior runs → **"New personal best!"** with confetti, 3 seconds
- **Per-cm bests** use the same tiers: beat your best at 40cm without beating the
  scenario overall and you get **"New 40cm PB!"**. A first-ever run at a new cm
  stays silent — it isn't an achievement.
- Confetti is hand-rolled canvas, no library, works fully offline.
- **Session avg badge** — a blinking "▲ avg up 11.1% this session" on any
  scenario whose average has risen since you started playing it today.
- **Insufficient-baseline banner** in light red on scenario cards, saying roughly
  how many runs are needed — while still showing PB and Avg from current runs.

## v0.0.5 — 2026-09-01

**TL;DR — bug-fix batch. cm list no longer resizes the page, custom date ranges,
and the server stops cluttering your browser.**

- **cm list fixed.** Drag-to-resize is gone (it fought the page layout). Shows 8
  at a time with a "Show all" button.
- **Clicking "Specific" no longer resizes the page.** The cm range/pick controls
  moved out of the filter bar onto their own line, so the bar height never changes.
- **Custom date range** in Window — pick any from/to (e.g. "since January"). It
  gets a previous-window baseline of the same length like any other range.
- **Honest power messaging.** Rather than a scary warning on every view, the app
  now distinguishes the two cases: the pooled headline is usually well-powered
  (±0.9% over 30 days) *because* it pools scenarios, while individual scenarios
  mostly are not. It says so plainly, and warns properly when even the headline
  can't resolve the effect you're after.
- **No more browser tab pile-up.** Restarting the server within 90 minutes won't
  re-open a tab.
- **No "press any key" on clean exit** — the window only stays open on an error.

## v0.0.4 — 2026-09-01

**TL;DR — the percentages are now honest. Most of them turned out not to be
statistically distinguishable from zero, and the app now says so.**

- **PB is no longer a percentage.** `max()` grows with the number of runs you
  play, so "PB increase" was partly measuring how much you played, not how much
  you improved. PB is still shown as a record; the measured ceiling is now the
  90th percentile.
- **Every % now shows a 95% confidence interval** (`+1.0% ± 0.8%`). If the
  interval crosses zero the number is grey instead of green/red, because it
  isn't distinguishable from no change.
- **New metric set:** Ceiling (p90, needs 15 runs), Typical (10% trimmed mean,
  needs 10), Floor (p10, needs 20). Floor previously could be a single bad run.
- **Per-scenario sample-size requirement.** How many runs you need scales with
  the square of that scenario's own spread, so there is no single right minimum.
  Under-powered scenarios now say exactly what's missing: *"needs ~61 runs per
  side at this scenario's spread (9.8%); you have 47."*
- **Warmup is excluded by default.** Measured at **−8.2%** on this data — the
  first 3 runs of a session really are that much worse. Toggleable.
- **Re-familiarisation runs excluded** — the first 5 runs after a 14+ day break
  on a scenario measure rustiness, not skill. Toggleable.
- **cm/360 is now controlled for automatically.** The unit of analysis is the
  scenario × cm-cluster cell, so a change in which sensitivities you played
  can't masquerade as a skill change.
- **Scenario averaging is inverse-variance weighted**, so precise scenarios
  count more than noisy ones without a big scenario drowning out the rest.
- Caveats surface automatically: multiple comparisons, regression to the mean on
  "Recommended to play", and your measured warmup effect.

Not included: anchored baselines ("am I better than in March"). Still rolling-only.

## v0.0.2 / v0.0.3

Folder copies made by hand rather than by `release.py`, so their contents were
never tracked and their `VERSION` files still read `0.0.1`. Treat them as v0.0.1.

## v0.0.1 — 2026-08-31

First frozen release.

- Local Python server: parses the stats folder once (3s), caches it, restarts in
  ~60ms, and watches for new runs live.
- Stats folder picker with Steam auto-detection.
- Consistency page: headline % cards, progress-over-time chart with plain-English
  interpretation, per-scenario cards with run charts.
- cm/360 analysis: level vs change tables, data-driven cm ranges, best/worst cm,
  fast vs slow comparison, favourites.
- Benchmarks page: 216 benchmarks with rank thresholds and weakest-link ranking.
- Simple and full versions of the app.
