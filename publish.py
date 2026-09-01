#!/usr/bin/env python3
"""
Publish a frozen release to GitHub, on one of exactly two channels.

    python publish.py --status                 what is on GitHub right now
    python publish.py 0.4.0 --beta             show what publishing would do
    python publish.py 0.4.0 --beta --yes       actually do it
    python publish.py 0.4.0 --base --yes       promote a build to base
    python publish.py --promote --yes          promote the current beta to base

Why two channels
----------------
A releases page with fourteen entries makes people pick, and most of them pick
wrong. There are two:

    base   the build that has been used enough to trust. GitHub "Latest".
    beta   the newest build. New work lands here first. GitHub "Pre-release".

Publishing a new version replaces **beta**. **Base** does not move until a beta
has proven itself and is promoted, at which point the previous base is deleted.
So there is always one boring option and one current option.

Safety
------
Nothing happens without `--yes`. Without it this prints the exact `gh` commands
it would run and exits. It never pushes commits - that is `git push` and is a
separate, deliberate act.

Requires the GitHub CLI (`gh`) to be installed and authenticated.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
RELEASES = os.path.join(ROOT, "releases")

# Tag names are stable per channel, so the download URL for "the current beta"
# never changes. The human-readable version lives in the release title and body.
CHANNEL_TAG = {"base": "base", "beta": "beta"}
CHANNEL_TITLE = {"base": "KovaaK's stats %s (base)",
                 "beta": "KovaaK's stats %s (beta)"}

# Per-install state must never end up inside a published zip.
EXCLUDE = {"cache", "logs", "__pycache__", ".browser-opened", "config.json"}


def gh(*args, check=True):
    """Run a gh command. Returns (rc, stdout, stderr)."""
    exe = shutil.which("gh") or r"C:\Program Files\GitHub CLI\gh.exe"
    p = subprocess.run([exe] + list(args), capture_output=True, text=True)
    if check and p.returncode != 0:
        raise SystemExit("! gh %s failed:\n%s" % (" ".join(args), p.stderr.strip()))
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def release_dir(version):
    d = os.path.join(RELEASES, "v" + version)
    if not os.path.isdir(d):
        raise SystemExit("! releases/v%s does not exist. Freeze it first:\n"
                         "    python release.py %s" % (version, version))
    return d


def make_zip(version, dest_dir):
    """Zip a frozen release, minus anything personal or generated."""
    src = release_dir(version)
    staging = os.path.join(dest_dir, "kovaaks-stats-%s" % version)
    shutil.copytree(src, staging,
                    ignore=shutil.ignore_patterns(*EXCLUDE))
    # A published build starts with no stats folder, like a fresh install.
    cfg_path = os.path.join(staging, "config.json")
    port = 8765
    try:
        with open(os.path.join(src, "config.json"), encoding="utf-8") as f:
            port = json.load(f).get("port", 8765)
    except Exception:
        pass
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump({"stats_folder": "", "port": port,
                   "scan_interval_seconds": 5, "open_browser": True}, f, indent=2)
    zip_base = os.path.join(dest_dir, "kovaaks-stats-%s" % version)
    return shutil.make_archive(zip_base, "zip", dest_dir,
                               os.path.basename(staging))


def notes_for(version):
    path = os.path.join(release_dir(version), "WHATS-NEW.txt")
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "See CHANGELOG.md."


def current(channel):
    """Which version is published on this channel, if any."""
    rc, out, _ = gh("release", "view", CHANNEL_TAG[channel],
                    "--json", "tagName,name,isPrerelease", check=False)
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def status():
    for ch in ("base", "beta"):
        info = current(ch)
        print("  %-5s %s" % (ch, info["name"] if info else "(nothing published)"))
    print()
    have = sorted(re.match(r"^v(.+)$", d).group(1)
                  for d in os.listdir(RELEASES) if re.match(r"^v[\d.]+$", d))
    print("  frozen locally: %s" % ", ".join(have))
    return 0


def publish(version, channel, yes):
    d = release_dir(version)
    title = CHANNEL_TITLE[channel] % ("v" + version)
    tag = CHANNEL_TAG[channel]
    prerelease = channel == "beta"
    existing = current(channel)

    print("  channel   : %s" % channel)
    print("  version   : v%s  (from %s)" % (version, d))
    print("  tag       : %s   %s" % (tag, "(pre-release)" if prerelease else "(latest)"))
    print("  replaces  : %s" % (existing["name"] if existing else "nothing"))
    print()

    if not yes:
        print("  Dry run. Nothing has been changed. To do it for real, add --yes.")
        print("  It would run:")
        if existing:
            print("    gh release delete %s --yes --cleanup-tag" % tag)
        print("    gh release create %s <zip> --title %r --notes-file <notes> %s"
              % (tag, title, "--prerelease" if prerelease else "--latest"))
        return 0

    tmp = tempfile.mkdtemp(prefix="kvpub-")
    try:
        zip_path = make_zip(version, tmp)
        notes_path = os.path.join(tmp, "notes.md")
        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(notes_for(version))
        if existing:
            gh("release", "delete", tag, "--yes", "--cleanup-tag")
            print("  - removed previous %s release (%s)" % (channel, existing["name"]))
        args = ["release", "create", tag, zip_path,
                "--title", title, "--notes-file", notes_path]
        args += ["--prerelease"] if prerelease else ["--latest"]
        gh(*args)
        print("  + published v%s as %s" % (version, channel))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


def promote(yes):
    """Make the current beta the new base."""
    beta = current("beta")
    if not beta:
        raise SystemExit("! nothing is published on beta, so there is nothing to promote")
    m = re.search(r"v([\d.]+)", beta["name"] or "")
    if not m:
        raise SystemExit("! could not read a version out of %r" % beta["name"])
    version = m.group(1)
    print("  promoting v%s from beta to base" % version)
    return publish(version, "base", yes)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", nargs="?", help="version to publish, e.g. 0.4.0")
    ap.add_argument("--base", action="store_true", help="publish as the stable build")
    ap.add_argument("--beta", action="store_true", help="publish as the newest build")
    ap.add_argument("--promote", action="store_true", help="make the current beta the base")
    ap.add_argument("--status", action="store_true", help="show what is published")
    ap.add_argument("--yes", action="store_true", help="actually do it")
    a = ap.parse_args()

    rc, _, _ = gh("auth", "status", check=False)
    if rc != 0:
        raise SystemExit("! gh is not authenticated. Run:  gh auth login")

    if a.status:
        return status()
    if a.promote:
        return promote(a.yes)
    if not a.version or not (a.base or a.beta):
        ap.print_help()
        return 1
    if a.base and a.beta:
        raise SystemExit("! pick one channel, not both")
    return publish(a.version, "base" if a.base else "beta", a.yes)


if __name__ == "__main__":
    sys.exit(main())
