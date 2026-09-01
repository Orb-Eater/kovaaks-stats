#!/usr/bin/env python3
"""
Build app/data/benchmarks.json from the Viscose Benchmarks S2 sheets.

    python planning/viscose-import.py            # show what it would write
    python planning/viscose-import.py --write    # write it

Source: the "score targets viscose benchmarks s2 draft" CSV export, one file per
difficulty. Set VISCOSE_DIR below, or pass --dir.

This replaces the previous 216-benchmark dataset outright rather than merging.
That dataset included a Viscose S2 Medium built from a malformed JSON file that
was edited until it parsed - readable, not correct, with roughly 30 of its 39
scenarios lost. Nothing from it survives here.

Sheet quirks this handles
-------------------------
* Each difficulty uses a different set of rank names and a different number of
  them: Medium 9 (cinnabar..fuchsia), Hard 8 (Wool..Silk), Expert 6
  (interloper..eclipse).
* Rank columns are followed by working columns - evxl population data, notes,
  revision commentary - which are NOT ranks. The run of ranks ends at the first
  header containing data/notes/changes/count, or at the first blank one.
* Rank labels carry their target population share: "Wool, 50%" -> "Wool". Expert
  labels are bare words already.
* Expert has a trailing "matty rank (real)" column. It is deliberately dropped -
  it is not a rank anyone is measured against.
* Thresholds are quoted with thousands separators: "13,400" -> 13400.0.
* The sheet is a working draft: blank rows, and rows whose scenario name is a
  section heading rather than a scenario. Anything without at least two numeric
  thresholds is skipped.
"""

import argparse
import csv
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VISCOSE_DIR = r"L:\Claude\Benchmarks\Viscose s2\csv"
OUT = os.path.join(ROOT, "app", "data", "benchmarks.json")

# Difficulty -> (file suffix, benchmark name). Easier is deliberately not
# shipped; these three are the ones asked for.
SHEETS = [
    ("Medium", "Viscose Benchmarks S2 - Medium"),
    ("Hard",   "Viscose Benchmarks S2 - Hard"),
    ("Expert", "Viscose Benchmarks S2 - Expert"),
]

FILE_TMPL = "score targets viscose benchmarks s2 draft - %s.csv"

# A header that means "the ranks have ended and working columns have begun".
NOT_A_RANK = re.compile(r"data|notes|changes|count|^\s*$", re.I)
# Dropped by name wherever it appears.
IGNORED_RANKS = {"matty rank (real)", "matty rank", "matty"}


def clean_rank(label):
    """'Wool, 50%' -> 'Wool'.  'cinnabar, 95%+' -> 'cinnabar'.  'heroic' -> 'heroic'."""
    return label.split(",")[0].strip()


def to_number(cell):
    """'13,400' -> 13400.0.  '' / 'n/a' / a note -> None."""
    if cell is None:
        return None
    t = cell.strip().replace(",", "").replace("%", "")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def rank_columns(header):
    """Indices and names of the rank columns, in order, left to right."""
    cols = []
    for i, h in enumerate(header[1:], start=1):
        if NOT_A_RANK.search(h or ""):
            break                      # working columns start here
        name = clean_rank(h)
        if name.lower() in IGNORED_RANKS:
            continue                   # dropped, but keep scanning
        cols.append((i, name))
    return cols


def read_sheet(path):
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return [], []
    cols = rank_columns(rows[0])
    scenarios = []
    for row in rows[1:]:
        if not row:
            continue
        name = (row[0] or "").strip()
        if not name:
            continue
        ranks = []
        for i, rank_name in cols:
            v = to_number(row[i]) if i < len(row) else None
            if v is not None:
                ranks.append({"n": rank_name, "t": v})
        # A heading or a stray comment row has no thresholds worth keeping.
        if len(ranks) < 2:
            continue
        # Thresholds must climb. If the sheet has them out of order, sorting is
        # the honest fix - a rank ladder that goes down is a typo, not data.
        ranks.sort(key=lambda r: r["t"])
        scenarios.append({"n": name, "r": ranks})
    return cols, scenarios


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=VISCOSE_DIR, help="folder holding the CSVs")
    ap.add_argument("--write", action="store_true", help="write app/data/benchmarks.json")
    a = ap.parse_args()

    out = []
    for suffix, title in SHEETS:
        path = os.path.join(a.dir, FILE_TMPL % suffix)
        if not os.path.exists(path):
            raise SystemExit("! missing: %s" % path)
        cols, scenarios = read_sheet(path)
        out.append({"name": title, "scenarios": scenarios})
        print("  %-34s %2d ranks  %2d scenarios" % (title, len(cols), len(scenarios)))
        print("      ranks: %s" % ", ".join(n for _, n in cols))
        skipped = [n for n in ("matty rank (real)",) if n in open(path, encoding="utf-8-sig").readline()]
        if skipped:
            print("      dropped: %s" % ", ".join(skipped))

    total = sum(len(b["scenarios"]) for b in out)
    print("\n  %d benchmarks, %d scenarios total" % (len(out), total))

    if not a.write:
        print("\n  Dry run - nothing written. Add --write.")
        return 0

    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("\n  + wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
