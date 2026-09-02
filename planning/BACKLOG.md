# Backlog

Everything requested, in the order I plan to build it. Each batch becomes one
release with its own CHANGELOG entry.

Status: `[ ]` todo · `[~]` in progress · `[x]` done (vX.Y.Z) · `[?]` needs a decision from you

**Versioning changed at v0.1.0** (your call): a batch of features now bumps the
MINOR digit, a fix between batches bumps PATCH. So Batch 7 is v0.2.0, not
v0.1.1 — not 0.0.10, 0.0.11. Nothing already released was renumbered.
`python release.py` defaults to the next minor; `--patch` for a fix.

**Unshipped batches no longer carry a version number.** They used to, and it went
stale every time something unplanned shipped between them — Batch 9 was promised
v0.4.0 while v0.4.0 and v0.5.0 were both taken by work that was not on this list.
**The batch numbers are stable and mean the plan order**; the version is assigned
when the batch actually ships. Batch 9 is still Batch 9.

**How to answer me.** Anything I need a decision on ends with a bare **`=`** on
its own. Type your answer after it and I will pick it up next session — no need
to reply in chat. Anything without a trailing `=` is mine to get on with.

**More than one Claude session works on this folder.** They share the filesystem
and git but *not* their conversations, so this file is the only handover between
them — and it can go stale when another session ships something without updating
it. Before trusting a question here, check reality: `git log --oneline`,
`git remote -v`, `ls releases/`. That is how the GitHub question below ended up
describing work that had already been done.

---

## Shipped

### Batch 1 — bugs and fixes → v0.0.5
- [x] cm list: drop scroll/resize, show 8 at a time + "Show all"
- [x] "Specific" must not resize the whole page
- [x] Stop opening a new browser tab on every server start
- [x] Remove the "press any key" pause on clean exit
- [x] Custom date range in Window, with under-powered warning
- [x] New release folder per batch (`release.py` auto-increments)

### Batch 2 — PB and progress feedback → v0.0.6
| Prior runs | Message | Confetti |
|---|---|---|
| 0 | **First score!** | no |
| 1–4 | **New highest score** | no |
| 5+ | **New personal best!** | yes, 3s |

- [x] Tiered PB detection, incl. per-cm variant ("New 40cm PB!")
- [x] Confetti + congrats card
- [x] Avg-increase notice for the rest of the session
- [x] Insufficient-baseline banner that still shows the %

### Batch 3 — session tracking → v0.0.7
- [x] Session panel: gaps, total time, active %, daily total
- [x] Restart-spam warning · idle nudge at 8 min
- [x] Break reminders configured by you (runs and/or timer, independent)
- [x] Count run resets — unblocked once you enabled "log every run"; shipped v0.1.0

### Batch 4 — honest chart scaling + footer → v0.0.8 ⭐ nr1 priority
Reasoning: [CHART-SCALING.md](../CHART-SCALING.md), [MEASUREMENT-SPEC.md](../MEASUREMENT-SPEC.md).
Source PDFs extracted to `planning/source-docs/`.

- [x] Kill auto-fit y-axis; scale to mean ± 3.5σ with a 4%-of-mean floor
- [x] σ from a fixed trailing 50 runs, held across Window changes
- [x] ±1σ noise-floor band + raw run dots on every score chart
- [x] PB drawn as a step function
- [x] Plot area 2:1 instead of 6.6:1
- [x] Axis labels + plain-English scale note
- [x] Same treatment on the overall Progress-over-time chart (% units, zero on axis)
- [x] Footer: credit, socials, inspirations
- [x] Build stamp in footer (which release + port you are looking at)

### Batch 5 — quick wins → v0.0.9
- [x] PB card moved under the session panel, 3s → **15s**, confetti 3s → **10s**
      and **blinking** (slowed, not removed, under `prefers-reduced-motion`)
- [x] **Now playing / last played** line in the session panel, live dot while recent
- [x] **Follow current scenario** toggle — off stops the panel naming what you
      play and stops new-run notices popping up. Remembered.
