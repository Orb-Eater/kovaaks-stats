# Parser spec — KovaaK's stats CSV

> Derived from 10 labelled files, 2024-11-11 to 2026-09-02, five of them
> hand-labelled as resets. Every rule below was validated against that set.
> Resolves blockers §0.1 and §0.3 of [V3.2-PATCH.md](V3.2-PATCH.md).

---

## 1. File layout

Four blocks separated by blank lines:

```
Kill #,Timestamp,Bot,Weapon,TTK,Shots,Hits,Accuracy,...        <- header, often no rows
                                                                   (tracking scenarios log no kills)
Weapon,Shots,Hits,Damage Done,Damage Possible,,Sens Scale,...  <- per-weapon header
Track Master 100,5993,3508,3508.0,5993.0,                      <- per-weapon row

Kills:,0                                                        <- summary block
Score:,10524.0
Scenario:,Smoothsphere Viscose Hard
Challenge Start:,19:34:40.714
...
Sens Scale:,cm/360                                              <- settings block
Horiz Sens:,40.0
DPI:,3200
Avg FPS:,1867.026733
```

### 1.1 The separator is `:,` — colon **and** comma

```
Score:,10524.0
       ^^ colon then comma
```

A regex matching a single separator character (`[:,]`) captures the colon and then
fails on the comma. This silently broke every field except `Score`, which had a looser
fallback, and is why the v1 validator reported `configs s?/d?/? = 21775`.

```js
const kv = k => {
  const m = text.match(new RegExp(
    '^' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ':\\s*,\\s*([^\\r\\n]*)', 'm'));
  return m ? m[1].trim() : null;
};
```

Line endings are mixed — `\r\n` between blocks, bare `\n` inside the summary block. Match
on `[^\r\n]*`, never `.*$` with a naive `$`.

### 1.2 Fields vary by scenario

Clicking scenarios populate `Kills`, `Avg TTK`, `Directs`. Tracking scenarios leave them
at zero and log no kill rows. Treat every field as optional. The four that must be present
are `Score`, the filename timestamp, `Sens Scale` + `Horiz Sens`, and `Avg FPS`.

---

## 2. Reset detection — solved

There is no explicit reset flag. **`Avg FPS` is the discriminator.** KovaaK's finalises it
only when a scenario runs to completion; abandon the run and it is written as `0.0`, or the
line is omitted entirely on a very early reset.

```js
o.avgFps  = kv('Avg FPS') === null || kv('Avg FPS') === '' ? null : parseFloat(kv('Avg FPS'));
o.isReset = o.avgFps === null || !isFinite(o.avgFps) || o.avgFps <= 0;
```

**Validation: 10/10 on the labelled set — 6 resets caught, 4 completed runs passed, zero
errors either way.**

| | Avg FPS |
|---|---|
| completed | 611.93, 837.24, 1078.11, 1867.03 |
| reset | 0.0 × 5, one file missing the line |

### 2.1 Secondary signals — cross-check only, do not use alone

A run reset almost immediately writes a degenerate record:

```
Scenario:,              <- empty
Hash:,                  <- empty
Challenge Start:,00:00:00.000
Avg FPS                 <- line absent
```

Only 1 of 6 labelled resets looked like this, so it catches early resets and misses the
rest. Store it as `o.degenerate` for agreement checking, but gate exclusion on `Avg FPS`.

### 2.2 Why this matters more than the count suggests

Score scales with time played rather than degrading gracefully. The same scenario, same
session:

| | shots | score |
|---|---|---|
| completed | 5993 | 10524.0 |
| reset | 133 | 279.0 |

A reset is not a slightly-low run. It is a near-zero one. At the ~26% rate the v1 run
reported, including them corrupts every average, and it corrupts them *unevenly* —
scenarios you restart more get dragged down harder.

**Re-measure the rate with this detector.** The v1 figure used a broken elapsed-time proxy
and only coincidentally landed near the true value.

---

## 3. cm/360 — solved, and simpler than expected

```
Sens Scale:,cm/360
Horiz Sens:,40.0
```

When `Sens Scale` is `cm/360`, **`Horiz Sens` is the cm/360 value directly**. No yaw
constant, no DPI arithmetic, no game-specific conversion.

