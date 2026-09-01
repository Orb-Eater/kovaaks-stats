#!/usr/bin/env python3
"""
KovaaK's stats - local server.

Parses your KovaaK's stats CSVs once, caches the parsed result on disk, watches
the folder for new runs, and serves everything to the browser app. Starting it
again is fast because only files that are new or changed get re-parsed.

    python server.py

Then open http://127.0.0.1:8765/ (full app) or /simple.html (stripped-back one).

Stdlib only - no pip install required.
"""

import hashlib
import json
import os
import re
import socket
import subprocess
import string
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
LOG_DIR = os.path.join(ROOT, "logs")
CACHE_DIR = os.path.join(ROOT, "cache")
CONFIG_PATH = os.path.join(ROOT, "config.json")

# stats_folder is intentionally empty: you pick your own folder in the app on
# first launch, and it gets remembered here afterwards.
DEFAULT_CONFIG = {
    "stats_folder": "",
    "port": 8765,
    "scan_interval_seconds": 5,
    "open_browser": True,
}

CONFIG = dict(DEFAULT_CONFIG)


def read_version():
    """Frozen releases carry a VERSION file; the working copy does not."""
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip() or "dev"
    except OSError:
        return "dev"


APP_VERSION = read_version()

# ---------------------------------------------------------------- config

def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            print("! config.json unreadable (%s); using defaults" % e)
    else:
        save_config(cfg)
    return cfg


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except OSError as e:
        print("! could not write config.json: %s" % e)


# ------------------------------------------------------- folder detection

STATS_TAIL = os.path.join("steamapps", "common", "FPSAimTrainer", "FPSAimTrainer", "stats")


def detect_stats_folders():
    """Best-effort guesses at where KovaaK's keeps its stats on this machine."""
    roots = []
    for env in ("ProgramFiles(x86)", "ProgramFiles"):
        base = os.environ.get(env)
        if base:
            roots.append(os.path.join(base, "Steam"))
    for d in string.ascii_uppercase:
        drive = d + ":\\"
        if not os.path.exists(drive):
            continue
        roots += [os.path.join(drive, "Steam"),
                  os.path.join(drive, "SteamLibrary"),
                  os.path.join(drive, "Games", "Steam"),
                  os.path.join(drive, "Program Files (x86)", "Steam")]

    # Steam records extra library drives in libraryfolders.vdf
    for r in list(roots):
        vdf = os.path.join(r, "steamapps", "libraryfolders.vdf")
        if os.path.exists(vdf):
            try:
                with open(vdf, encoding="utf-8", errors="replace") as f:
                    txt = f.read()
                for m in re.finditer(r'"path"\s*"([^"]+)"', txt):
                    roots.append(m.group(1).replace("\\\\", "\\"))
            except OSError:
                pass

    found, seen = [], set()
    for r in roots:
        p = os.path.join(r, STATS_TAIL)
        key = os.path.normcase(p)
        if key in seen:
            continue
        seen.add(key)
        if os.path.isdir(p):
            found.append(p)
    return found


# Bump whenever the shape of a parsed row changes. The disk cache stores rows
# verbatim, so without this a format change leaves every already-parsed run stuck
# in the old shape until its file happens to be touched.
#   1  scen, ts, score, cm360, scale, duration
#   2  + reset flag
#   3  reset now requires a score > 0 - a zero-scoring instant end is a real
#      NeverMiss run, not an abandoned attempt
ROW_SCHEMA = 3


def cache_path_for(folder):
    key = os.path.normcase(os.path.abspath(folder)).encode("utf-8")
    return os.path.join(CACHE_DIR, hashlib.sha1(key).hexdigest()[:16] + ".json")


def folder_is_usable(folder):
    """Real directory containing at least one .csv."""
    if not folder or not os.path.isdir(folder):
        return False, "That folder does not exist."
    try:
        with os.scandir(folder) as it:
            for e in it:
                if e.name.lower().endswith(".csv"):
                    return True, ""
    except OSError as e:
        return False, "Could not read that folder: %s" % e
    return False, "No .csv files in that folder - pick the KovaaK's 'stats' folder itself."


# ---------------------------------------------------------------- parsing
# Mirrors app/core.js exactly. Two quirks worth remembering:
#  * KovaaK's writes settings as "Key:,value" - colon AND comma - so the
#    separator class must allow one or more of [:,].
#  * "Sens Scale" appears twice: once as a column header in the per-weapon
#    summary row, once as the real setting. Only the line-anchored one counts.