- [x] **Most played** badge on the cm legend when a scenario has several cms
- [x] **PB cm** shown next to the PB value and tagged in the cm legend
- [x] Scenario cards per page 20 → **5**; "Show all" unchanged
- [x] Custom range is now **dd/mm/yy dropdowns** instead of a native calendar —
      scroll both directions, any order, invalid days greyed out (31 Feb, leap years)
- [x] Footer: real links for Reflek's, Corpserf dashboard and Kova; personal Kova
      link on the socials line; X logo linking to @OrbEater_; Discord removed

---

### Batch 6 — the three reported problems + run resets → v0.1.0

### 6.1 Folder dialog crashes without tkinter
> *"Could not open a folder dialog (No module named 'tkinter'). Paste the path instead."*

Your Python (`AppData\Roaming\Smoothie\bin\python.exe`, 3.8.10) was built without
tkinter. `native_pick_folder()` has no fallback, so the button dies.

- [x] PowerShell fallback: `System.Windows.Forms.FolderBrowserDialog` via
      `powershell -NoProfile -STA -Command …`. Present on every Windows box,
      no dependency on the Python build.
- [~] `comdlg32`/`shell32` COM fallback via `ctypes` — not needed yet; the
      PowerShell path works on this machine. Add it if a box turns up without
      PowerShell.
- [x] If both fail, keep the paste box but stop calling it an error — it works fine

### 6.2 Release isolation — "0.0.2 has updates 0.0.7 has"
**Diagnosed, evidence below. The files on disk are fine; the browser is the leak.**

What `release.py` actually gathers (answering the question directly): `server.py`,
`start.bat`, `CHANGELOG.md`, `CALCULATIONS.md`, and the whole `app/` folder
(`core.js`, `styles.css`, `index.html`, `simple.html`, `data/benchmarks.json`).
It skips `cache/`, `logs/`, `releases/`, `config.json`, then writes a fresh
`config.json`, a `VERSION` file, and `WHATS-NEW.txt`. Nothing is shared with the
working copy afterwards.

Verified: `core.js` is 71,445 / 90,610 / 94,665 / 100,863 / 109,685 bytes across
v0.0.2 / v0.0.4 / v0.0.5 / v0.0.6 / v0.0.7. They really are different builds.

**So why did an old build show new behaviour?** Two shared-origin leaks:

1. **Browser cache.** `core.js` is served with `Last-Modified` and **no
   `Cache-Control`** (confirmed by fetching the headers). Browsers then apply
   heuristic caching. `release.py` hands out ports by "next free slot", so the
   *first* release on any drive gets 8801, the second 8802, and so on. Two
   different builds on two drives therefore share the origin
   `http://127.0.0.1:8801` — and the browser serves whichever `core.js` it
   cached for that origin, regardless of which folder's server is running.
2. **localStorage.** `kva_break` and `kva_favcms` are keyed by origin too, so
   break settings and favourite cms leak between any two builds sharing a port.

Fix:
- [x] `Cache-Control: no-store` on every app asset (HTML/JS/CSS), not just `/api/*`
- [x] Port derived deterministically from the version string, not from a free-slot
      scan, so two builds can never collide on one origin
- [x] Namespace localStorage keys with the build version (`kva_break@0.1.0`),
      inheriting the previous build's value on first run
- [x] `release.py --verify` — build hash, core.js hash and a per-function hash of
      the statistics path, naming which calculation last changed and where
- [x] Build stamp in the footer *(shipped in v0.0.8 — the diagnostic half)*

### 6.3 "Stats calculation seems to have changed since last batch"
**Checked. It did not.** Byte-identical across v0.0.6 → v0.0.7 → working copy:
`stats`, `computeCells`, `overallOf`, `changeWithSE`, `annotateRuns`, `runUsable`,
`quantileAt`, `trimmedMean`, `requiredN`, `computeTrends`, `computeTrendSeries`,
`computeCmClusters`, `getActivePool`, and the entire `TUNING` block. The only new
function in v0.0.7 is `buildSessions`, which feeds the session panel and nothing
in the statistics path.

