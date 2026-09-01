# KovaaK's stats — project notes

Handoff notes so a fresh session (or future you) can pick this up without
re-deriving anything. Written 2026-08-31.

---

## Run it

Double-click **`start.bat`**. It finds a working Python 3.7+, starts the server,
and opens the browser. No install steps beyond Python itself.

`start.bat` probes each Python candidate by actually running it, which filters
out the Microsoft Store placeholder `python.exe` that ships on Windows and only
opens the Store. Order: `py -3`, `python` on PATH, then known install dirs.

Or manually:

```bash
cd L:\Claude\KovaaksStats
python server.py
```

Opens <http://127.0.0.1:8765/>. Ctrl+C to stop.

- `/` — full app (benchmarks, cm/360 analysis)
- `/simple.html` — stripped-back view (headline %s, chart, runs list)

**Choosing the stats folder.** On first launch `config.json` has an empty
`stats_folder`, so the app shows a chooser with (a) any Steam installs it
auto-detected, (b) a **Browse…** button that opens a real OS folder dialog via
the local server, and (c) a paste-the-path box. The choice is saved to
`config.json`, so later launches go straight in. "Change folder" in the header
reopens the chooser at any time.

Why not a normal file input: browsers never hand a page an absolute path, so the
server can't be told where the folder is that way. Hence detection + native
dialog + manual paste.

If you point it at the game/install folder rather than `stats`, it probes
`stats/`, `FPSAimTrainer/stats/` and the full Steam tail automatically.

## Versions / working on updates safely

```bash
python release.py 0.0.1
```

Copies the shipping files into `releases/v0.0.1/`, gives it **a port derived
from the version string** (`20000 + crc32(version) % 40000`) and its own
`config.json`, and writes a `VERSION` file. From then on it is fully independent
— `cache/`, `logs/` and config are per-install, and nothing is shared with the
working copy.

The port is derived rather than handed out because the old scheme gave the
*first* release in any copy of this folder 8801, so two builds on two drives
collided on one origin and shared a cache. See "Release isolation" below.

So: keep using `releases/v0.0.1/start.bat` day to day while editing the working
copy freely. Both can run at the same time (different ports). Verified: an edit
to `app/core.js` in the working copy shows on :8765 and *not* on the release's
port.

The footer shows which one you're looking at — `dev build · port 8765` vs
`v0.0.1 · port …`. **A release starts with no stats folder set**, deliberately:
inheriting the working copy's path baked one person's folder into a build meant
for anyone, and silently overrode a folder the user had already chosen for that
release.

## Layout

```
KovaaksStats/
  start.bat            double-click launcher (finds Python, starts server)
  release.py           freeze the current state as releases/vX.Y.Z (own port)
  releases/            frozen versions, each fully self-contained
  server.py            stdlib-only HTTP server + folder watcher + CSV parser
  config.json          stats_folder (set from the app), port, scan interval
  cache/               one parsed-run cache per folder, keyed by sha1(path)
  logs/                session-*.log, written by the server via POST /api/log
  app/
    index.html         full app markup
    simple.html        reduced markup, same core.js
    core.js            all logic (~1200 lines)
    styles.css
    data/benchmarks.json   Viscose Benchmarks S2, built by planning/viscose-import.py
```

`L:\Claude\kovaaks-consistency.html` is the old single-file version, kept as a
reference. It is superseded by this folder.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/runs` | all parsed runs, `{version, folder, names[], rows[]}` |
| `GET /api/version` | `{version, runs, scanning}` — client polls every 5s |
| `GET /api/config` | `{appVersion, port, folder, valid, reason, runs, candidates[]}` |
| `GET /api/benchmarks` | the benchmark array (Viscose S2: Medium, Hard, Expert) |
| `POST /api/folder` | `{folder}` → validate, index, persist to config.json |
| `POST /api/browse` | opens a native folder dialog, returns the chosen path |
| `POST /api/log` | `{session, entries[]}` → appended to `logs/session-*.log` |

`rows` are `[nameIdx, epochMs, score, cm360|null, sensScale|null]`. The name
dictionary keeps 21k runs at ~1MB instead of several MB.

---

## Decisions worth remembering

**Why a server at all.** Reading 21k files through the browser File API was slow
and had to happen on every launch. The server parses once (3.2s cold, threaded),
caches to `cache/<hash>.json` keyed by filename+mtime, and restarts in ~60ms. It also
makes real log files and folder watching possible, neither of which a `file://`
page can do.

**Client still works without the server.** `boot()` tries `api/benchmarks`; if
that fails it falls back to `data/benchmarks.json` and the folder picker. So
opening `app/index.html` directly still works, just slowly.

**One core.js for two pages.** `simple.html` omits chunks of markup. Rather than
branch everywhere, `$` returns a stable detached stub `<div>` for any missing id,
so writes are harmless no-ops. `has(sel)` is the explicit check where behaviour
must actually differ. 13 stubs are in play on simple.html.

## Parser quirks (hard-won — do not "simplify" these)