TS_RE = re.compile(r"(\d{4})[.\-](\d{2})[.\-](\d{2})[-_ ](\d{2})[.:](\d{2})[.:](\d{2})")
KV_RE = re.compile(r"^\s*([A-Za-z][A-Za-z %()/]*?)\s*[:,]+\s*([-\d.]+)")
SCALE_RE = re.compile(r"^\s*Sens\s*Scale\s*:\s*,?\s*([^\r\n,]+)", re.IGNORECASE | re.MULTILINE)
CUT_RE = re.compile(r"\s*-\s*(Challenge|Ultimate|Scenario)\s*-\s*", re.IGNORECASE)
TAIL_RE = re.compile(r"\s*-\s*(Challenge|Ultimate)\s*$", re.IGNORECASE)

# Verified multipliers from KovaaK's own FovSensConfig.json, solved for cm:
#   cm = 360 * 2.54 / (sens * K * dpi)
# Scales whose formula depends on FOV or carries an offset term (Splitgate,
# Paladins, Battlefield, GTA 5, PUBG) are deliberately absent - better to
# report no cm/360 than a silently wrong one.
CM_K = {
    "quake/source": 0.022, "quake champions": 0.022, "overwatch": 0.0066,
    "valorant": 0.06996, "apex legends": 0.022, "fortnite": 0.005555,
    "counter-strike": 0.022, "call of duty": 0.0066, "rainbow 6: siege": 0.018 / 3.141592653589793,
    "diabotical": 1.0 / 60, "destiny 2": 0.0066, "halo": 0.022222, "rust": 0.1125,
    "reflex arena": 0.018 / 3.141592653589793, "batallion": 0.017501, "ue4": 0.07,
    "hunt: showdown": 0.0429718162181364, "gundam evolution": 0.0003888500001,
    "the finals": 0.001, "roblox": 1.01061008, "roblox arsenal": 0.375,
    "marvel rivals": 0.0175, "deadlock": 0.044, "csgo": 0.022, "fragpunk": 0.05555,
    "strinova": 0.01388194363, "delta force": 0.03,
}


def parse_name(fn):
    base = re.sub(r"\.csv$", "", fn, flags=re.IGNORECASE)
    m = TS_RE.search(base)
    ts = None
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                          int(m.group(4)), int(m.group(5)), int(m.group(6)))
            ts = int(dt.timestamp() * 1000)
        except ValueError:
            ts = None
    cut = CUT_RE.search(base)
    if cut and cut.start() > 0:
        scen = base[:cut.start()]
    elif m:
        scen = re.sub(r"\s*-\s*$", "", base[:m.start()])
    else:
        scen = base
    return TAIL_RE.sub("", scen).strip(), ts


