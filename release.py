#!/usr/bin/env python3
"""
Freeze the current working copy as a numbered release.

    python release.py              # next minor: a batch is a feature release
    python release.py --patch      # next patch: a fix between batches
    python release.py 0.2.0        # explicit
    python release.py --verify     # prove which build each release really is

Copies server.py, start.bat, the docs and app/ into releases/vX.Y.Z/ and gives
that copy its own port, config, cache and logs. From then on it is completely
independent: you can keep editing the files here and the frozen release cannot
change or break, because it shares nothing with the working copy except the disk.

Versioning is SemVer (see NOTES.md, "Versioning"):

    a batch of features -> MINOR   0.1.0 -> 0.2.0
    a fix between them  -> PATCH   0.1.0 -> 0.1.1
    breaking change     -> MAJOR   0.9.0 -> 1.0.0

Ports are derived from the version string, deterministically, so two different
builds can never land on the same origin and share a browser cache or its
localStorage. Releases made before v0.1.0 keep the sequential ports already
written into their config.json.

A release starts with no stats folder set, exactly like a fresh install: it
offers the Steam folders it detected and remembers your choice in its own
config.json. Nothing personal is baked into a build.
"""

import hashlib
import json
import os
import re
import shutil
import sys
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
RELEASES = os.path.join(ROOT, "releases")
BASE_PORT = 8800          # legacy: releases up to v0.0.9 were numbered from here
PORT_LO, PORT_HI = 20000, 60000

# The statistics path. release.py --verify hashes these functions individually,
# so "did the maths change between two releases" is one command and it names the
# function rather than just saying the file differs.
STAT_FUNCS = [
    "stats", "computeCells", "overallOf", "changeWithSE", "annotateRuns",
    "runUsable", "quantileAt", "quantileSE", "trimSlice", "trimmedMean",
    "trimmedMeanSE", "requiredN", "computeTrends", "computeTrendSeries",
    "computeCmClusters", "computeCmDeltas", "getActivePool", "chartScale",
]

COPY_FILES = ["server.py", "start.bat", "install.bat", "LICENSE", "README.md",
              "CHANGELOG.md", "CALCULATIONS.md", "MEASUREMENT-SPEC.md",
              "CHART-SCALING.md", "NOTES.md"]
COPY_DIRS = ["app"]
# generated per-install state - never inherited from the working copy
SKIP = {"cache", "logs", "__pycache__", "releases", "config.json"}


def existing_versions():
    """Every release we can see, as (tuple, name). Reads the folder name rather
    than VERSION, since folders sometimes get renamed by hand."""
    out = []
    if not os.path.isdir(RELEASES):
        return out
    for d in os.listdir(RELEASES):
        m = re.match(r"^v(\d+(?:\.\d+)*)$", d)
        if m:
            out.append((tuple(int(x) for x in m.group(1).split(".")), m.group(1)))
    return sorted(out)


def next_version(kind="minor"):
    """Bump the highest release seen. A batch of features is a MINOR bump; only
    a fix between batches takes the PATCH digit. See NOTES.md, "Versioning"."""
    vs = existing_versions()
    if not vs:
        return "0.1.0" if kind == "minor" else "0.0.1"
    parts = list(vs[-1][0])
    while len(parts) < 3:
        parts.append(0)
    if kind == "minor":
        parts[1] += 1
        parts[2] = 0
    else:
        parts[2] += 1
    return ".".join(str(p) for p in parts)


def changelog_section(version):
    """Pull just this version's section out of CHANGELOG.md."""
    path = os.path.join(ROOT, "CHANGELOG.md")
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    m = re.search(r"^##\s+v" + re.escape(version) + r"\b.*?(?=^##\s|\Z)",
                  text, re.MULTILINE | re.DOTALL)
    return m.group(0).strip() if m else None


