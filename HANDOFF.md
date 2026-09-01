# Handoff — start here

Read this file first if you are picking the project up cold (new chat, new
machine, or after a `/clear`). It is the map; everything else is detail.

**Last updated:** 2026-09-01, after building Batch 8 (v0.3.0, not yet frozen
or committed — see "Next up").

---

## What this is

A local KovaaK's aim-trainer statistics app. Python stdlib server + two static
HTML front-ends, no dependencies, and run data is never uploaded anywhere.
(Outbound API calls are now permitted where a feature needs them — see the
playlist-import decision in the backlog. Until one ships, it makes none.)

The point of the whole thing, in one line:

> **See whether your floor is moving, not just your ceiling — and say "that's
> noise" when it is noise.**

That constraint is not decoration. The app is deliberately built to report *no
significant change* often, because a statistics tool that always finds a trend is
a random number generator with a confident interface.

---

## Run it

```bash
cd L:\Claude\KovaaksStats && python server.py
```

Or double-click `start.bat` (finds Python itself, no knowledge required).
Working copy serves on **http://127.0.0.1:8765/**.

Frozen releases live in `releases/vX.Y.Z/` and each has its own `start.bat` and
its own port (8801 upward). The footer of every page prints `build … · port …`
so you can tell at a glance which one you are looking at.

---

## Where everything is

| Path | What it is |
|---|---|
| `server.py` | HTTP server, CSV parser, folder watcher, folder detection. ~660 lines, stdlib only. |
| `app/core.js` | **All** client logic — stats, charts, cm analysis, sessions, benchmarks. ~2200 lines. One file drives both pages. |
| `app/index.html` | Full view. |
| `app/simple.html` | Stripped-back view. Omits markup; `$()` returns a detached stub for missing ids so the same script runs on both. |
| `app/styles.css` | All styling. |
| `app/lab.html` + `app/lab.js` | **Effects lab** — dev workbench that fires every animation and notification on demand against synthetic runs. Loads `core.js` and calls into it; nothing is reimplemented. Linked from the footer on dev builds only. |
| `app/data/categories.md` | **Score-by-cm interpretation rules.** Plain text, parsed at page load, the only copy. In `app/data/` because `planning/` is not copied into a release. |
| `app/data/benchmarks.json` | Viscose Benchmarks S2 — Medium/Hard/Expert, 39 scenarios each. Rebuilt by `planning/viscose-import.py`. |
| `release.py` | Freezes the working copy into `releases/vX.Y.Z/` with its own port. |
| `publish.py` | Publishes a frozen release to GitHub as **base** or **beta**. Does nothing without `--yes`. |
| `LICENSE` | MIT. |
| `start.bat` | Double-click launcher. |
| `install.bat` | One-time setup: finds/installs Python, makes shortcuts. Not needed to run. |
| `config.json` | Stats folder, port, scan interval. Per-install, never copied between builds. |
| `cache/`, `logs/` | Generated. Safe to delete. |

### Documentation, and which question each one answers

| File | Answers |
|---|---|
| **`HANDOFF.md`** (this file) | *Where do I start?* |
| `README.md` | *What is this and how do I run it?* |
| `CALCULATIONS.md` | *What does each number on screen actually compute?* — the formulas as built |
| `MEASUREMENT-SPEC.md` | *What are we allowed to claim, and why?* — the measurement design, its evidence base, and a gap list vs the current build |
| `CHART-SCALING.md` | *Why is the chart that size and that scale?* — axis rules, aspect ratio, the noise band |
| `NOTES.md` | *What will bite me?* — architecture, parser quirks, performance traps |
| `CHANGELOG.md` | *What changed in each release?* Newest first |
| `planning/BACKLOG.md` | *What is next, and what did they ask for?* Every request, batched |
| `planning/source-docs/` | Extracted text of the source PDFs, so the reasoning survives without them |
| `planning/scenario-analysis/categories.md` | User-editable interpretation rules for Batch 9 |
| `planning/baseline/scenarios.md` | User-editable scenario list for Batch 10 |

---

## How work is organised

- Requests are grouped into **themed batches** in `planning/BACKLOG.md`.
- **One batch = one release.** Each gets a CHANGELOG entry written *before*
  freezing, because `release.py` extracts `WHATS-NEW.txt` from it.