def parse_body(text):
    out = {}
    for line in text.splitlines():
        m = KV_RE.match(line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        try:
            val = float(m.group(2))
        except ValueError:
            continue
        if key == "score" and "score" not in out:
            out["score"] = val
        elif key == "horiz sens" and "sens" not in out:
            out["sens"] = val
        elif key == "dpi" and "dpi" not in out:
            out["dpi"] = val
    if "score" not in out:
        m2 = re.search(r"Score:?[,\s]+([-\d.]+)", text, re.IGNORECASE)
        if m2:
            out["score"] = float(m2.group(1))
    sm = SCALE_RE.search(text)
    if sm:
        scale = sm.group(1).strip()
        out["scale"] = scale
        key = scale.lower()
        sens = out.get("sens")
        if sens:
            if key == "cm/360":
                out["cm360"] = sens
            elif key == "in/360":
                out["cm360"] = sens * 2.54
            elif key in CM_K and out.get("dpi"):
                out["cm360"] = (360 * 2.54) / (sens * CM_K[key] * out["dpi"])
    return out


# "Challenge Start" is a time of day; the filename timestamp is when the run
# ended. The difference gives run duration, which is what session timing needs.
CHALLENGE_START_RE = re.compile(r"^\s*Challenge\s*Start\s*:\s*,?\s*(\d{2}):(\d{2}):(\d{2})",
                                re.IGNORECASE | re.MULTILINE)


# Filename timestamps are whole seconds, so a restart lands at exactly 0. This
# was measured on 21,635 real runs before it was chosen: 40 runs sit at 0s, then
# 294 at 1s, 270 at 2s, 179 at 3s - and those are genuine NeverMiss runs that
# ended the moment a shot was missed. A window of even +-2s swallowed 743 real
# runs. Exactly zero is the only safe cut.
RESET_MAX_SEC = 0.5


def run_timing(text, ts):
    """Return (duration_seconds_or_None, is_reset).

    With "log every run" enabled, KovaaK's writes a stats file for an attempt you
    restarted as well as for one you finished. They are distinguishable, and not
    by score - a reset 40 seconds into a good run outscores a completed bad one.

    The structural signal is Challenge Start. On a restart the game stamps the
    file with the *new* challenge's start time, which is the moment you pressed
    restart - the same moment the file itself is written. So a reset measures
    zero elapsed seconds, while a completed run measures the scenario length.
    The next completed run then inherits that same Challenge Start, which is the
    corroborating tell:

        03:55:51 file, Challenge Start 03:55:51  ->  0.0s   reset
        03:56:32 file, Challenge Start 03:56:32  ->  0.0s   reset
        03:57:17 file, Challenge Start 03:57:17  ->  0.0s   reset
        03:58:17 file, Challenge Start 03:57:17  -> 60.0s   completed

    One honest caveat: a NeverMiss run where the first shot misses also ends
    inside its opening second and is indistinguishable from a restart. Those
    always score 0, so the caller only treats a zero-length run as a reset when
    it actually scored something. A zero-scoring run is a real run that ended
    badly - it stays visible, it just never enters a percentage.
    """
    m = CHALLENGE_START_RE.search(text)
    if not m or ts is None:
        return None, False
    end = datetime.fromtimestamp(ts / 1000.0)
    try:
        start = end.replace(hour=int(m.group(1)), minute=int(m.group(2)),
                            second=int(m.group(3)), microsecond=0)
    except ValueError:
        return None, False
    secs = (end - start).total_seconds()
    # Checked before the midnight correction: a reset also has start >= end, and
    # wrapping it would turn 0 seconds into nearly 24 hours.
    if -RESET_MAX_SEC <= secs <= RESET_MAX_SEC:
        return None, True
    if secs < 0:                         # run genuinely crossed midnight
        secs += 86400
    # Anything beyond an hour is a clock oddity rather than a real run.
    return (round(secs, 1) if 0 < secs < 3600 else None), False


def parse_file(path, fn):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return None
    scen, ts = parse_name(fn)
    if ts is None:
        return None
    b = parse_body(text)
    if "score" not in b:
        return None
    dur, reset = run_timing(text, ts)
    # A restart that happened before you scored anything is indistinguishable
    # from a NeverMiss run whose first shot missed. Both end instantly with a
    # score of 0. Only a zero-length run that DID score is unambiguously an
    # abandoned attempt, so only that is flagged as a reset; the rest are handled
    # client-side as zero-score runs, which stay visible but never enter a
    # percentage. See runVisible/runUsable in core.js.
    if reset and not (b["score"] > 0):
        reset = False
    return [scen, ts, b["score"], b.get("cm360"), b.get("scale"), dur, 1 if reset else 0]


# ---------------------------------------------------------------- index

class StatsIndex:
    """Parsed runs keyed by filename, persisted to cache.json."""

    def __init__(self, folder=""):
        self.lock = threading.RLock()
        self.folder = ""
        self.by_file = {}     # filename -> [scen, ts, score, cm360, scale]
        self.mtimes = {}      # filename -> mtime
        self.version = 0
        self.scanning = False
        if folder:
            self.set_folder(folder)

    def set_folder(self, folder):
        """Point at a different stats folder. Each folder keeps its own cache,
        so switching back and forth stays instant."""
        with self.lock:
            self.folder = folder
            self.by_file = {}
            self.mtimes = {}
            self.version += 1
        self._load_cache()

    def _load_cache(self):
        if not self.folder:
            return
        path = cache_path_for(self.folder)
        if not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as f:
                c = json.load(f)
            if c.get("folder") != self.folder:
                pass
            elif c.get("schema") != ROW_SCHEMA:
                print("+ cache was written by an older parser; re-reading your runs")
            else:
                with self.lock:
                    self.by_file = c.get("by_file", {})
                    self.mtimes = c.get("mtimes", {})
                print("+ cache: %d runs already parsed" % len(self.by_file))
        except Exception as e:
            print("! cache unreadable (%s); starting fresh" % e)

    def _save_cache(self):
        if not self.folder:
            return
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = cache_path_for(self.folder)
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"folder": self.folder, "schema": ROW_SCHEMA,
                           "by_file": self.by_file, "mtimes": self.mtimes},
                          f, separators=(",", ":"))
            os.replace(tmp, path)
        except OSError as e:
            print("! could not write cache: %s" % e)

    def scan(self, verbose=False):
        """Parse anything new or modified. Returns number of files parsed."""
        if not self.folder or not os.path.isdir(self.folder):
            return 0
        seen, todo = set(), []
        with os.scandir(self.folder) as it:
            for e in it:
                if not e.name.lower().endswith(".csv"):
                    continue
                seen.add(e.name)
                try:
                    mt = e.stat().st_mtime
                except OSError:
                    continue
                if self.mtimes.get(e.name) != mt:
                    todo.append((e.name, e.path, mt))

        gone = set(self.by_file) - seen
        parsed = 0
        if todo or gone:
            # Parsing 20k+ files is almost entirely disk wait, so a thread pool
            # helps a lot here even with the GIL (~4x on a cold start).
            results = []
            if todo:
                workers = min(32, (os.cpu_count() or 4) * 4)
                with ThreadPoolExecutor(max_workers=workers) as ex:
                    futs = {ex.submit(parse_file, p, n): (n, mt) for n, p, mt in todo}
                    for fut in as_completed(futs):
                        name, mt = futs[fut]
                        try:
                            row = fut.result()
                        except Exception:
                            row = None
                        results.append((name, mt, row))
                        parsed += 1
                        if verbose and parsed % 2500 == 0:
                            print("  parsed %d/%d..." % (parsed, len(todo)))
            with self.lock:
                for name in gone:
                    self.by_file.pop(name, None)
                    self.mtimes.pop(name, None)
                for name, mt, row in results:
                    self.mtimes[name] = mt
                    if row:
                        self.by_file[name] = row
                    else:
                        self.by_file.pop(name, None)
                self.version += 1
            self._save_cache()
            if verbose or parsed:
                print("+ indexed %d new/changed, %d removed (total %d runs, v%d)"
                      % (parsed, len(gone), len(self.by_file), self.version))
        return parsed

    def scan_guarded(self, verbose=False):
        self.scanning = True
        try:
            return self.scan(verbose=verbose)
        finally:
            self.scanning = False

    def payload(self):
        """Compact form the browser expects: name dictionary + rows."""
        with self.lock:
            names, idx, rows = [], {}, []
            for row in self.by_file.values():
                scen = row[0]
                i = idx.get(scen)
                if i is None:
                    i = len(names)
                    names.append(scen)
                    idx[scen] = i
                # Kept positional and length-tolerant: a cache written by an older
                # parser has fewer columns, and must still load.
                rows.append([i, row[1], row[2], row[3], row[4],
                             row[5] if len(row) > 5 else None,
                             row[6] if len(row) > 6 else 0])
            return {"version": self.version, "folder": self.folder,
                    "names": names, "rows": rows, "skipped": 0}


