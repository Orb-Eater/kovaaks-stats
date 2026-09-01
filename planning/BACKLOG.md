# Backlog

Everything requested, in the order I plan to build it. Each batch becomes one
release with its own CHANGELOG entry.

Status: `[ ]` todo · `[~]` in progress · `[x]` done (vX.Y.Z) · `[?]` needs a decision from you

**Versioning changed at v0.1.0** (your call): a batch of features now bumps the
MINOR digit, a fix between batches bumps PATCH. So Batch 7 is v0.2.0, not
v0.1.1 — not 0.0.10, 0.0.11. Nothing already released was renumbered.
`python release.py` defaults to the next minor; `--patch` for a fix.

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
      *Chip-click applies the existing global Specific-cm filter rather than a
      card-scoped one — reuses the already-tested filtering path instead of a
      parallel per-card stats system. [MEASUREMENT-SPEC.md §10 gap 13](../MEASUREMENT-SPEC.md)
      /[CHART-SCALING.md §8](../CHART-SCALING.md)'s true per-card cm filtering is
      still open if that turns out not to be enough.*
- [x] **Hide the 0.0% session badge.** Suppressed whenever the figure would round
      to 0.0% (`|Δ| < 0.05`); falls back to the avg-up % at the cm/360 you're
      currently playing (tracked the same way, per-cm) when *that* figure is
      itself non-zero. Shows nothing when both are flat.
- [x] **Popup over the session panel when active play is under 40%.** Fires once
      per session (a dismissible box like the break reminder), gated on the
      session being at least 10 minutes long so a two-run session doesn't read as
      "idle" from one long gap.

## Batch 9 — layout and calendar → v0.4.0

- [ ] **Restart counter in the side space** (your answer: not in the runs list).
      Its own small readout, and **only rendered when "log every run" is on in
      KovaaK's** — with the setting off no restart ever reaches the stats folder,
      so a permanent "0 restarts" would be a lie rather than a measurement.
      Detect it the same way the count works: if the history contains any
      zero-length scored run, the setting is on.

- [ ] Widen the page: **1920px default, 2560px cap** (your answer). Current cap is
      1180px. 1200px must stay usable; **5120px full support eventually**.
- [ ] **Top menu bar** so 1200px users can still reach the calendar view.
- [ ] **Month calendar** in the newly free side space: current month + the 4
      previous. Per month, **Typical (trimmed mean) change only** — Ceiling and
      Floor need more runs than one month usually holds, so showing them would be
      three numbers where only one is trustworthy.
- [ ] Alongside it, the fun facts: **"X new scenarios tried!"** — scenarios with
      **0 runs before that month and >=1 during it** — plus a PB count and the
      avg %.
- [ ] **Session bar moves to the right side.**
- [ ] **Live "Time in KovaaK's".** Today it only updates when a run lands. Tick it
      from the PC clock and re-validate against the last run once a minute.

## Batch 10 — score-by-cm analysis → v0.5.0

Rules live in `planning/scenario-analysis/categories.md` as plain text so you can
edit them without touching code.

> Corporate Serf Dashboard does a sensitivity-vs-score plot per scenario. **It is
> AGPL-3.0** — copying any of it would force this project to AGPL too. Nothing has
> been taken from it; only the public feature description was read.

- [ ] Per-scenario "score by cm" toggle
- [ ] Category picker (Static/Dynamic Clicking → Micro/Wide/Regular; Control
      Tracking; Smoothness; Reactive) with sub-options
- [ ] Apply the written interpretation logic per category
- [ ] Extremes (<25cm, >80cm) excluded by default, toggleable
- [ ] "Work in progress" disclaimer pointing at the baseline page

## Batch 11 — baseline page, benchmarks and imports → v0.6.0

Scenario list is a plain document in `planning/baseline/scenarios.md`.