The numbers move because the **data** moves — the default Window is 30 days, so
every new session shifts both the window and its baseline. That is the metric
working, not drifting.

- [x] `?selftest=1` on any page: 36 checks over fixed synthetic data, expected
      values derived from the formulas by hand. Verified to catch a 0.1% drift.
- [ ] Work through the [MEASUREMENT-SPEC.md §10 gap list](../MEASUREMENT-SPEC.md)

---

### 6.4 Run resets — detected, excluded, counted

Your answer: *"It's on now, I've done multiple resets. See if there's any way to
know besides score if it's a reset or not."*

**There is.** On a restart, KovaaK's stamps the file with the *new* challenge's
start time, so the run measures zero elapsed seconds. Full write-up in `NOTES.md`
under "Run resets"; the threshold was measured against all 21,635 runs rather
than guessed, because a ±2s window would have deleted 743 genuine NeverMiss runs.

- [x] Detect restarts structurally (`run_timing` in server.py)
- [x] Keep them out of every statistic, unconditionally
- [x] Count them in the session panel, with the longest streak
- [x] "STOP CHASING RNG PBs" at >5 in a row, or >5 per completed run
- [ ] Optional toggle to *show* restarts in the runs list for inspection —
      currently they are simply invisible outside the session panel. Worth it?
      =

### Batch 7 — zero-score runs, declutter toggles, installer, GitHub → v0.2.0
- [x] **Zero-score runs visible but never counted.** v0.1.0 hid every
      zero-length run as a restart; a NeverMiss 0 is a real run. Split into
      `runVisible` (did you play it — only restarts fail, 5 total) and
      `runUsable` (may it enter a %, adds `score > 0`, 176 excluded).
- [x] Zeros drawn as hollow marks on the axis floor, out of the scale/band/lines
- [x] `+N scored 0` on the scenario header
- [x] Chart end labels spread to a minimum gap with leader lines, in the
      right-hand margin that was empty
- [x] "How to read this" panel gets a wider column and larger text
- [x] **Show explanation** toggle on the Window / Compare-vs paragraph
- [x] **Show figure explanation** toggle on the headline caveats
- [x] "Follow current scenario" hides with the session panel
- [x] Footer credit reads **Corporate Serf Dashboard** (its actual name)
- [x] `NOTES.md` no longer implies the malformed benchmark JSON was *repaired* —
      it was edited until it parsed, and ~30 scenarios were lost
- [x] **`install.bat`** — finds or winget-installs Python, Desktop + Start Menu
      shortcuts. Not required to run the app.
- [x] Git repository prepared, `.gitignore` keeps `config.json` (your stats
      folder path) and `releases/` out; tagged `v0.2.0`
- [ ] **Push to GitHub** — needs `gh auth login` from you; see below

### v0.2.1 — folder picker fix (patch, between batches)
Reported: *"windows still doesn't open up the file explorer to choose what
kovaaks folder to pick."*

**It was opening one the whole time — behind the browser.** The PowerShell call
blocked for a full 12-second test, so a window really was up and waiting; it just
had nothing to sit in front of, and Windows will not let a background process
take focus.

- [x] Own the dialog with a hidden 1x1 off-screen `WS_EX_TOPMOST` window.
      Verified on screen: visible, topmost, 960x480 at (0,0), correct title.
- [x] Use the **real Explorer window** — `IFileOpenDialog` + `FOS_PICKFOLDERS`
      via ctypes, no subprocess. PowerShell's tree widget drops to second,
      tkinter to third.
- [x] Fix the PowerShell fallback too: its owner Form is `Show()`n first, since
      an unshown Form has no handle and `TopMost` silently did nothing.