BROWSER_REOPEN_AFTER_MIN = 90


def should_open_browser(port):
    """True only if we haven't auto-opened this port in a while."""
    stamp = os.path.join(ROOT, ".browser-opened")
    now = time.time()
    try:
        with open(stamp, encoding="utf-8") as f:
            last_port, last_t = f.read().split()
        if int(last_port) == port and (now - float(last_t)) < BROWSER_REOPEN_AFTER_MIN*60:
            return False
    except Exception:
        pass
    try:
        with open(stamp, "w", encoding="utf-8") as f:
            f.write("%d %f" % (port, now))
    except OSError:
        pass
    return True


def port_in_use(port, host="127.0.0.1"):
    s = socket.socket()
    s.settimeout(0.4)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


DIALOG_TITLE = "Select your KovaaK’s stats folder"


def _pick_tkinter():
    """Nicest option when it exists - but plenty of Python builds ship without
    tkinter (embeddable distributions, some vendored runtimes), and then this
    raises ModuleNotFoundError rather than degrading."""
    import tkinter
    from tkinter import filedialog
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(title=DIALOG_TITLE) or None
    finally:
        root.destroy()


def _pick_powershell():
    """Windows fallback. WinForms' FolderBrowserDialog is part of the OS, so it
    works no matter how Python was built. -STA is required: the dialog is a COM
    apartment-threaded control and silently fails without it."""
    if os.name != "nt":
        return None
    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$d.Description = '%s';"
        "$d.ShowNewFolderButton = $false;"
        "$f = New-Object System.Windows.Forms.Form;"
        "$f.TopMost = $true;"
        "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK)"
        " { [Console]::Out.Write($d.SelectedPath) }"
    ) % DIALOG_TITLE.replace("'", "''")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    out = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", script],
        capture_output=True, text=True, timeout=300, creationflags=flags)
    return (out.stdout or "").strip() or None


