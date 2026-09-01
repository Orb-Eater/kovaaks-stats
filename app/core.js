// One core script drives both index.html (everything) and simple.html (the
// stripped-back view). simple.html simply omits chunks of markup; rather than
// branching all over the render code, $ hands back a stable detached stub for
// any id that page doesn't have, so writes to it are harmless no-ops.
// ---------------------------------------------------------------------------
// TUNING - every threshold the % calculations depend on, in one place.
// See CALCULATIONS.md for what each one does to the maths. Changing a value
// here changes it everywhere; nothing else hardcodes these.
// ---------------------------------------------------------------------------
const TUNING = {
  // --- statistical power (see STATISTICS.md §1) --------------------------
  // Required runs per side scales with the SQUARE of a scenario's own spread,
  // so a single global minimum cannot be right. n = POWER_CONST * (cv/effect)^2
  POWER_CONST: 15.7,     // 80% power, alpha 0.05 two-tailed. 21.0 = 90%, 11.3 = 70%
  TARGET_EFFECT: 5,      // the change size (%) we want to be able to detect
  HARD_FLOOR_N: 10,      // never trust fewer than this, CV itself is junk below it
  CI_Z: 1.96,            // 95% interval

  // --- metrics (STATISTICS.md §2) ---------------------------------------
  // max() grows with sample size on its own, so it is shown as a record but
  // never turned into a %. Quantiles are used for the measured quantities.
  CEILING_Q: 0.90, CEILING_MIN_N: 15,
  FLOOR_Q: 0.10,   FLOOR_MIN_N: 20,
  TYPICAL_MIN_N: 10,
  TRIM_FRACTION: 0.10,   // 10% off each end; needs n>=10 to remove anything
  TRIM_MIN_N: 10,

  // When a proper comparison-period baseline is too thin, fall back to this
  // many of the scenario's earliest-ever runs as a standing reference instead
  // of showing nothing (Batch 8). Point estimate only — never given a CI.
  EARLY_BASELINE_N: 5,

  // --- confounds (STATISTICS.md §3) -------------------------------------
  SESSION_GAP_MIN: 60,   // minutes of inactivity that starts a new session
  WARMUP_DROP: 2,        // runs dropped at the start of each session
  REFAM_GAP_DAYS: 14,    // returning to a scenario after this long...
  REFAM_DROP: 5,         // ...discards this many re-familiarisation runs

  // Points plotted on the progress chart.
  TREND_BUCKETS: 30,

  // cm cluster width: a cluster spans at most this multiple of its own minimum.
  CM_CLUSTER_RATIO: 1.1,

  // A cm value is treated as a stray/outlier below either of these.
  OUTLIER_MIN_RUNS: 5,
  OUTLIER_MIN_SHARE: 0.002,

  // Best/worst cm cards ignore buckets thinner than this.
  CM_CARD_MIN_RUNS: 10,
  CM_CARD_MIN_SCENARIOS: 2,

  // Days since last played before a scenario's % is flagged as stale.
  STALE_SOFT_DAYS: 7,
  STALE_HARD_DAYS: 14,

  // Minimum runs in a cm bucket before it appears in the cm tables.
  CM_LEVEL_MIN_N: 10,

  // Runs list paging. Small on purpose: each scenario card draws a chart, and
  // a short list is far easier to actually read than a wall of them.
  LIST_PAGE_SIZE: 5,

  // --- chart scaling (see CHART-SCALING.md) -----------------------------
  // Charts are scaled by the noise in the data, never auto-fitted to min/max.
  // Auto-fit stretches whatever variation exists to fill the frame, so a flat
  // plateau and a real breakthrough render identically. Scaling in sigmas
  // makes a 2-sigma gain occupy twice the height of a 1-sigma gain, so
  // improvements become visually comparable to each other.
  CHART_K: 3.5,             // y-axis half-height, in sigmas. Lower = magnified.
  CHART_MIN_SPAN_PCT: 0.04, // floor on the span as a fraction of mu, so a very
                            // consistent streak cannot collapse the axis
  CHART_SIGMA_N: 50,        // sigma comes from this many trailing runs and is
                            // held fixed, so changing Window never rescales y
  CHART_ASPECT: 2.0,        // width:height of the plot area. Slope is judged
                            // most accurately near 45 degrees (Cleveland).
  CHART_BAND_MIN_N: 8,      // fewer runs than this: no sigma band, it is noise

  // --- celebrations ------------------------------------------------------
  // The old 3s card was gone before you finished scrolling to it. It now sits
  // under the session panel and stays long enough to actually be read.
  CELEBRATE_MS: 15000,      // how long the PB card stays up
  CONFETTI_MS: 10000,       // how long the confetti runs inside it

  // --- run resets --------------------------------------------------------
  // With "log every run" on, restarts land in the stats folder as real files.
  // They are detected structurally (see run_timing in server.py), kept out of
  // every statistic, and counted in the session panel.
  RESET_RATIO_ALERT: 5,     // restarts per completed run before it says something
  RESET_ALERT_MIN_RUNS: 3,  // ...but not until this many runs were actually finished

  // Below this % of a session actually spent playing, a popup flags it once
  // per session (Batch 8) — but not before the session is long enough for the
  // ratio to mean anything; a two-run session reads noisy either way.
  LOW_ACTIVE_PCT: 40,
  LOW_ACTIVE_MIN_SPAN_SEC: 600
};
let excludeWarmup = true;
let excludeRefam = true;

const _stubs = new Map();
const $ = s => {
  const el = document.querySelector(s);
  if(el) return el;
  if(!_stubs.has(s)) _stubs.set(s, document.createElement('div'));
  return _stubs.get(s);
};
const has = s => !!document.querySelector(s);

let RUNS = [];
let SCEN_NAMES = new Set();
let currentPage = 'consistency';
let BENCH_DATA = [];
let cmMode = 'off';
let cmPickValue = null;
let cmSort = {key:'runs', dir:'desc'};
let rangeSort = {key:'cm', dir:'asc'};
let cmExpanded = false;
let cmTablesCollapsed = true;
let dataVersion = null;
let listLimit = 5;
let listShowAll = false;
// Scenario cards expanded for a closer look (Batch 8) — keyed like sessionAvg.
const expandedScenarios = new Set();
// ---- per-build settings storage ---------------------------------------
// localStorage is keyed by origin (host + port), not by folder. Frozen releases
// used to be numbered from 8801 upwards in every copy of the project, so two
// different builds on two drives shared an origin - and therefore shared their
// saved break settings and favourite cms. Ports are now derived from the version
// (release.py), and keys carry the build on top of that, so nothing leaks even
// if two builds do somehow land on one port.
const BUILD = (typeof window !== 'undefined' && window.KVA_BUILD) || 'dev';
const BUILD_HASH = (typeof window !== 'undefined' && window.KVA_BUILD_HASH) || '';
function lsKey(name){ return name + '@' + BUILD; }
function lsGet(name){
  try{
    const v = localStorage.getItem(lsKey(name));
    // First run of a new build: inherit whatever the previous build on this
    // origin had, so an update does not silently reset your settings.
    return v !== null ? v : localStorage.getItem(name);
  }catch(e){ return null; }
}
function lsSet(name, value){ try{ localStorage.setItem(lsKey(name), value); }catch(e){} }

let cmListExpanded = false;
let sessionCollapsed = false;
// "Follow current scenario" — when on, the session panel names whatever you are
// playing right now and the live note calls out each new run. Some people find
// that helpful, some find it follows them around; it is a toggle, remembered.
let followScen = lsGet('kva_follow') !== '0';
function saveFollowScen(){ lsSet('kva_follow', followScen ? '1' : '0'); }
let lastIdleNudge = 0;
let favCms = new Set();
try { favCms = new Set(JSON.parse(lsGet('kva_favcms')||'[]')); } catch(e){}
function saveFavCms(){ lsSet('kva_favcms', JSON.stringify([...favCms])); }

// ---- session log -------------------------------------------------------
// In memory, shown in the Session log panel, downloadable, and — when the
// Python server is running — POSTed to it so it lands in logs/ on disk.
const LOG = [];
const SESSION_ID = new Date().toISOString().replace(/[:.]/g,'-');
let SERVER_MODE = false;
let _logQueue = [], _logTimer = null;
function logMsg(msg, data){
  const e = {t: new Date().toISOString(), msg};
  if(data !== undefined) e.data = data;
  LOG.push(e);
  if(LOG.length > 3000) LOG.splice(0, LOG.length - 3000);
  if(has('#logWrap') && $('#logWrap').style.display !== 'none') renderLog();
  if(SERVER_MODE){
    _logQueue.push(e);
    if(!_logTimer) _logTimer = setTimeout(flushLog, 1500);
  }
  return e;
}
function flushLog(){
  _logTimer = null;
  if(!_logQueue.length) return;
  const batch = _logQueue; _logQueue = [];
  fetch('api/log', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({session: SESSION_ID, entries: batch})
  }).catch(()=>{});
}
window.addEventListener('beforeunload', flushLog);
window.addEventListener('error', e => logMsg('js error', {msg:e.message, src:e.filename, line:e.lineno}));
window.addEventListener('unhandledrejection', e => logMsg('unhandled promise rejection', String(e.reason)));

// Runs travel as a scenario-name dictionary + rows so 20k+ runs stay small.
function unpackRuns(p){
  // a[6] is the reset flag. Older caches predate it, so treat a missing value as
  // "not a reset" rather than dropping the run.
  return p.rows.map(a => ({scen: p.names[a[0]], date: new Date(a[1]), score: a[2],
                           cm360: a[3], sensScale: a[4], dur: a[5] == null ? null : a[5],
                           reset: a[6] === 1}));
}

const TS = /(\d{4})[.\-](\d{2})[.\-](\d{2})[-_ ](\d{2})[.:](\d{2})[.:](\d{2})/;

// Verified sensitivity-scale multipliers from KovaaK's own FovSensConfig.json
// (InchesFormula "360 / (Inches * K * DPI)" solved for cm: cm = 360*2.54/(sens*K*dpi)).
// Scales with FOV-dependent or offset terms (Splitgate, Paladins, Battlefield, GTA 5, PUBG)
// are intentionally omitted rather than risk a silently wrong conversion.
const CM_K = {
  'quake/source':0.022, 'quake champions':0.022, 'overwatch':0.0066, 'valorant':0.06996,
  'apex legends':0.022, 'fortnite':0.005555, 'counter-strike':0.022, 'call of duty':0.0066,
  'rainbow 6: siege':0.018/Math.PI, 'diabotical':1/60, 'destiny 2':0.0066, 'halo':0.022222,
  'rust':0.1125, 'reflex arena':0.018/Math.PI, 'batallion':0.017501, 'ue4':0.07,
  'hunt: showdown':0.0429718162181364, 'gundam evolution':0.0003888500001, 'the finals':0.001,
  'roblox':1.01061008, 'roblox arsenal':0.375, 'marvel rivals':0.0175, 'deadlock':0.044,
  'csgo':0.022, 'fragpunk':0.05555, 'strinova':0.01388194363, 'delta force':0.03
};

function parseName(fn){
  const base = fn.replace(/\.csv$/i,'');
  const m = base.match(TS);
  let date = null;
  if(m) date = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
  let scen = base;
  const cut = base.search(/\s*-\s*(Challenge|Ultimate|Scenario)\s*-\s*/i);
  if(cut > 0) scen = base.slice(0, cut);
  else if(m) scen = base.slice(0, m.index).replace(/\s*-\s*$/,'');
  scen = scen.replace(/\s*-\s*(Challenge|Ultimate)\s*$/i,'').trim();
  return {scen, date};
}