1. **`Key:,value`** — KovaaK's writes settings with a colon *and* a comma. The
   separator class must be `[:,]+`. With a single `[:,]` every settings line
   silently fails to parse, which is what made cm/360 come back empty for weeks.
2. **`Sens Scale` appears twice** — once as a column header in the per-weapon
   summary row, once as the real setting. Only the line-anchored match
   (`^\s*Sens Scale\s*:`) is correct.
3. **When `Sens Scale` is `cm/360`, `Horiz Sens` *is* the cm/360 value.** No DPI
   math needed. An earlier DPI-based estimate was wrong; don't reintroduce it.
4. **Other scales** convert via multipliers taken from KovaaK's own
   `FovSensConfig.json` (`Kovaaks Folder/Saved/SaveGames/FovSensConfig.json`):
   `cm = 360*2.54 / (sens * K * dpi)`. Scales whose formula depends on FOV or has
   an offset term (Splitgate, Paladins, Battlefield, GTA 5, PUBG) are
   **deliberately excluded** — better no value than a silently wrong one.
   Current coverage: 100% of runs (19,646 cm/360 + 1,004 Valorant + 803 Quake/Source).

The same table exists twice — `CM_K` in `server.py` and in `core.js`. Keep them
in sync if you touch either.

## Where the maths lives

All thresholds are in the `TUNING` block at the top of `app/core.js`.
**`CALCULATIONS.md` documents every formula** and flags the debatable choices
(equal-weight vs run-weighted scenario averaging, trimmed mean, min runs).

## Stats decisions

- **Baseline** — "Compare vs Previous window" is the default because it uses a
  genuinely separate, non-overlapping period. If a scenario lacks 3+ runs in the
  previous period it silently falls back to first-half-vs-second-half of the
  window and says so on the card.
- **Window "All"** must anchor to the earliest *run*, not epoch 0 — otherwise the
  first-half midpoint lands in 1998 and every trend reads `—`.
- **cm clustering** (`computeCmClusters`) anchors each cluster to its *minimum*,
  not the previous point. Chain-linking (compare to previous only) lets a walk of
  small steps 43→44→45→46 drift a cluster arbitrarily wide, which made
  "best/worst cm range" collapse into whatever range you play most. Ratio is 1.1.
  Outer clusters are labelled open-ended (`≤14cm`, `87cm+`).
- **Outlier exclusion** is on by default: drops cm values with <5 runs or <0.2%
  of cm-tagged runs, to kill accidental slider changes.
- **Trimmed mean** (`TRIM_FRACTION`, default 10% off each end) is used for Avg
  so a single fluke run can't swing a window. Set to 0 for a plain mean.
- **Runs list is paged** (20 at a time). Rendering every scenario means an SVG
  chart each, which is what made searching feel laggy on 2,000+ scenarios.
- **Divide-by-zero guards** — `trendPct` returns null for a zero baseline; a
  bottom-10% baseline of 0 previously produced `+Infinity%`.

## Performance

`computeTrendSeries` runs on **every** render. The naive version re-filtered and
re-sorted every scenario at every one of 30 buckets (~30x the necessary work) and
was what made renders crawl on 21k runs. It now does one incremental pass per
scenario: running max/sum for PB/Avg, and a sorted-by-binary-insertion array for
the bottom-10%. Full render is ~350ms, of which the series is ~90ms.

If renders get slow again, measure this function first.

## Benchmarks

- Source: the Viscose Benchmarks S2 CSV export in
  `L:\Claude\Benchmarks\Viscose s2\csv\`, one file per difficulty. Built by
  **`planning/viscose-import.py`** (dry-run by default, `--write` to commit) into
  `app/data/benchmarks.json` as `{name, kbid?, scenarios:[{n, r:[{n,t}]}]}`
  (`t` = score threshold). Rerun it whenever the sheet is revised.
- **Medium / Hard / Expert only** — 39 scenarios each, 117 in total. Easier is
  not shipped.
- Each difficulty has its own rank ladder and its own *number* of ranks: Medium 9
  (cinnabar..fuchsia), Hard 8 (Wool..Silk), Expert 6 (interloper..eclipse). Do
  not assume a fixed count anywhere.
- The sheet is a working draft. Rank columns are followed by working columns
  (evxl population data, revision notes) which are **not** ranks; the importer
  stops at the first header matching data/notes/changes/count. Expert's trailing
  **`matty rank (real)`** column is dropped on purpose — it is not a rank anyone
  is measured against.
- This **replaced** the previous 216-benchmark dataset outright. That one
  included a Viscose S2 Medium built from a malformed JSON file that was edited
  until it parsed — readable, not correct, with ~30 of its 39 scenarios lost.
  Nothing from it survives.
- `kbid` (the KovaaK's benchmark id, which doubles as the evxl.app URL segment
  `https://evxl.app/leaderboards/<kbid>`) is absent from the sheet, so the
  evxl link is simply not rendered. The UI already guards on it.
- **Overall rank = weakest link**: the lowest tier cleared across all scenarios.
  Shown twice — from all-time PB, and from the window average.
- Scenario matching is exact on trimmed+lowercased names. Unmatched scenarios are
  flagged `(no runs)` rather than hidden.