- **A batch is a MINOR bump.** `python release.py` gives the next minor (Batch 7
  is v0.2.0); `--patch` gives a fix release. See `NOTES.md`, "Versioning".
- Every release keeps working forever on its own port — that is the point.
- **Ports are derived from the version string**, so two builds can never share an
  origin and therefore can never share a browser cache. Check with
  `python release.py --verify`.

---

## The repository

`git init` is done, everything is committed, and `v0.2.0` is tagged. **It has not
been pushed** — creating a private repo needs a GitHub login, which is the user's
to give, not mine. Two commands finish it, run in this folder:

```bash
gh auth login
```

```bash
gh repo create kovaaks-stats --private --source=. --remote=origin --push
```

`gh` (GitHub CLI 2.98) is already installed. Afterwards, `git push --tags` sends
the version tags.

What is deliberately **not** tracked: `config.json` (it holds the user's own
stats-folder path), `cache/`, `logs/`, and `releases/`. Frozen releases are
reproducible from tags — `git checkout v0.2.0` gives that exact build — so
committing eight copies of the whole app would bloat the repo for nothing. They
still exist on disk and keep working. Releases before v0.2.0 predate the repo and
live only in `releases/`.

There is **no LICENSE file**. Correct for a private repo; it matters the day it
goes public, because with no licence nobody may legally use or fork it. That
question is open in `planning/BACKLOG.md`.

---

## Verifying a build

```bash
python release.py --verify
```

Prints every release's port, build hash and core.js hash, plus a per-function
hash of the statistics path saying which calculation last changed and where. Open
any page with `?selftest=1` to run 36 numeric checks against fixed synthetic data.

---

## The six things that will confuse you

1. **KovaaK's CSV settings use a colon *and* a comma**: `Horiz Sens:,0.5`. The
   parser regex is `[:,]+`, not `[:,]`. Getting this wrong silently broke the
   cm/360 filter three times.
2. **`Sens Scale` appears twice** — once as a column header, once as the real
   setting. Match it line-anchored (`^\s*Sens\s*Scale\s*:`) or you get the header.
3. **When `Sens Scale` is `cm/360`, `Horiz Sens` *is* the cm/360 value.** No
   conversion, no DPI maths. Other scales convert via
   `L:\Claude\Kovaaks\Saved\SaveGames\FovSensConfig.json`:
   `cm = 360 × 2.54 / (sens × K × dpi)`. FOV-dependent scales (Splitgate,
   Paladins, Battlefield, GTA 5, PUBG) are deliberately excluded.
4. **`allow_reuse_address` lets Windows double-bind a listening port.** `server.py`
   probes with `port_in_use()` before binding. Without it you get two servers on
   one port and half your requests hit the old code.
5. **Killing a `cmd` wrapper does not kill the Python child.** Orphaned servers
   keep serving old code and will waste an hour of your life. Check with
   `Get-CimInstance Win32_Process -Filter "Name like 'python%'"`.
6. **A dialog this server opens goes behind the browser** unless it is owned by
   a topmost window — the server has no UI to sit in front of, and a background
   process cannot take focus. That is why Browse looked dead for two releases.

---

## Current state (v0.3.0, unreleased — Batch 8 done, not yet frozen)

Working and verified on ~21,600 real runs (Batch 8 spot-checked via
`?selftest=1` plus live browser testing on a 1,500-run dataset):

- Statistical rework — Ceiling (p90) / Typical (trimmed mean) / Floor (p10) with
  95% CIs, power analysis, warm-up and re-familiarisation exclusion.
- **A % is almost always shown now.** A cell with no real earlier period falls
  back to its first 5 runs ever as a standing reference, tagged **early**
  instead of given a CI it hasn't earned. See `CALCULATIONS.md` §2b.
- **Warnings are icons, not paragraphs.** ℹ️ (early-baseline in use) and ⚠️
  (under-powered, with a concrete "N more runs, ~M days" tooltip) sit next to
  the scenario name; hover/focus for the text.
- **Score by cm** per scenario — average at each cm/360 with intervals, your
  own rules from `app/data/categories.md`, and explicit handling of the two
  confounds (thin levels, levels played at different times).