def native_pick_folder():
    """Open a real folder dialog on this machine. The server runs locally, so
    this is the closest thing to a normal 'Browse...' button - browsers refuse
    to hand a web page an absolute path.

    Tries every method available rather than giving up on the first failure. If
    they all fail the paste box is still there and works fine, so the message
    says that instead of reading like a crash."""
    result = {"folder": None, "opened": False, "tried": []}

    def run():
        for name, fn in (("tkinter", _pick_tkinter), ("powershell", _pick_powershell)):
            if fn is _pick_powershell and os.name != "nt":
                result["tried"].append("%s: Windows only" % name)
                continue
            try:
                folder = fn()
            except Exception as e:
                result["tried"].append("%s: %s" % (name, e))
                continue
            # No exception means a dialog really did open. Empty means the user
            # pressed Cancel, which is a choice, not a failure - stop here
            # rather than popping a second dialog at them.
            result["opened"] = True
            result["folder"] = folder
            return

    t = threading.Thread(target=run)
    t.start()
    t.join(timeout=310)
    if t.is_alive():
        return None, "Folder dialog timed out."
    if result["opened"]:
        return result["folder"], None
    print("! no folder dialog available: %s" % "; ".join(result["tried"]))
    return None, ("No folder dialog is available in this Python build "
                  "(%s). Paste or drag the path into the box instead - it works "
                  "exactly the same." % result["tried"][0].split(":")[0])


def watcher(index, interval):
    while True:
        time.sleep(interval)
        try:
            index.scan()
        except Exception as e:
            print("! watcher error: %s" % e)


# ---------------------------------------------------------------- http

class Handler(SimpleHTTPRequestHandler):
    index = None

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, fmt, *args):
        pass  # too noisy; real events are printed explicitly

    def end_headers(self):
        # Nothing this server sends may be cached - not the API, and especially
        # not core.js. Frozen releases used to share a port across drives, and a
        # heuristically-cached core.js then made an old build appear to have new
        # features. See NOTES.md, "Release isolation - the browser is the leak".
        if not getattr(self, "_cc_sent", False):
            self._cc_sent = True
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_head(self):
        # SimpleHTTPRequestHandler answers If-Modified-Since with a 304. A stale
        # entry cached before no-store existed could still trigger one, so drop
        # the header before it gets that far and always serve the real file.
        del self.headers["If-Modified-Since"]
        del self.headers["If-None-Match"]
        return super().send_head()

    def _json(self, obj, code=200):
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        idx = Handler.index
        if path == "/api/runs":
            return self._json(idx.payload())
        if path == "/api/version":
            return self._json({"version": idx.version, "runs": len(idx.by_file),
                               "scanning": idx.scanning})
        if path == "/api/config":
            ok, why = folder_is_usable(idx.folder) if idx.folder else (False, "")
            return self._json({
                "appVersion": APP_VERSION,
                "port": int(CONFIG.get("port", 0)),
                "folder": idx.folder,
                "valid": ok,
                "reason": why,
                "runs": len(idx.by_file),
                "version": idx.version,
                "scanning": idx.scanning,
                "candidates": detect_stats_folders(),
                "canBrowse": True,
            })
        if path == "/api/whatsnew":
            for name in ("WHATS-NEW.txt", "CHANGELOG.md"):
                try:
                    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
                        return self._json({"version": APP_VERSION, "text": f.read()[:8000]})
                except OSError:
                    continue
            return self._json({"version": APP_VERSION, "text": ""})
        if path == "/api/benchmarks":
            p = os.path.join(APP_DIR, "data", "benchmarks.json")
            try:
                with open(p, encoding="utf-8") as f:
                    return self._json(json.load(f))
            except OSError:
                return self._json([], 404)
        return super().do_GET()

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        idx = Handler.index

        if path == "/api/folder":
            try:
                folder = str(self._body().get("folder", "")).strip().strip('"')
            except Exception:
                return self._json({"error": "bad payload"}, 400)
            folder = os.path.expandvars(os.path.expanduser(folder))
            # Point at the stats subfolder if they gave the game/install folder
            if os.path.isdir(folder) and not folder_is_usable(folder)[0]:
                for probe in (os.path.join(folder, "stats"),
                              os.path.join(folder, "FPSAimTrainer", "stats"),
                              os.path.join(folder, STATS_TAIL)):
                    if folder_is_usable(probe)[0]:
                        folder = probe
                        break
            ok, why = folder_is_usable(folder)
            if not ok:
                return self._json({"error": why}, 400)
            folder = os.path.abspath(folder)
            print("+ stats folder set to %s" % folder)
            idx.set_folder(folder)
            t0 = time.time()
            idx.scan_guarded(verbose=True)
            CONFIG["stats_folder"] = folder
            save_config(CONFIG)
            print("+ %d runs ready in %.1fs" % (len(idx.by_file), time.time() - t0))
            return self._json({"ok": True, "folder": folder,
                               "runs": len(idx.by_file), "version": idx.version})

        if path == "/api/browse":
            folder, err = native_pick_folder()
            if err:
                return self._json({"error": err}, 500)
            return self._json({"folder": folder or ""})

        if path != "/api/log":
            return self._json({"error": "not found"}, 404)
        try:
            data = self._body()
        except Exception:
            return self._json({"error": "bad payload"}, 400)
        session = re.sub(r"[^A-Za-z0-9\-_.]", "", str(data.get("session", "session")))[:80]
        os.makedirs(LOG_DIR, exist_ok=True)
        try:
            with open(os.path.join(LOG_DIR, "session-%s.log" % session), "a", encoding="utf-8") as f:
                for e in data.get("entries", []):
                    line = "%s\t%s" % (e.get("t", ""), e.get("msg", ""))
                    if "data" in e:
                        line += "\t" + json.dumps(e["data"], separators=(",", ":"))
                    f.write(line + "\n")
        except OSError as e:
            return self._json({"error": str(e)}, 500)
        return self._json({"ok": True})