- [x] Page narrates the wait — button disables, escalates at 6s ("check behind
      this window") and 25s (offer the paste box); Cancel says so.
- [x] Dialog timeout 310s → 150s, so an unseen dialog cannot wedge the request.
- [x] Tested through `POST /api/browse` with the dialog auto-cancelled, plus the
      all-pickers-fail and picker-succeeds paths.

---

### Batch 8 — the rest of the UI declutter → v0.3.0

Your words: *"We need to remove all the text clutter everywhere."*

- [x] **Icons instead of paragraphs.** Beside each scenario name: an ℹ️ info icon
      and, when relevant, a ⚠️ alarm icon. Text appears on hover/focus (native
      `title`, same convention as the cm swatches). Replaces the "Not enough
      baseline yet…" block — the ℹ️ only shows when a % on that card actually used
      the early-baseline fallback below.
- [x] **Rewrite the under-powered message.** Now a ⚠️ whose tooltip says only the
      concrete thing: how many more comparable runs per side, and roughly how many
      days at your recent pace (window runs ÷ window span).
- [x] **Always show progress %.** `earlyBaseline()`: when a cell's real baseline
      period is too thin, falls back to its first `EARLY_BASELINE_N` (5) runs ever
      as a standing reference — point estimate only, no CI, tagged **early**.
      Applied to the scenario cards' ceiling/typical/floor *and* the by-cm
      avg/pb-change tables. Still shows `—` when the *window* side itself lacks
      enough runs — this only fixes the "no earlier period" case. See
      [CALCULATIONS.md §2b](../CALCULATIONS.md).
- [x] **Expand a scenario** from a control in its top-right corner: larger text and
      a wider chart (CSS-only — the chart's viewBox already scales). The cm chips
      are clickable independent of expand — click one to set the app's Specific-cm
      filter to that value.
      *It turned out not to be enough, and you reported it: applying the global
      filter meant one click on one scenario re-filtered every other scenario on
      the page. Card-scoped filtering shipped in **v0.5.0** — see below.*
- [x] **Hide the 0.0% session badge.** Suppressed whenever the figure would round
      to 0.0% (`|Δ| < 0.05`); falls back to the avg-up % at the cm/360 you're
      currently playing (tracked the same way, per-cm) when *that* figure is
      itself non-zero. Shows nothing when both are flat.
- [x] **Popup over the session panel when active play is under 40%.** Fires once
      per session (a dismissible box like the break reminder), gated on the
      session being at least 10 minutes long so a two-run session doesn't read as
      "idle" from one long gap.

### Not on the plan — Scenario testing → v0.4.0

Requested mid-flight, shipped ahead of Batch 9. Full detail in `CHANGELOG.md`.

- [x] Benchmarks tab renamed **Scenario testing**, carrying Viscose Benchmarks
      S2 (Medium / Hard / Expert, 39 scenarios each). matty rank dropped.
- [x] Dev stats folder moved to `L:\Claude\Kovaaks Folder\stats`.
- [x] One-time "turn on Log every run" offer; restart counter hidden while the
      setting is off rather than showing a permanent zero.

### Not on the plan — the cm chip fix, card sizes, effects lab → v0.5.0

- [x] **cm chips filter only the card you clicked** (your report: *"it changes
      every scenario view. It should be a toggle and only change for that
      scenario"*). A per-card toggle held in `scenCm`; the pinned card is
      **recomputed** through `computeTrends()` on that cm's runs rather than
      having its numbers patched, so the CIs, the power check, the baseline and
      the chart's sigma all move with it. The chips themselves are built from
      the *unfiltered* runs, or pinning would delete the way back out.
- [x] **Expanded is the default** for every scenario card — the button was being
      pressed every time.
- [x] **Full width** in its place: one card breaks out to 1920px, numbers beside
      the chart. The chart keeps its 2:1 aspect (CHART-SCALING.md) and is capped
      by viewport height, so it cannot end up taller than the screen.
- [x] **Effects lab** at `app/lab.html` — fire the confetti, every celebration
      tier, the break reminder, the idle nudge, the low-active popup, the
      restart-spam alert and the live "just played" note on demand, against
      seeded synthetic runs. It loads `core.js` and calls the real functions;
      nothing is reimplemented, because a copy drifts and then you are tuning
      something the app does not do. Linked from the footer on dev builds only.
- [x] Six new self-test checks pinning the chip fix. 42 total.

### Batch 9 — layout, calendar and readable explanations → v0.6.0

- [x] Page widened: cap **1180px → 2560px**. Fills a 1920 monitor, fills a 2560
      one, stops there. 1200px verified usable; 5120 still later. — *v0.6.0*
- [x] **Top-left menu bar**: Icon meanings, Calculation and reasoning, Month
      calendar. — *v0.6.0*
- [x] **Month calendar**, this month + 4 previous, **Typical (trimmed mean) only**
      against the month before, with a per-day strip. — *v0.6.0*
- [x] Fun facts: **"X new scenarios tried!"** and a PB count, both counted over
      every run played rather than the filtered pool. — *v0.6.0*
- [x] **Session panel moved to the right side** (two columns above 1500px, both
      inline below it). — *v0.6.0*
- [x] **Live "Time in KovaaK's"** — ticks from the PC clock, re-validates against
      the run history every minute, stops at the session gap. — *v0.6.0*
- [x] **Notifications became an overlay** above the page rather than divs in the
      flow, and **PB confetti went full screen**. — *v0.6.0*
- [x] **Sessions split at 30 minutes** instead of 60, with same-day sittings
      keeping the break between them. — *v0.6.0*
- [x] **Reference drawer**: one yellow warning symbol per card, opening a panel
      with that scenario's caveats, plus the icon key and the reasoning. Replaces
      the 12px hover text. — *v0.6.0*

### Batch 10 — score-by-cm analysis → v0.7.0

Rules live in **`app/data/categories.md`** as plain text so you can edit them
without touching code. *(Moved there from `planning/scenario-analysis/`, which is
not copied into a release — the feature would have been dead in every build you
actually run.)*

> Corporate Serf Dashboard does a sensitivity-vs-score plot per scenario. **It is
> AGPL-3.0** — copying any of it would force this project to AGPL too. Nothing has
> been taken from it; only the public feature description was read.

- [x] Per-scenario **"Score by cm"** toggle, with a 95% interval on every level
      and the run count under each. — *v0.7.0*
- [x] **Category picker** built from the headings in the rules file, so adding a
      heading adds an option. Remembered per scenario; a guess from the name is
      offered and labelled as a guess. — *v0.7.0*
- [x] **The written rules are applied.** Templates are never shown; a condition
      the app cannot evaluate is reported back with the list of ones that work,
      rather than silently never firing. — *v0.7.0*
- [x] **Extremes (<25cm, >80cm) excluded by default**, toggleable. — *v0.7.0*
- [x] **"Work in progress" disclaimer** pointing at the baseline page, plus a
      "Score by cm" page in the reference drawer. — *v0.7.0*
- [x] **Both confounds handled out loud**: levels under 10 runs are not drawn or
      used, and levels played in different weeks are called out with the gap in
      days. — *v0.7.0*

**Your rules file is still mostly a template.** Static Clicking / Micro has 2
rules, Control Paradise has 4 (one of which uses "scores fall toward 20cm", which
is prose rather than a condition and is reported as not evaluated). Everything
else is empty and says so in the picker. The conditions available are documented
in a table at the top of the file.

### v0.7.1 — six fixes between batches

Reported 2026-09-01 with a screenshot of the `cloverRawControl Viscose 50cm`
card. All six are done and verified in the browser.

- [x] **Celebrations moved to the centre of the viewport.** Second toast layer
      (`#toastCenter`), `position:fixed`, so it is the centre of what you are
      looking at rather than of the document. — *v0.7.1*
- [x] **Confetti only for a scenario PB.** A cm-scoped best still gets a centred
      card, without confetti — you have as many of those as you have
      sensitivities. — *v0.7.1*
- [x] **"Just played" notification removed.** The session panel already shows
      the scenario, the cm and the score, permanently and without needing to be
      dismissed. — *v0.7.1*
- [x] **Sort: "Most data (tightest measurement)".** Sorts by the width of the
      95% interval, not by run count — 200 runs over six sensitivities can
      measure less than 40 at one. Unmeasurable rows fall to the bottom. — *v0.7.1*
- [x] **A missing "vs baseline" now says why.** Was reported as *"fault in
      program?"* and was not one: 16 runs split over 7 cm bands, with only 10
      paired in the fullest band, cannot fill a 15-per-side ceiling comparison.
      The defect was the silence. The dash now carries the reason on hover, the
      card carries a ⚠, and the drawer lists which figures are affected. — *v0.7.1*
- [x] **Hover any dot on a chart** for score, date, time, cm, duration, run
      number, PB-at-the-time and comparison to typical. Nearest-neighbour inside
      a ~26px grab radius (the marks stay 2px), ~45ms rather than a second. — *v0.7.1*
- [x] **`HANDOFF.md` is no longer published.** Added to `.gitignore` and
      untracked. It stays on disk, stays current, and stops going to GitHub.
      **Note:** it is already present in the history pushed to `origin/master`
      — untracking stops *future* updates, it does not erase the copy already
      there. Removing that would need a history rewrite and a force-push, which
      has not been done. — *v0.7.1*

### v0.7.2 — three more fixes between batches

Reported 2026-09-01, on top of v0.7.1. All three are done and verified in the
browser.

- [x] **Full width is now the only scenario-card layout.** The per-card
      toggle is gone; every card renders chart-left, metrics-right, up to
      1920px, unconditionally — same treatment `.scen-expanded` got. — *v0.7.2*
- [x] **Sort dropdown reordered**: Recently played, Most data, Most played,
      Biggest gain, Recommended to play, Least consistent, Longest since
      played, Name. Since the sort choice isn't persisted, this also changes
      the page's default sort on load, from Most played to Recently played.
      — *v0.7.2*
- [x] **`HANDOFF.md` moved to `L:\Claude\HANDOFF.md`**, outside the repo
      folder, instead of being `.gitignore`d from inside it — a structural
      guarantee rather than a convention. `release.py` and `publish.py` no
      longer reference it. — *v0.7.2*

## Batch 11 — updater, error logging, folder tidy-up, raw data export

Was "Batch 14"; promoted to Batch 11 on 2026-09-02 when the old Batch
11/12/13 were parked (see "Future plans" below) until the app is otherwise
finished. Built and verified 2026-09-02.

- [x] **Auto-updater.** New `updater.py`, run by `start.bat` before
      `server.py` launches. Checks the `beta` release via the GitHub API
      (~5s timeout), backs up `internal\` to `internal.bak\` before applying,
      verifies the downloaded zip with `zipfile.testzip()`, and rolls back
      from the backup on any mid-apply failure. Refuses to run against the
      dev checkout (`VERSION` missing). Handles both the new nested
      (`internal/`) and the still-live flat zip layout on the download side,
      always merging into `internal\` on disk. Toggleable via
      `auto_update` in `config.json` (on by default). Verified: dev-mode
      refusal, a real update round-trip (flat beta zip → nested install,
      `config.json`/port preserved), a corrupted-zip abort, and a
      mid-copy failure rolling back cleanly.
- [x] **Error logging for `install.bat`/`start.bat`.** Both scripts append
      timestamped checkpoints to `internal\logs\install.log` /
      `internal\logs\start.log` (script start, each Python-detection step,
      the resolved Python command, exit codes). `server.py`'s own `main()`
      now also writes to `logs\server.log` (start/version, stats-folder
      usability, port conflicts, serving URL, stop).
- [x] **Tidy the release folder.** `release.py` now nests everything except
      `install.bat`/`start.bat` under `internal\` in every frozen release;
      the working copy stays flat. New `RELEASE_ROOT` in `server.py` lets
      user-facing output (the export folder below) land at the top level
      regardless of which layout is running.
- [x] **Per-scenario raw data export tab.** "Export data" button next to
      "Score by cm" on each scenario card, builds a two-section CSV (runs +
      every calculated figure shown on the card) client-side and POSTs it to
      a new `/api/export` endpoint, which writes it to
      `SCENARIO DATA EXPORT/<scenario>.csv` at the release root.
- [ ] **Real beta round-trip, not yet done.** Every updater test so far went
      old-flat-beta (the one actually published on GitHub) → new-nested-local
      (a frozen copy of this working tree). Nobody has published a beta built
      from this new nested `release.py` output yet, so a genuine
      post-Batch-11 → post-Batch-11 update has never actually run. Needs one
      `release.py` + `publish.py --beta` round-trip before this ships to you
      for real.

---

## Open questions

Every one of these ends in a bare **`=`**. Write your answer after it; I read them
at the start of the next session. Answered ones move to *Answered* at the bottom.

*(none open right now)*

---

## Future plans — after the app is otherwise finished

Renamed and parked here 2026-09-02: real, planned work, just not near-term.
**Do not raise these unprompted or ask about them each session** — they stay
here until Orb Eater says to pull one back into the active batch list.

### Playlist API update *(was Batch 11 — baseline page, benchmarks and imports)*

Scenario list is a plain document in `planning/baseline/scenarios.md`.

✅ **Fixed in v0.4.0.** The bundled Viscose S2 Medium used to have 9 of its 39
scenarios — its source JSON was malformed and was edited until it parsed, which
made it *readable*, not *correct*, losing ~30 scenarios. It is gone. All three
shipped difficulties now come from your CSV export with 39 scenarios each.

- [ ] Baseline page with curated scenarios per category
- [ ] Two run-requirement tiers (quick check vs full skill map)
- [ ] **Minimum run count per scenario** before Viscose struggles are called out
- [ ] Scenario missing from your history → say to play it (or that the name is a typo)
- [ ] Overall skill representation from PB / avg% / low avg% / volume
- [ ] Strengths and weaknesses summary — **use z-scores, not % change**
      ([CHART-SCALING.md §7](../CHART-SCALING.md))
- [ ] Baseline cm set to 45–50cm for now
- [x] **Renamed the Benchmarks tab to "Scenario testing"** — *v0.4.0*
- [x] **Viscose S2 Medium/Hard/Expert ingested**, matty dropped, 39 scenarios
      each. Built by `planning/viscose-import.py`. — *v0.4.0*
- [ ] **Scenario testing overhaul — deferred, and out of scope for the GitHub
      release.** Your call, 2026-09-01: it gets its own plan later and does not
      hold anything up. The rename and the Viscose S2 data are in place; nothing
      else here waits on it. **2026-09-02:** Claude Design is putting together a
      mockup for this — we don't build anything here until that lands.
- [ ] **Playlist import via share code** (e.g. `KovaaKsPlunderingOlivegreenClutch`).
      Outbound API calls are approved, so this resolves server-side against
      KovaaK's rather than needing an offline export. First feature to make a
      network call — the README's privacy wording was updated to match, and it
      must stay true: run data still never leaves the machine.

### Comparison tools *(was Batch 12 — timeframe comparison tools)*

- [ ] Compare an arbitrary timeframe against the baseline sitting behind it
- [ ] Compare month X vs the previous month
- [ ] Compare month X vs month Y (any two)
- [ ] Label each window **Form / Trend (estimated) / Change vs baseline** per
      [MEASUREMENT-SPEC.md §7](../MEASUREMENT-SPEC.md) — the 7-day view must stop
      using the word "improvement"

### ADHD mode update *(was Batch 13 — personal calibration and ADHD mode)*

- [ ] **Warm-up calibration on first launch.** `WARMUP_DROP: 2` is a guess, and
      the spec says time constants for this task are unknown and must be estimated
      from the user's own data. Fit `tau` from
      `score(i) = P·(1 − e^(−i/tau)) − f·max(0, i − i_fatigue)`
      ([MEASUREMENT-SPEC.md §4.4](../MEASUREMENT-SPEC.md)) once, on install, and
      cache it. One person is warm after 5 runs, another after 20.
- [ ] **ADHD mode toggle.** Watch the gaps between runs. If the first 3–5 runs
      average 2–5 minutes apart, notify. Keep notifying with a popup for as long
      as gaps stay over 2 minutes. Stays on until turned off.

---

## Answered

- **GitHub push timing, overridden** → the standing "push once Batches 9–13 are
  all done" rule was set aside once, 2026-09-02: pushed everything sitting
  local at the time (`master` + tags v0.4.0–v0.7.2) instead of waiting.
  v0.7.2 also published as GitHub `beta` (pre-release); v0.3.1 stays `base`
  ("Latest") until promoted. The rule itself isn't repealed — it applies again
  from here unless told otherwise.
- **Dev stats folder** → moved to `L:\Claude\Kovaaks Folder\stats` (21,453 runs).
- **Log-every-run suggestion** → yes, shown once when the setting is off, with the
  clutter trade-off stated; dismissed forever with one click; remembered per
  build. The restart counter is hidden entirely while the setting is off, rather
  than showing a permanent zero. *v0.4.0.*
- **Viscose difficulties** → **Medium, Hard, Expert**. Easier not shipped. Matty
  rank dropped. Benchmarks tab renamed **Scenario testing**. *v0.4.0.*

- **Push + publish** → done 2026-09-01. `master` and all four tags are on
  `Orb-Eater/kovaaks-stats` (private). **v0.3.1 published as `base`** —
  `kovaaks-stats-0.3.1.zip`, 216 KB, verified by downloading it back and running
  it. Nothing on `beta` yet; the next feature release goes there.

- **Calendar metric** → **Typical (trimmed mean) change** per month, plus fun
  facts: new scenarios tried (0 runs before the month, >=1 during), PB count,
  avg %. *Batch 9.*
- **Viscose "matty" rank** → ignore it. The new files **replace the whole
  benchmark dataset**, and the Benchmarks tab becomes **"Scenario testing"**.
  *Batch 11.*
- **API calls** → allowed. Playlist share codes resolve server-side against
  KovaaK's; no offline export needed. Privacy wording in README/HANDOFF corrected
  to the claim that is actually true: run data never leaves the machine.
- **Restarts in the runs list** → no. Own counter in the side space, shown only
  when "log every run" is enabled. *Batch 9.*
- **Licence** → **MIT**, `LICENSE` written. Keeps the credit, no warranty,
  anyone may use or fork it.
- **Releases must not carry a personal stats folder** → `release.py` now writes a
  blank one, and the path was cleared from v0.2.1 and v0.3.0. Published zips are
  blanked again on the way out.
- **GitHub repo** → created private as `Orb-Eater/kovaaks-stats` by a separate
  session. Push work is on hold above.
- **X.com handle** → `https://x.com/OrbEater_`, X logo, clickable. *v0.0.9.*
- **Site width** → 1920 default, 2560 cap now, 5120 eventually. **Shipped in
  v0.6.0** along with the session bar moving to the right side, which only made
  sense once the page was wide enough to have a right side.
- **GitHub push timing** → push once every currently planned batch (9–13) is
  finished. Recorded as a standing instruction, 2026-09-01.
- **Notifications** → an overlay above the page, like a cookie banner, not part
  of the layout. **PB confetti** → full screen. *v0.6.0.*
- **Session gap** → 30 minutes, and same-day sittings keep the break between
  them rather than being merged or forgotten. *v0.6.0.*
- **Versioning** → batch = MINOR bump. *v0.1.0.* 0.1.0 -> 0.2.0, **not** 0.0.10.
- **Confetti** → PB after 5+ prior runs, 10s, blinking. *v0.0.9.*
- **Run resets** → detectable without score; excluded from the graph, counted in
  the session panel, RNG warning above 5. *v0.1.0.*
- **NeverMiss zeros** → keep visible, keep out of the %. *v0.2.0.*
- **Folder picker** → it was opening behind the browser; now a topmost-owned real
  Explorer window. *v0.2.1.*
- **ADHD mode wording** → "START FOCUSING ON KOVAAK'S AND STOP BEING ON TIKTOK".
  *Batch 13.*
- **Benchmark JSON** → the malformed `STS 2 - Pokeball & Flicker.json` was never
  repaired, only made parseable; ~30 scenarios were lost. The Viscose replacement
  retires it.