- **Notifications are an overlay** (`toast()` → `#toastLayer`), not divs in the
  page flow. A PB throws **full-screen confetti**.
- **Sessions split at 30 minutes**; sittings on the same day keep the break
  between them (`breakBeforeSec`, `dayIndex`). "Time in KovaaK's" ticks live.
- **Top-left menu bar** and a **reference drawer** (`openSideTab`,
  `SIDETAB_DOCS`). One yellow warning symbol per card replaces the hover-text
  icons; `scenCaveats()` builds what it says.
- **Page caps at 2560px**, two columns above 1500px with the session panel and
  **month calendar** on the right.
- Scenario cards are **expanded by default**, with a **Full width** button that
  breaks one card out to 1920px (chart beside the numbers, 2:1 aspect kept).
- **cm chips are a per-card toggle** — they filter the scenario you clicked and
  nothing else. They used to drive the app-wide Specific-cm filter, which moved
  every scenario on the page. See NOTES.md, "Two cm filters".
- Session badge no longer shows a flat "0.0%"; falls back to the cm/360
  you're currently playing when that figure is non-zero instead.
- **"Mostly idle this session" popup** under 40% active play, once per
  session, dismissible.
- cm/360 coverage 100%. Filtering by exact cm, range, or favourites.
- Scenario testing: Viscose Benchmarks S2 (Medium/Hard/Expert), searchable,
  with rank thresholds.
- Session tracking: gaps, active %, daily totals, break reminders.
- PB celebration tiers with confetti.
- **Honest chart scaling** — σ-scaled axes, ±1σ noise band, PB as steps, 2:1
  plot area. See `CHART-SCALING.md`.
- Now-playing line + follow toggle, PB card under the session panel, most-played
  and PB cm badges, dd/mm/yy range pickers, real footer links.
- **Run resets detected and excluded** — see `NOTES.md`, "Run resets".
- **Release isolation fixed** — no-store on all assets, version-derived ports,
  build-namespaced localStorage, `release.py --verify`.
- **`?selftest=1`** — 36 numeric checks over fixed synthetic data.
- **Zero-score runs visible but never counted** — see `NOTES.md`, "Zero-score
  runs vs restarts".
- Collapsible explanations, non-colliding chart end labels, `install.bat`.
- **Folder picker is the real Explorer window** and is actually visible — see
  `NOTES.md`, "The folder picker, and why it looked broken".

Measured facts worth remembering:

- Warm-up effect is **−8.2%** — the first 3 runs of a session average 8.2% below
  later runs. This is why the exclusion exists.
- The old "Overall PB increase +3.7%" became "Ceiling change −0.1% ± 1.4%" once
  sample-size bias was removed. Most of the old figure was `max()` drift.
- "Typical change +1.0% ± 0.9%" is the one headline that survives as real signal.
- Latest session: 79 runs, 4h58m in KovaaK's, 1h18m actually playing — **26%
  active**.
- Cold parse 3.2s (was 99s), warm restart 60ms, render 67ms.

---

## Next up

**Freeze Batch 8 as v0.3.0.** The code, docs and CHANGELOG are done and
spot-tested in the browser (dev port 8765); `python release.py` (next minor,
no flag needed) freezes it, and a git commit is still pending — the working
tree has uncommitted changes covering all of Batch 8, deliberately left
uncommitted for you to review first.

After that, **Batch 9 → v0.4.0** — layout and calendar (wider page, top menu
bar, month calendar, session bar to the right, live "Time in KovaaK's").

Full detail and every later batch: `planning/BACKLOG.md`.

**Before you start, read the *Open questions* at the bottom of
`planning/BACKLOG.md`.** Each one ends in a bare `=` where Orb Eater writes the
answer between sessions. Anything with an answer after the `=` is a decision that
has already been made; anything with an empty `=` is still waiting and should not
be guessed at.

---

## Ground rules that carry over

- **Never copy from Corporate Serf Dashboard.** It is AGPL-3.0; copying would
  force this project to AGPL. Only its public feature description has been read.
- **Keep personal data out of the dev copy** — no personal favourites, no
  personal stats-folder path in the committed `config.json`.
- Everything will eventually go to GitHub, so `.gitignore` covers `cache/`,
  `logs/`, and `config.json`.