```js
o.cm = (o.scale && /cm\s*\/\s*360/i.test(o.scale) && o.sens > 0) ? o.sens : null;
```

Resolved 10/10 on the labelled set: 40, 64, 30, 1.5.

- 40 and 64 match the user's stated 35–40 cm and 63 cm games.
- `FOVScale:,Overwatch` is a **separate field** and unrelated. Do not confuse it with
  `Sens Scale`.
- If a user sets `Sens Scale` to a game name rather than `cm/360`, conversion becomes
  necessary. Return `null` and exclude rather than guessing a yaw constant.

### 3.1 The field is not new

A 2024-11-11 file — the first day of this corpus — carries `Sens Scale`, `Horiz Sens`,
`DPI` and `Avg FPS` in the same layout as a 2026-09-02 file. **The theory that older
exports lacked sensitivity data is not supported.** The v1 failure was the regex, not the
format, so cm stratification is available across the entire history and V3.2 §0.1 can be
closed once re-run.

### 3.2 One value to check

`1w2ts Micro++ ultrasmall` reports 1.5 cm/360 at 20,000 DPI, against 1600–5500 DPI
elsewhere. Either a deliberate micro-adjustment experiment or a stale config. It is far
outside the rest of the distribution, so `OUTLIER_MIN_SHARE` should exclude it — but
confirm which it is, because if the DPI field is stale on a whole era of runs, cm is wrong
for that era.

---

## 4. Run duration — derivable, and new

Not stored directly, but recoverable:

```js
duration_s = filename_timestamp - Challenge_Start
```

The filename timestamp is the file **write** time, i.e. when the run ended.

Validated on completed runs: **59.3, 29.8, 59.3, 59.2 s** — exactly the 60s and 30s
scenario lengths, minus sub-second rounding.

```js
function runDuration(date, challStart){
  if(!date || !challStart || !/^\d\d:\d\d:\d\d/.test(challStart)) return null;
  const b = challStart.split(':').map(parseFloat);
  const end = date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds();
  let d = end - (b[0]*3600 + b[1]*60 + b[2]);
  if(d < -43200) d += 86400;            // midnight wrap
  if(d >  43200) d -= 86400;
  return d;
}
```

This matters for V3.2 §1. The time-indexed warm-up correction currently approximates
elapsed session time from inter-run gaps. With real durations you can compute **actual
elapsed play time**, which is what the correction should be indexed on — a session with
long idle gaps between runs is not warm in the same way as one with continuous play.

It also gives a second, independent reset detector: a run materially shorter than that
scenario's modal duration was abandoned. Use it to cross-check the `Avg FPS` rule at scale
rather than replacing it.

---

## 5. Filename parsing

Real files use dots and spaces:

```
Smoothsphere Viscose Hard - Challenge - 2026.09.02-19.34.30 Stats.csv
```

Upload and download paths often sanitise these to underscores, so accept both:

```js
const TS = /(\d{4})[._\-](\d{2})[._\-](\d{2})[-_ ](\d{2})[._:](\d{2})[._:](\d{2})/;
// split scenario on  [\s_]*-[\s_]*(Challenge|Ultimate|Scenario)[\s_]*-[\s_]*
```

`Scenario:` inside the file is more reliable than the filename when populated — but it is
empty on degenerate resets, so keep the filename as fallback.

**Re-check the 2,119-scenario count after this fix.** If separator handling was splitting
one scenario into variants, the real count is lower and the reachability picture in
V3.2 §4.1 improves.

---

## 6. Validation checklist

Re-run the validator with this parser and confirm:

- [ ] `cm_resolved_pct` above 95%, earliest date at the start of the corpus (T11b)
- [ ] Reset rate re-measured with `Avg FPS`, and `degenerate_overlap` reported (T11)
- [ ] `score_bias_if_kept` quantifies what resets were costing (T11)
- [ ] **T1 ICC re-run with sensitivity stratified.** The 0.581 figure pooled 40 cm and
      64 cm runs; the corrected value decides whether DEFF is ~20 or ~10, which drives the
      required-sessions number in T4
- [ ] T9 produces a real cm-inflation figure instead of `—`
- [ ] Scenario count after the separator fix