⚠ Our bundled **Viscose S2 Medium has only 9 of 39 scenarios.** Its source JSON
was malformed and I edited it until it parsed — which made it *readable*, not
*correct*: ~30 scenarios were lost in the process and were never recovered. Do
not treat that file as repaired. Easier / Hard / Expert are complete (39 each).
Your new xlsx/CSV export replaces it.

- [ ] Baseline page with curated scenarios per category
- [ ] Two run-requirement tiers (quick check vs full skill map)
- [ ] **Minimum run count per scenario** before Viscose struggles are called out
- [ ] Scenario missing from your history → say to play it (or that the name is a typo)
- [ ] Overall skill representation from PB / avg% / low avg% / volume
- [ ] Strengths and weaknesses summary — **use z-scores, not % change**
      ([CHART-SCALING.md §7](../CHART-SCALING.md))
- [ ] Baseline cm set to 45–50cm for now
- [ ] **Rename the Benchmarks tab to "Scenario testing"**, holding the Viscose
      benchmarks. The 216 bundled benchmarks are replaced wholesale, not merged.
- [ ] **Viscose raw sheet ingest** from `L:\Claude\Benchmarks\Viscose s2\`
      (xlsx + Easier / Medium / Hard / Expert CSVs). **Ignore the "matty" rank**
      entirely. These replace the whole benchmark dataset, which also retires the
      broken Medium file below.
- [ ] **Playlist import via share code** (e.g. `KovaaKsPlunderingOlivegreenClutch`).
      Outbound API calls are approved, so this resolves server-side against
      KovaaK's rather than needing an offline export. First feature to make a
      network call — the README's privacy wording was updated to match, and it
      must stay true: run data still never leaves the machine.

## Batch 12 — timeframe comparison tools → v0.7.0

- [ ] Compare an arbitrary timeframe against the baseline sitting behind it
- [ ] Compare month X vs the previous month
- [ ] Compare month X vs month Y (any two)
- [ ] Label each window **Form / Trend (estimated) / Change vs baseline** per
      [MEASUREMENT-SPEC.md §7](../MEASUREMENT-SPEC.md) — the 7-day view must stop
      using the word "improvement"

## Batch 13 — personal calibration and ADHD mode → v0.8.0

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

## Open questions

Every one of these ends in a bare **`=`**. Write your answer after it; I read them
at the start of the next session. Answered ones move to *Answered* at the bottom.

- **[?] Nothing is pushed, and pushing is on hold.** The repo exists at
  `https://github.com/Orb-Eater/kovaaks-stats` (private) with the first commits
  up. Still local: `master` is **ahead** by the v0.3.0 and v0.3.1 commits, and
  **no tags are on the remote**. One command sends both when you want it:
  `git push origin master --follow-tags`.
  **Standing instruction from 2026-09-01: do not push without being asked.**
  =

- **[?] Which build is base, which is beta?** `publish.py` is built and ships two
  GitHub releases at a time (see README, "Two downloads, not twenty"). Nothing has
  been published yet. My read of what you said: **v0.3.0 becomes base** once it is
  pushed, and the next feature release becomes beta. Confirm, or name them.
  =

- **[?] Your dev stats folder is `C:\Users\Toms\Downloads\eden csv`** (1500
  runs), set by you at 05:25 on 2026-09-01. Deliberate, or back to Steam? New
  releases no longer inherit it, and I cleared it out of v0.2.1 and v0.3.0, so
  this only affects the working copy at `L:\Claude\KovaaksStats`.
  =

- **[?] What does "log every run" turn into for other people?** The restart
  counter only appears when the setting is on. For someone who has it off, do you
  want the app to *suggest* enabling it (with the caveat that it writes a CSV per
  restart and clutters other tools), or stay silent?
  =

- **[?] Viscose: which difficulties ship?** Easier / Medium / Hard / Expert are
  all in the export. All four, or a subset? And is "Scenario testing" a rename of
  the existing tab or a new page with benchmarks kept somewhere else?
  =

---

## Answered

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
- **Site width** → 1920 default, 2560 cap now, 5120 eventually. *Batch 9.*
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
