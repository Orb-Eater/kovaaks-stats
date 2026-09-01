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

---

## Batch 8 — the rest of the UI declutter → v0.3.0

Your words: *"We need to remove all the text clutter everywhere."*

- [ ] **Icons instead of paragraphs.** Beside each scenario name: an ℹ️ info icon
      and, when relevant, a ⚠️ alarm icon. Text appears on hover, not inline.
      Replaces the "Not enough baseline yet…" block.
- [ ] **Rewrite the under-powered message.** Current text —
      *"Can currently detect a change of about ±? here; you want ±5%. At this
      scenario's spread (12.9%) that needs roughly 105 comparable runs per side —
      you have 0."* — reads as nonsense, partly because `±?` renders when there is
      no CI at all. Replace with a yellow warning icon whose tooltip says only the
      concrete thing: **how many more runs, over what timeframe.**
- [ ] **Always show progress %.** Currently blank when criteria are not met. Show
      it with the warning attached instead. **Baseline = first 5 runs** when there
      is no proper baseline. Same rule per cm.
- [ ] **Expand a scenario** from a control in its top-right corner: everything
      scales up for easier viewing, and the cm chips (already displayed) become
      clickable to filter that scenario to a single cm.
      *This also closes [MEASUREMENT-SPEC.md §10 gap 13](../MEASUREMENT-SPEC.md)
      and [CHART-SCALING.md §8](../CHART-SCALING.md) — per-scenario cm filtering
      is a precondition for the σ band being meaningful.*
- [ ] **Hide the 0.0% session badge.** "▲ avg up 0.1% this session" should not
      render at 0.0%. Show avg-up % for the cm currently being played instead.
- [ ] **Popup over the session panel when active play is under 40%** *(moved here
      from Batch 8 — it belongs with the session panel work)*

## Batch 9 — layout and calendar → v0.4.0

- [ ] Widen the page: **1920px default, 2560px cap** (your answer). Current cap is
      1180px. 1200px must stay usable; **5120px full support eventually**.
- [ ] **Top menu bar** so 1200px users can still reach the calendar view.
- [ ] **Month calendar** in the newly free side space: current month + the 4
      previous, each with the % increase inside that month.
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
- [ ] **Playlist import**
- [ ] **Viscose raw Excel sheet** ingest — [?] need the file and its layout

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

- **[?] GitHub push — needs you.** Everything is committed and tagged locally;
  the only missing piece is authentication, which I must not do on your behalf.
  Two commands, once:

      gh auth login
      gh repo create kovaaks-stats --private --source=. --remote=origin --push

  Run them in `L:\Claude\KovaaksStats`. Repo name `kovaaks-stats` — say if you
  want something else, and whether I should push the tag too (`git push --tags`).
  =

- **[?] Licence.** No LICENSE file yet, which is correct for a private repo but
  matters the day it goes public: with no licence, nobody may legally use or fork
  it. MIT (do what you like, keep the credit) is the usual choice for a tool like
  this. **Not** AGPL — that is Corporate Serf Dashboard's licence, not ours, and
  we have deliberately taken nothing from it.
  =

- **[?] Viscose sheet columns.** Found `L:\Claude\Benchmarks\Viscose s2\`
  (xlsx plus Easier / Medium / Hard / Expert CSVs). The extra **"matty"** rank
  above eclipse — a real rank, or a bonus tier shown separately? And should these
  replace the bundled JSON for Viscose S2, or sit beside it?
  =

- **[?] Playlist share codes.** `KovaaKsPlunderingOlivegreenClutch` is resolved
  server-side by KovaaK's, so supporting it means an outbound HTTP call — which
  breaks the "no network calls" promise the app currently makes. (a) allow one
  clearly-labelled call, only when you paste a code; (b) you export the playlist
  to a file and I read it offline; (c) paste the scenario names. Which?
  =

- **[?] Calendar % metric.** You said "overall increase vs previous month, avg %,
  a count of PBs, and new scenarios played". Still need: is "overall increase"
  the Typical (trimmed mean) change alone, or the same Ceiling/Typical/Floor
  split the cards use? Typical is the only one that survives a single month's
  run count.
  =

- **[?] Show restarts in the runs list?** The 5 real restarts are excluded from
  every statistic and counted in the session panel. Do you also want a toggle
  that *displays* them among the runs?
  =

---

## Answered

- **X.com handle** → `https://x.com/OrbEater_`, X logo, clickable. *v0.0.9.*
- **Site width** → 1920 default, 2560 cap now, 5120 eventually. *Batch 9.*
- **Versioning** → switch now, batch = MINOR bump. *v0.1.0.* Note: 0.1.0 → 0.2.0,
  **not** 0.0.10 — those digits are independent numbers, not decimals.
- **Confetti** → PB after 5+ prior runs, 10s, blinking. *v0.0.9.*
- **Run resets** → detectable without score; excluded from the graph, counted in
  the session panel, RNG warning above 5. *v0.1.0.*
- **NeverMiss zeros** → keep visible, keep out of the %. *v0.2.0.*
- **ADHD mode wording** → "START FOCUSING ON KOVAAK'S AND STOP BEING ON TIKTOK".
  *Batch 13.*
- **Viscose raw sheet** → xlsx + CSV received (unfiltered draft, "matty" rank,
  scenario names out of order). *Batch 11*, follow-up above.
- **Benchmark JSON** → the malformed `STS 2 - Pokeball & Flicker.json` was never
  repaired, only made parseable; ~30 scenarios were lost. Docs corrected.