def port_for(version):
    """Derive the port from the version string.

    The old scheme handed out the next free port, so the *first* release in any
    copy of this folder got 8801 - and two different builds on two drives then
    shared the origin http://127.0.0.1:8801, along with its browser cache and its
    localStorage. That is how an old release ended up appearing to have newer
    features. Deriving the port from the version makes one origin mean exactly
    one build, on every machine, forever."""
    return PORT_LO + zlib.crc32(version.encode("utf-8")) % (PORT_HI - PORT_LO)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


FN_RE = "^function %s\\(.*?^}"


def stat_fn_hashes(core_js_path):
    """Hash each statistics function on its own, so a diff between releases says
    which calculation moved rather than just 'core.js changed'."""
    try:
        with open(core_js_path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return {}
    out = {}
    for name in STAT_FUNCS:
        m = re.search(FN_RE % re.escape(name), text, re.MULTILINE | re.DOTALL)
        out[name] = hashlib.sha256(m.group(0).encode("utf-8")).hexdigest()[:10] if m else "-"
    return out


# Excluded from the build hash. config.json and .browser-opened are per-install
# state; VERSION and WHATS-NEW.txt are release metadata rather than code; and
# build.js holds the hash itself, which cannot be an input to its own value.
UNHASHED = {"config.json", ".browser-opened", "VERSION", "WHATS-NEW.txt", "build.js"}


def build_hash(folder):
    """One hash for a build: only the files that actually ship, in a stable
    order. Restricted to COPY_FILES + COPY_DIRS so that hashing the working copy
    and hashing a freeze of it give the same answer - otherwise `dev` would never
    match the release made from it and the number would prove nothing."""
    h = hashlib.sha256()
    paths = []
    for f in COPY_FILES:
        if f not in UNHASHED and os.path.exists(os.path.join(folder, f)):
            paths.append(f)
    for d in COPY_DIRS:
        root = os.path.join(folder, d)
        for base, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP)
            for f in sorted(files):
                if f in UNHASHED:
                    continue
                paths.append(os.path.relpath(os.path.join(base, f), folder))
    for rel in sorted(p.replace(os.sep, "/") for p in paths):
        h.update(rel.encode("utf-8"))
        h.update(sha(os.path.join(folder, rel.replace("/", os.sep))).encode("ascii"))
    return h.hexdigest()


def _row(label, folder, port):
    core = os.path.join(folder, "app", "core.js")
    return {
        "version": label,
        "port": port,
        "build": build_hash(folder)[:16],
        "core": sha(core)[:10] if os.path.exists(core) else "-",
        "bytes": os.path.getsize(core) if os.path.exists(core) else 0,
        "stats": stat_fn_hashes(core),
    }


def verify():
    """Print what each release actually contains. Answers "is this really the
    build I think it is" without opening a browser."""
    rows = []
    for _, name in existing_versions():
        d = os.path.join(RELEASES, "v" + name)
        port = "?"
        try:
            with open(os.path.join(d, "config.json"), encoding="utf-8") as f:
                port = json.load(f).get("port", "?")
        except Exception:
            pass
        rows.append(_row(name, d, port))
    rows.append(_row("dev", ROOT, 8765))

    print()
    print("%-8s %-7s %-18s %-12s %s" % ("version", "port", "build", "core.js", "bytes"))
    print("-" * 62)
    for r in rows:
        print("%-8s %-7s %-18s %-12s %d" %
              (r["version"], r["port"], r["build"], r["core"], r["bytes"]))

    print()
    print("statistics functions - a hash differing from the column to its left")
    print("means that calculation changed in that release:")
    print()
    print("%-20s%s" % ("function", "".join("%-12s" % r["version"][:11] for r in rows)))
    print("-" * (20 + 12 * len(rows)))
    for name in STAT_FUNCS:
        cells = [r["stats"].get(name, "-") for r in rows]
        # Only the last change matters. Saying "changed" because v0.0.2 predates
        # the statistics rework is noise on every single row.
        last = None
        for i in range(1, len(cells)):
            if cells[i] != cells[i - 1] and cells[i] != "-":
                last = rows[i]["version"]
        note = ("  unchanged since v%s" % last) if last else "  never changed"
        if last == rows[-1]["version"]:
            note = "  <- CHANGED in this build"
        print("%-20s%s%s" % (name, "".join("%-12s" % c for c in cells), note))

    seen = {}
    for r in rows:
        seen.setdefault(str(r["port"]), []).append(r["version"])
    clash = {k: v for k, v in seen.items() if len(v) > 1}
    print()
    if clash:
        for k, v in clash.items():
            print("! port %s is shared by %s" % (k, ", ".join(v)))
        print("  builds on one port share a browser cache and its localStorage.")
        print("  Re-freeze the newer one to give it a version-derived port.")
    else:
        print("+ every build has its own port, so none of them can share a cache")
    return 0


