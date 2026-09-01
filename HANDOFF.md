# Handoff — start here

Read this file first if you are picking the project up cold (new chat, new
machine, or after a `/clear`). It is the map; everything else is detail.

**Last updated:** 2026-09-01, after shipping v0.2.0.

---

## What this is

A local KovaaK's aim-trainer statistics app. Python stdlib server + two static
HTML front-ends, no dependencies, no network calls, no uploads.

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
| `app/data/benchmarks.json` | 216 benchmarks consolidated from `L:\Claude\Benchmarks\`. |
| `release.py` | Freezes the working copy into `releases/vX.Y.Z/` with its own port. |
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

## Verifying a build

```bash
python release.py --verify
```

Prints every release's port, build hash and core.js hash, plus a per-function
hash of the statistics path saying which calculation last changed and where. Open
any page with `?selftest=1` to run 36 numeric checks against fixed synthetic data.

---

## The five things that will confuse you

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

---

## Current state (v0.2.0)

Working and verified on ~21,600 real runs:

- Statistical rework — Ceiling (p90) / Typical (trimmed mean) / Floor (p10) with
  95% CIs, power analysis, warm-up and re-familiarisation exclusion.
- cm/360 coverage 100%. Filtering by exact cm, range, or favourites.
- 216 benchmarks, searchable, with rank thresholds.
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

**Batch 7 → v0.3.0** — the rest of the UI declutter: icons with hover text
instead of paragraphs of warning, a rewritten under-powered message, progress %
always shown (with the warning attached), an expand control per scenario with
clickable cm chips, and no more 0.0% session badge. The two explanation toggles
and the chart-label fix already shipped in v0.2.0.

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