def main():
    global CONFIG
    CONFIG = load_config()
    folder = CONFIG.get("stats_folder") or ""
    os.makedirs(LOG_DIR, exist_ok=True)

    print("KovaaK's stats server")

    index = StatsIndex()
    if folder and folder_is_usable(folder)[0]:
        print("  stats folder : %s" % folder)
        index.set_folder(folder)
        t0 = time.time()
        index.scan_guarded(verbose=True)
        print("+ %d runs ready in %.1fs" % (len(index.by_file), time.time() - t0))
    else:
        if folder:
            print("  ! saved folder is unusable (%s)" % folder_is_usable(folder)[1])
        found = detect_stats_folders()
        if found:
            print("  found %d likely stats folder(s); pick one in the app:" % len(found))
            for p in found:
                print("    - %s" % p)
        else:
            print("  no stats folder set - choose one in the app when it opens")

    Handler.index = index
    interval = int(CONFIG["scan_interval_seconds"])
    threading.Thread(target=watcher, args=(index, interval), daemon=True).start()

    port = int(CONFIG["port"])
    # Windows lets a second process bind an already-listening port (its
    # SO_REUSEADDR behaves like SO_REUSEPORT, and HTTPServer sets it by
    # default), so binding alone would silently succeed and requests would go
    # to whichever instance won. Probe with a real connection first.
    def busy(detail=""):
        print("! port %d is not available%s." % (port, detail))
        print("  This app is most likely already running in another window -")
        print("  open http://127.0.0.1:%d/ instead of starting it again." % port)
        print("  If something else owns that port, change \"port\" in config.json.")

    if port_in_use(port):
        busy("")
        return
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as e:
        busy(" (%s)" % e)
        return
    url = "http://127.0.0.1:%d/" % port
    print("+ serving %s" % url)
    print("  full app: %s   simple: %ssimple.html" % (url, url))
    print("  watching for new runs every %ss - Ctrl+C to stop" % interval)
    # Restarting the server repeatedly used to pile up identical tabs. Python
    # cannot ask a browser to focus an existing tab, so instead: only auto-open
    # if we haven't opened this URL recently (a restart within the window almost
    # certainly means the old tab is still sitting there).
    if CONFIG.get("open_browser") and should_open_browser(port):
        threading.Timer(0.6, lambda: webbrowser.open(url, new=0, autoraise=True)).start()
    else:
        print("  (browser not re-opened - reuse the tab you already have)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n+ stopped")


if __name__ == "__main__":
    main()
