#!/usr/bin/env python3
"""
KovaaK's stats - optional auto-updater.

Run by start.bat as a pre-flight step, before server.py launches. Checks
GitHub for a newer beta release, and if there is one, downloads and applies
it. Never blocks the app: any failure (no network, corrupt download, no
release yet) is printed and this exits 0 so start.bat moves on regardless.

Stdlib only, same constraint as server.py - no pip install required.
"""

import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

# Not every Python found on a user's PC puts the script's own folder on
# sys.path (some embeddable/bundled distributions don't) - added explicitly
# so `import server` below is not left to chance.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# server.py already resolves these correctly whether it's running flat (the
# dev working copy) or nested under internal/ (a frozen release, Batch 11) -
# updater.py lives right next to it in both layouts, so reuse them rather than
# re-deriving the same logic twice.
from server import ROOT, RELEASE_ROOT, APP_VERSION, CONFIG_PATH, DEFAULT_CONFIG

REPO = "Orb-Eater/kovaaks-stats"
API_URL = "https://api.github.com/repos/%s/releases/tags/beta" % REPO
TIMEOUT = 5  # seconds - a hung connection must never stall start.bat

# Never touched by an update: batch files that may be (indirectly) currently
# executing, and per-install state. publish.py's own EXCLUDE already keeps
# cache/logs/config.json out of the zip, but skip them defensively too rather
# than assume that always holds.
SKIP_NAMES = {"install.bat", "start.bat", "config.json", "cache", "logs", "__pycache__"}


def ver_tuple(s):
    parts = (re.sub(r"[^\d.]", "", s or "0").split(".") + ["0", "0", "0"])[:3]
    return tuple(int(p) if p.isdigit() else 0 for p in parts)


def read_auto_update():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f).get("auto_update", DEFAULT_CONFIG["auto_update"])
    except OSError:
        return DEFAULT_CONFIG["auto_update"]


def fetch_release():
    req = urllib.request.Request(API_URL, headers={
        "Accept": "application/vnd.github+json",
        # GitHub's API rejects requests with no User-Agent at all.
        "User-Agent": "kovaaks-stats-updater",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def zip_asset_url(release):
    for a in release.get("assets", []):
        if a.get("name", "").endswith(".zip"):
            return a["browser_download_url"]
    return None


def download(url, dest_path):
    req = urllib.request.Request(url, headers={"User-Agent": "kovaaks-stats-updater"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r, open(dest_path, "wb") as f:
        shutil.copyfileobj(r, f)


def apply_update(staging_root):
    """Copy-merge an extracted release into RELEASE_ROOT/internal, skipping
    anything per-install or currently executing. Raises on any failure - the
    caller is responsible for backup/rollback around this.

    staging_root is the zip's own top-level folder. It is only guaranteed to
    have the internal/ nesting (Batch 11) once a beta has been published from
    this new release.py - until then it is still flat, the same layout
    running installs already have. Detecting it here (the same content_root()
    idea release.py itself uses) means the updater does the right thing on
    either side of that transition, always landing content under internal/
    on disk regardless of how the download was shaped."""
    content_root = os.path.join(staging_root, "internal")
    if not os.path.isdir(content_root):
        content_root = staging_root
    dest_internal = os.path.join(RELEASE_ROOT, "internal")
    for base, dirs, files in os.walk(content_root):
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
        rel_base = os.path.relpath(base, content_root)
        top = rel_base.split(os.sep)[0] if rel_base != "." else None
        for name in files:
            if (top or name) in SKIP_NAMES:
                continue
            rel = name if rel_base == "." else os.path.join(rel_base, name)
            dst = os.path.join(dest_internal, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(base, name), dst)


def main():
    if APP_VERSION == "dev":
        print("  (updater: dev checkout, nothing to update)")
        return 0

    if not read_auto_update():
        print("  Auto-update disabled in config.json.")
        return 0

    try:
        release = fetch_release()
    except Exception as e:
        print("! Could not check for updates: %s - continuing without updating." % e)
        return 0

    m = re.search(r"v([\d.]+)", release.get("name") or "")
    remote_version = m.group(1) if m else None
    if not remote_version or ver_tuple(remote_version) <= ver_tuple(APP_VERSION):
        print("  Up to date (v%s)." % APP_VERSION)
        return 0

    url = zip_asset_url(release)
    if not url:
        print("! Update v%s found but has no zip asset - skipping." % remote_version)
        return 0

    tmp = tempfile.mkdtemp(prefix="kva-update-")
    try:
        zip_path = os.path.join(tmp, "update.zip")
        try:
            download(url, zip_path)
            with zipfile.ZipFile(zip_path) as zf:
                if zf.testzip() is not None:
                    raise ValueError("downloaded zip is corrupt")
                zf.extractall(tmp)
        except Exception as e:
            print("! Update download failed: %s - continuing without updating." % e)
            return 0

        # The zip's one nested folder, e.g. kovaaks-stats-0.5.0/ (publish.py's
        # make_zip), holding the same install.bat/start.bat/internal/ layout
        # release.py itself produces.
        entries = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d)) and d != "__MACOSX"]
        staging_root = os.path.join(tmp, entries[0]) if entries else None
        if not staging_root:
            print("! Downloaded update looked empty - continuing without updating.")
            return 0

        internal_dir = os.path.join(RELEASE_ROOT, "internal")
        backup_dir = os.path.join(RELEASE_ROOT, "internal.bak")
        if os.path.isdir(backup_dir):
            shutil.rmtree(backup_dir)
        shutil.copytree(internal_dir, backup_dir)

        try:
            apply_update(staging_root)
        except Exception as e:
            print("! Update failed and was rolled back: %s" % e)
            shutil.rmtree(internal_dir, ignore_errors=True)
            shutil.move(backup_dir, internal_dir)
            return 0

        print("+ Updated to v%s." % remote_version)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
