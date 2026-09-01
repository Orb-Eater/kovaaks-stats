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

Copies `server.py`, `start.bat` and `app/` into `releases/v0.0.1/`, gives it its
own port (8801, 8802, … per release) and its own `config.json`, and writes a
`VERSION` file. From then on it is fully independent — `cache/`, `logs/` and
config are per-install, and nothing is shared with the working copy.

So: keep using `releases/v0.0.1/start.bat` day to day while editing the working
copy freely. Both can run at the same time (different ports). Verified: an edit
to `app/core.js` in the working copy shows on :8765 and *not* on :8801.

The header shows which one you're looking at — `dev build · port 8765` vs
`v0.0.1 · port 8801`. Releases inherit your stats-folder choice so they start ready.

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