- evxl.app itself has no public API and does not publish its Energy formula —
  these local JSON files are the source of truth, not scraping.

## cm tables: two different questions

The cm breakdown shows four numbers per bucket, and they answer different things:

- **avg level / pb level** — how that cm performs *relative to your own typical
  avg/PB for the same scenario*. "Is this cm good for me?"
- **avg change / pb change** — how your scores *at that cm* moved versus the same
  cm earlier (`computeCmDeltas`). "Am I improving at this cm?" Runs are bucketed
  by cm first, then each bucket is compared only against its own earlier runs, so
  it is not contaminated by scenarios that merely happen to use that cm.

Both need 3+ runs per scenario per bucket on each side, so sparse cms show `—`.

## Known gaps / next steps

- Benchmark work was explicitly deferred ("putting further adjustments on
  benchmark later").
- `CM_K` duplicated between Python and JS (see above).
- Deleting a CSV bumps the version and drops the run — intentional, but it means
  an external cleanup of the stats folder shows up live in the UI.
- No packaging yet. If you want a double-clickable `.exe`, PyInstaller over
  `server.py` with `app/` bundled as data is the straightforward route.

## Charts (v0.0.8 onwards)

Charts are **never** auto-fitted to data min/max. See `CHART-SCALING.md` for the
full reasoning; the short version:

- `chartScale(scores)` sets the y-range to mean +/- `CHART_K` sigma, floored at
  `CHART_MIN_SPAN_PCT` of the mean and expanded to contain every plotted point.
- sigma comes from the last `CHART_SIGMA_N` runs and is deliberately *not*
  recomputed from the visible window, so changing Window never changes how big a
  gain looks. If you ever add x-zoom, it must not touch the y-axis.
- The `+-1 sigma` band is drawn around the **rolling median**, not the rolling
  mean as the source document specifies. Deliberate: the band has to be centred
  on the line the eye is following, or "did this clear the band" stops working.
- PB uses `H`/`V` path segments, not `L`. It is a ratchet; a diagonal between two
  PBs would be a claim about runs where nothing happened.
- Plot areas are 2:1 via CSS `aspect-ratio`, with a fixed-height fallback for
  browsers without it. Do not go back to `preserveAspectRatio="none"` on a wide,
  short viewBox - that was flattening every trend it drew.

## Release isolation - the browser is the leak

The files in `releases/vX.Y.Z/` really are independent (different `core.js` sizes
prove it). But two builds can still contaminate each other:

- `core.js` is served by `SimpleHTTPRequestHandler` with `Last-Modified` and **no
  `Cache-Control`**, so browsers cache it heuristically.
- `release.py` assigns ports by next-free-slot, so the *first* release in any copy
  of this folder gets 8801. Two builds on two drives then share the origin
  `http://127.0.0.1:8801` - and share its cache and its `localStorage`
  (`kva_break`, `kva_favcms`).

Result: an old build can appear to have new behaviour. The footer build stamp
(v0.0.8) makes this visible; the actual fix is queued as Batch 5 in
`planning/BACKLOG.md` - `no-store` on app assets, version-derived ports, and
version-namespaced localStorage keys.

## Reading the source PDFs

`planning/source-docs/` holds the extracted text of the spec PDFs plus the
extractor that produced it. Those PDFs are wkhtmltopdf output using Identity-H
CID fonts, so ordinary text extraction returns nothing readable - you need the
per-font `ToUnicode` CMap, including its `bfrange` **array** form
(`<lo> <hi> [<u1> <u2> ...]`). `_pdf_extract.py` handles it with stdlib only.

## Versioning — what people actually use

You asked whether to switch to a conventional scheme. Short answer: what we have
is already **SemVer**, we are just using it timidly.

**Semantic versioning** is `MAJOR.MINOR.PATCH`:

- **PATCH** (`0.0.8` -> `0.0.9`) - bug fixes and small tweaks, nothing new to learn.
- **MINOR** (`0.0.9` -> `0.1.0`) - new features, backwards compatible. **This is
  what a batch is.** Every batch here has been a MINOR release wearing a PATCH
  number.
- **MAJOR** (`0.x` -> `1.0.0`) - breaking changes. Below `1.0.0` the rules are
  relaxed and `0.x` publicly means "still moving fast, no stability promised".

What that implies for this project:

- A **batch = one MINOR bump**. Batch 6 -> `v0.1.0`, Batch 7 -> `v0.2.0`, and so
  on. Emergency fixes between batches take the PATCH digit: `v0.1.1`.
- **`v1.0.0` when it goes public on GitHub** with a README someone else can
  follow, which is roughly the state it is in now. `1.0.0` is not a quality claim
  - it is a promise that the next breaking change bumps to `2.0.0`.
- Tag releases `v1.2.3` in git. GitHub Releases reads those tags, and
  `WHATS-NEW.txt` is already the release-notes body.
- **Do not** name folders after batch numbers. Batch numbers are planning; version
  numbers are what shipped. They drift apart the moment one batch splits in two,
  which has already happened twice here.

Nothing has been renumbered - the existing folders stay as they are. The switch,
if you want it, starts at the next release.

## Run resets - how they are detected

With "log every run" enabled in KovaaK's, a restarted attempt gets its own CSV in
the stats folder, with a real score attached. Those scores are partial progress
at the moment you pressed restart, so they are systematically low and unrelated
to skill. They have to be found and excluded.

**Score cannot be used.** A reset 40 seconds into a good run outscores a
completed bad one - the three restarts on 2026-09-01 scored 456, 3834 and 8118
against a completed 10548.

**The signal is Challenge Start.** On a restart the game writes the aborted
attempt's stats but stamps the file with the *new* challenge's start time, which
is the same moment the file itself is written. So a restart measures zero elapsed
seconds. The next completed run inherits that same start stamp:

    03:55:51 file, Challenge Start 03:55:51  ->  0.0s   restart, score 456
    03:56:32 file, Challenge Start 03:56:32  ->  0.0s   restart, score 3834
    03:57:17 file, Challenge Start 03:57:17  ->  0.0s   restart, score 8118
    03:58:17 file, Challenge Start 03:57:17  -> 60.0s   completed, score 10548

**The threshold is exactly zero, and that matters.** Measured across all 21,635
runs on disk:

    0s :  40 runs      <- restarts
    1s : 294 runs      <- real NeverMiss runs that ended on the first miss
    2s : 270 runs
    3s : 179 runs

A window of even +-2s would have thrown away 743 genuine runs. `RESET_MAX_SEC` is
0.5, which at whole-second filename granularity means exactly 0. Do not widen it.

**Honest caveat.** A NeverMiss run whose first shot misses also ends inside its
opening second and is indistinguishable from a restart. Those always score 0, so
excluding them costs nothing - a zero is not a measurement. Of the 40 detected,
5 are restarts with partial scores and 35 are zero-scoring NeverMiss entries.

Resets are excluded from every statistic unconditionally (`runUsable`), unlike
warmup and re-familiarisation which are toggleable - there is no reading of the
data where including a reset is correct. They are counted in the session panel,
and a restart streak longer than `RESET_RATIO_ALERT` triggers the RNG-chasing
warning.

The row format grew a column for this, so `ROW_SCHEMA` in server.py was bumped to
2. The disk cache stores rows verbatim; without the schema check every
already-parsed run would have stayed in the old shape forever.

## Zero-score runs vs restarts

Two different questions, and conflating them is what v0.1.0 got wrong:

- `runVisible(r)` - **did you play this run?** Only a restart fails. Drives the
  charts and the run counts.
- `runUsable(r)` - **may it enter a percentage?** `runVisible && score > 0`.

A zero-length run is only classed as a restart when it actually *scored*
something. On a NeverMiss, missing the first shot ends the run inside its opening
second with a score of 0 - a real run, indistinguishable from a restart by
timing alone, and it should stay visible. Splitting on score separates them:

    dur ~ 0, score > 0   ->  restart      5 runs, hidden entirely
    score == 0           ->  zero run   176 runs, drawn but never counted

141 of those zeros previously had a real duration and were being averaged into
the statistics, dragging the floor down for a reason unrelated to skill.

`getActivePool()` returns two pools. `pool` feeds every percentage; `displayPool`
is the same set plus the zeros and feeds charts only. `computeTrends` attaches
`rsAll` (display) alongside `rs` (statistics) and a `zeroRuns` count. `spark()`
filters the zeros back out before computing the scale, then draws them pinned to
the axis floor as hollow marks - the axis must come from real runs, or a single 0
squashes everything into the top of the frame.

## Benchmarks: what was NOT fixed

`STS 2 - Pokeball & Flicker.json` arrived malformed (trailing commas, unclosed
arrays). It was edited until it parsed. **That made it readable, not correct** -
roughly 30 of its 39 scenarios were lost in the process and were never recovered,
which is why the bundled Viscose S2 Medium benchmark has only 9. Do not describe
that file as repaired anywhere. The replacement is the raw xlsx/CSV export in
`L:\Claude\Benchmarks\Viscose s2\`, queued for Batch 10.

## The folder picker, and why it looked broken

Opening a folder dialog was never the hard part. **Being seen was.**

The server has no window of its own. A dialog it opens therefore has nothing to
sit in front of, and Windows will not let a background process take the
foreground, so the dialog went straight behind the browser. From the user's side
the Browse button simply did nothing. The giveaway when debugging: the PowerShell
call *blocked for the full timeout*, which means a window was up and waiting.

Two things fix it, and both matter:

1. **A hidden topmost owner window** (`_ifd_owner_window`) - 1x1, off-screen,
   `WS_EX_TOPMOST | WS_EX_TOOLWINDOW`, shown with `SW_SHOWNA` so it has a real
   handle. A topmost window draws above normal windows regardless of focus, so
   the dialog it owns is visible without stealing focus, which a background
   process cannot legitimately do anyway. Verified: `IsWindowVisible` true,
   `WS_EX_TOPMOST` set, 960x540 at (0,0).
2. **The page narrates the wait.** The request blocks while the dialog is open,
   so the browser is the only place that can say "a window opened, look behind
   this one". It escalates at 6s and 25s and offers the paste box.

Picker order, all in `PICKERS`:

    explorer     IFileOpenDialog + FOS_PICKFOLDERS, straight ctypes.
                 The real Explorer window. No subprocess, no console flash.
    powershell   WinForms FolderBrowserDialog. Part of Windows, so it survives
                 any Python build - but on .NET Framework it is the old tree
                 widget, hence second. Its owner Form must be Show()n first:
                 an unshown Form has no handle and TopMost does nothing.
    tkinter      Last. Absent from the Smoothie Python this project runs on.

Cancelling is a decision, not a failure: a picker that returns without raising
counts as "opened", so the loop stops instead of popping a second dialog. Only if
every picker *raises* does the user get the "paste the path instead" message.

`DIALOG_TIMEOUT` is 150s. It used to be 310, which meant a dialog nobody could
see wedged the HTTP request for over five minutes.

### Testing it without blocking

A folder dialog blocks until someone clicks. To test unattended, find it by
window class and close it:

    hwnd = user32.FindWindowW("#32770", None)
    user32.PostMessageW(hwnd, 0x0010, 0, 0)      # WM_CLOSE

`Show()` then returns `0x800704C7` (ERROR_CANCELLED), which is the same path as
a real Cancel. `scratchpad/test_picker.py` in the session notes does this for all
four cases: picker direct, full `native_pick_folder`, every picker failing, and a
picker succeeding.

## Publishing: base and beta

`releases/` is gitignored, so "what people download" is **GitHub Releases**, not
folders in the repo. `publish.py` keeps exactly two live at any time:

    base   the build that has been used enough to trust   -> GitHub "Latest"
    beta   the newest build                               -> GitHub "Pre-release"

A new version replaces **beta**. **Base** only moves when a beta is promoted
(`--promote`), which deletes the previous base. Two options, one boring and one
current, instead of a list nobody can choose from.

The tags are the *channel names* (`base`, `beta`), not version numbers, so the
download URL for "the current beta" is stable. The version lives in the release
title and body; `WHATS-NEW.txt` becomes the release notes automatically.

`publish.py` does nothing without `--yes` - it prints the `gh` commands it would
run and exits. It never pushes commits: that is `git push`, deliberately separate.

**Nothing personal ships.** `make_zip` drops `cache/`, `logs/`, `config.json`,
`__pycache__`, `.browser-opened` and `HANDOFF.md`, then writes a fresh
`config.json` with an empty `stats_folder`. Belt and braces: `release.py` already
writes a blank one at freeze time. It used to copy the working copy's folder,
which baked one person's path into every build and overrode the choice the user
of that release had already made.

## What the app promises about privacy

It used to say "no network calls". That stopped being true the moment outbound
API calls were approved (playlist share codes resolve server-side against
KovaaK's). The claim in README and HANDOFF is now the one that survives contact
with the roadmap:

> your run data is never uploaded anywhere - it is read from your stats folder
> and stays there.

Keep it that way. A feature may call out to fetch *reference* data - playlists,
benchmark thresholds, leaderboards - but nothing derived from the user's own runs
goes with it. If that ever has to change, the wording changes first.

## Two cm filters, and why they are different

There are two things in the UI that filter by sensitivity, and they are not the
same feature:

    Specific cm (above the list)   global   filters every scenario on the page
    a cm chip on a card            local    filters that one card

The chips shipped wired to the *global* one. Clicking `60cm` under a chart to
ask "how am I doing at 60 here?" re-filtered every other scenario as well, and
nothing on screen said so. They are now a per-card toggle held in `scenCm`
(key -> cm), and the global control is left alone.

**A pinned card is recomputed, not patched.** `cardView()` re-runs
`computeTrends()` over just that cm's runs. Patching the displayed numbers would
leave the confidence intervals, the power check, the baseline and the chart's
sigma describing a different population than the numbers above them - a card
claiming a comparison it never made. `minRuns` is 1 for that recompute on
purpose: you asked for this cm specifically, and each metric already withholds
itself below its own minimum rather than guessing.

**The chips are built from the unfiltered runs.** `spark(rsAll, byCm, legendRs,
pinnedCm)` draws `rsAll` but hands `legendRs` to `cmDotLegend`. Build the chips
from the filtered list and pinning becomes a one-way door: the other
sensitivities vanish, and with them the only way back out.

## Card sizes

`.scen-expanded` is applied to every card in the run list now - it used to be
behind an Expand button that was pressed every time anyway. The class is kept
rather than folded into `.scen` because the session panel and the cm breakdown
also use `.scen`, and those should not grow.

`.scen-full` is the new one: a full-bleed breakout up to 1920px, inset from the
viewport so it never collides with the scrollbar. The numbers move beside the
chart via grid areas. The chart keeps its 2:1 aspect - CHART-SCALING.md is
explicit that the aspect is doing work, so stretching it to fill the width would
undo the thing the whole document argues for - and it is capped by viewport
height as well, since 1920px at 2:1 is a 960px-tall chart.

## The effects lab

`app/lab.html` + `app/lab.js`. A dev workbench: fire every celebration, nudge,
alert and live note on demand instead of waiting to hit a PB or hand-editing a
CSV to provoke one.

It **loads `core.js` and calls into it**. Nothing is reimplemented, and nothing
should ever be: a copy of an animation drifts from the real one, and then you are
tuning something the app does not do. What the lab supplies is *state* -
synthetic `RUNS`, cleared once-per-session guards, `TUNING` values from the
sliders. The real `celebrate()`, `runConfetti()`, `fireBreak()`,
`maybeFireLowActiveNudge()`, `checkIdleNudge()`, `showLiveNote()`,
`renderSessionPanel()` and `spark()` do the work.

`core.js` skips its own boot when `window.KVA_LAB` is set, so the lab never
fetches the config, never loads 20k runs and never starts the watcher poll.

The synthetic history is seeded (`rng(20260901)`), so the chart looks identical
on every reload and two screenshots of the same effect are comparable. The
generated data has to obey the same physics as real data - the first version
gave runs 58-second durations and 42-second gaps, and the session panel
correctly reported 100% active play for a session that could not exist.

Linked from the footer on dev builds only. It ships in releases (a few KB, and
being able to check a frozen build's animations is the point) without being
advertised there.

## Notifications are an overlay, not markup

`toast(key, html, opts)` in `core.js`, rendering into one of **two** layers,
each **created on demand** rather than living in the markup - so index, simple
and the effects lab all get them without three copies of one div.

    key     one live card per key; firing again replaces rather than stacks
    kind    warn | info | good | celebrate
    ms      auto-dismiss, 0 = stays until dismissed
    once    dismissing silences that key for the rest of the session
    center  render into #toastCenter instead of #toastLayer

`#toastLayer` is the bottom-right corner. `#toastCenter` is the middle of the
viewport, and **only celebrations use it**. The distinction is what the
notification is for: a corner notice is something you glance at when you get
round to it, a PB is the one event worth putting in front of your face. Both
layers are `position:fixed`, so "the middle" means the middle of what you are
looking at right now, whatever the page is scrolled to - not the middle of the
document.

Because a key can now live in either layer, `findToast(key)` searches both, and
the replace-and-dismiss paths go through it rather than through
`document.getElementById`. Firing a key that is already up in the other layer
still replaces rather than stacking.

Everything goes through `toast()`: break reminders, the idle nudge, the
low-active popup, the restart-spam warning, the log-every-run suggestion and
every celebration tier.

### What earns confetti (v0.7.1)

Full-screen confetti fires for a **scenario PB only** - `a.kind === 'pb' &&
a.scope === 'scenario'`. A best at one sensitivity is a real result and still
gets a centred card (`★ New 52cm PB!`), but it gets no confetti and no `.big`
class. You have as many cm-scoped bests as you have sensitivities; if each one
threw confetti across the whole window, whole-window confetti would stop meaning
anything. The lab's `pbcm` button is labelled *"no confetti - by design"* so this
does not get "fixed" by someone reading it as a bug.

### There is no "just played" notification (v0.7.1)

There used to be a `toast('live', 'Just played: ...')` on every completed run.
It is gone. The session panel already carries the scenario, the sensitivity and
the score, it is on screen the whole time, and it does not have to be dismissed.
`showLiveNote()` now only calls `renderSessionPanel()`. A notification that
duplicates something already visible is just something else to close.

They used to be `<div>`s in the page flow (`#liveNote`, `#breakAlert`,
`#lowActiveAlert`, `#celebrate`). Those are gone from all three pages. The
problem was not styling: a notification inside the flow moves the page under the
cursor when it arrives and again when it leaves, and one that renders below the
fold has not notified anyone.

Two guards matter, because `renderSessionPanel()` re-runs on every 5-second
poll: `resetWarnShownFor` and `lowActiveNudgeShownFor` hold a session start
timestamp, and `logHintShown` is a plain once-per-load flag on top of the
persisted `kva_loghint` dismissal.

## Sessions: 30 minutes, and same-day sittings

`SESSION_GAP_MIN` is **30**, down from 60. Half an hour with no completed run
and the next run starts a new session.

That alone would throw away the fact that three sittings happened on one day, so
`buildSessions()` adds a second pass:

    breakBeforeSec   gap from the previous session, only when same calendar day
    dayIndex         which sitting of that day this is (1-based)
    dayBreakSec      break time accumulated across the day so far

The session panel shows the break before the current sitting and totals the day
across all of them. Nothing is merged - the 30-minute split is right for
measuring one sitting - but nothing is forgotten either.

**The clock is live.** `SESSION_CLOCK` + a 1-second `tickSessionClock()` update
the two elapsed-time cards from the PC clock, and rebuild the whole panel every
60 ticks so the numbers are re-validated against the run history instead of
drifting on their own arithmetic. It stops once the last run is older than
`SESSION_GAP_MIN` - past that it is not this session any more.

## The reference drawer

`openSideTab(title, html, sourceBtn)`, `SIDETAB_DOCS`, and one **yellow warning
symbol** per scenario card.

The explanations used to be `title` attributes on 12px icons and a 9px `early`
tag. That is where writing goes to not be read. `scenCaveats(v, ctx)` now returns
a list of {title, body} for a given card - under-powered (with the run count and
a day estimate), stand-in baseline in use, staleness, zero-score runs - and the
card renders one symbol that opens them in a panel. `SCEN_CAVEATS` stashes the
rendered HTML by scenario key, because the click happens long after the render
and re-deriving the row there would mean recomputing it.

The menu bar opens the same drawer with `SIDETAB_DOCS.icons`, `.calc` and
`.calendar`. Those live in `core.js` rather than the markup so simple.html and
the lab get them for free.

`.sidetab[hidden]` needs an explicit `display:none`: the element is
`display:flex`, which beats the `[hidden]` attribute and would leave the drawer
permanently on screen.

## Layout: 2560, and a right-hand column

`.wrap` caps at **2560px**. Read it as "grows with the screen and stops at
2560": a 1920 monitor fills, a 2560 monitor fills, wider stays put until the
layout earns more - past 2560 the answer is more columns, not longer lines. 5120
is still a later job. Prose keeps `max-width:104ch` regardless, because line
length is a reading constraint and not a layout one.

`.applayout` is one column until 1500px and two above it, with the session panel
and the month calendar on the right. **Only the session panel is sticky, not the
column**: a sticky column taller than the viewport can never be scrolled to its
own bottom, which would put the oldest two months permanently out of reach.

The "Month calendar" menu entry checks whether the calendar is already on screen
before scrolling. `scrollIntoView` on an element inside a sticky container jumps
to where it would have been rather than where it is.

## Month calendar

`renderCalendar()` draws this month and the four before it. **One measured
number each: Typical, the trimmed mean**, against the previous month, through
`computeTrends` + `overallOf` - the same path the headline cards use. Ceiling and
Floor are deliberately absent: they are quantiles, they need more runs than a
month usually holds, and showing them would put two confident-looking numbers
next to one honest one.

Cached on `dataVersion + pool.length + the exclusion settings + today's date`.
Five months of trend computation on every 5-second poll is pure waste; the
calendar only moves when the data or the exclusions move.

The fun facts (`newScenariosIn`, `pbsIn`) are counted over **RUNS minus
restarts**, not the filtered pool. A run you played as a warm-up is still a
scenario you tried; the warm-up exclusion exists to keep biased scores out of a
measurement, and these are not measurements. The drawer says so, and says
plainly that a PB count rises fastest when you try new scenarios - the second
run of a new scenario beats the first almost every time.

## Score by cm

`app/data/categories.md` holds the rules. It is plain text, it is the only copy,
and `parseCategoryRules()` reads it at page load - edit, reload, done.

**It lives in `app/data/` and not `planning/` because `planning/` is not in
`release.py`'s COPY_FILES or COPY_DIRS.** A rules file there would work in the
working copy and be missing from every frozen build, which is the one place it
actually has to work.

    parseCategoryRules(text)   -> [{cat, sub, notes, rules:[{when, terms, then}]}]
    cmLevels(runs, extremes)   -> per-rounded-cm {cm, n, mean, sd, se, first, last}
    cmAnalysis(runs, extremes) -> {levels, regular, best, worst, diff, overlap}
    evalTerm(term, analysis)   -> boolean, one condition
    evalRules(entry, analysis) -> {fired, skipped}

Parser rules worth knowing:

- **Fenced blocks are skipped.** The file documents its own format in one, and
  parsing it invented a category called `<Category>` holding `WHEN: <condition>`.
- **`(add your ...)` marks a template**, and templates are dropped rather than
  shown. Printing "(add your interpretation)" as a finding is worse than nothing.
- **An unrecognised condition is reported back in the panel**, with the list of
  ones that work. A rule that silently never fires is the worst outcome for
  somebody editing a text file with no feedback.
- Trailing prose after a valid condition ("`pct_below_regular(0) at slower cm`")
  keeps the rule but is quoted back as not checked.

**Direction matters and is easy to get backwards.** cm/360 is distance per turn,
so a bigger number is a slower sensitivity: `faster_than(50)` is true when your
best level is *below* 50. There are self-tests pinning every condition's
direction, because inverting one would invert every interpretation in the file.

### The two confounds

This is the easiest chart here to lie with, so the panel spends most of its
space on them:

1. **Sample size.** `CM_LEVEL_MIN_N` (10) gates every level. Below it a level is
   neither drawn nor available to a rule. Every point carries its 95% interval.
2. **Time.** `cmTimeOverlap(best, regular)` checks whether the two levels every
   interpretation rests on were played in the same stretch. Disjoint and 7+ days
   apart gets the yellow warning; disjoint but closer, or thin overlap, gets a
   quiet note. Warning about a two-day gap would train the reader to ignore the
   warning, which costs more than the false negative.

The headline line above the readings states the best-vs-regular difference with
its interval, and says outright when it spans zero. The rules still fire - they
are the user's rules - but nobody reads them thinking the data supports more than
it does.

### Scope of the runs

The panel uses the scenario's **whole history**, not the current window.
Comparing sensitivities needs every run of each it can get, and the thing a short
window would otherwise hide - that the levels were played months apart - is
measured and stated rather than avoided.

### Category assignment

Stored per build in `kva_scencat` as `{scenarioKey: "Cat / Sub"}`. `guessCategory`
offers a first pick from the scenario name, labelled "guessed from the name" in
the UI. It is substring matching on a title; it exists to save picking the same
thing forty times, not to be right. With no sub-category in the name it prefers
the `Regular` entry - an earlier version took whichever entry came first in the
file, which quietly labelled everything Micro.

> Corporate Serf Dashboard has a sensitivity-vs-score plot. It is **AGPL-3.0**.
> Nothing has been taken from it - only the public description of the feature was
> read. Everything here is built on this project's own cm machinery.

## Chart hover: nearest-neighbour, not hit targets

Hovering any run on a scenario chart gives you the run behind it. A native
`title=` would have been free, and was rejected for two reasons that are the
whole point of the feature: it waits about a second before appearing, and it
only fires when the pointer is genuinely over a 2px circle.

The dots stay 2px. Growing them to a reliably clickable size would turn a
200-run chart into a smear, which loses more than the hover gains. So the
**grab radius lives in the pointer handler instead**, where it can be far
larger than the mark it belongs to:

    SPARK_GRAB_PX   26    how close is close enough, in screen pixels
    SPARK_DELAY_MS  45    vs roughly 1000ms for a browser tooltip

`onSparkMove` is one `mousemove` listener on `document`, not one per chart. It
finds the enclosing `svg.spark`, converts the cursor into viewBox units, and
takes the nearest registered point inside the radius:

    k  = d.w / svg.getBoundingClientRect().width      // viewBox units per screen px
    vx = (e.clientX - box.left) * k

That `k` is the part that is easy to get wrong. The SVG is scaled by CSS, so a
radius written in viewBox units would mean a different physical distance on a
full-width card than on a narrow one. Converting *pixels into viewBox units* per
chart keeps the grab feeling identical at every card size.

**Where the point data lives.** `spark()` builds a plain array while it emits
the circles and hands it to `sparkRegister()`, which returns an id that becomes
the SVG's `id`. The map is keyed by that id. It is deliberately not
`data-` attributes: a 200-run chart would carry ~15KB of JSON in its markup,
times however many cards are open. Charts are re-rendered wholesale so old ids
simply stop existing; rather than depending on a frame callback to notice -
which never fires in a background tab - the map is capped at 120 entries and
insertion order means the oldest are the dead ones.

Two details that came out of testing:

- The highlight ring (`.sparkhl`) is appended **last** in the SVG. Emitted
  first, it drew behind the data and was invisible on any dense chart.
- `mouseleave` is bound **without** capture. With capture it fires every time
  the pointer crosses from one SVG child to another, and the tooltip blinks
  continuously as you move along a line.

The panel is placed clear of the cursor and **flips rather than clips** near an
edge, so a hover at the bottom of the window opens upward.

## Sorting by how well measured a scenario is

The "Most data (tightest measurement)" sort is deliberately not a run count.

What decides whether a scenario can show you progress is **the width of its 95%
interval** - so the sort key is `CI_Z * typical.se`, ascending. Two hundred runs
spread over six sensitivities can measure less than forty runs at one, because
the unit of analysis is the (scenario x cm-cluster) cell and each cell is only
ever compared against itself ([CALCULATIONS.md 3](CALCULATIONS.md)). A sort by `st.n` would put the
first scenario above the second and be wrong about the only thing the sort is
for.

Rows with no interval at all cannot be ordered against ones that have one, so
they fall to the bottom, ordered by paired runs (`nMin`, then `st.n`) - closest
to being measurable first. The page carries a caveat saying what the order
means when this sort is active, because "most data" invites being read as "most
played".

## Why a comparison is missing, said out loud

`cmpWhy(v, key, minN)` explains a dash in the "vs baseline" column. It exists
because a card could previously show three dashes and no warning, which reads
like a broken program rather than an honest one - this was reported as a bug and
was not one.

It distinguishes three cases, because they need different things from you:

1. **Not enough runs.** Names the requirement (15 ceiling / 20 floor / 10
   typical, per side), then the actual counts in the fullest band: *"has 10 in
   this window and 16 in the period before it"*. When the runs span more than
   one band it adds the number of bands **and the reason it matters** - each
   band is only ever compared against itself, otherwise moving your sens between
   the two periods would show up as a change in skill.
2. **No earlier period at all** - there is simply nothing to compare against yet.
3. **The sensitivity you play now was not played before.** Different from (2):
   you have history, just not at this cm.

The text is used twice, so it deliberately does **not** start with the row name:
the dash's tooltip prefixes `label + ' - '` itself, and the drawer caveat lists
the rows. An earlier version returned `"Ceiling (p90) needs at least..."` and
the tooltip read *"Ceiling (p90) - Ceiling (p90) needs at least 15 runs"*.