function parseBody(text){
  const out = {};
  const lines = text.split(/\r?\n/);
  for(const ln of lines){
    const m = ln.match(/^\s*([A-Za-z][A-Za-z %()\/]*?)\s*[:,]+\s*([-\d.]+)/);
    if(!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = parseFloat(m[2]);
    if(isNaN(val)) continue;
    if(key === 'score' && out.score === undefined) out.score = val;
    else if(key === 'accuracy' && out.acc === undefined) out.acc = val;
    else if((key === 'hit count' || key === 'hits') && out.hits === undefined) out.hits = val;
    else if((key === 'miss count' || key === 'misses') && out.miss === undefined) out.miss = val;
    else if(key.startsWith('avg time to kill') && out.ttk === undefined) out.ttk = val;
    else if(key === 'horiz sens' && out.sens === undefined) out.sens = val;
    else if(key === 'dpi' && out.dpi === undefined) out.dpi = val;
  }
  if(out.score === undefined){
    const m2 = text.match(/Score:?[,\s]+([-\d.]+)/i);
    if(m2) out.score = parseFloat(m2[1]);
  }
  const scaleMatch = text.match(/^\s*Sens\s*Scale\s*:\s*,?\s*([^\r\n,]+)/im);
  if(scaleMatch){
    const scaleName = scaleMatch[1].trim();
    out.sensScale = scaleName;
    const key = scaleName.toLowerCase();
    if(out.sens !== undefined){
      if(key === 'cm/360') out.cm360 = out.sens;
      else if(key === 'in/360') out.cm360 = out.sens * 2.54;
      else if(CM_K[key] !== undefined && out.dpi !== undefined){
        out.cm360 = (360*2.54) / (out.sens * CM_K[key] * out.dpi);
      }
    }
  }
  return out;
}

function pctMean(sorted, frac){
  const n = Math.max(1, Math.ceil(sorted.length * frac));
  let s = 0; for(let i=0;i<n;i++) s += sorted[i];
  return s/n;
}
const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
function median(a){ const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }
function sd(a){ const m=mean(a); return Math.sqrt(mean(a.map(v=>(v-m)**2))); }
const fmt = (v,d=1) => v===null||v===undefined||isNaN(v) ? '—' : v.toFixed(d);

async function ingest(files){
  const csvs = [...files].filter(f => /\.csv$/i.test(f.name));
  if(!csvs.length){ $('#loadmsg').innerHTML = '<div class="err">No CSV files found in that selection. Pick the <code>stats</code> folder itself.</div>'; return; }
  $('#loadmsg').innerHTML = '<p style="color:var(--ink2);font-size:14px;margin:16px 0 0">Reading ' + csvs.length.toLocaleString() + ' files…</p>';
  const runs = []; let noScore = 0, noDate = 0;
  const CH = 400;
  for(let i=0;i<csvs.length;i+=CH){
    const batch = csvs.slice(i, i+CH);
    const texts = await Promise.all(batch.map(f => f.text().catch(()=>'')));
    batch.forEach((f, j) => {
      const {scen, date} = parseName(f.name);
      const b = parseBody(texts[j]);
      if(b.score === undefined){ noScore++; return; }
      if(!date || isNaN(date)){ noDate++; return; }
      runs.push({scen, date, ...b});
    });
    $('#loadmsg').innerHTML = '<p style="color:var(--ink2);font-size:14px;margin:16px 0 0">Reading… ' + Math.min(i+CH, csvs.length).toLocaleString() + ' / ' + csvs.length.toLocaleString() + '</p>';
    await new Promise(r => setTimeout(r, 0));
  }
  if(!runs.length){
    $('#loadmsg').innerHTML = '<div class="err">Read ' + csvs.length + ' files but found no usable runs. The filename or score format may differ from what this expects — send me one CSV and I\'ll adjust the parser.</div>';
    return;
  }
  RUNS = runs.sort((a,b) => a.date - b.date);
  let extra = '';
  if(noScore + noDate > 0) extra = ' Skipped ' + (noScore+noDate) + ' files (' + noScore + ' with no score, ' + noDate + ' with no readable date).';
  logMsg('ingest complete', {files: csvs.length, runs: RUNS.length, noScore, noDate});
  afterRunsLoaded(extra);
}

// Shared by a fresh folder read and by a load from the server.
function afterRunsLoaded(extraNote, _unused, folder){
  SCEN_NAMES = new Set(RUNS.map(r => r.scen.trim().toLowerCase()));
  annotateRuns();
  let summary = 'Loaded <b>' + RUNS.length.toLocaleString() + '</b> runs across ' +
    new Set(RUNS.map(r=>r.scen)).size + ' scenarios, ' +
    RUNS[0].date.toISOString().slice(0,10) + ' to ' + RUNS[RUNS.length-1].date.toISOString().slice(0,10) + '.';
  if(folder) summary += ' <span style="color:var(--ink3)">Watching ' + esc(folder) + '</span>';
  summary += (extraNote || '');
  $('#panel').classList.add('compact');
  $('#drop').style.display = 'none';
  $('#loadmsg').innerHTML = '<div class="foldbar"><p class="note" style="margin:0">'+summary+'</p>' +
    '<button id="changeFolder">Change folder</button></div>';
  $('#changeFolder').addEventListener('click', async () => {
    $('#panel').classList.remove('compact');
    if(SERVER_MODE){
      try{ await refreshServerConfig(); }catch(err){}
      showFolderSetup('');
    } else {
      $('#drop').style.display = '';
      $('#loadmsg').innerHTML = '';
    }
  });
  applyPage();
  buildDatePickers();

  const cmVals = RUNS.map(r=>r.cm360).filter(v => v!==undefined && v!==null && !isNaN(v));
  if(cmVals.length){
    const cmMinVal = Math.min(...cmVals), cmMaxVal = Math.max(...cmVals);
    $('#cmMin').value = Math.floor(cmMinVal*10)/10;
    $('#cmMax').value = Math.ceil(cmMaxVal*10)/10;
    $('#cmwrap').style.display = '';

    rebuildCmPickOptions();

    const scaleCounts = {};
    RUNS.forEach(r => { if(r.cm360!=null){ const s=r.sensScale||'unknown'; scaleCounts[s]=(scaleCounts[s]||0)+1; } });
    const scaleSummary = Object.entries(scaleCounts).sort((a,b)=>b[1]-a[1]).map(([s,c])=>c.toLocaleString()+' '+s).join(', ');
    const other = RUNS.length - cmVals.length;
    $('#cmnote').style.display = '';
    $('#cmnote').textContent = 'cm/360 found for ' + cmVals.length.toLocaleString() + ' / ' + RUNS.length.toLocaleString() + ' runs (' + scaleSummary + ').' +
      (other ? ' The other ' + other.toLocaleString() + ' runs used a sens scale that isn\'t converted and are always included regardless of this filter.' : '');
  } else {
    $('#cmwrap').style.display = 'none';
  }

  render();
  if(currentPage === 'benchmarks') renderBenchmarkList();
}

// Trimmed mean: drop the top and bottom TRIM_FRACTION before averaging, so one
// lucky or one disastrous run cannot swing a window's average on its own. With
// TRIM_FRACTION = 0 this is just the plain mean.
// ---------------------------------------------------------------------------
// Quantiles + standard errors (STATISTICS.md §1, §2)
// ---------------------------------------------------------------------------
function quantileAt(sorted, p){
  if(!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// SE of a sample quantile = sqrt(p(1-p)/n) / f(x_p). The density f is estimated
// from the spacing of neighbouring order statistics (Siddiqui / Bloch-Gastwirth),
// which is cheap and adequate here — a bootstrap would cost far more per render
// for no practical gain at these sample sizes.
function quantileSE(sorted, p){
  const n = sorted.length;
  if(n < 8) return null;
  const h = Math.max(0.05, 1/Math.sqrt(n));
  const lo = quantileAt(sorted, Math.max(0, p - h));
  const hi = quantileAt(sorted, Math.min(1, p + h));
  const spread = hi - lo;
  if(!(spread > 0)) return null;
  const dens = (2*h) / spread;
  if(!(dens > 0)) return null;
  return Math.sqrt(p*(1-p)/n) / dens;
}

function trimSlice(sorted, frac){
  if(!(frac > 0) || sorted.length < TUNING.TRIM_MIN_N) return sorted;
  const cut = Math.floor(sorted.length * frac);
  return cut > 0 ? sorted.slice(cut, sorted.length - cut) : sorted;
}
function trimmedMeanSE(sorted, frac){
  const kept = trimSlice(sorted, frac);
  if(kept.length < 2) return null;
  return sd(kept) / Math.sqrt(kept.length);
}

// A permanent low bar for scenarios/cells that don't yet have a real earlier
// period to compare against: your first EARLY_BASELINE_N runs, ever. Still
// real data, just a different reference point — and deliberately given no CI,
// because 2-5 samples can estimate a level but not its precision.
function earlyBaseline(scoresChronological){
  const n = Math.min(TUNING.EARLY_BASELINE_N, scoresChronological.length);
  if(n < 2) return null;
  const early = scoresChronological.slice(0, n).slice().sort((a,b)=>a-b);
  return {
    n,
    ceiling: quantileAt(early, TUNING.CEILING_Q),
    typical: trimmedMean(early, TUNING.TRIM_FRACTION),
    floor: quantileAt(early, TUNING.FLOOR_Q),
    avg: mean(early)
  };
}

// Runs required per side to detect TARGET_EFFECT at this scenario's own spread.
function requiredN(cv){
  if(cv == null || !isFinite(cv) || cv <= 0) return TUNING.HARD_FLOOR_N;
  return Math.max(TUNING.HARD_FLOOR_N,
    Math.ceil(TUNING.POWER_CONST * Math.pow(cv / TUNING.TARGET_EFFECT, 2)));
}

// ---------------------------------------------------------------------------
// Warmup + re-familiarisation tagging (STATISTICS.md §3.1, §3.2)
// RNG is unbiased and averages out; these two are biased and do not, so they
// get excluded rather than modelled. Runs are tagged once on load and filtered
// at pool-build time so the toggles are instant.
// ---------------------------------------------------------------------------
function annotateRuns(){
  let prevT = null, pos = 0;
  RUNS.forEach(r => {
    if(prevT === null || (r.date - prevT) > TUNING.SESSION_GAP_MIN*60000) pos = 0;
    r.sessPos = pos++;
    prevT = r.date;
    r.excl = (r.sessPos < TUNING.WARMUP_DROP) ? 'warmup' : null;
  });
  const byScen = {};
  RUNS.forEach(r => (byScen[r.scen] ||= []).push(r));
  Object.values(byScen).forEach(rs => {
    let last = null, drop = 0;
    rs.forEach(r => {
      if(last !== null && (r.date - last) > TUNING.REFAM_GAP_DAYS*864e5) drop = TUNING.REFAM_DROP;
      if(drop > 0){ if(!r.excl) r.excl = 'refam'; drop--; }
      last = r.date;
    });
  });
}
// ---------------------------------------------------------------------------
// Sessions (Batch 3)
// A session is a run of activity with no gap longer than SESSION_GAP_MIN.
// Run duration comes from the CSV (Challenge Start vs the file's timestamp),
// so "time in KovaaK's" and "time actually playing" are genuinely different
// numbers rather than one estimated from the other.
// ---------------------------------------------------------------------------
function buildSessions(){
  const out = [];
  let cur = null;
  RUNS.forEach(r => {
    if(!cur || (r.date - cur.end) > TUNING.SESSION_GAP_MIN*60000){
      cur = {start: r.date, end: r.date, runs: [], gaps: []};
      out.push(cur);
    } else {
      cur.gaps.push((r.date - cur.end)/1000);
    }
    cur.runs.push(r);
    cur.end = r.date;
  });
  out.forEach(s => {
    s.spanSec = Math.max(0, (s.end - s.start)/1000);
    const durs = s.runs.map(r => r.dur).filter(v => v != null);
    s.playSec = durs.reduce((a,b)=>a+b, 0);
    s.durCoverage = s.runs.length ? durs.length / s.runs.length : 0;
    // Idle needs the run itself excluded, so span alone would overstate playing.
    s.activePct = s.spanSec > 0 ? Math.min(100, s.playSec / s.spanSec * 100) : null;
    s.medGap = s.gaps.length ? median(s.gaps) : null;
    s.scens = new Set(s.runs.map(r => r.scen)).size;
    // Resets belong here even though they are barred from the statistics: how
    // often you bail out of a run is a fact about the session, not about skill.
    s.resets = s.runs.filter(r => r.reset).length;
    s.completed = s.runs.length - s.resets;
    s.resetRatio = s.completed > 0 ? s.resets / s.completed : null;
    // Longest run of restarts with no completed run between them. "Resetting
    // more than 5 times per run" is really about this, not about a session
    // average - one bad stretch is the thing worth flagging.
    let streak = 0;
    s.maxResetStreak = 0;
    s.runs.forEach(r => {
      streak = r.reset ? streak + 1 : 0;
      if(streak > s.maxResetStreak) s.maxResetStreak = streak;
    });
  });
  return out;
}

function fmtDur(sec){
  if(sec == null || !isFinite(sec)) return '—';
  const h = Math.floor(sec/3600), m = Math.round((sec%3600)/60);
  return h ? (h + 'h ' + m + 'm') : (m ? m + 'm' : Math.round(sec) + 's');
}

// Rapid-fire restarting: lots of very short gaps sustained over a long stretch
// is the signature of resetting for a PB rather than practising.
// More than RESET_RATIO_ALERT restarts for every completed run means the runs
// are being thrown away until one starts well, which measures luck rather than
// aim. Only fires once there are enough completed runs for the ratio to mean
// anything - two resets on your first run is just finding your grip.
// "Log every run" in KovaaK's is off by default, and while it is off a restart
// never reaches the stats folder at all - so the restart counter would sit at a
// permanent zero, which is a lie rather than a measurement. Detect the setting
// from the data itself: a zero-length run that still scored can only exist if
// the game wrote a file for an attempt that was abandoned.
function logEveryRunOn(){
  return RUNS.some(r => r.reset);
}

// Suggested once, dismissed forever. Nobody needs to be told twice.
function logHintDismissed(){ return lsGet('kva_loghint') === '1'; }
function dismissLogHint(){ lsSet('kva_loghint', '1'); }

function logEveryRunHint(){
  if(logEveryRunOn() || logHintDismissed()) return '';
  return '<div class="loghint">' +
    '<b>Want a restart counter?</b> Turn on <b>“Log every run”</b> in KovaaK\'s ' +
    '(Settings &rsaquo; Game). Restarts are invisible to this app until you do — ' +
    'the game only writes a file for runs you finish, so there is nothing to count.' +
    '<span class="dim"> The trade-off: it writes a CSV for every restart too, which ' +
    'clutters the stats folder and any other tool reading it. This app filters them ' +
    'out of every statistic automatically.</span>' +
    '<button type="button" id="logHintNo" class="minibtn" style="float:none;margin-left:10px">Don\'t show again</button>' +
    '</div>';
}

function resetDiagnosis(s){
  if(!s || !s.resets || s.completed < TUNING.RESET_ALERT_MIN_RUNS) return null;
  const byStreak = s.maxResetStreak > TUNING.RESET_RATIO_ALERT;
  const byRatio = s.resetRatio != null && s.resetRatio > TUNING.RESET_RATIO_ALERT;
  if(!byStreak && !byRatio) return null;
  const why = byStreak
    ? s.maxResetStreak + ' restarts in a row without finishing a run'
    : s.resets + ' restarts across ' + s.completed + ' completed runs (' +
      s.resetRatio.toFixed(1) + ' per run)';
  return 'STOP CHASING RNG PBs — ' + why + '. Restarting until the spawn pattern ' +
    'looks good measures the RNG, not your aim, and a score you only got because ' +
    'the run started well is not one you can repeat. Play the run you get.';
}

function rushDiagnosis(s){
  if(!s || s.medGap == null || s.spanSec < 3000) return null;
  if(s.medGap >= 5) return null;
  return 'Median gap between runs is ' + s.medGap.toFixed(1) + 's across ' +
    fmtDur(s.spanSec) + '. Back-to-back restarts with no pause drain focus fast — ' +
    'try leaving a few seconds between runs, and a real break every so often.';
}

// The opposite problem to rushDiagnosis: most of the session's clock went
// somewhere other than playing (alt-tabbed, deciding what to play, a long
// queue). Gated on session length so a two-run session doesn't read as "idle"
// just because the gap between them was long (Batch 8).
function lowActiveDiagnosis(s){
  if(!s || s.activePct == null) return null;
  if(s.spanSec < TUNING.LOW_ACTIVE_MIN_SPAN_SEC) return null;
  if(s.activePct >= TUNING.LOW_ACTIVE_PCT) return null;
  return 'Only ' + s.activePct.toFixed(0) + '% of this session (' + fmtDur(s.spanSec) +
    ' since the first run) has actually been spent playing. Not a judgement — just flagging it ' +
    'in case you meant to be heads-down.';
}

// Two different questions, deliberately separated.
//
// runVisible - "did you actually play this run?" Drives charts and run counts.
//   A reset is the only thing that fails here: an abandoned attempt is not a run
//   you played, and its score is whatever you had accumulated at the moment you
//   pressed restart. Excluded unconditionally, unlike warmup and
//   re-familiarisation, which are toggles.
//
// runUsable - "may this run enter a percentage?" Everything visible, minus
//   zero-score runs. On a NeverMiss a zero means the first shot missed: a real
//   run, worth seeing on the chart, but it measures the moment you lost rather
//   than a level of performance, and averaging it in drags the floor down for a
//   reason that has nothing to do with skill. 176 of them across this history.
function runVisible(r){
  if(r.reset) return false;
  if(r.excl === 'warmup') return !excludeWarmup;
  if(r.excl === 'refam') return !excludeRefam;
  return true;
}
function runUsable(r){
  return runVisible(r) && r.score > 0;
}

// Does warmup actually cost this user anything? (STATISTICS.md §3.1 validation)
function warmupEffect(){
  const early = [], late = [];
  RUNS.forEach(r => {
    if(r.sessPos == null) return;
    (r.sessPos < 3 ? early : late).push(r.score);
  });
  if(early.length < 30 || late.length < 30) return null;
  // Scores differ wildly between scenarios, so compare within scenario.
  const byScen = {};
  RUNS.forEach(r => { if(r.sessPos != null) (byScen[r.scen] ||= []).push(r); });
  const ratios = [];
  Object.values(byScen).forEach(rs => {
    const e = rs.filter(r => r.sessPos < 3).map(r => r.score);
    const l = rs.filter(r => r.sessPos >= 3).map(r => r.score);
    if(e.length < 3 || l.length < 10) return;
    const lm = mean(l);
    if(lm > 0) ratios.push((mean(e) - lm) / lm * 100);
  });
  return ratios.length >= 5 ? mean(ratios) : null;
}

function trimmedMean(sorted, frac){
  const kept = trimSlice(sorted, frac);
  return kept.length ? mean(kept) : mean(sorted);
}

// The measured metrics are all quantile- or trim-based so none of them can be
// moved wholesale by a single run, and none of them drift with sample size.
// `record` (true max) is kept for display only — never turned into a %.
function stats(scores){
  const s = [...scores].sort((a,b)=>a-b);
  const m = mean(s);
  return {
    n: s.length, sorted: s,
    record:  s.length ? s[s.length-1] : null,
    ceiling: s.length >= TUNING.CEILING_MIN_N ? quantileAt(s, TUNING.CEILING_Q) : null,
    typical: s.length >= TUNING.TYPICAL_MIN_N ? trimmedMean(s, TUNING.TRIM_FRACTION) : null,
    floor:   s.length >= TUNING.FLOOR_MIN_N   ? quantileAt(s, TUNING.FLOOR_Q)   : null,
    mean: m, med: median(s), worst: s[0],
    cv: m > 0 ? sd(s)/m*100 : null
  };
}

// change% with its standard error, so the UI can show an interval instead of a
// bare point estimate. `fallback` (an earlyBaseline() result) stands in for a
// missing/too-thin real baseline so a % is always shown (Batch 8) rather than
// a dash — flagged with `early: true` so the UI can say why there's no CI.
function changeWithSE(w, b, key, fallback){
  const wv = w[key];
  let bv = b[key], early = false;
  if(bv == null && fallback && fallback[key] != null && fallback[key] > 0){
    bv = fallback[key];
    early = true;
  }
  if(wv == null || bv == null || !(bv > 0)) return null;
  const pct = (wv - bv)/bv*100;
  if(early) return {pct, se: null, early: true, earlyN: fallback.n};
  let seW, seB;
  if(key === 'typical'){
    seW = trimmedMeanSE(w.sorted, TUNING.TRIM_FRACTION);
    seB = trimmedMeanSE(b.sorted, TUNING.TRIM_FRACTION);
  } else {
    const q = key === 'ceiling' ? TUNING.CEILING_Q : TUNING.FLOOR_Q;
    seW = quantileSE(w.sorted, q);
    seB = quantileSE(b.sorted, q);
  }
  if(seW == null || seB == null) return {pct, se: null};
  return {pct, se: Math.sqrt(seW*seW + seB*seB)/bv*100};
}

// Unit of analysis is the (scenario x cm-cluster) cell, so a shift in which cms
// you played between the two periods cannot masquerade as a skill change
// (STATISTICS.md §3.3). Cells are aggregated afterwards.
function computeCells(pool, windowStart, windowEnd, cmpMode, clusters){
  const winLen = windowEnd.getTime() - windowStart.getTime();
  const baseStart = new Date(windowStart.getTime() - winLen);
  const mid = new Date(windowStart.getTime() + winLen/2);
  const cells = {};
  pool.forEach(r => {
    const cl = (clusters && clusters.length && r.cm360 != null)
      ? clusterIndexFor(r.cm360, clusters) : -1;
    const key = r.scen + ' ' + cl;
    const c = cells[key] ||= {scen: r.scen, cluster: cl, win: [], base: [], all: [], allRuns: []};
    c.all.push(r.score);
    c.allRuns.push(r);
    const t = r.date;
    if(cmpMode === 'prev'){
      if(t >= windowStart && t <= windowEnd) c.win.push(r.score);
      else if(t >= baseStart && t < windowStart) c.base.push(r.score);
    } else {
      if(t >= mid && t <= windowEnd) c.win.push(r.score);
      else if(t >= windowStart && t < mid) c.base.push(r.score);
    }
  });
  return Object.values(cells).map(c => {
    const w = stats(c.win), b = stats(c.base);
    const allSorted = [...c.all].sort((x,y)=>x-y);
    const am = mean(allSorted);
    const cv = (allSorted.length >= TUNING.HARD_FLOOR_N && am > 0) ? sd(allSorted)/am*100 : null;
    const nReq = requiredN(cv);
    // Earliest-ever runs of this cell, oldest first, feed earlyBaseline() when
    // the real baseline period is too thin to compute ceiling/typical/floor on.
    const chronological = c.allRuns.length > 1
      ? [...c.allRuns].sort((x,y)=>x.date-y.date).map(r=>r.score) : c.all;
    const fallback = earlyBaseline(chronological);
    return {
      scen: c.scen, cluster: c.cluster, w, b, cv, nRequired: nReq,
      nMin: Math.min(w.n, b.n), powered: Math.min(w.n, b.n) >= nReq,
      ceiling: changeWithSE(w, b, 'ceiling', fallback),
      typical: changeWithSE(w, b, 'typical', fallback),
      floor:   changeWithSE(w, b, 'floor', fallback)
    };
  });
}

// Inverse-variance weighting (STATISTICS.md §4): the minimum-variance unbiased
// estimator of the common effect. Noisy/sparse cells shrink automatically
// instead of being excluded, and it yields an SE on the aggregate for free.
function overallOf(list){
  const items = list.filter(c => c && c.pct != null && isFinite(c.pct));
  if(!items.length) return null;
  const precise = items.filter(c => c.se != null && c.se > 0 && isFinite(c.se));
  if(!precise.length){
    // No cell has a real interval — most commonly because every one of them
    // is leaning on earlyBaseline(). Carry that through so the UI still knows
    // to show the "early" marker instead of a CI it doesn't have (Batch 8).
    const earlyOnes = items.filter(c => c.early);
    return {
      pct: mean(items.map(c=>c.pct)), se: null,
      early: earlyOnes.length > 0,
      earlyN: earlyOnes.length ? Math.max(...earlyOnes.map(c => c.earlyN || 0)) : undefined
    };
  }
  const wSum = precise.reduce((s,c) => s + 1/(c.se*c.se), 0);
  const num  = precise.reduce((s,c) => s + c.pct/(c.se*c.se), 0);
  return {pct: num/wSum, se: Math.sqrt(1/wSum)};
}

function computeTrends(pool, windowStart, windowEnd, cmpMode, minRuns, clusters, displayPool){
  const cells = computeCells(pool, windowStart, windowEnd, cmpMode, clusters);
  const byScen = {};
  cells.forEach(c => (byScen[c.scen] ||= []).push(c));

  const runsByScen = {}, allByScen = {};
  pool.forEach(r => {
    (allByScen[r.scen] ||= []).push(r.score);
    if(r.date >= windowStart && r.date <= windowEnd) (runsByScen[r.scen] ||= []).push(r);
  });
  // Charts get the zeros back. Nothing computed from `pool` above can see them.
  const shownByScen = {};
  (displayPool || pool).forEach(r => {
    if(r.date >= windowStart && r.date <= windowEnd) (shownByScen[r.scen] ||= []).push(r);
  });

  return Object.entries(byScen).map(([scen, cs]) => {
    const rs = runsByScen[scen] || [];
    if(!rs.length) return null;
    const st = stats(rs.map(r=>r.score));
    // Total paired runs across cells - stratifying by cm splits the data up, so
    // the best single cell badly understates what's actually available.
    const nMin = cs.reduce((a,c) => a + Math.min(c.w.n, c.b.n), 0);
    // Required n comes from the scenario's spread over ALL its history, not
    // per-cell: cells too small to estimate a CV fall back to the floor, and
    // taking the min across them would understate the requirement badly.
    const allScores = allByScen[scen] || [];
    const am = allScores.length ? mean(allScores) : 0;
    const scenCv = (allScores.length >= TUNING.HARD_FLOOR_N && am > 0) ? sd(allScores)/am*100 : null;
    const nRequired = requiredN(scenCv);
    const typical = overallOf(cs.map(c=>c.typical));
    // "Powered" means: is this scenario's own interval tight enough to detect a
    // TARGET_EFFECT change? That is exactly what the aggregated SE already
    // answers, and unlike a raw run count it accounts for cm stratification and
    // for how noisy this particular scenario is.
    const powered = (typical && typical.se != null)
      ? (TUNING.CI_Z * typical.se) <= TUNING.TARGET_EFFECT
      : nMin >= nRequired;
    const rsAll = shownByScen[scen] || rs;
    return {
      scen, rs, rsAll, zeroRuns: rsAll.length - rs.length, st, cells: cs,
      ceiling: overallOf(cs.map(c=>c.ceiling)),
      typical,
      floor:   overallOf(cs.map(c=>c.floor)),
      nMin, nRequired, scenCv, powered,
      base: cs.some(c => c.b.n > 0),
      // True when at least one shown % leans on the first-N-runs fallback
      // rather than a real earlier period (Batch 8) — drives the info icon.
      usedEarlyBaseline: cs.some(c =>
        (c.ceiling && c.ceiling.early) || (c.typical && c.typical.early) || (c.floor && c.floor.early)),
      // convenience accessors used by sorting / the cm tables
      get avgTrend(){ return this.typical ? this.typical.pct : null; }
    };
  }).filter(r => r && r.st.n >= minRuns);
}

// Data-driven cm/360 clusters instead of fixed bins: sensitivity differences matter
// proportionally, not absolutely, so a cluster spans at most CM_CLUSTER_RATIO× its own
// minimum. Anchored to the cluster's minimum (not the previous point) deliberately —
// comparing only to the previous point lets a "walk" of small steps (43→44→45→46→47)
// chain-drift a cluster arbitrarily wide even under a tight ratio, which is exactly
// what made "best/worst cm range" collapse into just whatever range you play most.
// Boundaries between clusters sit at the midpoint of the gap, so every cm value (not
// just ones you've literally used) still maps into exactly one cluster.
function computeCmClusters(pool){
  const counts = {};
  pool.forEach(r => { if(r.cm360!=null){ const b=Math.round(r.cm360); counts[b]=(counts[b]||0)+1; } });
  const entries = Object.entries(counts).map(([b,c])=>({cm:+b,count:c})).sort((a,b)=>a.cm-b.cm);
  if(!entries.length) return [];
  const groups = [];
  let cur = [entries[0]];
  for(let i=1;i<entries.length;i++){
    if(entries[i].cm / cur[0].cm <= TUNING.CM_CLUSTER_RATIO) cur.push(entries[i]);
    else { groups.push(cur); cur = [entries[i]]; }
  }
  groups.push(cur);
  return groups.map((g,i) => {
    const lo = g[0].cm, hi = g[g.length-1].cm;
    const lowBound = i===0 ? -Infinity : (groups[i-1][groups[i-1].length-1].cm + lo)/2;
    const highBound = i===groups.length-1 ? Infinity : (hi + groups[i+1][0].cm)/2;
    // Label the cluster by its actual zone of coverage (the boundary midpoints), not
    // just the literal cm values observed — a single-value cluster still gets shown as
    // a real range, and the outermost clusters are left open-ended ("100cm+", "≤13cm")
    // instead of pretending there's a hard ceiling/floor where none exists.
    let label;
    if(groups.length === 1) label = lo===hi ? (lo+'cm') : (lo+'–'+hi+'cm');
    else if(i === 0) label = '≤' + Math.floor(highBound) + 'cm';
    else if(i === groups.length-1) label = Math.ceil(lowBound) + 'cm+';
    else label = Math.ceil(lowBound) + '–' + Math.floor(highBound) + 'cm';
    return { lo, hi, lowBound, highBound, runs: g.reduce((a,e)=>a+e.count,0), label };
  });
}
function clusterIndexFor(cm, clusters){
  for(let i=0;i<clusters.length;i++) if(cm >= clusters[i].lowBound && cm < clusters[i].highBound) return i;
  return null;
}

function computeCmRangeBreakdown(rows, clusters){
  const buckets = {};
  rows.forEach(r => {
    if(!(r.st.mean > 0)) return;
    const byBucket = {};
    r.rs.forEach(x => {
      if(x.cm360 == null) return;
      const idx = clusterIndexFor(x.cm360, clusters);
      if(idx == null) return;
      (byBucket[idx] ||= []).push(x.score);
    });
    Object.entries(byBucket).forEach(([idx, scores]) => {
      if(scores.length < TUNING.CM_LEVEL_MIN_N) return;
      idx = +idx;
      const sortedC = [...scores].sort((x,y)=>x-y);
      const pbAtC = quantileAt(sortedC, TUNING.CEILING_Q);
      const avgAtC = mean(scores);
      const entry = buckets[idx] ||= {runs:0, scenarios:0, pbRatios:[], avgRatios:[]};
      entry.runs += scores.length;
      entry.scenarios += 1;
      if(r.st.ceiling > 0) entry.pbRatios.push(pbAtC / r.st.ceiling * 100);
      entry.avgRatios.push(avgAtC / r.st.mean * 100);
    });
  });
  return Object.entries(buckets).map(([idx, e]) => ({
    idx: +idx, lo: clusters[+idx].lo, label: clusters[+idx].label, runs: e.runs, scenarios: e.scenarios,
    pbPct: mean(e.pbRatios), avgPct: mean(e.avgRatios)
  })).sort((a,b) => a.idx - b.idx);
}

function computeFastSlowBreakdown(rows){
  const buckets = { fast: {runs:0, scenarios:0, pbRatios:[], avgRatios:[]}, slow: {runs:0, scenarios:0, pbRatios:[], avgRatios:[]} };
  rows.forEach(r => {
    if(!(r.st.mean > 0)) return;
    const byBucket = {fast:[], slow:[]};
    r.rs.forEach(x => {
      if(x.cm360 == null) return;
      if(x.cm360 < 50) byBucket.fast.push(x.score);
      else if(x.cm360 > 50) byBucket.slow.push(x.score);
    });
    ['fast','slow'].forEach(key => {
      const scores = byBucket[key];
      if(scores.length < TUNING.CM_LEVEL_MIN_N) return;
      const sortedC = [...scores].sort((x,y)=>x-y);
      const pbAtC = quantileAt(sortedC, TUNING.CEILING_Q);
      const avgAtC = mean(scores);
      buckets[key].runs += scores.length;
      buckets[key].scenarios += 1;
      if(r.st.ceiling > 0) buckets[key].pbRatios.push(pbAtC / r.st.ceiling * 100);
      buckets[key].avgRatios.push(avgAtC / r.st.mean * 100);
    });
  });
  const out = {};
  ['fast','slow'].forEach(key => {
    const b = buckets[key];
    out[key] = b.avgRatios.length ? {runs:b.runs, scenarios:b.scenarios, pbPct:mean(b.pbRatios), avgPct:mean(b.avgRatios)} : null;
  });
  return out;
}

// The `avg`/`pb` columns say how well a cm performs *relative to your own
// typical level*. This says something different and complementary: has your
// skill AT that cm actually improved over the window? Runs are bucketed by cm
// first, then each bucket is compared against its own earlier runs at the same
// cm — so "44-49cm avg +6%" means your scores at 44-49cm went up 6%, not that
// scenarios which happen to use that cm went up.
function computeCmDeltas(pool, windowStart, windowEnd, cmpMode, bucketOf){
  const winLen = windowEnd.getTime() - windowStart.getTime();
  const baseStart = new Date(windowStart.getTime() - winLen);
  const mid = new Date(windowStart.getTime() + winLen/2);
  const byScen = {};
  pool.forEach(r => { if(r.cm360 != null) (byScen[r.scen] ||= []).push(r); });
  const acc = {};
  Object.values(byScen).forEach(rs => {
    const cur = {}, base = {}, all = {};
    rs.forEach(r => {
      const b = bucketOf(r.cm360);
      if(b == null) return;
      (all[b] ||= []).push(r);
      const t = r.date;
      if(cmpMode === 'prev'){
        if(t >= windowStart && t <= windowEnd) (cur[b] ||= []).push(r.score);
        else if(t >= baseStart && t < windowStart) (base[b] ||= []).push(r.score);
      } else {
        if(t >= mid && t <= windowEnd) (cur[b] ||= []).push(r.score);
        else if(t >= windowStart && t < mid) (base[b] ||= []).push(r.score);
      }
    });
    Object.keys(cur).forEach(b => {
      const c = cur[b];
      if(c.length < TUNING.CM_LEVEL_MIN_N) return;
      const bs = base[b];
      let bAvg, bBest, early = false;
      // Same rule as the per-scenario cards (Batch 8): a too-thin baseline
      // period falls back to this cm's first-ever runs instead of going blank.
      if(bs && bs.length >= TUNING.CM_LEVEL_MIN_N){
        const bs_ = [...bs].sort((x,y)=>x-y);
        bAvg = mean(bs); bBest = quantileAt(bs_, TUNING.CEILING_Q);
      } else {
        const chrono = [...(all[b]||[])].sort((x,y)=>x.date-y.date).map(r=>r.score);
        const fb = earlyBaseline(chrono);
        if(!fb) return;
        bAvg = fb.avg; bBest = fb.ceiling; early = true;
      }
      const cAvg = mean(c);
      const cs_ = [...c].sort((x,y)=>x-y);
      const cBest = quantileAt(cs_, TUNING.CEILING_Q);
      const e = acc[b] ||= {avg:[], pb:[], scenarios:0, runs:0, early:0};
      if(bAvg > 0) e.avg.push((cAvg - bAvg)/bAvg*100);
      if(bBest > 0) e.pb.push((cBest - bBest)/bBest*100);
      e.scenarios++;
      e.runs += c.length;
      if(early) e.early++;
    });
  });
  const out = {};
  Object.entries(acc).forEach(([b, e]) => {
    out[b] = {
      avgDelta: e.avg.length ? mean(e.avg) : null,
      pbDelta: e.pb.length ? mean(e.pb) : null,
      scenarios: e.scenarios,
      early: e.early > 0
    };
  });
  return out;
}

function computeCmBreakdown(rows){
  const buckets = {};
  rows.forEach(r => {
    if(!(r.st.mean > 0)) return;
    const byBucket = {};
    r.rs.forEach(x => {
      if(x.cm360 == null) return;
      const b = Math.round(x.cm360);
      (byBucket[b] ||= []).push(x.score);
    });
    Object.entries(byBucket).forEach(([b, scores]) => {
      if(scores.length < TUNING.CM_LEVEL_MIN_N) return;
      b = +b;
      const sortedC = [...scores].sort((x,y)=>x-y);
      const pbAtC = quantileAt(sortedC, TUNING.CEILING_Q);
      const avgAtC = mean(scores);
      const entry = buckets[b] ||= {runs:0, scenarios:0, pbRatios:[], avgRatios:[]};
      entry.runs += scores.length;
      entry.scenarios += 1;
      if(r.st.ceiling > 0) entry.pbRatios.push(pbAtC / r.st.ceiling * 100);
      entry.avgRatios.push(avgAtC / r.st.mean * 100);
    });
  });
  return Object.entries(buckets).map(([b, e]) => ({
    cm: +b, runs: e.runs, scenarios: e.scenarios,
    pbPct: mean(e.pbRatios), avgPct: mean(e.avgRatios)
  })).sort((a,b) => b.runs - a.runs);
}

function sortKeyOf(entry, key){
  if(key==='cm') return entry.cm !== undefined ? entry.cm : entry.lo;
  if(key==='avg') return entry.avgPct;
  if(key==='pb') return entry.pbPct;
  return entry[key];
}
function sortEntries(list, state){
  const dir = state.dir==='asc' ? 1 : -1;
  return [...list].sort((a,b) => (sortKeyOf(a,state.key) - sortKeyOf(b,state.key)) * dir);
}
function thCell(table, key, label, state){
  const active = state.key===key;
  const arrow = active ? (state.dir==='asc' ? ' ▲' : ' ▼') : '';
  return '<th data-table="'+table+'" data-key="'+key+'" style="cursor:pointer" title="Click to sort">'+label+arrow+'</th>';
}

// Search box and list are one control: an inline, scrollable, drag-to-resize
// list rather than a native <select>, which near the bottom of the page opens
// upwards and can't be resized.
function rebuildCmPickOptions(){
  const counts = {};
  RUNS.forEach(r => { if(r.cm360!=null){ const b=Math.round(r.cm360); counts[b]=(counts[b]||0)+1; } });
  const all = Object.entries(counts).map(([b,c])=>({cm:+b,count:c}))
    .sort((a,b) => (favCms.has(b.cm)-favCms.has(a.cm)) || (b.count-a.count));
  $('#cmvals').innerHTML = all.map(e=>'<option value="'+e.cm+'">').join('');

  // Prefix match: typing "5" means 5, 50-59 - not 25.
  const q = ($('#cmPickSearch').value || '').trim();
  const shown = q ? all.filter(e => String(e.cm).startsWith(q)) : all;

  if(cmPickValue==null || !all.some(e=>e.cm===cmPickValue)) cmPickValue = all.length ? all[0].cm : null;

  const CM_VISIBLE = 8;
  if(has('#cmListAll')){
    const overflow = shown.length > CM_VISIBLE;
    $('#cmListAll').style.display = overflow ? '' : 'none';
    $('#cmListAll').textContent = cmListExpanded
      ? 'Show fewer' : ('Show all ' + shown.length + ' cms');
    $('#cmList').classList.toggle('all', cmListExpanded && overflow);
  }
  $('#cmList').innerHTML = shown.length ? shown.map((e,i) =>
    '<div class="cmitem'+(e.cm===cmPickValue?' sel':'')+'" data-cm="'+e.cm+'">'+
      '<span class="cmstar'+(favCms.has(e.cm)?' on':'')+'" data-star="'+e.cm+'" title="Favorite">'+(favCms.has(e.cm)?'★':'☆')+'</span>'+
      '<span class="cmitem-v">'+e.cm+'cm</span>'+
      '<span class="cmitem-n">'+e.count.toLocaleString()+' runs'+(!q && !favCms.has(e.cm) && i===0 ? ' · most common' : '')+'</span>'+
    '</div>').join('') : '<div class="cmitem-empty">No cm starts with "'+esc(q)+'"</div>';

  renderFavRow();
}
function updateFavStar(){ /* per-row stars now; kept so old callers are safe */ }
function renderFavRow(){
  if(!favCms.size){ $('#favCmRow').innerHTML = ''; return; }
  const items = [...favCms].sort((a,b)=>a-b);
  // Only the cm actually in use is highlighted; the rest stay plain.
  $('#favCmRow').innerHTML = '<span style="font-size:12px;color:var(--ink2)">Favorites:</span>' +
    items.map(cm => '<button type="button" class="tabbtn favchip'+(cm===cmPickValue && cmMode==='pick' ? ' isfav' : '')+'" data-cm="'+cm+'">'+
      (cm===cmPickValue && cmMode==='pick' ? '★ ' : '') + cm+'cm</button>').join('');
}

function setCmTab(mode){
  cmMode = mode;
  $('#cmTabOff').classList.toggle('active', mode==='off');
  $('#cmTabRange').classList.toggle('active', mode==='range');
  $('#cmTabPick').classList.toggle('active', mode==='pick');
  $('#cmRangeUI').style.display = mode==='range' ? '' : 'none';
  $('#cmPickUI').style.display = mode==='pick' ? '' : 'none';
}

// Shared by both pages: the Consistency page's Window + cm/360 filter controls stay
// visible regardless of which page you're on, so "see benchmark X at cm Y" is just
// setting the Specific cm filter before switching to the Benchmarks tab.
// ---------------------------------------------------------------------------
// Custom range date pickers.
//
// The native <input type="date"> calendar drills down month -> day with no way
// back up once you are picking days. Three plain dropdowns are dd/mm/yy that you
// can scroll in either direction, forever, in any order. Each group writes a
// YYYY-MM-DD string into a hidden input, so everything downstream is unchanged.
// ---------------------------------------------------------------------------
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildDatePickers(){
  if(!RUNS.length) return;
  const first = RUNS[0].date, last = RUNS[RUNS.length-1].date;
  const y0 = first.getFullYear(), y1 = last.getFullYear();
  document.querySelectorAll('.datepick').forEach(g => {
    if(g.dataset.built) return;
    g.dataset.built = '1';
    const isFrom = g.dataset.target === 'winFrom';
    const seed = isFrom ? first : last;
    const [d,m,y] = [g.querySelector('.dsel'), g.querySelector('.msel'), g.querySelector('.ysel')];
    for(let i=1;i<=31;i++) d.add(new Option(String(i).padStart(2,'0'), i));
    MONTH_NAMES.forEach((n,i) => m.add(new Option(n, i+1)));
    for(let i=y0;i<=y1;i++) y.add(new Option(String(i), i));
    d.value = seed.getDate(); m.value = seed.getMonth()+1; y.value = seed.getFullYear();
    [d,m,y].forEach(sel => sel.addEventListener('change', () => syncDatePicker(g)));
    syncDatePicker(g, true);
  });
}

function syncDatePicker(g, quiet){
  const d = g.querySelector('.dsel'), m = g.querySelector('.msel'), y = g.querySelector('.ysel');
  // 31 Feb is a real thing to land on when you scroll a day list. Clamp rather
  // than silently rolling over into the next month.
  const maxDay = new Date(+y.value, +m.value, 0).getDate();
  [...d.options].forEach(o => { o.disabled = +o.value > maxDay; });
  if(+d.value > maxDay) d.value = maxDay;
  const iso = y.value + '-' + String(m.value).padStart(2,'0') + '-' + String(d.value).padStart(2,'0');
  const hidden = document.getElementById(g.dataset.target);
  if(!hidden || hidden.value === iso) return;
  hidden.value = iso;
  if(!quiet) hidden.dispatchEvent(new Event('change', {bubbles:true}));
}

function getActivePool(){
  const winVal = $('#win').value;
  const custom = winVal === 'custom';
  const days = custom ? 0 : +winVal;
  const now = RUNS[RUNS.length-1].date;
  let windowEnd = now;
  if(has('#customRangeUI')) $('#customRangeUI').style.display = custom ? '' : 'none';
  const hasCmData = RUNS.some(r => r.cm360 != null);

  // Warmup / re-familiarisation runs are biased low, so they are dropped before
  // anything else is computed.
  //
  // Two pools come out of here. `pool` feeds every percentage and excludes
  // zero-score runs; `displayPool` is the same set plus those zeros, and feeds
  // the charts only. A NeverMiss zero is a real run and you should be able to
  // see it happened - it just must not pull an average down.
  let cmFilteredBase = RUNS.filter(runVisible);
  if(hasCmData && $('#cmOutlier').checked){
    const counts = {};
    RUNS.forEach(r => { if(r.cm360!=null){ const b=Math.round(r.cm360); counts[b]=(counts[b]||0)+1; } });
    const total = Object.values(counts).reduce((a,c)=>a+c,0);
    const bad = new Set();
    Object.entries(counts).forEach(([b,c]) => { if(c < TUNING.OUTLIER_MIN_RUNS || c/total < TUNING.OUTLIER_MIN_SHARE) bad.add(+b); });
    // NB: filter the already warmup/refam-filtered list, not RUNS — rebuilding
    // from RUNS here silently threw those exclusions away.
    if(bad.size) cmFilteredBase = cmFilteredBase.filter(r => r.cm360==null || !bad.has(Math.round(r.cm360)));
  }

  const cmFilter = list => {
    if(hasCmData && cmMode==='range'){
      const cmMin = parseFloat($('#cmMin').value), cmMax = parseFloat($('#cmMax').value);
      if(!isNaN(cmMin) && !isNaN(cmMax)) return list.filter(r => r.cm360!=null && r.cm360>=cmMin && r.cm360<=cmMax);
    } else if(hasCmData && cmMode==='pick' && cmPickValue!=null){
      return list.filter(r => r.cm360!=null && Math.round(r.cm360)===cmPickValue);
    }
    return list;
  };
  const displayPool = cmFilter(cmFilteredBase);
  const pool = displayPool.filter(r => r.score > 0);

  let windowStart;
  if(custom){
    const f = $('#winFrom').value, t = $('#winTo').value;
    windowStart = f ? new Date(f + 'T00:00:00') : (pool.length ? pool[0].date : new Date(0));
    if(t) windowEnd = new Date(t + 'T23:59:59');
    if(!(windowStart < windowEnd)) windowStart = pool.length ? pool[0].date : new Date(0);
  } else {
    windowStart = days ? new Date(now - days*864e5) : (pool.length ? pool[0].date : new Date(0));
  }
  // A custom range has no natural "previous window" unless it's a fixed length,
  // so treat its length as the comparison span.
  const spanDays = Math.max(1, Math.round((windowEnd - windowStart)/864e5));
  return {days, custom, spanDays, pool, displayPool,
          cmAnalysisPool: cmFilteredBase.filter(r => r.score > 0),
          windowStart, windowEnd, hasCmData};
}

function render(){
  const minRuns = +$('#minruns').value;
  const cmpMode = $('#cmp').value;
  const {days, custom, spanDays, pool, displayPool, cmAnalysisPool, windowStart, windowEnd, hasCmData} = getActivePool();
  // A custom range CAN use a previous-window baseline (the equally long span
  // before it); only "All" has nothing earlier to compare against.
  const hasPrevWindow = days > 0 || custom;
  const effCmpMode = hasPrevWindow ? cmpMode : 'first';
  $('#cmp').disabled = !hasPrevWindow;
  $('#allnote').style.display = hasPrevWindow ? 'none' : 'block';

  const analysisClusters = hasCmData ? computeCmClusters(cmAnalysisPool) : [];
  const rows = computeTrends(pool, windowStart, windowEnd, effCmpMode, minRuns, analysisClusters, displayPool);
  const runsInWindow = pool.filter(r => r.date >= windowStart && r.date <= windowEnd).length;

  const allCells = rows.reduce((a,r) => a.concat(r.cells), []);
  const overallPb  = overallOf(allCells.map(c=>c.ceiling));
  const overallAvg = overallOf(allCells.map(c=>c.typical));
  const overallLow = overallOf(allCells.map(c=>c.floor));
  const avgVsPb = (overallAvg && overallPb)
    ? {pct: overallAvg.pct - overallPb.pct,
       se: (overallAvg.se!=null && overallPb.se!=null) ? Math.sqrt(overallAvg.se**2 + overallPb.se**2) : null}
    : null;

  let avgVsPrev = null;
  if(hasPrevWindow){
    const prevEnd = new Date(windowStart.getTime() - 1);
    const prevStart = new Date(windowStart.getTime() - spanDays*864e5);
    const prevRows = computeTrends(pool, prevStart, prevEnd, cmpMode, minRuns, analysisClusters);
    const prevCells = prevRows.reduce((a,r) => a.concat(r.cells), []);
    const prevOverallAvg = overallOf(prevCells.map(c=>c.typical));
    if(overallAvg && prevOverallAvg) avgVsPrev = {
      pct: overallAvg.pct - prevOverallAvg.pct,
      se: (overallAvg.se!=null && prevOverallAvg.se!=null) ? Math.sqrt(overallAvg.se**2 + prevOverallAvg.se**2) : null
    };
  }

  const sortBy = (has('#sortby2') ? $('#sortby2').value : $('#sortby').value) || 'runs';
  if(has('#sortby')) $('#sortby').value = sortBy;
  const lastAt = r => r.rs[r.rs.length-1].date;
  // "Recommended to play" replaces the old raw "biggest drop": a drop alone is
  // usually just noise or a stale number. This ranks what would actually repay
  // a session - going backwards, gone cold, or too thin to trust yet.
  const needScore = r => {
    const days = (windowEnd - lastAt(r)) / 864e5;
    let s = 0;
    if(r.avgTrend !== null && r.avgTrend < 0) s += Math.min(30, -r.avgTrend * 2);
    if(days >= TUNING.STALE_SOFT_DAYS) s += Math.min(30, days);
    if(!r.base) s += 15;
    if(r.st.n < minRuns * 2) s += 10;
    s += Math.min(15, r.st.cv / 2);
    return s;
  };
  rows.sort((a,b) => {
    if(sortBy==='runs') return b.st.n - a.st.n;
    if(sortBy==='recent') return lastAt(b) - lastAt(a);
    if(sortBy==='name') return a.scen.localeCompare(b.scen);
    if(sortBy==='cv') return b.st.cv - a.st.cv;
    if(sortBy==='stale') return lastAt(a) - lastAt(b);
    if(sortBy==='needplay') return needScore(b) - needScore(a);
    return (b.avgTrend ?? -1e9) - (a.avgTrend ?? -1e9);
  });

  const pctStr = v => v===null ? '—' : (v>=0?'+':'') + v.toFixed(1) + '%';
  const cls = v => v===null ? '' : (v>=0?'up':'dn');
  const deltaSpan = v => v===null ? '<span style="color:var(--ink3)">—</span>' : '<span class="'+cls(v)+'">'+pctStr(v)+'</span>';
  // Rendered as its own line under the value rather than a small inline badge,
  // so the number is actually readable and the card isn't mostly empty space.
  const sideBadge = v => v===null ? '' : '<div class="vsub '+cls(v)+'">'+pctStr(v)+' avg</div>';

  // A result whose 95% interval straddles zero is not distinguishable from "no
  // change", so it is shown in neutral grey rather than green/red. The interval
  // itself is printed next to it — that one extra number is the whole
  // difference between a finding and a coin flip.
  const ciCrossesZero = e => !e || e.se == null || Math.abs(e.pct) <= TUNING.CI_Z * e.se;
  const estCls = e => (!e || e.pct == null) ? '' : (ciCrossesZero(e) ? 'ns' : (e.pct >= 0 ? 'up' : 'dn'));
  const estStr = e => (!e || e.pct == null) ? '—' : pctStr(e.pct);
  const ciStr  = e => (!e || e.se == null) ? '' : ' ± ' + (TUNING.CI_Z * e.se).toFixed(1) + '%';
  // A % built from earlyBaseline() (Batch 8) gets a small marker rather than a
  // CI, because 2-5 samples can say roughly where you started but not how
  // precisely — showing an interval on that would overstate what it knows.
  const earlyTag = n => '<abbr class="earlytag" title="Baseline is your first '+n+' run'+(n===1?'':'s')+
    ' of this — there is no separate earlier period to compare against yet, so treat this as a rough starting point, not a measured change.">early</abbr>';
  const estSpan = e => (!e || e.pct == null)
    ? '<span style="color:var(--ink3)">—</span>'
    : '<span class="'+estCls(e)+'">'+pctStr(e.pct)+'</span>' +
      (e.early ? ' '+earlyTag(e.earlyN) : '<span class="ci">'+ciStr(e)+'</span>');

  // cm/360 breakdown (always computed from the full cm spectrum, ignoring the active Range/Specific filter,
  // so different cms can be compared side by side) + best/worst performing cm.
  let cmBreakdown = [], bestCm = null, worstCm = null;
  let rangeBreakdown = [], bestRange = null, worstRange = null;
  let cmDeltas = {}, rangeDeltas = {};
  let fastSlow = null;
  if(hasCmData){
    const cmRows = computeTrends(cmAnalysisPool, windowStart, windowEnd, effCmpMode, minRuns, []);
    cmBreakdown = computeCmBreakdown(cmRows);
    const candidates = cmBreakdown.filter(e => e.runs >= TUNING.CM_CARD_MIN_RUNS && e.scenarios >= TUNING.CM_CARD_MIN_SCENARIOS);
    const pickFrom = candidates.length ? candidates : cmBreakdown;
    if(pickFrom.length){
      bestCm = pickFrom.reduce((a,b) => b.avgPct > a.avgPct ? b : a);
      worstCm = pickFrom.reduce((a,b) => b.avgPct < a.avgPct ? b : a);
    }

    const cmClusters = computeCmClusters(cmAnalysisPool);
    rangeBreakdown = computeCmRangeBreakdown(cmRows, cmClusters);
    cmDeltas = computeCmDeltas(cmAnalysisPool, windowStart, windowEnd, effCmpMode, v => Math.round(v));
    rangeDeltas = computeCmDeltas(cmAnalysisPool, windowStart, windowEnd, effCmpMode, v => clusterIndexFor(v, cmClusters));
    const rangeCandidates = rangeBreakdown.filter(e => e.runs >= TUNING.CM_CARD_MIN_RUNS && e.scenarios >= TUNING.CM_CARD_MIN_SCENARIOS);
    const rangePickFrom = rangeCandidates.length ? rangeCandidates : rangeBreakdown;
    if(rangePickFrom.length){
      bestRange = rangePickFrom.reduce((a,b) => b.avgPct > a.avgPct ? b : a);
      worstRange = rangePickFrom.reduce((a,b) => b.avgPct < a.avgPct ? b : a);
    }

    fastSlow = computeFastSlowBreakdown(cmRows);

    const winRuns = cmAnalysisPool.filter(r => r.date>=windowStart && r.date<=windowEnd && r.cm360!=null);
    const wCounts = {};
    winRuns.forEach(r => { const b=Math.round(r.cm360); wCounts[b]=(wCounts[b]||0)+1; });
    const wSorted = Object.entries(wCounts).sort((a,b)=>b[1]-a[1]);
    if(!wSorted.length){
      $('#cmWindowNote').textContent = 'No cm/360-tagged runs in this window.';
    } else if(cmMode === 'off'){
      const top3 = wSorted.slice(0,3).map(([cm,c],i) => (i+1)+'. '+cm+'cm ('+c.toLocaleString()+')').join('  ');
      $('#cmWindowNote').textContent = 'Top cm/360 in this window: ' + top3 + ' — out of ' + winRuns.length.toLocaleString() + ' cm-tagged runs.';
    } else {
      $('#cmWindowNote').textContent = 'Most used cm/360 in this window: ' + wSorted[0][0] + 'cm (' + wSorted[0][1].toLocaleString() + ' of ' + winRuns.length.toLocaleString() + ' cm-tagged runs).';
    }
  }

  const TIPS = {
    'Runs in window': 'Total runs across all scenarios shown, inside the selected time window, cm/360 filter and outlier exclusion.',
    'Scenarios shown': 'Distinct scenarios with at least the minimum run count in this window.',
    'Ceiling change': 'Your 90th-percentile score vs its baseline — what a good run looks like. Deliberately NOT your best run: a max grows with the number of runs you play, so it would show "improvement" from sample size alone. Inverse-variance weighted across every scenario × cm cell, shown with a 95% interval. Grey means the interval crosses zero, i.e. not distinguishable from no change.',
    'Typical change': 'Your 10%-trimmed mean vs its baseline — the middle of your distribution, with the best and worst tails removed so one fluke run cannot move it. Weighted by precision across all scenario × cm cells, with a 95% interval.',
    'Floor change': 'Your 10th-percentile score vs its baseline — how bad your bad runs are. Needs 20+ runs on each side, otherwise the "bottom 10%" is one or two runs and is meaningless.',
    'Typical vs Ceiling': 'Typical change minus Ceiling change. Positive means your floor is catching up to your peak (consolidation). Negative means your peak is running ahead of your typical result.',
    'Vs prev timeframe': 'This window’s Typical change minus the same figure for the equal-length window before it. Positive means your rate of improvement is accelerating.',
    'Mean spread (CV)': 'Average coefficient of variation (stdev ÷ mean) across shown scenarios — lower means scores cluster tighter around your average.',
    'Best performing cm': 'The cm/360 with the highest average score relative to your own typical average across all cms (minimum 10 runs across 2+ scenarios in this window, ignoring the Range/Specific filter above so all cms are compared). The side % is how far above your typical average that cm performs.',
    'Worst performing cm': 'The cm/360 with the lowest average score relative to your own typical average across all cms (minimum 10 runs across 2+ scenarios in this window, ignoring the Range/Specific filter above so all cms are compared).',
    'Best cm range': 'The cm/360 with the highest average score relative to your own typical average (same rules as Best performing cm), but grouped into ranges built from your actual data instead of one exact cm — consecutive cms you\'ve used get merged whenever they\'re within ~10% of each other (e.g. 35→38cm merges, 35→55cm doesn\'t), so this pools more data per bucket and is more resistant to a handful of stray runs skewing the result.',
    'Worst cm range': 'The cm range with the lowest average score relative to your own typical average, same stability advantage as Best cm range.',
    'Fast cm (<50cm)': 'Your average score across all cm/360 settings faster than 50cm, relative to your own typical average (minimum 3 runs per scenario at a fast cm).',
    'Slow cm (>50cm)': 'Your average score across all cm/360 settings slower than 50cm, relative to your own typical average (minimum 3 runs per scenario at a slow cm).'
  };

  const cardHtml = ([k,v,c,side,big]) => '<div class="card'+(big?' big':'')+'" title="'+(TIPS[k]||'')+'"><div class="k">'+k+'</div><div class="v'+(c?' '+c:'')+'">'+v+'</div>'+(side||'')+'</div>';
  // Big cards carry the estimate plus its interval underneath.
  const estCard = (k, e, avail) => [k, avail ? estStr(e) : '—', avail ? estCls(e) : '',
    (avail && e && e.se != null) ? '<div class="vsub ci">'+ciStr(e).replace(/^ /,'')+'</div>' : '', true];

  const cards = [
    estCard('Ceiling change', overallPb, true),
    estCard('Typical change', overallAvg, true),
    estCard('Floor change', overallLow, true),
    estCard('Typical vs Ceiling', avgVsPb, true),
    estCard('Vs prev timeframe', avgVsPrev, !!days),
    ['Runs in window', runsInWindow.toLocaleString(), ''],
    ['Scenarios shown', rows.length, ''],
    ['Mean spread (CV)', fmt(mean(rows.map(r=>r.st.cv).filter(v=>v!=null))) + '%', '']
  ];
  $('#overview').innerHTML = cards.map(cardHtml).join('');

  // Multiple comparisons + regression-to-the-mean caveats (STATISTICS.md §6).
  const shownWithCI = rows.filter(r => r.typical && r.typical.se != null).length;
  const wEff = warmupEffect();
  const caveats = [];
  // Whole-window power check: if most scenarios can't support a % over the range
  // you picked, say so up front rather than letting the cards imply precision.
  const underPowered = rows.filter(r => !r.powered).length;
  const headHalf = (overallAvg && overallAvg.se != null) ? TUNING.CI_Z*overallAvg.se : null;
  if(rows.length){
    if(!overallAvg){
      caveats.push('⚠ This ' + spanDays + '-day range has no scenario with enough runs on both ' +
        'sides to compute a change at all. Widen the range.');
    } else if(headHalf == null){
      caveats.push('⚠ A change is shown but its precision could not be estimated in this ' +
        spanDays + '-day range — too few runs. Treat it as a rough indication only.');
    } else if(headHalf > TUNING.TARGET_EFFECT){
      // The pooled number itself can't resolve the effect you care about.
      caveats.push('⚠ Even pooled across all scenarios, this ' + spanDays + '-day range can only ' +
        'resolve a change of about ±' + headHalf.toFixed(1) + '% — wider than the ' +
        TUNING.TARGET_EFFECT + '% you are trying to detect. Widen the range or play more before ' +
        'reading anything into these numbers.');
    } else if(underPowered / rows.length > 0.5){
      // Normal and expected: pooling is what buys the precision.
      caveats.push('Headline figures are well-powered (±' + (headHalf != null ? headHalf.toFixed(1) : '?') +
        '%) because they pool every scenario. Individual scenarios mostly are not — ' + underPowered +
        ' of ' + rows.length + ' would each need roughly 60+ comparable runs per side at their own spread. ' +
        'Trust the headline over any single scenario row.');
    }
  }
  if(shownWithCI >= 20) caveats.push('With ' + shownWithCI + ' scenarios on screen, expect ~' +
    Math.max(1, Math.round(shownWithCI*0.05)) + ' to look significant by chance alone. Treat any single standout sceptically.');
  if(wEff != null && Math.abs(wEff) >= 1) caveats.push('Your first 3 runs of a session average ' +
    (wEff>=0?'+':'') + wEff.toFixed(1) + '% vs later runs' +
    (excludeWarmup ? ' — those runs are being excluded.' : ' — consider enabling "Skip warmup".'));
  if(sortBy === 'needplay') caveats.push('Recommended-to-play partly selects scenarios that currently look bad, so they will tend to look better next time regardless of what you do (regression to the mean). Do not read that rebound as proof the recommender worked.');
  // Kept behind a toggle: it is worth reading once and then permanently in the
  // way. The button only appears when there is actually something to say.
  $('#caveats').innerHTML = caveats.length
    ? '<p class="note" style="margin-top:0">' + caveats.map(esc).join('<br>') + '</p>' : '';
  if(has('#caveatsRow')) $('#caveatsRow').style.display = caveats.length ? '' : 'none';
  if(!caveats.length && has('#caveats')) $('#caveats').style.display = 'none';

  // cm-specific cards live inside the cm/360 section so the headline row stays clean.
  const cmCards = [];
  if(bestCm) cmCards.push(['Best performing cm', bestCm.cm+'cm', '', sideBadge(bestCm.avgPct-100)]);
  if(worstCm) cmCards.push(['Worst performing cm', worstCm.cm+'cm', '', sideBadge(worstCm.avgPct-100)]);
  if(bestRange) cmCards.push(['Best cm range', bestRange.label, '', sideBadge(bestRange.avgPct-100)]);
  if(worstRange) cmCards.push(['Worst cm range', worstRange.label, '', sideBadge(worstRange.avgPct-100)]);
  if(fastSlow && (fastSlow.fast || fastSlow.slow)){
    cmCards.push(['Fast cm (<50cm)', fastSlow.fast ? '<50cm' : '—', '', fastSlow.fast ? sideBadge(fastSlow.fast.avgPct-100) : '']);
    cmCards.push(['Slow cm (>50cm)', fastSlow.slow ? '>50cm' : '—', '', fastSlow.slow ? sideBadge(fastSlow.slow.avgPct-100) : '']);
  }
  $('#cmCards').innerHTML = cmCards.map(cardHtml).join('');

  renderSessionPanel();
  const series = computeTrendSeries(pool, windowStart, windowEnd, effCmpMode, minRuns, analysisClusters);
  $('#trendChartWrap').innerHTML = trendChartHtml(series, windowStart, windowEnd);

  if(hasCmData && (cmBreakdown.length || rangeBreakdown.length)){
    $('#cmBreakdownWrap').style.display = '';
    const sortedRange = sortEntries(rangeBreakdown, rangeSort);
    const sortedCm = sortEntries(cmBreakdown, cmSort);
    const CM_COLLAPSE_N = 8;
    const shownCm = cmExpanded ? sortedCm : sortedCm.slice(0, CM_COLLAPSE_N);
    // One toggle controls both tables — they are two views of the same thing.
    let html = '<div class="scen" style="padding-bottom:8px"><h3>Performance by cm' +
      '<button type="button" id="cmTablesToggle" class="minibtn">'+(cmTablesCollapsed?'Show tables':'Hide tables')+'</button></h3>' +
      '<p class="meta" style="margin-bottom:0"><b>level</b> = how that cm performs vs your own typical avg/PB (is this cm good for you?). ' +
      '<b>change</b> = how your scores <i>at that cm</i> moved vs the same cm earlier (are you improving there?). ' +
      'Both ignore the Range/Specific filter so all cms stay comparable.</p></div>';
    const dcell = d => d ? deltaSpan(d.avgDelta) + (d.early ? ' '+earlyTag(TUNING.EARLY_BASELINE_N) : '') : '<span style="color:var(--ink3)">—</span>';
    const dcellPb = d => d ? deltaSpan(d.pbDelta) + (d.early ? ' '+earlyTag(TUNING.EARLY_BASELINE_N) : '') : '<span style="color:var(--ink3)">—</span>';
    if(!cmTablesCollapsed){
      html += '<div class="cmside-by-side">';
      if(sortedRange.length){
        html += '<div class="scen"><h3>By cm range</h3>'+
          '<p class="meta">Pooled into ranges built from your actual data — more resistant to stray runs. Click a column to sort.</p>'+
          '<table><tr>'+thCell('range','cm','range',rangeSort)+thCell('range','runs','runs',rangeSort)+thCell('range','avg','avg level',rangeSort)+thCell('range','pb','pb level',rangeSort)+'<th>avg change</th><th>pb change</th></tr>'+
          sortedRange.map(e => '<tr><td>'+e.label+'</td><td>'+e.runs.toLocaleString()+'</td><td>'+deltaSpan(e.avgPct-100)+'</td><td>'+deltaSpan(e.pbPct-100)+'</td><td>'+dcell(rangeDeltas[e.idx])+'</td><td>'+dcellPb(rangeDeltas[e.idx])+'</td></tr>').join('')+
          '</table></div>';
      }
      if(sortedCm.length){
        html += '<div class="scen"><h3>By exact cm/360</h3>'+
          '<p class="meta">Every individual cm you have used. Click a column to sort.</p>'+
          '<table><tr>'+thCell('cm','cm','cm/360',cmSort)+thCell('cm','runs','runs',cmSort)+thCell('cm','avg','avg level',cmSort)+thCell('cm','pb','pb level',cmSort)+'<th>avg change</th><th>pb change</th></tr>'+
          shownCm.map(e => '<tr><td>'+e.cm+'cm</td><td>'+e.runs.toLocaleString()+'</td><td>'+deltaSpan(e.avgPct-100)+'</td><td>'+deltaSpan(e.pbPct-100)+'</td><td>'+dcell(cmDeltas[e.cm])+'</td><td>'+dcellPb(cmDeltas[e.cm])+'</td></tr>').join('')+
          '</table>'+
          (sortedCm.length > CM_COLLAPSE_N ? '<button type="button" id="cmTableToggle" style="margin-top:10px">'+(cmExpanded ? 'Show fewer' : 'Show all '+sortedCm.length+' cms')+'</button>' : '')+
          '</div>';
      }
      html += '</div>';
    }
    $('#cmBreakdownWrap').innerHTML = html;
  } else if(hasCmData){
    $('#cmBreakdownWrap').style.display = '';
    $('#cmBreakdownWrap').innerHTML = '<p class="note">Not enough runs at any single cm/360 or cm range (need 3+ per scenario) to break down performance by cm yet.</p>';
  } else {
    $('#cmBreakdownWrap').style.display = 'none';
  }

  const colorByCm = hasCmData;
  const runQ = ($('#runSearch').value || '').trim().toLowerCase();
  const matched = runQ ? rows.filter(r => r.scen.toLowerCase().includes(runQ)) : rows;
  // Each scenario card draws an SVG chart, so rendering hundreds at once is the
  // expensive part - page them instead.
  const limit = listShowAll ? matched.length : Math.min(listLimit, matched.length);
  const shownRows = matched.slice(0, limit);
  if(has('#runSearchNote')){
    $('#runSearchNote').textContent = runQ
      ? (matched.length.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' match "' + runQ + '" · showing ' + shownRows.length)
      : (rows.length.toLocaleString() + ' scenarios · showing ' + shownRows.length);
  }
  $('#list').innerHTML = shownRows.map(r => {
    const row = (label, value, minN, est) =>
      '<tr><td>'+label+'</td><td>'+(value==null ? '<span style="color:var(--ink3)">n&lt;'+minN+'</span>' : fmt(value))+'</td>'+
      '<td>'+estSpan(est)+'</td></tr>';
    // Icons instead of paragraphs (Batch 8): the concrete thing only, on hover.
    const moreNeeded = Math.max(0, r.nRequired - r.nMin);
    const windowSpanDays = Math.max(1, (windowEnd - windowStart)/864e5);
    const ratePerDay = r.st.n / windowSpanDays;
    const etaDays = (!r.powered && ratePerDay > 0) ? Math.ceil(moreNeeded/ratePerDay) : null;
    const warnIcon = !r.powered
      ? '<span class="icon-warn" tabindex="0" title="Needs about '+moreNeeded+' more comparable run'+(moreNeeded===1?'':'s')+
        ' per side to reliably detect a '+TUNING.TARGET_EFFECT+'% change'+
        (etaDays!=null ? ' — roughly '+etaDays+' day'+(etaDays===1?'':'s')+' at your recent pace' : '')+'.">⚠️</span>'
      : '';
    const infoIcon = r.usedEarlyBaseline
      ? '<span class="icon-info" tabindex="0" title="No separate earlier period to compare against yet, so some %s below use your first '+
        TUNING.EARLY_BASELINE_N+' runs of this scenario as a rough starting point instead. Play it across a few separate days for a fully independent comparison.">ℹ️</span>'
      : '';
    const key = r.scen.trim().toLowerCase();
    // Session badge: this scenario overall, or — if that would show as a flat
    // 0.0% — the cm/360 actually being played right now (Batch 8).
    const zeroish = v => v == null || Math.abs(v) < 0.05;
    const sess = sessionAvg[key];
    const curCm = lastCmFor(r.scen);
    const sessCm = curCm != null ? sessionAvgByCm[sessionKeyOf(r.scen, curCm)] : null;
    let sessBadge = '';
    if(sess && sess.improved && !zeroish(sess.deltaPct)){
      sessBadge = '<span class="sessup" title="Your average on this scenario has risen since you started this session">▲ avg up '+
        sess.deltaPct.toFixed(1)+'% this session</span>';
    } else if(sessCm && sessCm.improved && !zeroish(sessCm.deltaPct)){
      sessBadge = '<span class="sessup" title="Your average at '+curCm+'cm/360 has risen since you started this session">▲ avg up '+
        sessCm.deltaPct.toFixed(1)+'% this session at '+curCm+'cm</span>';
    }
    const expanded = expandedScenarios.has(key);
    return '<div class="scen'+(expanded?' scen-expanded':'')+'"><h3>'+
      esc(r.scen)+' '+infoIcon+warnIcon+' '+sessBadge+
      '<button type="button" class="minibtn expandBtn" data-scen="'+esc(key)+'">'+(expanded?'Collapse':'Expand')+'</button></h3>'+
      '<p class="meta">'+r.st.n+' runs'+(r.zeroRuns ? ' <span class="zerotag" title="Runs that scored 0 — a NeverMiss that ended on the first shot, for example. Drawn on the chart, never counted in a percentage.">+'+r.zeroRuns+' scored 0</span>' : '')+' · spread '+fmt(r.st.cv)+'% · last played '+r.rs[r.rs.length-1].date.toISOString().slice(0,10)+
      (r.cells.length>1 ? ' · '+r.cells.length+' cm cells' : '')+'</p>'+
      '<table><tr><th>metric</th><th>value</th><th>vs baseline (95% CI)</th></tr>'+
      '<tr><td>PB <span class="recordtag">record</span></td><td>'+fmt(r.st.record)+pbCmTag(r.rs)+'</td><td><span style="color:var(--ink3)">not a measurement</span></td></tr>'+
      row('Ceiling (p90)', r.st.ceiling, TUNING.CEILING_MIN_N, r.ceiling)+
      row('Typical (trimmed)', r.st.typical, TUNING.TYPICAL_MIN_N, r.typical)+
      row('Floor (p10)', r.st.floor, TUNING.FLOOR_MIN_N, r.floor)+
      '</table>'+
      staleNote(r, windowEnd) +
      spark(r.rsAll || r.rs, colorByCm)+
      '<div class="legend"><span><i style="background:var(--best)"></i>PB (step — it is a ratchet, not a slope)</span>'+
      '<span><i style="background:var(--med)"></i>rolling median</span>'+
      '<span><i style="background:var(--low)"></i>rolling bottom 10%</span>'+
      '<span><i style="background:var(--ink3)"></i>individual runs</span>'+
      '<span><i class="bandkey"></i>±1σ noise floor</span></div>'+
      '</div>';
  }).join('') || '<p style="color:var(--ink2)">' +
    (runQ ? 'No scenarios match that search.' : 'No scenarios meet the minimum run count in this window.') + '</p>';

  const remaining = matched.length - shownRows.length;
  $('#listMore').innerHTML = remaining > 0
    ? '<button type="button" id="listMoreBtn">See another ' + Math.min(TUNING.LIST_PAGE_SIZE, remaining) + '</button>' +
      '<button type="button" id="listAllBtn" style="margin-left:8px">Show all ' + matched.length.toLocaleString() + ' runs</button>' +
      '<p class="note" style="margin-top:8px">Showing everything draws a chart per scenario — with this many it can make searching and scrolling stutter for a few seconds.</p>'
    : (listShowAll && matched.length > TUNING.LIST_PAGE_SIZE
        ? '<button type="button" id="listFewerBtn">Show fewer</button>' : '');
}

function esc(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// A scenario you have not touched in a while has a stale average: the % is
// still measured against an old baseline, so it says more about where you left
// off than where you are now. Flag it rather than quietly showing a number.
function staleNote(r, windowEnd){
  const days = Math.floor((windowEnd - r.rs[r.rs.length-1].date) / 864e5);
  if(days < TUNING.STALE_SOFT_DAYS) return '';
  const strength = days >= TUNING.STALE_HARD_DAYS ? 'is likely out of date' : 'may be out of date';
  return '<p class="stalewarn">Not played in ' + days + ' days — this % ' + strength +
    '. Around 10 more runs would give a reliable read.</p>';
}

// Progression of the three headline numbers across the window. Each point is
// cumulative (window start → that date) measured against the same baseline the
// cards use, so the right-hand edge lands exactly on the card values and the
// curve shows how you got there rather than bouncing around on daily noise.
function computeTrendSeries(pool, windowStart, windowEnd, cmpMode, minRuns, clusters, buckets){
  buckets = buckets || TUNING.TREND_BUCKETS;
  const t0 = windowStart.getTime(), t1 = windowEnd.getTime();
  const span = Math.max(1, t1 - t0);
  const full = computeTrends(pool, windowStart, windowEnd, cmpMode, minRuns, clusters);
  // Chart baseline is the scenario-level pooled baseline (all its cells), which
  // is what the cumulative curve is measured against.
  const baseByScen = {};
  full.forEach(r => {
    const baseScores = r.cells.reduce((a,c) => a.concat(c.b.sorted || []), []);
    if(baseScores.length) baseByScen[r.scen] = stats(baseScores);
  });
  const scens = Object.keys(baseByScen);
  if(!scens.length) return [];
  const byScen = {};
  pool.forEach(r => {
    if(baseByScen[r.scen] && r.date >= windowStart && r.date <= windowEnd) (byScen[r.scen] ||= []).push(r);
  });
  // One incremental pass per scenario instead of re-filtering + re-sorting every
  // scenario at every bucket. Running max/sum give PB and Avg in O(1); the
  // bottom-10% mean comes from a sorted-by-insertion array, so the whole series
  // costs about one sort per scenario rather than `buckets` of them. (The naive
  // version was ~30x more work and was what made a full render crawl.)
  const acc = [];
  for(let i=0;i<buckets;i++) acc.push({pbs:[], avgs:[], lows:[]});
  scens.forEach(s => {
    const rs = (byScen[s]||[]).sort((a,b)=>a.date-b.date);
    if(!rs.length) return;
    const b = baseByScen[s];
    const sorted = [];
    let sum = 0, best = -Infinity, bi = 0;
    for(let k=0;k<rs.length;k++){
      const v = rs[k].score;
      sum += v;
      if(v > best) best = v;
      let lo2 = 0, hi2 = sorted.length;
      while(lo2 < hi2){ const mid = (lo2+hi2)>>1; if(sorted[mid] < v) lo2 = mid+1; else hi2 = mid; }
      sorted.splice(lo2, 0, v);
      const tk = rs[k].date.getTime();
      // close out every bucket this run completes
      while(bi < buckets && tk > t0 + span*(bi+1)/buckets) {
        recordBucket(acc[bi], sorted, sum, best, b);
        bi++;
      }
    }
    while(bi < buckets){ recordBucket(acc[bi], sorted, sum, best, b); bi++; }
  });
  const out = [];
  for(let i=0;i<buckets;i++){
    const a = acc[i];
    out.push({
      t: t0 + span*(i+1)/buckets,
      pb:  a.pbs.length  ? mean(a.pbs)  : null,
      avg: a.avgs.length ? mean(a.avgs) : null,
      low: a.lows.length ? mean(a.lows) : null,
      n: a.avgs.length
    });
  }
  return out;
}
// Uses the same quantile/trim metrics as everything else, read off the sorted
// array that's already being maintained incrementally.
function recordBucket(slot, sorted, sum, best, b){
  const n = sorted.length;
  if(n < TUNING.TYPICAL_MIN_N) return;
  if(b.ceiling > 0 && n >= TUNING.CEILING_MIN_N)
    slot.pbs.push((quantileAt(sorted, TUNING.CEILING_Q) - b.ceiling)/b.ceiling*100);
  if(b.typical > 0)
    slot.avgs.push((trimmedMean(sorted, TUNING.TRIM_FRACTION) - b.typical)/b.typical*100);
  if(b.floor > 0 && n >= TUNING.FLOOR_MIN_N)
    slot.lows.push((quantileAt(sorted, TUNING.FLOOR_Q) - b.floor)/b.floor*100);
}

function trendChartHtml(series, windowStart, windowEnd){
  const pts = series.filter(p => p.avg !== null || p.pb !== null || p.low !== null);
  if(pts.length < 2){
    return '<div class="scen"><h3>Progress over time</h3><p class="alert">Not enough baselined runs in this window to chart a trend yet — widen the Window, or lower Min runs.</p></div>';
  }
  // PR is generous on purpose: the three end labels live out there, and at 64
  // they stacked on top of each other whenever the series converged.
  const H=340, W=Math.round(H*TUNING.CHART_ASPECT), PL=52, PR=96, PT=18, PB=30;
  const vals = [];
  pts.forEach(p => ['pb','avg','low'].forEach(k => { if(p[k]!=null && isFinite(p[k])) vals.push(p[k]); }));
  // Same rule as the per-scenario charts (CHART-SCALING.md §3), in % units.
  // Zero is always on the axis because these are changes against a baseline, so
  // "no change" is the reference line the eye needs. The span comes from the
  // spread of the plotted series rather than its min/max, so a quiet month
  // renders quiet instead of being stretched to fill the frame.
  const spread = sd(vals) || 0;
  const half = Math.max(TUNING.CHART_K * spread, TUNING.TARGET_EFFECT);
  let lo = Math.min(-half, ...vals), hi = Math.max(half, ...vals);
  if(hi - lo < 1){ hi += 0.5; lo -= 0.5; }
  const pad = (hi-lo)*0.06; lo -= pad; hi += pad;
  const t0 = pts[0].t, t1 = pts[pts.length-1].t, tSpan = Math.max(1, t1-t0);
  const x = t => PL + (t-t0)/tSpan * (W-PL-PR);
  const y = v => PT + (hi-v)/(hi-lo) * (H-PT-PB);

  const line = (key) => {
    let d='', started=false;
    pts.forEach(p => {
      const v=p[key];
      if(v==null || !isFinite(v)){ return; }
      d += (started?'L':'M') + x(p.t).toFixed(1) + ',' + y(v).toFixed(1);
      started = true;
    });
    return d;
  };
  const SERIES = [
    {key:'pb',  color:'var(--best)', label:'PB %'},
    {key:'avg', color:'var(--med)',  label:'Avg %'},
    {key:'low', color:'var(--low)',  label:'Low avg %'}
  ];

  // y gridlines
  let ticks='';
  const step = niceStep((hi-lo)/5);
  for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step){
    const yy=y(v);
    ticks += '<line x1="'+PL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+yy.toFixed(1)+'" stroke="currentColor" stroke-opacity="'+(Math.abs(v)<1e-9?'.45':'.13')+'" stroke-width="1" vector-effect="non-scaling-stroke"/>'+
      '<text x="'+(PL-8)+'" y="'+(yy+4).toFixed(1)+'" text-anchor="end" font-size="11" fill="currentColor" opacity=".75">'+(v>0?'+':'')+v.toFixed(step<1?1:0)+'%</text>';
  }

  const paths = SERIES.map(s => '<path d="'+line(s.key)+'" fill="none" stroke="'+s.color+'" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>').join('');
  // The three series usually finish within a point or two of each other, so
  // their end labels land on top of one another. Push them apart to a minimum
  // spacing, keeping their order, and run a leader line back to the real value
  // so nothing is misread as being at the height its label sits at.
  const LBL_GAP = 15;
  const ends = SERIES.map(sr => {
    let last=null; for(let i=pts.length-1;i>=0;i--){ if(pts[i][sr.key]!=null && isFinite(pts[i][sr.key])){ last=pts[i]; break; } }
    if(!last) return null;
    const v = last[sr.key];
    return {color: sr.color, v, yTrue: y(v), yLbl: y(v), t: last.t};
  }).filter(Boolean).sort((a,b) => a.yLbl - b.yLbl);
  for(let i=1;i<ends.length;i++){
    if(ends[i].yLbl - ends[i-1].yLbl < LBL_GAP) ends[i].yLbl = ends[i-1].yLbl + LBL_GAP;
  }
  // Nudge back inside the frame if the spreading pushed the stack off the bottom.
  const overflow = ends.length ? ends[ends.length-1].yLbl - (H-PB) : 0;
  if(overflow > 0) ends.forEach(e => { e.yLbl -= overflow; });

  const endLabels = ends.map(e =>
    '<path d="M'+(x(e.t)).toFixed(1)+','+e.yTrue.toFixed(1)+
      'L'+(W-PR+4)+','+e.yLbl.toFixed(1)+'" fill="none" stroke="'+e.color+
      '" stroke-width="1" opacity=".45" vector-effect="non-scaling-stroke"/>'+
    '<text x="'+(W-PR+8)+'" y="'+(e.yLbl+4).toFixed(1)+'" font-size="13" font-weight="600" fill="'+e.color+'">'+
      (e.v>=0?'+':'')+e.v.toFixed(1)+'%</text>').join('');

  const dstr = ms => new Date(ms).toISOString().slice(0,10);
  const xLabels = '<text x="'+PL+'" y="'+(H-9)+'" font-size="11" fill="currentColor" opacity=".75">'+dstr(t0)+'</text>'+
    '<text x="'+(W-PR)+'" y="'+(H-9)+'" text-anchor="end" font-size="11" fill="currentColor" opacity=".75">'+dstr(t1)+'</text>';

  const last = pts[pts.length-1];
  return '<div class="scen"><h3>Progress over time</h3>'+
    '<p class="meta">Cumulative % change vs your baseline, averaged across the '+last.n+' scenarios with enough runs. The right edge matches the cards above.</p>'+
    '<div class="chartgrid">'+
      '<div>'+
        '<svg class="tchart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="PB, average and low average percent change over time" style="color:var(--ink3)">'+
        ticks + paths + endLabels + xLabels +
        '</svg>'+
        '<div class="legend">'+SERIES.map(s=>'<span><i style="background:'+s.color+'"></i>'+s.label+'</span>').join('')+'</div>'+
      '</div>'+
      chartExplainer(last)+
    '</div>'+
    '</div>';
}

// Reading the three lines against each other is the whole point of the chart,
// so spell out what the current spread actually means rather than leaving it
// to be inferred.
function chartExplainer(last){
  const pb = last.pb, avg = last.avg, low = last.low;
  const p = v => (v==null||!isFinite(v)) ? '—' : (v>=0?'+':'') + v.toFixed(1) + '%';
  let verdict = '', detail = '';
  if(pb!=null && avg!=null && low!=null){
    const lowVsPb = low - pb, avgVsPb = avg - pb;
    if(lowVsPb > 1.5){
      verdict = 'Your floor is rising faster than your ceiling.';
      detail = 'Low avg (' + p(low) + ') is outpacing PB (' + p(pb) + '), so your bad runs are closing the gap on your best. This is consolidation — the skill is becoming reliable rather than occasional. It is the healthiest pattern to see.';
    } else if(lowVsPb < -1.5){
      verdict = 'Your ceiling is rising faster than your floor.';
      detail = 'PB (' + p(pb) + ') is outpacing low avg (' + p(low) + '), so you are spiking higher without your bad runs following. Often means you are pushing speed over control — expect the PB to feel unrepeatable until the floor catches up.';
    } else {
      verdict = 'Floor and ceiling are moving together.';
      detail = 'PB (' + p(pb) + ') and low avg (' + p(low) + ') are within a couple of points, so the whole distribution is shifting up rather than just the tails. Steady, even progress.';
    }
    if(Math.abs(avgVsPb) > 3){
      detail += avgVsPb > 0
        ? ' Avg is also well ahead of PB, which usually means more consistent sessions rather than a new peak.'
        : ' Avg is lagging PB noticeably, which usually means one or two standout runs are carrying the number.';
    }
  } else {
    verdict = 'Not enough baselined data to interpret yet.';
    detail = 'Widen the Window or lower Min runs so more scenarios have both a baseline and runs inside the window.';
  }
  return '<div class="explain">'+
    '<h4>How to read this</h4>'+
    '<p><b>'+esc(verdict)+'</b></p>'+
    '<p>'+esc(detail)+'</p>'+
    '<p class="dim">Each line is % change against the same baseline the cards use. ' +
    '<b>PB</b> is your ceiling, <b>Low avg</b> is your floor (bottom 10%), <b>Avg</b> sits between them. ' +
    'Lines rising together = real improvement; lines spreading apart = your consistency and your peak are moving at different speeds.</p>'+
    '</div>';
}
function niceStep(raw){
  if(!(raw>0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw/p;
  return (n<=1?1:n<=2?2:n<=5?5:10)*p;
}

// ---------------------------------------------------------------------------
// PB detection (Batch 2)
// Tiered on purpose: a 2nd-ever run beating the 1st isn't a milestone, but it
// should still feel like something. Full celebration is reserved for a real PB
// on a scenario you've actually played.
// ---------------------------------------------------------------------------
// Per-scenario, this session: did your average go up while you were playing?
// Baseline is your average at the moment the session's first run of that
// scenario landed, so it answers "am I doing better than when I sat down".
const sessionAvg = {};      // scen -> {startAvg, startN, improved}
// Same idea, scoped to one cm/360 (Batch 8) — feeds the session badge when the
// scenario-wide figure would show as a flat 0.0%.
const sessionAvgByCm = {};  // "scen|cm" -> same shape
function sessionKeyOf(scen, cm){ return scen.trim().toLowerCase() + '|' + cm; }
function updateSessionAvgEntry(store, key, run, matches){
  const upto = RUNS.filter(r => matches(r) && r.date <= run.date);
  if(upto.length < 3) return;
  const cur = mean(upto.map(r => r.score));
  if(!store[key]){
    const prior = upto.slice(0, -1);
    store[key] = {startAvg: prior.length ? mean(prior.map(r=>r.score)) : cur, improved:false};
  }
  const s = store[key];
  s.curAvg = cur;
  if(cur > s.startAvg) s.improved = true;
  s.deltaPct = s.startAvg > 0 ? (cur - s.startAvg)/s.startAvg*100 : null;
}
function noteSessionAvg(run){
  const key = run.scen.trim().toLowerCase();
  updateSessionAvgEntry(sessionAvg, key, run, r => r.scen.trim().toLowerCase() === key);
  if(run.cm360 != null){
    const cm = Math.round(run.cm360);
    updateSessionAvgEntry(sessionAvgByCm, sessionKeyOf(run.scen, cm), run,
      r => r.scen.trim().toLowerCase() === key && r.cm360 != null && Math.round(r.cm360) === cm);
  }
}
// The cm/360 of the most recent run of this scenario — "the cm being played
// right now", for the per-cm session badge fallback.
function lastCmFor(scen){
  const key = scen.trim().toLowerCase();
  for(let i = RUNS.length-1; i >= 0; i--){
    if(RUNS[i].scen.trim().toLowerCase() === key && RUNS[i].cm360 != null) return Math.round(RUNS[i].cm360);
  }
  return null;
}

function classifyAchievement(run){
  const key = run.scen.trim().toLowerCase();
  const prior = RUNS.filter(r => r !== run && r.scen.trim().toLowerCase() === key && r.date <= run.date);
  const tier = n => n === 0 ? 'first' : (n < 5 ? 'high' : 'pb');

  if(!prior.length) return {kind:'first', scope:'scenario', tier:'first', scen:run.scen, score:run.score};

  const best = Math.max(...prior.map(r => r.score));
  if(run.score > best){
    return {kind: tier(prior.length), scope:'scenario', scen:run.scen,
            score:run.score, prev:best, n:prior.length};
  }

  // Not a scenario best - but is it a best at this specific sensitivity?
  if(run.cm360 != null){
    const cm = Math.round(run.cm360);
    const priorCm = prior.filter(r => r.cm360 != null && Math.round(r.cm360) === cm);
    if(!priorCm.length) return null;   // first run at this cm isn't worth a shout
    const bestCm = Math.max(...priorCm.map(r => r.score));
    if(run.score > bestCm){
      return {kind: tier(priorCm.length), scope:'cm', cm, scen:run.scen,
              score:run.score, prev:bestCm, n:priorCm.length};
    }
  }
  return null;
}

function achievementText(a){
  if(a.kind === 'first') return {title:'First score!', sub:esc(a.scen) + ' — ' + fmt(a.score)};
  const where = a.scope === 'cm' ? (a.cm + 'cm ') : '';
  const gain = (a.prev > 0) ? ' (+' + ((a.score-a.prev)/a.prev*100).toFixed(1) + '%)' : '';
  if(a.kind === 'high') return {
    title: 'New highest ' + where + 'score',
    sub: esc(a.scen) + ' — ' + fmt(a.score) + ' beats ' + fmt(a.prev) + gain + ' · run ' + (a.n+1)
  };
  return {
    title: a.scope === 'cm' ? ('New ' + a.cm + 'cm PB!') : 'New personal best!',
    sub: esc(a.scen) + ' — ' + fmt(a.score) + ' beats ' + fmt(a.prev) + gain + ' · ' + a.n + ' prior runs'
  };
}

function celebrate(a){
  if(!has('#celebrate')) return;
  const t = achievementText(a);
  const full = a.kind === 'pb';
  $('#celebrate').innerHTML =
    '<div class="celebrate' + (full ? ' big' : '') + '">' +
      (full ? '<canvas class="confetti" id="confettiCanvas"></canvas>' : '') +
      '<div class="celebrate-in">' +
        '<div class="celebrate-t">' + (full ? '🎉 ' : (a.kind === 'first' ? '⭐ ' : '★ ')) + t.title + '</div>' +
        '<div class="celebrate-s">' + t.sub + '</div>' +
      '</div>' +
    '</div>';
  logMsg('achievement', {kind:a.kind, scope:a.scope, scen:a.scen, score:a.score});
  if(full) runConfetti(document.getElementById('confettiCanvas'));
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => { if(has('#celebrate')) $('#celebrate').innerHTML = ''; }, TUNING.CELEBRATE_MS);
}

// Small self-contained confetti - no library, works offline.
function runConfetti(cv){
  if(!cv) return;
  const rect = cv.parentElement.getBoundingClientRect();
  cv.width = Math.max(320, rect.width); cv.height = Math.max(90, rect.height);
  const ctx = cv.getContext('2d');
  const colors = ['#5fb98a','#4a9ee0','#e8c34a','#e08a3c','#c07be0'];
  const bits = [];
  for(let i=0;i<90;i++) bits.push({
    x: Math.random()*cv.width, y: -Math.random()*cv.height,
    vx: (Math.random()-0.5)*1.6, vy: 1.4 + Math.random()*2.4,
    w: 4+Math.random()*4, h: 5+Math.random()*6,
    rot: Math.random()*Math.PI, vr: (Math.random()-0.5)*0.28,
    c: colors[(Math.random()*colors.length)|0]
  });
  const t0 = performance.now();
  (function frame(now){
    const el = now - t0;
    if(el > TUNING.CONFETTI_MS || !cv.isConnected) return;
    ctx.clearRect(0,0,cv.width,cv.height);
    const fadeFrom = TUNING.CONFETTI_MS - 700;
    const fade = el > fadeFrom ? Math.max(0, 1-(el-fadeFrom)/700) : 1;
    bits.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.vy += 0.02;
      // Over 10 seconds every piece would have fallen out of the card, leaving
      // an empty box for most of the celebration. Recycle them off the top
      // instead - unless we are already fading out, so the end stays clean.
      if(b.y - b.h > cv.height && fade === 1){
        b.y = -b.h; b.x = Math.random()*cv.width; b.vy = 1.4 + Math.random()*2.4;
      }
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(b.x,b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.c; ctx.fillRect(-b.w/2,-b.h/2,b.w,b.h); ctx.restore();
    });
    requestAnimationFrame(frame);
  })(t0);
}

// ---------------------------------------------------------------------------
// Break reminders. Run-based and time-based are independent on purpose: the
// timer keeps running whether you play 5 runs or 50 in that period.
// ---------------------------------------------------------------------------
const BRK = {
  enabled: false, autostart: false,
  everyRuns: 30, everyMin: 0,
  runsSince: 0, timerStart: null, _tick: null
};
function loadBreakPrefs(){
  try{
    const p = JSON.parse(lsGet('kva_break')||'{}');
    Object.assign(BRK, {enabled: !!p.enabled, autostart: !!p.autostart,
      everyRuns: p.everyRuns ?? 30, everyMin: p.everyMin ?? 0});
  }catch(e){}
}
function saveBreakPrefs(){
  lsSet('kva_break', JSON.stringify({
    enabled: BRK.enabled, autostart: BRK.autostart,
    everyRuns: BRK.everyRuns, everyMin: BRK.everyMin}));
}
function startBreakTimer(){
  BRK.timerStart = Date.now();
  BRK.runsSince = 0;
  clearInterval(BRK._tick);
  BRK._tick = setInterval(() => {
    if(!BRK.enabled || !BRK.everyMin || !BRK.timerStart) return;
    const mins = (Date.now() - BRK.timerStart)/60000;
    if(mins >= BRK.everyMin){
      fireBreak(Math.round(mins) + ' minutes since your last break');
      BRK.timerStart = Date.now();
    }
    renderBreakStatus();
  }, 15000);
  renderBreakStatus();
}
function noteRunForBreak(n){
  if(!BRK.enabled) return;
  if(BRK.autostart && BRK.timerStart === null) startBreakTimer();
  BRK.runsSince += n;
  if(BRK.everyRuns && BRK.runsSince >= BRK.everyRuns){
    fireBreak(BRK.runsSince + ' runs without a break');
    BRK.runsSince = 0;
  }
  renderBreakStatus();
}
function fireBreak(why){
  if(!has('#breakAlert')) return;
  $('#breakAlert').innerHTML = '<div class="breakalert">☕ <b>Take a break</b> — ' + esc(why) +
    '. Step away for a few minutes; aim is a focus skill and tired reps reinforce bad habits.' +
    '<button type="button" id="breakDismiss" class="minibtn" style="float:none;margin-left:10px">Dismiss</button></div>';
  logMsg('break reminder fired', why);
  const d = document.getElementById('breakDismiss');
  if(d) d.addEventListener('click', () => { $('#breakAlert').innerHTML = ''; });
}
// Fires at most once per session (Batch 8) — renderSessionPanel re-runs on
// every poll tick, but re-showing this every 5s the whole time you're
// alt-tabbed would be its own kind of annoying.
let lowActiveNudgeShownFor = null;
function maybeFireLowActiveNudge(s){
  if(!has('#lowActiveAlert') || lowActiveNudgeShownFor === s.start.getTime()) return;
  const why = lowActiveDiagnosis(s);
  if(!why) return;
  lowActiveNudgeShownFor = s.start.getTime();
  $('#lowActiveAlert').innerHTML = '<div class="breakalert">⏸ <b>Mostly idle this session</b> — ' + esc(why) +
    '<button type="button" id="lowActiveDismiss" class="minibtn" style="float:none;margin-left:10px">Dismiss</button></div>';
  logMsg('low active-play nudge fired', {activePct: Math.round(s.activePct), spanSec: Math.round(s.spanSec)});
  const d = document.getElementById('lowActiveDismiss');
  if(d) d.addEventListener('click', () => { $('#lowActiveAlert').innerHTML = ''; });
}
function renderBreakStatus(){
  if(!has('#breakStatus')) return;
  if(!BRK.enabled){ $('#breakStatus').textContent = ''; return; }
  const bits = [];
  if(BRK.everyRuns) bits.push(BRK.runsSince + '/' + BRK.everyRuns + ' runs');
  if(BRK.everyMin) bits.push(BRK.timerStart
    ? Math.floor((Date.now()-BRK.timerStart)/60000) + '/' + BRK.everyMin + ' min'
    : 'timer idle');
  $('#breakStatus').textContent = bits.join(' · ');
}

// No new run for a while mid-session: usually restart-spam rather than a break.
function checkIdleNudge(){
  if(!RUNS.length || !has('#liveNote')) return;
  const last = RUNS[RUNS.length-1].date.getTime();
  const idleMin = (Date.now() - last)/60000;
  if(idleMin >= 8 && idleMin < 25 && last > lastIdleNudge){
    lastIdleNudge = last;
    $('#liveNote').innerHTML = '<p class="livenote">No completed run for ' + Math.floor(idleMin) +
      ' minutes. If you are restarting over and over, that is chasing an RNG PB rather than practising — ' +
      'let a run finish and read the score instead.</p>';
    logMsg('idle nudge shown', {idleMin: Math.round(idleMin)});
  }
}

function renderSessionPanel(){
  if(!has('#sessionPanel')) return;
  const sessions = buildSessions();
  if(!sessions.length){ $('#sessionPanel').innerHTML = ''; return; }
  const s = sessions[sessions.length-1];
  const now = RUNS[RUNS.length-1].date;
  maybeFireLowActiveNudge(s);

  const today = sessions.filter(x => x.end.toDateString() === now.toDateString());
  // Completed runs only, to match the Latest-session card. Restarts are
  // counted separately rather than inflating the day's total.
  const tRuns = today.reduce((a,x)=>a+x.completed,0);
  const tPlay = today.reduce((a,x)=>a+x.playSec,0);
  const tSpan = today.reduce((a,x)=>a+x.spanSec,0);

  const cov = s.durCoverage < 0.8
    ? '<p class="note" style="margin-top:8px">Run durations found for ' +
      Math.round(s.durCoverage*100) + '% of this session\'s runs; times are a lower bound.</p>' : '';
  const rush = rushDiagnosis(s);
  const resetWarn = resetDiagnosis(s);

  // What the watcher last saw land. Treated as "now playing" while it is recent;
  // after that it is just the last thing you played, and says so.
  const lastRun = RUNS[RUNS.length-1];
  const ageMin = (Date.now() - lastRun.date.getTime())/60000;
  const nowPlaying = !followScen ? '' :
    '<p class="nowplaying' + (ageMin < 10 ? ' live' : '') + '">' +
      (ageMin < 10 ? '<span class="dot"></span>Now playing: ' : 'Last played: ') +
      '<b>' + esc(lastRun.scen) + '</b>' +
      (lastRun.cm360 != null ? ' at ' + Math.round(lastRun.cm360) + 'cm' : '') +
      ' · ' + fmt(lastRun.score) +
      (ageMin >= 10 ? ' · ' + Math.round(ageMin) + ' min ago' : '') +
    '</p>';

  $('#sessionPanel').innerHTML = '<div class="scen"><h3>Session' +
    '<button type="button" id="sessionToggle" class="minibtn">' + (sessionCollapsed?'Show':'Hide') + '</button>' +
    // Part of the session panel, so it collapses with it rather than floating
    // over a hidden section.
    (sessionCollapsed ? '' :
      '<label class="chk followchk" title="Off: the panel stops naming what you are playing and new-run notices stop popping up."><input type="checkbox" id="followScen"' +
      (followScen?' checked':'') + '> Follow current scenario</label>') + '</h3>' +
    (sessionCollapsed ? '' :
      nowPlaying +
      '<div class="cards" style="margin-bottom:0">' +
        card('Latest session', s.completed + ' runs' +
          (s.resets ? ' <span class="ci">+' + s.resets + ' restarts</span>' : '')) +
        card('Time in KovaaK\'s', fmtDur(s.spanSec)) +
        card('Actually playing', fmtDur(s.playSec) +
          (s.activePct != null ? ' <span class="ci">(' + s.activePct.toFixed(0) + '%)</span>' : '')) +
        card('Median gap', s.medGap != null ? s.medGap.toFixed(1) + 's' : '—') +
        card('Scenarios', s.scens) +
        (logEveryRunOn() ? card('Restarts', s.resets +
          (s.maxResetStreak > 1 ? ' <span class="ci">(' + s.maxResetStreak + ' in a row)</span>' : '')) : '') +
        card('Today', tRuns + ' runs · ' + fmtDur(tPlay) + ' played') +
      '</div>' + cov +
      (resetWarn ? '<p class="resetalert">' + esc(resetWarn) + '</p>' : '') +
      logEveryRunHint() +
      (rush ? '<p class="stalewarn">' + esc(rush) + '</p>' : '')) +
    '</div>';
  const t = document.getElementById('sessionToggle');
  if(t) t.addEventListener('click', () => { sessionCollapsed = !sessionCollapsed; renderSessionPanel(); });
  const lh = document.getElementById('logHintNo');
  if(lh) lh.addEventListener('click', () => { dismissLogHint(); renderSessionPanel(); });
  const f = document.getElementById('followScen');
  if(f) f.addEventListener('change', () => {
    followScen = f.checked; saveFollowScen();
    if(!followScen && has('#liveNote')) $('#liveNote').innerHTML = '';
    renderSessionPanel();
  });

  function card(k,v){ return '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }
}

// Called after the watcher pulls in new runs: surface what just landed so you
// can see the app reacting while you play, without hunting for it in the list.
function showLiveNote(sinceMs){
  if(!has('#liveNote')) return;
  const fresh = RUNS.filter(r => r.date.getTime() > sinceMs).sort((a,b) => b.date - a.date);
  // A later tick with nothing newer (e.g. a deleted file bumping the version)
  // must not wipe the note that a previous tick just put up.
  if(!fresh.length) return;

  // Celebrate the best thing that just landed (oldest-first so the newest wins).
  let bestAch = null;
  const rank = {first:1, high:2, pb:3};
  [...fresh].reverse().forEach(r => {
    const a = classifyAchievement(r);
    if(a && (!bestAch || rank[a.kind] >= rank[bestAch.kind])) bestAch = a;
  });
  if(bestAch) celebrate(bestAch);
  fresh.forEach(noteSessionAvg);
  noteRunForBreak(fresh.length);
  renderSessionPanel();
  if(!followScen){ $('#liveNote').innerHTML = ''; return; }
  const n = fresh[0];
  const when = n.date.toTimeString().slice(0,5);
  $('#liveNote').innerHTML = '<p class="livenote">Just played: <b>' + esc(n.scen) + '</b> — ' +
    fmt(n.score) + (n.cm360!=null ? ' at ' + Math.round(n.cm360) + 'cm' : '') + ' at ' + when +
    (fresh.length > 1 ? ' &nbsp;·&nbsp; ' + fresh.length + ' new runs picked up' : '') + '</p>';
  clearTimeout(showLiveNote._t);
  showLiveNote._t = setTimeout(() => { if(has('#liveNote')) $('#liveNote').innerHTML = ''; }, 60000);
}

function renderLog(){
  const lines = LOG.map(e => e.t.replace('T',' ').slice(0,19) + '  ' + e.msg + (e.data!==undefined ? '  ' + JSON.stringify(e.data) : ''));
  $('#logWrap').innerHTML = '<div class="scen"><h3>Session log' +
    '<button type="button" id="logDownload" class="minibtn">Download .log</button>' +
    '<button type="button" id="logClear" class="minibtn" style="margin-right:6px">Clear</button></h3>'+
    '<p class="meta">'+LOG.length+' entries this session · id '+SESSION_ID+'</p>'+
    '<div class="logbox">'+esc(lines.join('\n') || 'No entries yet.')+'</div></div>';
}
function downloadLog(){
  const body = LOG.map(e => e.t + '\t' + e.msg + (e.data!==undefined ? '\t' + JSON.stringify(e.data) : '')).join('\n');
  const blob = new Blob([body], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kovaaks-stats-' + SESSION_ID + '.log';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function applyPage(){
  $('#pageTabConsistency').classList.toggle('active', currentPage==='consistency');
  $('#pageTabBenchmarks').classList.toggle('active', currentPage==='benchmarks');
  $('#app').style.display = (currentPage==='consistency' && RUNS.length) ? 'block' : 'none';
  $('#benchApp').style.display = currentPage==='benchmarks' ? 'block' : 'none';
}

function scenarioMatchCount(bench){
  if(!RUNS.length) return null;
  let matched = 0;
  bench.scenarios.forEach(sc => { if(SCEN_NAMES.has(sc.n.trim().toLowerCase())) matched++; });
  return matched;
}

// PB = your all-time best at this scenario (cm-filtered, but not time-windowed) — "have
// you ever cleared this rank". Avg = your average within the selected Window — "are you
// consistently there". Same PB/Avg duality used throughout the Consistency page.
function scenarioStatsFor(scenName, pool, windowStart, windowEnd){
  const key = scenName.trim().toLowerCase();
  const allRuns = pool.filter(r => r.scen.trim().toLowerCase() === key);
  const winRuns = allRuns.filter(r => r.date >= windowStart && r.date <= windowEnd);
  return {
    pb: allRuns.length ? Math.max(...allRuns.map(r=>r.score)) : null,
    avg: winRuns.length ? mean(winRuns.map(r=>r.score)) : null,
    allCount: allRuns.length, winCount: winRuns.length
  };
}

function rankAchieved(score, ranks){
  if(score == null) return null;
  let achieved = null;
  for(const r of ranks) if(score >= r.t) achieved = r;
  return achieved;
}

function canonicalRankOrder(bench){
  let best = [];
  bench.scenarios.forEach(sc => { if(sc.r.length > best.length) best = sc.r.map(r=>r.n); });
  return best;
}

function renderBenchmarkList(){
  if(!has('#benchListWrap')) return;
  const q = ($('#benchSearch').value || '').trim().toLowerCase();
  const filtered = q ? BENCH_DATA.filter(b => b.name.toLowerCase().includes(q)) : BENCH_DATA;
  $('#benchCtxNote').textContent = filtered.length.toLocaleString() + ' of ' + BENCH_DATA.length.toLocaleString() + ' benchmarks.' +
    (RUNS.length ? ' "Played" counts respect the Window and cm/360 filter above; click one to see your PB/Avg and rank per scenario.' : ' Load your stats to see your scores — you can still browse scenario lists and rank thresholds now.');
  $('#benchListWrap').innerHTML = filtered.map(b => {
    const total = b.scenarios.length;
    const matched = scenarioMatchCount(b);
    return '<div class="scen benchrow" data-name="'+esc(b.name)+'"><h3>'+esc(b.name)+'</h3>'+
      '<p class="meta">'+total+' scenarios'+(matched!=null ? ' · '+matched+'/'+total+' played' : '')+'</p></div>';
  }).join('') || '<p class="note">No benchmarks match that search.</p>';
  $('#benchListWrap').style.display = '';
  $('#benchDetailWrap').style.display = 'none';
}

function openBenchmark(name){
  const b = BENCH_DATA.find(x => x.name === name);
  if(!b) return;
  $('#benchListWrap').style.display = 'none';
  $('#benchDetailWrap').style.display = '';

  const order = canonicalRankOrder(b);
  let pool = [], windowStart = null, windowEnd = null;
  if(RUNS.length) ({pool, windowStart, windowEnd} = getActivePool());

  let pbIdxMin = order.length, avgIdxMin = order.length, playedCount = 0;
  const rows = b.scenarios.map(sc => {
    const st = RUNS.length ? scenarioStatsFor(sc.n, pool, windowStart, windowEnd) : {pb:null,avg:null,allCount:0,winCount:0};
    if(st.allCount>0 || st.winCount>0) playedCount++;
    const pbRank = rankAchieved(st.pb, sc.r);
    const avgRank = rankAchieved(st.avg, sc.r);
    if(RUNS.length){
      pbIdxMin = Math.min(pbIdxMin, pbRank ? order.indexOf(pbRank.n) : -1);
      avgIdxMin = Math.min(avgIdxMin, avgRank ? order.indexOf(avgRank.n) : -1);
    }
    return {name: sc.n, ranks: sc.r, pb: st.pb, avg: st.avg, pbRank, avgRank};
  });
  const overallPbRank = (RUNS.length && pbIdxMin>=0 && pbIdxMin<order.length) ? order[pbIdxMin] : null;
  const overallAvgRank = (RUNS.length && avgIdxMin>=0 && avgIdxMin<order.length) ? order[avgIdxMin] : null;

  const evxlLink = b.kbid ? ' · <a href="https://evxl.app/leaderboards/'+b.kbid+'" target="_blank" rel="noopener">View on evxl.app ↗</a>' : '';
  const summaryCards = RUNS.length ? (
    '<div class="cards" style="margin-bottom:16px">'+
      '<div class="card" title="Weakest-link rank: the lowest rank tier you\'ve cleared across every scenario in this benchmark, using your all-time PB per scenario (cm-filtered by the controls above). A scenario you haven\'t played at all counts as not cleared."><div class="k">Overall rank (PB, all-time)</div><div class="v">'+(overallPbRank?esc(overallPbRank):'Unranked')+'</div></div>'+
      '<div class="card" title="Same weakest-link rule, using your average score within the selected Window instead of your PB — how consistently you\'re actually at that rank right now."><div class="k">Overall rank (Avg, this window)</div><div class="v">'+(overallAvgRank?esc(overallAvgRank):'Unranked')+'</div></div>'+
    '</div>'
  ) : '<p class="note">Load your stats to see your PB/Avg and rank per scenario.</p>';

  $('#benchDetailWrap').innerHTML = '<div class="scen">'+
    '<button type="button" id="benchBack" class="minibtn">← Back</button>'+
    '<h3>'+esc(b.name)+'</h3>'+
    '<p class="meta">'+b.scenarios.length+' scenarios'+(RUNS.length ? ' · '+playedCount+'/'+b.scenarios.length+' played':'')+evxlLink+'</p>'+
    summaryCards+
    '<table><tr><th>scenario</th><th>PB</th><th>PB rank</th><th>avg</th><th>avg rank</th><th>thresholds</th></tr>'+
    rows.map(r => '<tr><td>'+esc(r.name)+(SCEN_NAMES.size && !SCEN_NAMES.has(r.name.trim().toLowerCase()) ? ' <span style="color:var(--ink3)">(no runs)</span>' : '')+'</td>'+
      '<td>'+(r.pb!=null?fmt(r.pb):'—')+'</td>'+
      '<td>'+(r.pbRank?esc(r.pbRank.n):'—')+'</td>'+
      '<td>'+(r.avg!=null?fmt(r.avg):'—')+'</td>'+
      '<td>'+(r.avgRank?esc(r.avgRank.n):'—')+'</td>'+
      '<td style="text-align:left;font-size:10.5px;color:var(--ink2)">'+r.ranks.map(rk=>esc(rk.n)+' '+rk.t).join(' · ')+'</td>'+
      '</tr>').join('')+
    '</table></div>';
}

function cmColor(bucket){ return 'hsl(' + ((bucket*137) % 360) + ' 70% 58%)'; }
// Which cm a scenario's runs sit at, plus the two facts you actually want when
// a scenario has been played at several: where most of the volume is, and which
// one the record was set on. Reading that off coloured dots was guesswork.
function cmProfile(rs){
  const counts = new Map();
  let pbRun = null;
  rs.forEach(r => {
    if(r.cm360 == null) return;
    const b = Math.round(r.cm360);
    counts.set(b, (counts.get(b) || 0) + 1);
    if(!pbRun || r.score > pbRun.score) pbRun = r;
  });
  if(!counts.size) return null;
  let most = null;
  counts.forEach((n, b) => { if(!most || n > most.n) most = {cm: b, n}; });
  return {
    buckets: [...counts.keys()].sort((a,b)=>a-b),
    counts,
    most,
    pbCm: pbRun && pbRun.cm360 != null ? Math.round(pbRun.cm360) : null,
    total: rs.length
  };
}

// Sits next to the PB value. Only worth showing when the scenario has runs at
// more than one sensitivity - otherwise it is noise on every single row.
function pbCmTag(rs){
  const p = cmProfile(rs);
  if(!p || p.buckets.length < 2 || p.pbCm == null) return '';
  return ' <span class="pbcm" style="border-color:'+cmColor(p.pbCm)+
    '" title="Your record on this scenario was set at '+p.pbCm+'cm/360">'+p.pbCm+'cm</span>';
}

// Chips are clickable (Batch 8): picking one sets the app's Specific-cm filter
// to that value, so "look at this scenario at just this cm" is one click.
function cmDotLegend(rs){
  const p = cmProfile(rs);
  if(!p) return '';
  const multi = p.buckets.length > 1;
  return '<div class="cmlegend">'+p.buckets.map(b => {
    const n = p.counts.get(b);
    const isMost = multi && p.most && b === p.most.cm;
    const isPb   = multi && b === p.pbCm;
    const tags = (isMost ? '<b class="cmtag most">most played</b>' : '') +
                 (isPb   ? '<b class="cmtag pb">PB</b>' : '');
    return '<span class="cmchip" data-cm="'+b+'" tabindex="0" title="'+n+' run'+(n===1?'':'s')+' at '+b+'cm'+
      (isMost ? ' — more than at any other sensitivity' : '')+
      (isPb ? ' — your record on this scenario was set here' : '')+' — click to filter to '+b+'cm">'+
      '<i class="cmswatch" style="background:'+cmColor(b)+'"></i>'+b+'cm'+tags+'</span>';
  }).join('')+'</div>';
}

// ---------------------------------------------------------------------------
// Honest chart scaling — see CHART-SCALING.md for the full reasoning.
//
// The y-axis is set from the SPREAD of the scores, not their range. Auto-fitting
// min/max is the single biggest source of visual dishonesty in a progress chart:
// it stretches whatever variation exists to fill the frame, so a plateau and a
// breakthrough look identical. Scaling in sigmas means the visual size of a
// change tracks its size in units of the noise.
//
// sigma comes from a FIXED trailing window (the last CHART_SIGMA_N runs), not
// from whatever happens to be visible, so switching Window never changes how
// big a given gain looks. Two screenshots a week apart stay comparable.
// ---------------------------------------------------------------------------
function chartScale(scores){
  const tail = scores.slice(-TUNING.CHART_SIGMA_N);
  const mu = mean(tail), sd0 = sd(tail);
  // Two clamps. The percentage floor stops a freakishly consistent streak from
  // collapsing the axis and re-amplifying noise; the min/max expansion keeps
  // every plotted run inside the frame, because a clipped line silently hides
  // the exact run the user is looking for.
  const span = Math.max(TUNING.CHART_K * sd0, TUNING.CHART_MIN_SPAN_PCT * Math.abs(mu)) || 1;
  const lo = Math.min(mu - span, Math.min(...scores));
  const hi = Math.max(mu + span, Math.max(...scores));
  return { lo, hi, mu, sd: sd0, span, n: tail.length };
}

function spark(rsAll, byCm){
  // 2:1 plot area. Slope is judged most accurately when the average segment
  // sits near 45 degrees; wide-and-short charts flatten trends (Cleveland).
  const H = 340, W = Math.round(H * TUNING.CHART_ASPECT), P = 10, PL = 46;
  // Zero-score runs are drawn, but they take no part in the scale, the rolling
  // lines or the sigma band. A NeverMiss zero is the moment you lost, not a
  // level of performance - letting it set the axis floor would squash every
  // real run into the top of the frame for no informational gain.
  const rs = rsAll.filter(r => r.score > 0);
  const zeros = rsAll.filter(r => r.score <= 0);
  if(!rs.length) return '';
  const sc = rs.map(r => r.score);
  const s = chartScale(sc);
  const rng = (s.hi - s.lo) || 1;
  const x = i => PL + i*(W-PL-P)/Math.max(1, rs.length-1);
  const y = v => H-P - ((v-s.lo)/rng)*(H-2*P);
  const k = Math.max(5, Math.round(rs.length/12));

  let med='', low='', bandTop='', bandBot=[], pb='';
  let best = -Infinity, prevBest = null;
  for(let i=0;i<rs.length;i++){
    const w = sc.slice(Math.max(0,i-k+1), i+1).sort((a,b)=>a-b);
    const m = median(w);
    med += (i?'L':'M')+x(i).toFixed(1)+','+y(m).toFixed(1);
    low += (i?'L':'M')+x(i).toFixed(1)+','+y(pctMean(w,0.10)).toFixed(1);
    // +-1 sigma around the rolling mean: the noise floor, drawn explicitly.
    // Clearing the band is progress; sitting inside it is a good day.
    bandTop += (i?'L':'M')+x(i).toFixed(1)+','+y(m+s.sd).toFixed(1);
    bandBot.push('L'+x(i).toFixed(1)+','+y(m-s.sd).toFixed(1));
    // PB is a ratchet, so it is drawn as a step. A diagonal between two PBs
    // would be a claim about the runs in between, and nothing happened there.
    if(sc[i] > best){
      if(prevBest === null) pb += 'M'+x(i).toFixed(1)+','+y(sc[i]).toFixed(1);
      else pb += 'H'+x(i).toFixed(1)+'V'+y(sc[i]).toFixed(1);
      best = sc[i]; prevBest = best;
    }
  }
  if(prevBest !== null) pb += 'H'+x(rs.length-1).toFixed(1);
  bandBot.reverse();
  const band = (rs.length >= TUNING.CHART_BAND_MIN_N && s.sd > 0)
    ? '<path d="'+bandTop+bandBot.join('')+'Z" fill="var(--med)" opacity=".15"/>' : '';

  const dots = rs.map((r,i)=>{
    const useCm = byCm && r.cm360!=null;
    const fill = useCm ? cmColor(Math.round(r.cm360)) : 'currentColor';
    const op = useCm ? '.8' : '.32';
    const rad = useCm ? 2.1 : 1.4;
    return '<circle cx="'+x(i).toFixed(1)+'" cy="'+y(r.score).toFixed(1)+'" r="'+rad+'" fill="'+fill+'" opacity="'+op+'"/>';
  }).join('');

  // The axis is no longer "whatever fits", so it has to be labelled or the
  // reader has no idea what vertical distance means.
  let ticks='';
  const step = niceStep(rng/4);
  for(let v=Math.ceil(s.lo/step)*step; v<=s.hi; v+=step){
    const yy=y(v);
    ticks += '<line x1="'+PL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-P)+'" y2="'+yy.toFixed(1)+'" stroke="currentColor" stroke-opacity=".10" stroke-width="1" vector-effect="non-scaling-stroke"/>'+
      '<text x="'+(PL-6)+'" y="'+(yy+3.5).toFixed(1)+'" text-anchor="end" font-size="11" fill="currentColor" opacity=".8">'+fmt(v)+'</text>';
  }

  // Pinned to the axis floor with a hollow marker: present, countable, and
  // obviously not part of the trend.
  const zeroMarks = zeros.map(z => {
    // Placed by time so it lands where it happened, not bolted onto the end.
    const i = rs.findIndex(r => r.date > z.date);
    const at = i === -1 ? rs.length - 1 : Math.max(0, i - 1);
    return '<circle cx="'+x(at).toFixed(1)+'" cy="'+(H-P-2).toFixed(1)+'" r="2.6" fill="none" '+
      'stroke="var(--low)" stroke-width="1.2" opacity=".65"><title>Scored 0 on '+
      esc(z.date.toISOString().slice(0,10))+' — shown, but not counted in any %</title></circle>';
  }).join('');

  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Score over time with individual runs, a one-sigma noise band, PB steps, rolling median and rolling bottom ten percent" style="color:var(--ink3)">'+
    ticks + band + dots + zeroMarks +
    '<path d="'+pb+'" fill="none" stroke="var(--best)" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/>'+
    '<path d="'+low+'" fill="none" stroke="var(--low)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'+
    '<path d="'+med+'" fill="none" stroke="var(--med)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>'+
    scaleNote(s, zeros.length) +
    (byCm ? cmDotLegend(rs) : '');
}

// Says out loud what the axis is doing, so nobody has to guess whether a big
// visual swing is a big real swing.
function scaleNote(s, zeroCount){
  const pct = s.mu ? (s.sd/Math.abs(s.mu)*100) : 0;
  const zeroBit = zeroCount
    ? ' <span class="zeronote">' + zeroCount + ' run' + (zeroCount===1?'':'s') +
      ' scored 0 (hollow marks along the bottom) — shown, but left out of every %.</span>'
    : '';
  return '<p class="scalenote" title="The y-axis is set from your spread, not from your best and worst run. That keeps the vertical size of a change proportional to how noisy your scores actually are — a flat month looks flat instead of being stretched to fill the chart.">'+
    'Axis: mean '+fmt(s.mu)+' ± '+TUNING.CHART_K+'σ (σ = '+fmt(s.sd)+', '+pct.toFixed(1)+'% of mean, from your last '+s.n+' runs). '+
    'Shaded band is ±1σ — <b>clearing the band is progress, inside the band is a good day.</b>'+zeroBit+'</p>';
}

let showRunsView = false;
function applyRunsView(){
  $('#overview').classList.toggle('hero', !showRunsView);
  $('#listWrap').style.display = showRunsView ? '' : 'none';
  $('#toggleRuns').textContent = showRunsView ? 'Back to overview ▴' : 'See runs ▾';
}
$('#toggleRuns').addEventListener('click', () => { showRunsView = !showRunsView; applyRunsView(); });
applyRunsView();

$('#pageTabConsistency').addEventListener('click', () => { currentPage = 'consistency'; applyPage(); });
$('#pageTabBenchmarks').addEventListener('click', () => { currentPage = 'benchmarks'; applyPage(); renderBenchmarkList(); });
applyPage();
renderBenchmarkList();
$('#benchSearch').addEventListener('input', renderBenchmarkList);
$('#benchListWrap').addEventListener('click', e => {
  const row = e.target.closest('.benchrow');
  if(row) openBenchmark(row.dataset.name);
});
$('#benchDetailWrap').addEventListener('click', e => {
  if(e.target.id === 'benchBack') renderBenchmarkList();
});

$('#cmBreakdownWrap').addEventListener('click', e => {
  const th = e.target.closest('th[data-key]');
  if(th){
    const state = th.dataset.table==='cm' ? cmSort : rangeSort;
    const key = th.dataset.key;
    if(state.key === key) state.dir = state.dir==='asc' ? 'desc' : 'asc';
    else { state.key = key; state.dir = key==='cm' ? 'asc' : 'desc'; }
    render();
    return;
  }
  if(e.target.id === 'cmTableToggle'){ cmExpanded = !cmExpanded; render(); }
  if(e.target.id === 'cmTablesToggle'){ cmTablesCollapsed = !cmTablesCollapsed; render(); }
});

$('#favCmRow').addEventListener('click', e => {
  const btn = e.target.closest('.favchip');
  if(!btn) return;
  cmPickValue = +btn.dataset.cm;
  setCmTab('pick');
  rebuildCmPickOptions();
  render();
});

$('#cmTabOff').addEventListener('click', () => { setCmTab('off'); render(); });
$('#cmTabRange').addEventListener('click', () => { setCmTab('range'); render(); });
$('#cmTabPick').addEventListener('click', () => { setCmTab('pick'); render(); });
$('#cmListAll').addEventListener('click', () => { cmListExpanded = !cmListExpanded; rebuildCmPickOptions(); });
$('#cmList').addEventListener('click', e => {
  const star = e.target.closest('.cmstar');
  if(star){
    const cm = +star.dataset.star;
    if(favCms.has(cm)) favCms.delete(cm); else favCms.add(cm);
    saveFavCms();
    rebuildCmPickOptions();
    return;
  }
  const item = e.target.closest('.cmitem');
  if(!item) return;
  cmPickValue = +item.dataset.cm;
  rebuildCmPickOptions();
  render();
});
if(has('#cmPickSearch')){
  let _ct = null;
  $('#cmPickSearch').addEventListener('input', () => {
    clearTimeout(_ct); _ct = setTimeout(rebuildCmPickOptions, 100);
  });
}
$('#cmOutlier').addEventListener('change', render);
loadBreakPrefs();
function syncBreakUI(){
  $('#brkEnable').checked = BRK.enabled;
  $('#brkAuto').checked = BRK.autostart;
  $('#brkRuns').value = BRK.everyRuns;
  $('#brkMin').value = String(BRK.everyMin);
  $('#brkOpts').style.display = BRK.enabled ? '' : 'none';
  renderBreakStatus();
}
if(has('#brkEnable')){
  syncBreakUI();
  $('#brkEnable').addEventListener('change', () => {
    BRK.enabled = $('#brkEnable').checked; saveBreakPrefs();
    if(BRK.enabled) startBreakTimer(); else { clearInterval(BRK._tick); BRK.timerStart = null; }
    syncBreakUI();
  });
  $('#brkAuto').addEventListener('change', () => { BRK.autostart = $('#brkAuto').checked; saveBreakPrefs(); });
  $('#brkRuns').addEventListener('change', () => { BRK.everyRuns = Math.max(0, +$('#brkRuns').value||0); saveBreakPrefs(); renderBreakStatus(); });
  $('#brkMin').addEventListener('change', () => { BRK.everyMin = +$('#brkMin').value||0; saveBreakPrefs(); if(BRK.enabled) startBreakTimer(); });
  $('#brkReset').addEventListener('click', () => { startBreakTimer(); $('#breakAlert').innerHTML = ''; });
  if(BRK.enabled && BRK.autostart) startBreakTimer();
}

$('#exWarmup').addEventListener('change', () => { excludeWarmup = $('#exWarmup').checked; render(); });
$('#exRefam').addEventListener('change', () => { excludeRefam = $('#exRefam').checked; render(); });
$('#sortby2').addEventListener('change', () => { $('#sortby').value = $('#sortby2').value; render(); });
$('#cmClear').addEventListener('click', () => {
  setCmTab('off');
  $('#cmOutlier').checked = true;
  render();
});

$('#cmSectionToggle').addEventListener('click', () => {
  const open = $('#cmSection').style.display !== 'none';
  $('#cmSection').style.display = open ? 'none' : '';
  $('#cmSectionToggle').textContent = open ? 'cm/360 analysis ▾' : 'cm/360 analysis ▴';
  $('#cmSectionToggle').classList.toggle('active', !open);
});
// The in-page log panel is gone; logging still runs and is written to logs/ on
// disk by the server, which is what it was actually for (crash/debug history).
// downloadLog() is kept and can be called from the console if ever needed.

$('#pick').addEventListener('change', e => ingest(e.target.files));
$('#pickf').addEventListener('change', e => ingest(e.target.files));
['win','minruns','sortby','cmp','cmMin','cmMax','winFrom','winTo'].forEach(id => $('#'+id).addEventListener('change', render));
if(has('#runSearch')){
  let _t = null;
  $('#runSearch').addEventListener('input', () => {
    clearTimeout(_t);
    $('#listWrap').classList.add('busy');   // fades the list while typing
    listLimit = TUNING.LIST_PAGE_SIZE;      // a new search starts from the top
    listShowAll = false;
    _t = setTimeout(() => { render(); $('#listWrap').classList.remove('busy'); }, 160);
  });
}
$('#listMore').addEventListener('click', e => {
  if(e.target.id === 'listMoreBtn'){ listLimit += TUNING.LIST_PAGE_SIZE; render(); }
  if(e.target.id === 'listAllBtn'){ listShowAll = true; render(); }
  if(e.target.id === 'listFewerBtn'){ listShowAll = false; listLimit = TUNING.LIST_PAGE_SIZE; render(); }
});
// Delegated onto the (never-replaced) wrapper, since #list's own innerHTML is
// rebuilt on every render() — a listener on the cards themselves would vanish.
$('#list').addEventListener('click', e => {
  const expBtn = e.target.closest('.expandBtn');
  if(expBtn){
    const key = expBtn.dataset.scen;
    if(expandedScenarios.has(key)) expandedScenarios.delete(key); else expandedScenarios.add(key);
    render();
    return;
  }
  const chip = e.target.closest('.cmchip');
  if(chip){
    cmPickValue = +chip.dataset.cm;
    setCmTab('pick');
    rebuildCmPickOptions();
    render();
  }
});

const drop = $('#drop');
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
drop.addEventListener('drop', async e => {
  const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if(!items.length){ ingest(e.dataTransfer.files); return; }
  const files = [];
  async function walk(entry){
    if(entry.isFile) return new Promise(res => entry.file(f => { files.push(f); res(); }, res));
    const rd = entry.createReader();
    let batch;
    do { batch = await new Promise(res => rd.readEntries(res, ()=>res([])));
         for(const en of batch) await walk(en); } while(batch.length);
  }
  for(const it of items) await walk(it);
  ingest(files);
});

// ---- data loading ------------------------------------------------------
// Preferred path: the Python server has already parsed the stats folder and
// keeps it warm, so this is a single JSON fetch rather than 21k file reads.
// Fallback: opened as a bare file:// page, in which case we ask for the folder.
async function loadFromServer(){
  const r = await fetch('api/runs', {cache:'no-store'});
  if(!r.ok) throw new Error('api/runs ' + r.status);
  const j = await r.json();
  if(!j.rows || !j.rows.length) throw new Error('server returned no runs');
  RUNS = unpackRuns(j).sort((a,b) => a.date - b.date);
  dataVersion = j.version;
  let extra = '';
  if(j.skipped) extra = ' Skipped ' + j.skipped + ' unreadable files.';
  logMsg('loaded runs from server', {runs: RUNS.length, version: j.version, folder: j.folder});
  afterRunsLoaded(extra, null, j.folder);
  return true;
}

// The server bumps `version` whenever the watcher sees new runs land.
async function pollForNewRuns(){
  if(!SERVER_MODE) return;
  checkIdleNudge();
  try{
    const r = await fetch('api/version', {cache:'no-store'});
    if(!r.ok) return;
    const j = await r.json();
    if(dataVersion !== null && j.version !== dataVersion){
      const before = RUNS.length ? RUNS[RUNS.length-1].date.getTime() : 0;
      logMsg('new runs detected by watcher — reloading', {from: dataVersion, to: j.version});
      await loadFromServer();
      showLiveNote(before);
    }
  }catch(err){ /* server went away; keep showing what we have */ }
}

// ---- choosing your stats folder ---------------------------------------
// Browsers deliberately never hand a page an absolute path, so a normal file
// input can't tell the server where your folder is. Instead: offer whatever
// Steam installs we detected, a real OS folder dialog opened by the local
// server, and a plain paste-the-path box as the always-works fallback.
let SERVER_CONFIG = null;

async function refreshServerConfig(){
  const r = await fetch('api/config', {cache:'no-store'});
  if(!r.ok) throw new Error('api/config ' + r.status);
  SERVER_CONFIG = await r.json();
  renderBuildStamp();
  return SERVER_CONFIG;
}

// Every frozen release is an independent copy on its own port. Print which one
// this is, so "am I looking at the old build or the new one" is answered by
// looking at the page instead of by guessing from which features appear.
function renderBuildStamp(){
  if(!has('#buildStamp')) return;
  const v = SERVER_CONFIG && SERVER_CONFIG.appVersion;
  const port = SERVER_CONFIG && SERVER_CONFIG.port;
  const label = v || BUILD || 'dev';
  $('#buildStamp').textContent = SERVER_MODE
    ? 'build ' + (label === 'dev' ? 'dev (working copy)' : label) +
      (BUILD_HASH ? ' · ' + BUILD_HASH : '') + (port ? ' · port ' + port : '')
    : 'build: local file mode (no server)';
}

function showFolderSetup(msg){
  const c = SERVER_CONFIG || {candidates: [], folder: ''};
  const cands = (c.candidates || []).map(p =>
    '<button type="button" class="pathbtn" data-folder="'+esc(p)+'">' +
    '<span class="pathbtn-k">Use this</span><span class="pathbtn-p">'+esc(p)+'</span></button>').join('');
  $('#drop').style.display = 'none';
  $('#panel').classList.remove('compact');
  $('#folderSetup').style.display = '';
  $('#folderSetup').innerHTML =
    '<h3 style="margin:0 0 4px;font-size:16px;font-weight:500">Choose your KovaaK\'s stats folder</h3>' +
    '<p class="note" style="margin:0 0 14px">Usually <code>…\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer\\stats</code></p>' +
    (msg ? '<div class="err" style="margin:0 0 14px">'+esc(msg)+'</div>' : '') +
    (cands.length ? '<p class="note" style="margin:0 0 8px">Found on this machine:</p><div class="pathlist">'+cands+'</div>' : '') +
    '<div class="searchbar" style="margin-top:14px">' +
      '<input type="text" id="folderInput" placeholder="Or paste the full path…" value="'+esc(c.folder||'')+'">' +
      '<button type="button" id="folderBrowse">Browse…</button>' +
      '<button type="button" id="folderUse">Use folder</button>' +
    '</div>' +
    '<p class="note" id="folderStatus" style="margin:10px 0 0"></p>';
}

async function useFolder(folder){
  if(!folder || !folder.trim()) return;
  $('#folderStatus').textContent = 'Reading ' + folder + ' — first time on a big folder takes a few seconds…';
  logMsg('setting stats folder', folder);
  let res;
  try{
    res = await fetch('api/folder', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({folder})
    });
  }catch(err){
    $('#folderStatus').textContent = 'Could not reach the server: ' + err;
    return;
  }
  const j = await res.json().catch(()=>({}));
  if(!res.ok){
    $('#folderStatus').textContent = j.error || ('Failed (' + res.status + ')');
    logMsg('folder rejected', j.error || res.status);
    return;
  }
  logMsg('folder accepted', {folder: j.folder, runs: j.runs});
  $('#folderSetup').style.display = 'none';
  await refreshServerConfig();
  await loadFromServer();
}

function wireFolderSetup(){
  $('#folderSetup').addEventListener('click', async e => {
    const btn = e.target.closest('.pathbtn');
    if(btn){ useFolder(btn.dataset.folder); return; }
    if(e.target.id === 'folderUse'){ useFolder($('#folderInput').value); return; }
    if(e.target.id === 'folderBrowse'){
      // The request blocks for as long as the dialog is open, and the dialog
      // belongs to the server process rather than the browser — so if anything
      // does end up covering it, the page is the only place that can say so.
      // Escalate the wording rather than leaving a button that looks dead.
      const btnEl = e.target;
      btnEl.disabled = true;
      $('#folderStatus').innerHTML = '<b>A folder window has opened.</b> ' +
        'Pick your <code>stats</code> folder there.';
      const nudges = [
        [6000, 'Still waiting. If you cannot see it, check behind this window or on your other monitor — try Alt+Tab.'],
        [25000, 'Nothing picked yet. You can cancel that window and paste the path in the box below instead — it works exactly the same.']
      ].map(([ms, msg]) => setTimeout(() => {
        $('#folderStatus').innerHTML = '<b>A folder window is open.</b> ' + esc(msg);
      }, ms));
      const done = () => { nudges.forEach(clearTimeout); btnEl.disabled = false; };
      try{
        const r = await fetch('api/browse', {method:'POST'});
        const j = await r.json();
        done();
        if(j.error){ $('#folderStatus').textContent = j.error; return; }
        if(!j.folder){ $('#folderStatus').textContent = 'Nothing selected — the window was cancelled.'; return; }
        $('#folderInput').value = j.folder;
        useFolder(j.folder);
      }catch(err){
        done();
        $('#folderStatus').textContent = 'Browse failed: ' + err;
      }
    }
  });
  $('#folderSetup').addEventListener('keydown', e => {
    if(e.target.id === 'folderInput' && e.key === 'Enter') useFolder($('#folderInput').value);
  });
}

(async function boot(){
  try{
    const r = await fetch('api/benchmarks', {cache:'no-store'});
    if(r.ok){ BENCH_DATA = await r.json(); SERVER_MODE = true; }
  }catch(err){ /* file:// mode */ }
  if(!SERVER_MODE){
    try{
      const r2 = await fetch('data/benchmarks.json', {cache:'no-store'});
      if(r2.ok) BENCH_DATA = await r2.json();
    }catch(err){ /* benchmarks unavailable; the rest still works */ }
  }
  logMsg('app start', {page: location.pathname.split('/').pop() || 'index.html', serverMode: SERVER_MODE, benchmarks: BENCH_DATA.length});
  renderBenchmarkList();

  if(!SERVER_MODE){
    logMsg('no server — using in-browser folder picker');
    return;
  }

  wireFolderSetup();
  try{
    await refreshServerConfig();
  }catch(err){
    logMsg('could not read server config', String(err));
    return;
  }
  if(SERVER_CONFIG.appVersion){
    const tag = SERVER_CONFIG.appVersion === 'dev'
      ? 'dev build · port ' + SERVER_CONFIG.port
      : 'v' + SERVER_CONFIG.appVersion + ' · port ' + SERVER_CONFIG.port;
    const sub = document.querySelector('.sub');
    if(sub){
      sub.innerHTML += ' <span class="vertag" id="verTag" title="Click for what changed in this version">(' + esc(tag) + ')</span>';
      const el = document.getElementById('verTag');
      if(el) el.addEventListener('click', async () => {
        const box = document.getElementById('whatsNew');
        if(!box) return;
        if(box.style.display !== 'none'){ box.style.display = 'none'; return; }
        try{
          const r = await fetch('api/whatsnew', {cache:'no-store'});
          const j = await r.json();
          box.innerHTML = '<div class="scen"><h3>What changed'+
            '<button type="button" class="minibtn" id="whatsNewClose">Close</button></h3>'+
            '<pre class="logbox" style="max-height:340px">'+esc(j.text || 'No changelog found.')+'</pre></div>';
          box.style.display = '';
          const c = document.getElementById('whatsNewClose');
          if(c) c.addEventListener('click', () => { box.style.display = 'none'; });
        }catch(err){ /* offline / file mode */ }
      });
    }
  }
  if(SERVER_CONFIG.valid && SERVER_CONFIG.runs > 0){
    await loadFromServer();
  } else {
    showFolderSetup(SERVER_CONFIG.folder ? SERVER_CONFIG.reason : '');
  }
  setInterval(pollForNewRuns, 5000);
})();

// ---------------------------------------------------------------------------
// Explanation toggles. The prose is genuinely useful the first time and pure
// clutter every time after, so it is collapsed by default and the choice is
// remembered per build.
// ---------------------------------------------------------------------------
function wireExplain(btnSel, paneSel, key, showLabel, hideLabel){
  if(!has(btnSel) || !has(paneSel)) return;
  const btn = $(btnSel), pane = $(paneSel);
  let open = lsGet(key) === '1';
  const apply = () => {
    pane.style.display = open ? '' : 'none';
    btn.textContent = open ? hideLabel : showLabel;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', () => { open = !open; lsSet(key, open ? '1' : '0'); apply(); });
  apply();
}
wireExplain('#winExplainBtn', '#winExplain', 'kva_x_win',
            'Show explanation', 'Hide explanation');
wireExplain('#caveatsBtn', '#caveats', 'kva_x_caveats',
            'Show figure explanation', 'Hide figure explanation');

// File mode never reaches refreshServerConfig(), so stamp the footer anyway.
renderBuildStamp();

// ---------------------------------------------------------------------------
// Self-test.  Open any page with ?selftest=1
//
// release.py --verify proves the statistics CODE has not changed between two
// releases. This proves the NUMBERS are still what they are supposed to be, by
// running every formula over a fixed synthetic dataset with hand-computed
// expected values. Between the two, "did the maths change?" stops being a
// question you answer by reading diffs.
//
// Expected values are derived from the definitions, not captured from a run -
// a captured value would happily agree with a broken implementation.
// ---------------------------------------------------------------------------
function selfTest(){
  const R = [];
  const near = (a, b, tol) => a != null && Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
  const t = (name, got, want, tol) => R.push({
    name, got, want, ok: (typeof want === 'number') ? near(got, want, tol) : got === want
  });

  // 1..10. Every expectation below is worked out from the formula by hand.
  const A = [1,2,3,4,5,6,7,8,9,10];
  // Same, but the top value is a wild outlier - trimming must reject it.
  const OUT = [1,2,3,4,5,6,7,8,9,100];
  const FLAT = Array(10).fill(100);

  t('mean(1..10)', mean(A), 5.5);
  t('median(1..10) even n', median(A), 5.5);
  t('median(odd n)', median([3,1,2]), 2);
  t('sd(1..10) population', sd(A), Math.sqrt(8.25));
  t('sd(constant) = 0', sd(FLAT), 0);

  // quantileAt interpolates: idx = (n-1)*p
  t('quantileAt p90', quantileAt(A, 0.90), 9.1);     // idx 8.1 -> 9 + 1*0.1
  t('quantileAt p10', quantileAt(A, 0.10), 1.9);     // idx 0.9 -> 1 + 1*0.9
  t('quantileAt p50', quantileAt(A, 0.50), 5.5);     // idx 4.5 -> 5 + 1*0.5
  t('quantileAt p0',  quantileAt(A, 0), 1);
  t('quantileAt p100', quantileAt(A, 1), 10);
  t('quantileAt empty', quantileAt([], 0.5), null);

  // trimSlice cuts floor(n*frac) from EACH end, and does nothing below TRIM_MIN_N
  t('trimSlice keeps 8 of 10', trimSlice(A, 0.10).length, 8);
  t('trimSlice drops the ends', trimSlice(A, 0.10)[0], 2);
  t('trimSlice below TRIM_MIN_N is a no-op', trimSlice([1,2,3], 0.10).length, 3);
  t('trimmedMean(1..10)', trimmedMean(A, 0.10), 5.5);
  t('trimmedMean rejects an outlier', trimmedMean(OUT, 0.10), 5.5);
  t('plain mean does not', mean(OUT), 14.5);

  // pctMean averages the lowest ceil(n*frac) values - the floor metric
  t('pctMean bottom 10%', pctMean(A, 0.10), 1);
  t('pctMean bottom 30%', pctMean(A, 0.30), 2);      // mean of 1,2,3

  // n = POWER_CONST * (cv/TARGET_EFFECT)^2, floored at HARD_FLOOR_N
  t('requiredN(cv 10%)', requiredN(10), Math.ceil(TUNING.POWER_CONST * 4));
  t('requiredN(tiny cv) hits the floor', requiredN(0.1), TUNING.HARD_FLOOR_N);
  t('requiredN(null)', requiredN(null), TUNING.HARD_FLOOR_N);
  t('requiredN(0)', requiredN(0), TUNING.HARD_FLOOR_N);

  // stats() gates each metric on its own minimum sample size
  const st = stats(A);
  t('stats n', st.n, 10);
  t('stats record is the max', st.record, 10);
  t('stats ceiling withheld under CEILING_MIN_N', st.ceiling, null);
  t('stats floor withheld under FLOOR_MIN_N', st.floor, null);
  t('stats typical shown at TYPICAL_MIN_N', st.typical, 5.5);
  t('stats cv', st.cv, Math.sqrt(8.25)/5.5*100, 1e-9);

  // chartScale: mu +- max(K*sigma, MIN_SPAN_PCT*mu), expanded to hold every point
  const cs = chartScale(A);
  const span = TUNING.CHART_K * Math.sqrt(8.25);
  t('chartScale mu', cs.mu, 5.5);
  t('chartScale sigma', cs.sd, Math.sqrt(8.25));
  t('chartScale span is K sigma', cs.span, span);
  t('chartScale contains every point', (cs.lo <= 1 && cs.hi >= 10), true);
  const flat = chartScale(FLAT);
  t('chartScale floors a zero-sigma span', flat.span, TUNING.CHART_MIN_SPAN_PCT * 100);
  t('chartScale flat lo', flat.lo, 100 - TUNING.CHART_MIN_SPAN_PCT * 100);
  const spike = chartScale(OUT);
  t('chartScale expands rather than clipping', (spike.hi >= 100), true);

  const fails = R.filter(r => !r.ok);
  const fmtv = v => (typeof v === 'number' ? (Math.round(v * 1e6) / 1e6) : String(v));
  const rows = R.map(r =>
    '<tr class="' + (r.ok ? 'stpass' : 'stfail') + '"><td>' + (r.ok ? 'PASS' : 'FAIL') +
    '</td><td>' + esc(r.name) + '</td><td>' + fmtv(r.got) + '</td><td>' + fmtv(r.want) + '</td></tr>').join('');

  document.body.insertAdjacentHTML('afterbegin',
    '<div class="selftest"><h2>' + (fails.length ? '✗ ' + fails.length + ' of ' : '✓ all ') +
    R.length + ' checks ' + (fails.length ? 'FAILED' : 'passed') + '</h2>' +
    '<p>build ' + esc(BUILD) + (BUILD_HASH ? ' · ' + esc(BUILD_HASH) : '') +
    ' — fixed synthetic data, expected values derived from the formulas by hand. ' +
    'Compare code between releases with <code>python release.py --verify</code>.</p>' +
    '<table><tr><th></th><th>check</th><th>got</th><th>expected</th></tr>' + rows + '</table></div>');

  (fails.length ? console.error : console.log)(
    'selftest: ' + (R.length - fails.length) + '/' + R.length + ' passed', fails);
  return {total: R.length, failed: fails.length, fails};
}

if(location.search.indexOf('selftest') !== -1) selfTest();