def main():
    args = sys.argv[1:]
    if "--verify" in args:
        return verify()
    if args and not args[0].startswith("-"):
        version = args[0].lstrip("vV")
        if not re.match(r"^\d+(\.\d+)*$", version):
            print("! version should look like 0.2.0")
            return 1
    else:
        kind = "patch" if "--patch" in args else "minor"
        version = next_version(kind)
        print("+ no version given, using next %s release: %s" % (kind, version))

    dest = os.path.join(RELEASES, "v" + version)
    if os.path.exists(dest):
        ans = input("releases/v%s already exists. Overwrite it? [y/N] " % version)
        if ans.strip().lower() != "y":
            print("cancelled")
            return 1
        shutil.rmtree(dest)
    os.makedirs(dest)

    for f in COPY_FILES:
        src = os.path.join(ROOT, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, f))
    for d in COPY_DIRS:
        src = os.path.join(ROOT, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(dest, d),
                            ignore=shutil.ignore_patterns(*SKIP))

    port = port_for(version)
    # Deliberately blank. A release used to inherit whatever stats folder the
    # working copy happened to be pointing at, which is one person's path baked
    # into a build meant for anyone - and it silently overrode the folder the
    # user had already chosen for that release. Starting empty means the app does
    # what it does on a fresh install: offers the Steam folders it detected, and
    # remembers the choice in this release's own config.json from then on.
    with open(os.path.join(dest, "config.json"), "w", encoding="utf-8") as f:
        json.dump({"stats_folder": "", "port": port,
                   "scan_interval_seconds": 5, "open_browser": True}, f, indent=2)
    with open(os.path.join(dest, "VERSION"), "w", encoding="utf-8") as f:
        f.write(version + "\n")


    section = changelog_section(version)
    if section:
        with open(os.path.join(dest, "WHATS-NEW.txt"), "w", encoding="utf-8") as f:
            f.write(section + "\n")
        print("+ WHATS-NEW.txt written from CHANGELOG.md")
    else:
        print("! no '## v%s' section in CHANGELOG.md - add one so this release" % version)
        print("  says what changed. Writing a placeholder for now.")
        with open(os.path.join(dest, "WHATS-NEW.txt"), "w", encoding="utf-8") as f:
            f.write("## v%s\n\n(no changelog entry written)\n" % version)

    # Stamped last, once every other shipped file is in place, so the hash the
    # page reports is the hash --verify computes. Baked in rather than fetched so
    # localStorage keys can be namespaced per build synchronously at load.
    bh = build_hash(dest)
    with open(os.path.join(dest, "app", "build.js"), "w", encoding="utf-8") as f:
        f.write("window.KVA_BUILD = %s;\n" % json.dumps(version))
        f.write("window.KVA_BUILD_HASH = %s;\n" % json.dumps(bh[:12]))

    print("+ froze v%s -> %s" % (version, dest))
    print("  build hash:   %s" % bh[:16])
    print("  run it with:  %s" % os.path.join(dest, "start.bat"))
    print("  it will serve on http://127.0.0.1:%d/  (derived from the version)" % port)
    print("  the working copy in this folder is untouched and still uses its own port")
    print("  check every release with:  python release.py --verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
