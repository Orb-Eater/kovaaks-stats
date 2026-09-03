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

  // --- session unit (CALCULATIONS-V3 §1, §3, §5) --------------------------
  // Runs inside one session share warm-up state, fatigue, mood and hardware -
  // they are not independent observations. The corpus validation run measured
  // this directly: icc_median 0.58 at a typical session of 33 runs implies
  // every CI the *_MIN_N thresholds above were gating was about a quarter of
  // its correct width (V3.2-PATCH.md §3). Fix: reduce each session to one
  // number per (scenario x cm-cluster) cell - its trimmed mean, the spec's
  // fallback method, since no curve-fitting library exists here to run the
  // preferred fitted-plateau model - and gate/measure ceiling, typical and
  // floor off THOSE values instead of raw runs. PB stays run-based (a record
  // is a record); nMin/powered/CSV run counts are untouched, so this only
  // changes what feeds the three %-figures and their intervals.
  SESSION_MIN_RUNS: 3,     // a session contributing fewer runs to a cell isn't a session estimate
  CEILING_MIN_SESS: 8,
  TYPICAL_MIN_SESS: 6,
  FLOOR_MIN_SESS: 8,

  // CALCULATIONS-V4 §8: when a proper comparison-period baseline is too thin,
  // fall back to the fitted familiarisation-curve asymptote (see
  // fitFamiliarisation()) as a standing reference instead of showing nothing.
  // Needs at least this many runs to fit; below it, show nothing rather than
  // baseline off contaminated early data (replaces the old EARLY_BASELINE_N,
  // which used raw first-N runs — retired per §13).
  FAMILIAR_MIN_RUNS: 25,
  // Fixed decay constant for the familiarisation curve, corpus-measured
  // (fitting exponential vs power-law to 7,910 published learning series
  // found exponential wins on unaveraged per-subject data; confirmed 39-6 on
  // this corpus too). Fixing it is what makes the per-cell fit a closed-form
  // linear regression instead of needing a nonlinear solver — see
  // fitFamiliarisation(). A cell is "in familiarisation" below ~3*LAMBDA runs.
  LAMBDA: 66.69,

  // Harrell-Davis quantile estimator (CALCULATIONS-V4 §4.2) replaces the
  // traditional order-statistic Ceiling/Floor for session values: its bias is
  // smaller and flatter across sample sizes (traditional -0.6%/-0.8%/-0.3% at
  // n=15/25/40 vs HD +0.31%/+0.30%/+0.19%), at the cost of being ~2x more
  // sensitive to a single new max/min - accepted since n-bias is systematic
  // and an added max is occasional. n-matching (§4.3) handles the case where
  // a window/baseline comparison's two periods have very different session
  // counts, which would otherwise let that n-dependent bias masquerade as a
  // real change.
  N_MATCH_RATIO: 1.5,      // subsample the larger side once it exceeds the smaller by this multiple
  N_MATCH_REPS: 200,       // draws to average over - 25 swings the estimate by 2x between runs

  // --- confounds (STATISTICS.md §3) -------------------------------------
  // Half an hour with no completed run and the next one starts a new session.
  // Was 60. Closing KovaaK's, taking a walk or getting pulled away for half an
  // hour is a different sitting, and calling it one four-hour session made
  // "time in KovaaK's" and the active-play % describe something nobody did.
  // Sessions on the same day are still tied together - see dayIndex below.
  SESSION_GAP_MIN: 30,   // minutes of inactivity that starts a new session
  // Time-indexed, not run-indexed (V3.2 §1): a run-count cutoff means a
  // session with 20s gaps stays contaminated while one with long gaps between
  // runs clears it after two runs regardless of how little time actually
  // passed. 120s is fitted to this corpus's minute-bucketed warm-up curve —
  // recalibrate per install if the curve shape looks different.
  WARMUP_SECONDS: 120,    // seconds since session start still counted as warm-up
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
  // They are detected structurally (see run_timing in server.py) and kept out
  // of every statistic. Not surfaced as a count anywhere in the UI — it was
  // inconsistent about when it did and didn't show up, which read as broken.
  RESET_RATIO_ALERT: 5,     // restarts per completed run before it says something
  RESET_ALERT_MIN_RUNS: 3,  // ...but not until this many runs were actually finished

  // Below this % of a session actually spent playing, a popup flags it once
  // per session (Batch 8) — but not before the session is long enough for the
  // ratio to mean anything; a two-run session reads noisy either way.
  LOW_ACTIVE_PCT: 40,
  LOW_ACTIVE_MIN_SPAN_SEC: 600,

  // --- attribution (CALCULATIONS-V4 §10.3) --------------------------------
  // A scenario needs at least this many lagged week-over-week pairs (dose in
  // week t, outcome change t -> t+1) before its correlation means anything -
  // roughly the same order as FLOOR_MIN_SESS above, for the same reason: a
  // handful of points can produce any correlation by chance.
  ATTRIB_MIN_WEEKS: 8,
  // "Run the identical test against NEG_CONTROL_N scenarios with no plausible
  // relationship" - the spec's own number.
  NEG_CONTROL_N: 10
};
let excludeWarmup = true;
let excludeRefam = true;
// Off by default: these overlay a trader's-eye read (trendlines through the
// first/latest swing high and low, projected across the whole chart, plus a
// raw run-to-run line) on top of the chart's normal smoothed stats. Useful
// when you want it, noise when you don't - hence one toggle, not three.
let tradingLines = false;

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
// A cm chip pins THAT ONE card to that sensitivity. It used to set the global
// Specific-cm filter, which silently re-filtered every other scenario on the
// page - one click, and the whole view had moved. It is a per-card toggle:
// click the pinned chip again to clear it. The Specific-cm control above the
// list is still the global thing, deliberately.
const scenCm = new Map();
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

// Harrell-Davis quantile (CALCULATIONS-V4 §4.2): a weighted average of every
// order statistic, the weights coming from the regularized incomplete beta
// function - unlike quantileAt() above, which only ever looks at one or two
// points. Used for session-value Ceiling/Floor; quantileAt() stays as-is for
// the raw-run PB-ratio/trend readouts elsewhere in this file, which were not
// part of what CALCULATIONS-V4 §4 flagged.
function logGamma(x){
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if(x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for(let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(x, a, b){
  const MAXIT = 200, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if(Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for(let m = 1; m <= MAXIT; m++){
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if(Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if(Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if(Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if(Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if(Math.abs(del - 1) < EPS) break;
  }
  return h;
}
// Regularized incomplete beta I_x(a,b), Numerical Recipes' betai.
function betaInc(x, a, b){
  if(x <= 0) return 0;
  if(x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  if(x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
  return 1 - bt * betacf(1 - x, b, a) / b;
}
function hdQuantile(sorted, p){
  const n = sorted.length;
  if(!n) return null;
  const a = (n + 1) * p, b = (n + 1) * (1 - p);
  let q = 0, prev = 0;
  for(let i = 1; i <= n; i++){
    const cur = betaInc(i / n, a, b);
    q += (cur - prev) * sorted[i - 1];
    prev = cur;
  }
  return q;
}
// SE of an HD quantile via jackknife (CALCULATIONS-V4 §4.4) - deliberately
// not the order-statistic-spacing density used by quantileSE() below, which
// the spec calls out by name as unusable here ("at p=0.90 with n=20 the
// density comes from the two or three sparsest points in the sample").
function hdQuantileSE(sorted, p){
  const n = sorted.length;
  if(n < 2) return null;
  const loo = [];
  for(let i = 0; i < n; i++) loo.push(hdQuantile(sorted.slice(0,i).concat(sorted.slice(i+1)), p));
  const qbar = mean(loo);
  const ss = loo.reduce((s,q) => s + (q-qbar)*(q-qbar), 0);
  return Math.sqrt((n-1)/n * ss);
}
// Exact expected maximum of n iid standard normal draws (CALCULATIONS-V4 §4.1),
// index n-1. Precomputed once offline via Simpson's-rule numerical integration
// of n * integral(x * phi(x) * Phi(x)^(n-1) dx, -9, 9) and pasted in as a
// literal table — Blom's approximation is documented as inaccurate for the
// maximum below n~100, and sessions here run 15-40 runs. The generator isn't
// shipped; values were cross-checked against published expected-order-
// statistic tables (e.g. n=10 -> 1.5388, n=100 -> 2.5077) to 3-4 decimals.
const EXPECTED_MAX_TABLE = [
0.000000,0.564190,0.846284,1.029375,1.162964,1.267206,1.352178,1.423600,1.485013,1.538753,
1.586436,1.629228,1.667990,1.703382,1.735914,1.765992,1.793942,1.820032,1.844482,1.867475,
1.889168,1.909693,1.929162,1.947675,1.965315,1.982158,1.998270,2.013708,2.028523,2.042762,
2.056465,2.069670,2.082409,2.094714,2.106610,2.118124,2.129278,2.140092,2.150587,2.160778,
2.170683,2.180317,2.189692,2.198823,2.207721,2.216396,2.224860,2.233122,2.241191,2.249075,
2.256782,2.264320,2.271695,2.278914,2.285984,2.292910,2.299697,2.306351,2.312877,2.319279,
2.325561,2.331729,2.337785,2.343734,2.349579,2.355323,2.360971,2.366524,2.371986,2.377359,
2.382647,2.387852,2.392976,2.398022,2.402992,2.407888,2.412713,2.417467,2.422153,2.426774,
2.431330,2.435823,2.440256,2.444629,2.448944,2.453202,2.457406,2.461556,2.465653,2.469699,
2.473695,2.477642,2.481542,2.485395,2.489202,2.492965,2.496685,2.500362,2.503997,2.507591,
2.511146,2.514661,2.518138,2.521578,2.524981,2.528348,2.531680,2.534977,2.538240,2.541471,
2.544668,2.547834,2.550969,2.554072,2.557146,2.560190,2.563205,2.566191,2.569149,2.572080,
2.574984,2.577861,2.580712,2.583537,2.586338,2.589113,2.591864,2.594591,2.597295,2.599975,
2.602632,2.605268,2.607881,2.610472,2.613042,2.615591,2.618119,2.620627,2.623114,2.625582,
2.628031,2.630460,2.632871,2.635262,2.637636,2.639991,2.642329,2.644649,2.646951,2.649237,
2.651506,2.653758,2.655994,2.658214,2.660418,2.662606,2.664779,2.666936,2.669078,2.671206,
2.673319,2.675417,2.677501,2.679571,2.681628,2.683670,2.685699,2.687714,2.689717,2.691706,
2.693682,2.695646,2.697597,2.699535,2.701461,2.703376,2.705278,2.707168,2.709047,2.710914,
2.712770,2.714614,2.716448,2.718270,2.720081,2.721882,2.723672,2.725451,2.727220,2.728979,
2.730727,2.732466,2.734194,2.735913,2.737622,2.739321,2.741011,2.742691,2.744362,2.746024,
2.747676,2.749320,2.750955,2.752580,2.754197,2.755806,2.757406,2.758997,2.760580,2.762154,
2.763721,2.765279,2.766829,2.768371,2.769905,2.771432,2.772950,2.774461,2.775965,2.777460,
2.778949,2.780430,2.781903,2.783370,2.784829,2.786281,2.787726,2.789164,2.790595,2.792019,
2.793437,2.794848,2.796252,2.797649,2.799040,2.800424,2.801802,2.803174,2.804539,2.805898,
2.807251,2.808598,2.809938,2.811273,2.812601,2.813924,2.815241,2.816551,2.817856,2.819156,
2.820449,2.821737,2.823020,2.824297,2.825568,2.826834,2.828094,2.829349,2.830599,2.831843,
2.833082,2.834316,2.835545,2.836769,2.837988,2.839201,2.840410,2.841614,2.842812,2.844006,
2.845195,2.846379,2.847559,2.848734,2.849904,2.851069,2.852230,2.853386,2.854538,2.855685,
2.856827,2.857966,2.859099,2.860229,2.861354,2.862474,2.863591,2.864703,2.865811,2.866915,
2.868014,2.869110,2.870201,2.871288,2.872372,2.873451,2.874526,2.875597,2.876665,2.877728
];
// Falls back beyond the table (a scenario played more than 300 times inside
// the active window) to the standard second-order Gumbel asymptotic - but
// anchored to the table's own last value rather than used raw. The raw
// asymptotic is a slowly-converging approximation and sits visibly below the
// exact integral even at n=300 (2.745 vs 2.878), which would make expected-max
// dip the moment a scenario crosses 300 runs; adding the table/asymptotic gap
// at the boundary keeps it continuous while still following the asymptotic's
// (correct) slope beyond it. Exact integration stops mattering out here
// anyway - Blom-style approximations are already fine above n~100.
const _EM_ASYM_N = n => { const l = Math.log(n); return Math.sqrt(2*l) - (Math.log(l) + Math.log(4*Math.PI)) / (2*Math.sqrt(2*l)); };
const _EM_ANCHOR = EXPECTED_MAX_TABLE[EXPECTED_MAX_TABLE.length-1] - _EM_ASYM_N(EXPECTED_MAX_TABLE.length);
function expectedMaxStd(n){
  if(n < 1) return null;
  if(n <= EXPECTED_MAX_TABLE.length) return EXPECTED_MAX_TABLE[n-1];
  return _EM_ASYM_N(n) + _EM_ANCHOR;
}
// pb_surprise (CALCULATIONS-V4 §4.1): how many sigma the actual record sits
// above (or below) the record an unchanging player would be expected to reach
// from n runs alone - max() rises with n on its own, so a raw PB can't say
// anything by itself (see wherever "record" renders). Needs a non-junk sigma,
// so gated the same way CV is (TUNING.HARD_FLOOR_N: "junk below it").
function pbSurprise(sorted){
  const n = sorted.length;
  if(n < TUNING.HARD_FLOOR_N) return null;
  const m = mean(sorted), s = sd(sorted);
  if(!(s > 0)) return null;
  return (sorted[n-1] - m) / s - expectedMaxStd(n);
}
function sampleWithoutReplacement(arr, k){
  const a = arr.slice(), n = a.length;
  for(let i = 0; i < k; i++){
    const j = i + Math.floor(Math.random() * (n - i));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, k);
}
// n-matching (CALCULATIONS-V4 §4.3): HD's bias depends on n, so comparing an
// n=40 window against an n=8 baseline directly would read that bias gap as a
// real change. Once the two counts differ by more than N_MATCH_RATIO, the
// larger side is repeatedly subsampled down to the smaller side's n and
// averaged; the spread across those draws becomes its SE, deliberately wider
// than a single full-n jackknife would give, since resampling is itself a
// source of uncertainty here.
function nMatchedHD(wSorted, bSorted, p){
  const nw = wSorted.length, nb = bSorted.length;
  const ratio = (nw && nb) ? Math.max(nw/nb, nb/nw) : Infinity;
  if(nw < 2 || nb < 2 || !(ratio > TUNING.N_MATCH_RATIO)){
    return {
      wQ: hdQuantile(wSorted, p), wSE: hdQuantileSE(wSorted, p),
      bQ: hdQuantile(bSorted, p), bSE: hdQuantileSE(bSorted, p)
    };
  }
  const target = Math.min(nw, nb);
  const matched = sorted => {
    if(sorted.length === target) return {Q: hdQuantile(sorted, p), SE: hdQuantileSE(sorted, p)};
    const draws = [];
    for(let i = 0; i < TUNING.N_MATCH_REPS; i++){
      draws.push(hdQuantile(sampleWithoutReplacement(sorted, target).sort((a,b)=>a-b), p));
    }
    return {Q: mean(draws), SE: sd(draws)};
  };
  const w = matched(wSorted), b = matched(bSorted);
  return {wQ: w.Q, wSE: w.SE, bQ: b.Q, bSE: b.SE};
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

// CALCULATIONS-V4 §8: a cell's first few runs are the most familiarisation-
// contaminated data it will ever produce, so using them raw as a baseline
// (the old EARLY_BASELINE_N approach) inflates apparent improvement on every
// new scenario — and directly contradicts the re-familiarisation rule (§2.3),
// which treats those same early scores as understating true skill. Fit the
// familiarisation curve instead and use its asymptote as the level.
//
// score(k) = A - B*exp(-(k+E)/lambda), k = cumulative runs on this cell.
// lambda is fixed at its corpus-measured value (66.69 runs — fitting both
// exponential and power-law forms to 7,910 published learning series found
// exponential wins on unaveraged per-subject data, and it wins 39-6 on this
// corpus too). With lambda fixed, exp(-(k+E)/lambda) = exp(-E/lambda) *
// exp(-k/lambda), so the model is linear in A and C = B*exp(-E/lambda):
// score(k) = A - C*exp(-k/lambda) — an ordinary least-squares line through
// (exp(-k/lambda), score(k)). B and E are only identifiable as their
// combined product C from a single cell's own history (there is no
// cross-scenario transfer model here), so C stands in as the fitted
// amplitude and only A — "the skill estimate, comparable across cells" — is
// used as the baseline level, per spec: "Report A as the level, never raw
// early scores."
function fitFamiliarisation(scoresChronological){
  const n = scoresChronological.length;
  if(n < TUNING.FAMILIAR_MIN_RUNS) return null;
  const lambda = TUNING.LAMBDA;
  const xs = scoresChronological.map((_, i) => Math.exp(-(i+1) / lambda));
  const mx = mean(xs), my = mean(scoresChronological);
  let sxy = 0, sxx = 0;
  for(let i=0; i<n; i++){
    const dx = xs[i] - mx;
    sxy += dx * (scoresChronological[i] - my);
    sxx += dx * dx;
  }
  if(sxx === 0) return null;
  const slope = sxy / sxx;             // slope of score vs exp(-k/lambda) = -C
  const A = my - slope * mx;
  // "Mark a cell in familiarisation while k < 3*lambda (~200 runs) and
  // exclude it from the matched basket until it clears" — the basket-level
  // exclusion is §6.1's matched/all-cells split (a separate roadmap stop);
  // this flag is surfaced here so callers can label the figure honestly.
  return {n, level: A, amplitude: -slope, lambda, inFamiliarisation: n < 3*lambda};
}

// A permanent low bar for scenarios/cells that don't yet have a real earlier
// period to compare against: the fitted familiarisation asymptote (§8). One
// number stands in for ceiling/typical/floor alike — a curve fit estimates a
// central skill level, not separate quantiles — and is deliberately given no
// CI, matching the old early-baseline's "level, not precision" contract.
function earlyBaseline(scoresChronological){
  const fit = fitFamiliarisation(scoresChronological);
  if(!fit) return null;
  return {
    n: fit.n,
    ceiling: fit.level, typical: fit.level, floor: fit.level, avg: fit.level,
    lambda: fit.lambda, inFamiliarisation: fit.inFamiliarisation
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
// Warm-up is measured against elapsed session time, not run count — see
// WARMUP_SECONDS above. Session start is approximated as the first run's own
// timestamp (itself an end-of-run time, same convention buildSessions uses),
// so sessElapsedSec is a "how far into the session did this run land" clock
// rather than a precise start-to-start measurement.
// ---------------------------------------------------------------------------
function annotateRuns(){
  let prevT = null, sessionStart = null, sessId = -1;
  RUNS.forEach(r => {
    if(prevT === null || (r.date - prevT) > TUNING.SESSION_GAP_MIN*60000){ sessionStart = r.date; sessId++; }
    r.sessElapsedSec = (r.date - sessionStart) / 1000;
    r.sessId = sessId;
    prevT = r.date;
    r.excl = (r.sessElapsedSec < TUNING.WARMUP_SECONDS) ? 'warmup' : null;
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
  // Sessions that share a calendar day belong together. Splitting at 30 minutes
  // is right for measuring one sitting, but you did not start a new day just
  // because you had lunch - so the gap between two sittings is kept as a break
  // rather than thrown away, and the day totals span all of them.
  out.forEach((s, i) => {
    const prev = i > 0 ? out[i-1] : null;
    const sameDay = prev && prev.end.toDateString() === s.start.toDateString();
    s.breakBeforeSec = sameDay ? (s.start - prev.end)/1000 : null;
    s.dayIndex = sameDay ? prev.dayIndex + 1 : 1;
    s.dayBreakSec = sameDay ? prev.dayBreakSec + s.breakBeforeSec : 0;
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
    if(r.sessElapsedSec == null) return;
    (r.sessElapsedSec < TUNING.WARMUP_SECONDS ? early : late).push(r.score);
  });
  if(early.length < 30 || late.length < 30) return null;
  // Scores differ wildly between scenarios, so compare within scenario.
  const byScen = {};
  RUNS.forEach(r => { if(r.sessElapsedSec != null) (byScen[r.scen] ||= []).push(r); });
  const ratios = [];
  Object.values(byScen).forEach(rs => {
    const e = rs.filter(r => r.sessElapsedSec < TUNING.WARMUP_SECONDS).map(r => r.score);
    const l = rs.filter(r => r.sessElapsedSec >= TUNING.WARMUP_SECONDS).map(r => r.score);
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

// Reduces runs to one value per session (CALCULATIONS-V3 §3) - the spec's
// fallback method, trimmed_mean of the session's runs. The preferred method
// (fit score(i) = P*(1-exp(-i/tau)) - f*max(0,i-i_fatigue) per session and
// take P) needs a nonlinear curve-fit this stdlib-only app doesn't have, and
// the fatigue half of that model didn't reproduce against live data anyway
// (parked, V3.3-CORRECTIONS.md §6 item 5) - so the fallback is what's built.
// `runs` should already be warmup/refam/reset/zero-filtered (i.e. drawn from
// `pool`); the WARMUP_SECONDS exclusion upstream already plays the role the
// spec gives `runs[ceil(tau_user):]`. Sessions under SESSION_MIN_RUNS are
// dropped, not padded - one run is not a session estimate.
function sessionValues(runs){
  const bySess = {};
  runs.forEach(r => { if(r.sessId != null) (bySess[r.sessId] ||= []).push(r.score); });
  return Object.values(bySess)
    .filter(scores => scores.length >= TUNING.SESSION_MIN_RUNS)
    .map(scores => trimmedMean(scores.slice().sort((a,b)=>a-b), TUNING.TRIM_FRACTION));
}
// Session-value inputs use lower minimums (§5) than raw-run inputs, since a
// session is worth far more than a run - pass this as the second arg.
const SESS_THRESH = {CEILING_MIN_N: TUNING.CEILING_MIN_SESS, TYPICAL_MIN_N: TUNING.TYPICAL_MIN_SESS, FLOOR_MIN_N: TUNING.FLOOR_MIN_SESS};

// The measured metrics are all quantile- or trim-based so none of them can be
// moved wholesale by a single run, and none of them drift with sample size.
// `record` (true max) is kept for display only — never turned into a %.
// `thresh` overrides the *_MIN_N gates below (defaults to TUNING itself) —
// used to feed this the same function with session-value minimums instead of
// run-value ones, without a second copy of the gating logic. `hd` switches
// Ceiling/Floor to the Harrell-Davis estimator (CALCULATIONS-V4 §4.2) — pass
// it only for session-value stats; raw-run callers (PB-ratio/trend readouts)
// keep the traditional order-statistic quantile they were validated against.
function stats(scores, thresh, hd){
  thresh = thresh || TUNING;
  const s = [...scores].sort((a,b)=>a-b);
  const m = mean(s);
  const q = hd ? hdQuantile : quantileAt;
  return {
    n: s.length, sorted: s,
    record:  s.length ? s[s.length-1] : null,
    ceiling: s.length >= thresh.CEILING_MIN_N ? q(s, TUNING.CEILING_Q) : null,
    typical: s.length >= thresh.TYPICAL_MIN_N ? trimmedMean(s, TUNING.TRIM_FRACTION) : null,
    floor:   s.length >= thresh.FLOOR_MIN_N   ? q(s, TUNING.FLOOR_Q)   : null,
    mean: m, med: median(s), worst: s[0],
    cv: m > 0 ? sd(s)/m*100 : null
  };
}

// change% with its standard error, so the UI can show an interval instead of a
// bare point estimate. `fallback` (an earlyBaseline() result) stands in for a
// missing/too-thin real baseline so a % is always shown (Batch 8) rather than
// a dash — flagged with `early: true` so the UI can say why there's no CI.
function changeWithSE(w, b, key, fallback){
  let wv = w[key], bv = b[key];
  let early = false;
  if(bv == null && fallback && fallback[key] != null && fallback[key] > 0){
    bv = fallback[key];
    early = true;
  }
  if(wv == null || bv == null || !(bv > 0)) return null;
  if(early) return {pct: (wv - bv)/bv*100, se: null, early: true, earlyN: fallback.n};
  let seW, seB;
  if(key === 'typical'){
    seW = trimmedMeanSE(w.sorted, TUNING.TRIM_FRACTION);
    seB = trimmedMeanSE(b.sorted, TUNING.TRIM_FRACTION);
  } else {
    // Ceiling/Floor are Harrell-Davis quantiles of session values, n-matched
    // (CALCULATIONS-V4 §4.2/§4.3) when the two periods' session counts differ
    // materially — recompute wv/bv from the matched draws rather than the
    // plain per-side w[key]/b[key], so the % and its SE come from the same
    // (possibly subsampled) estimate.
    const q = key === 'ceiling' ? TUNING.CEILING_Q : TUNING.FLOOR_Q;
    const m = nMatchedHD(w.sorted, b.sorted, q);
    wv = m.wQ; bv = m.bQ;
    seW = m.wSE; seB = m.bSE;
  }
  if(!(bv > 0)) return null;
  const pct = (wv - bv)/bv*100;
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
    const c = cells[key] ||= {scen: r.scen, cluster: cl, win: [], base: [], all: [], allRuns: [], winRuns: [], baseRuns: []};
    c.all.push(r.score);
    c.allRuns.push(r);
    const t = r.date;
    if(cmpMode === 'prev'){
      if(t >= windowStart && t <= windowEnd){ c.win.push(r.score); c.winRuns.push(r); }
      else if(t >= baseStart && t < windowStart){ c.base.push(r.score); c.baseRuns.push(r); }
    } else {
      if(t >= mid && t <= windowEnd){ c.win.push(r.score); c.winRuns.push(r); }
      else if(t >= windowStart && t < mid){ c.base.push(r.score); c.baseRuns.push(r); }
    }
  });
  return Object.values(cells).map(c => {
    const w = stats(c.win), b = stats(c.base);
    // Ceiling/typical/floor are measured on session values, not raw runs
    // (CALCULATIONS-V3 §1/§3/§5) - w/b above stay raw-run-based since nMin/
    // powered/CSV export all still count runs, same as before this change.
    const wSess = stats(sessionValues(c.winRuns), SESS_THRESH, true);
    const bSess = stats(sessionValues(c.baseRuns), SESS_THRESH, true);
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
      scen: c.scen, cluster: c.cluster, w, b, wSess, bSess, cv, nRequired: nReq,
      nMin: Math.min(w.n, b.n), powered: Math.min(w.n, b.n) >= nReq,
      ceiling: changeWithSE(wSess, bSess, 'ceiling', fallback),
      typical: changeWithSE(wSess, bSess, 'typical', fallback),
      floor:   changeWithSE(wSess, bSess, 'floor', fallback)
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
    // st.n/record/mean/med/cv stay raw-run-based (they feed the "N runs" meta
    // text, CSV export, "most played" sort and density heuristics) - only the
    // three session-gated figures get overlaid onto this same object.
    const sessSt = stats(sessionValues(rs), SESS_THRESH, true);
    st.ceiling = sessSt.ceiling; st.typical = sessSt.typical; st.floor = sessSt.floor;
    st.nSessions = sessSt.n;
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
  renderCalendar(pool, displayPool, analysisClusters, effCmpMode);

  // CALCULATIONS-V4 §10.1: the benchmark aggregate is the app's primary,
  // most-trusted metric (fixed basket, externally anchored effect size) — but
  // it only exists for suites the user has actually played scenarios from.
  // Build every playable suite's normalized runs, auto-pick the one with the
  // most matched runs as the headline unless the user has picked one, and
  // hide the whole section when nothing qualifies.
  let benchAgg = null, benchAggName = null, benchChoices = [], attrib = null;
  if(has('#benchHeadlineWrap') && BENCH_DATA && BENCH_DATA.length){
    benchChoices = BENCH_DATA
      .map(b => ({b, normRuns: benchmarkNormalizedRuns(b, pool)}))
      .filter(x => x.normRuns.length >= TUNING.HARD_FLOOR_N)
      .sort((a,b) => b.normRuns.length - a.normRuns.length);
    if(benchChoices.length){
      const picked = lsGet('kva_headline_bench');
      const match = picked && benchChoices.find(x => x.b.name === picked);
      const chosen = match || benchChoices[0];
      benchAggName = chosen.b.name;
      benchAgg = computeBenchmarkAggregate(chosen.normRuns, windowStart, windowEnd, effCmpMode);
      // §10.3 always runs over full history regardless of the window
      // selector — chosen.normRuns already is full history (see
      // computeBenchmarkAggregate's own note: window filtering happens
      // inside it, not upstream), so this reuses it and `pool` as-is.
      if(has('#attribWrap')) attrib = computeAttribution(chosen.b, chosen.normRuns, pool);
    }
  }
  const runsInWindow = pool.filter(r => r.date >= windowStart && r.date <= windowEnd).length;

  // Cell fragmentation readout — with 2,000+ scenarios and dozens of cm/360
  // clusters, almost none of them individually clear the noise threshold.
  // Telling the user why beats letting every number silently read "within noise".
  {
    const fragScenarios = new Set(pool.map(r => r.scen)).size;
    if(fragScenarios > 1){
      const clusterPart = hasCmData && analysisClusters.length > 1
        ? ' across <b>' + analysisClusters.length.toLocaleString() + '</b> cm/360 clusters'
        : '';
      $('#fragNote').style.display = 'block';
      $('#fragNote').innerHTML = 'Your data spans <b>' + fragScenarios.toLocaleString() + '</b> scenarios' + clusterPart +
        ' — most individual combinations don’t have enough runs yet to clear the noise threshold, which is why many read as “within noise” below.';
    } else {
      $('#fragNote').style.display = 'none';
    }
  }

  const allCells = rows.reduce((a,r) => a.concat(r.cells), []);
  const overallPb  = overallOf(allCells.map(c=>c.ceiling));
  const overallAvg = overallOf(allCells.map(c=>c.typical));
  const overallLow = overallOf(allCells.map(c=>c.floor));

  // CALCULATIONS-V4 §6.1: mixing cells with a real baseline into the same
  // pool as cells leaning on earlyBaseline()'s fitted-asymptote fallback
  // compares different baskets across the window - the index-number problem.
  // Report both: Matched (real data both sides only) is the defensible read
  // on skill change; All cells folds the fallback cells back in, which is
  // what makes new/thin scenarios move the headline at all. When they
  // diverge, that gap *is* the familiarisation signal, not noise to hide.
  const matchedPb  = overallOf(allCells.filter(c => c.ceiling && !c.ceiling.early).map(c=>c.ceiling));
  const matchedAvg = overallOf(allCells.filter(c => c.typical && !c.typical.early).map(c=>c.typical));
  const matchedLow = overallOf(allCells.filter(c => c.floor   && !c.floor.early).map(c=>c.floor));
  const typicalCells = allCells.filter(c => c.typical != null);
  const matchedComposition = {
    matched: typicalCells.filter(c => !c.typical.early).length,
    all: typicalCells.length
  };

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
  // "Most data" is deliberately not "most runs". What decides whether a scenario
  // can show you progress is how tight its interval is, and that depends on how
  // noisy the scenario is for you and on how the runs split across sensitivity
  // bands - not on the raw count. 200 runs spread over six sensitivities can
  // measure less than 40 runs at one. Rows with no interval at all sort to the
  // bottom, ordered by paired runs, because that is the honest ranking of
  // "closest to being measurable".
  const ciHalf = r => (r.typical && r.typical.se != null) ? TUNING.CI_Z * r.typical.se : null;
  rows.sort((a,b) => {
    if(sortBy==='data'){
      const ca = ciHalf(a), cb = ciHalf(b);
      if(ca != null && cb != null) return ca - cb;
      if(ca != null) return -1;
      if(cb != null) return 1;
      return (b.nMin - a.nMin) || (b.st.n - a.st.n);
    }
    if(sortBy==='runs') return b.st.n - a.st.n;
    if(sortBy==='recent') return lastAt(b) - lastAt(a);
    if(sortBy==='name') return a.scen.localeCompare(b.scen);
    if(sortBy==='cv') return b.st.cv - a.st.cv;
    if(sortBy==='stale') return lastAt(a) - lastAt(b);
    if(sortBy==='needplay') return needScore(b) - needScore(a);
    return (b.avgTrend ?? -1e9) - (a.avgTrend ?? -1e9);
  });

  // "Recently played" is a "what did I just do" view, not a "what can be
  // calculated" view - a scenario played yesterday but too few times yet to
  // clear minRuns would otherwise vanish from its own recency sort. Pull in
  // anything computeTrends would normally drop for being under minRuns, but
  // only for this sort and only for the card list, not the headline stats
  // (which stay on `rows` exactly as before).
  let displayRows = rows;
  if(sortBy==='recent'){
    const already = new Set(rows.map(r => r.scen));
    const allPlayed = computeTrends(pool, windowStart, windowEnd, effCmpMode, 1, analysisClusters, displayPool);
    const extra = allPlayed.filter(r => !already.has(r.scen));
    displayRows = rows.concat(extra).sort((a,b) => lastAt(b) - lastAt(a));
  }

  const pctStr = v => v===null ? '—' : (v>=0?'+':'') + v.toFixed(1) + '%';
  const cls = v => v===null ? '' : (v>=0?'up':'dn');
  const deltaSpan = v => v===null ? '<span style="color:var(--ink3)">—</span>' : '<span class="'+cls(v)+'">'+pctStr(v)+'</span>';
  // Rendered as its own line under the value rather than a small inline badge,
  // so the number is actually readable and the card isn't mostly empty space.
  const sideBadge = v => v===null ? '' : '<div class="vsub '+cls(v)+'">'+pctStr(v)+' avg</div>';

  // A result whose 95% interval straddles zero is not distinguishable from "no
  // change" — see nsTag below for how that renders.
  const ciCrossesZero = e => !e || e.se == null || Math.abs(e.pct) <= TUNING.CI_Z * e.se;
  const estCls = e => (!e || e.pct == null) ? '' : (ciCrossesZero(e) ? 'ns' : (e.pct >= 0 ? 'up' : 'dn'));
  const estStr = e => (!e || e.pct == null) ? '—' : pctStr(e.pct);
  const ciStr  = e => (!e || e.se == null) ? '' : ' ± ' + (TUNING.CI_Z * e.se).toFixed(1) + '%';
  // A result whose interval crosses zero never renders as a number, even a grey
  // one — a colour-coded figure still reads as a measurement. It renders as the
  // words "within noise", with the actual figure and interval moved behind the
  // hover rather than sitting in the default view.
  const nsTag = e => '<span class="nstag" title="' +
    pctStr(e.pct) + (e.se != null
      ? ', 95% CI ±' + (TUNING.CI_Z*e.se).toFixed(1) + '% — crosses zero, not distinguishable from no change.'
      : ' — measured against an early baseline, not a confidence interval.') +
    '">within noise</span>';
  // A % built from earlyBaseline() (CALCULATIONS-V4 §8) gets a small marker
  // rather than a CI: it's a fitted curve's asymptote, not a sampled interval,
  // so there's no standard error to show — showing one would overstate what
  // it knows.
  const earlyTag = n => '<abbr class="earlytag" title="Baseline is a familiarisation curve fitted to your first '+n+' run'+(n===1?'':'s')+
    ' of this — there is no separate earlier period to compare against yet, so treat this as a rough starting point, not a measured change.">early</abbr>';
  const estSpan = e => (!e || e.pct == null)
    ? '<span style="color:var(--ink3)">—</span>'
    : ciCrossesZero(e)
      ? nsTag(e) + (e.early ? ' '+earlyTag(e.earlyN) : '')
      : '<span class="'+estCls(e)+'">'+pctStr(e.pct)+'</span><span class="ci">'+ciStr(e)+'</span>';

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
    'Ceiling change': 'Your 90th-percentile score vs its baseline — what a good run looks like. Deliberately NOT your best run: a max grows with the number of runs you play, so it would show "improvement" from sample size alone. Computed over one value per session (not raw runs) — runs in the same sitting share warm-up, fatigue and mood, so they are not independent samples. Inverse-variance weighted across every scenario × cm cell, shown with a 95% interval. "Within noise" means the interval crosses zero, i.e. not distinguishable from no change — hover it for the actual figure.',
    'Typical change': 'Your 10%-trimmed mean vs its baseline — the middle of your distribution, with the best and worst tails removed so one fluke run cannot move it. Computed over one value per session, not raw runs, for the same reason as Ceiling. Weighted by precision across all scenario × cm cells, with a 95% interval.',
    'Floor change': 'Your 10th-percentile score vs its baseline — how bad your bad runs are. Computed over one value per session, not raw runs. Needs 8+ sessions on each side, otherwise the "bottom 10%" is one or two sessions and is meaningless.',
    'Typical vs Ceiling': 'Typical change minus Ceiling change. Positive means your floor is catching up to your peak (consolidation). Negative means your peak is running ahead of your typical result.',
    'Vs prev timeframe': 'This window’s Typical change minus the same figure for the equal-length window before it. Positive means your rate of improvement is accelerating.',
    'Mean spread (CV)': 'Average coefficient of variation (stdev ÷ mean) across shown scenarios — lower means scores cluster tighter around your average.',
    'Best performing cm': 'The cm/360 with the highest average score relative to your own typical average across all cms (minimum 10 runs across 2+ scenarios in this window, ignoring the Range/Specific filter above so all cms are compared). The side % is how far above your typical average that cm performs.',
    'Worst performing cm': 'The cm/360 with the lowest average score relative to your own typical average across all cms (minimum 10 runs across 2+ scenarios in this window, ignoring the Range/Specific filter above so all cms are compared).',
    'Best cm range': 'The cm/360 with the highest average score relative to your own typical average (same rules as Best performing cm), but grouped into ranges built from your actual data instead of one exact cm — consecutive cms you\'ve used get merged whenever they\'re within ~10% of each other (e.g. 35→38cm merges, 35→55cm doesn\'t), so this pools more data per bucket and is more resistant to a handful of stray runs skewing the result.',
    'Worst cm range': 'The cm range with the lowest average score relative to your own typical average, same stability advantage as Best cm range.',
    'Fast cm (<50cm)': 'Your average score across all cm/360 settings faster than 50cm, relative to your own typical average (minimum 3 runs per scenario at a fast cm).',
    'Slow cm (>50cm)': 'Your average score across all cm/360 settings slower than 50cm, relative to your own typical average (minimum 3 runs per scenario at a slow cm).',
    'Benchmark ceiling change': 'CALCULATIONS-V4 §10.1: your peak performance on this benchmark suite, on its own rank scale (each scenario\'s raw score converted to a continuous rank-index before averaging, so scenarios with different scales combine fairly). One value per real-world session (all suite scenarios played that session, averaged), then Harrell-Davis p90 with n-matching, same as the per-scenario Ceiling. This is the app\'s primary metric — the suite\'s ranks are a fixed, externally-defined scale, so this effect size can\'t be inflated by cherry-picking your own best scenario/cm the way a self-defined baseline can.',
    'Benchmark typical change': 'CALCULATIONS-V4 §10.1: your typical performance on this benchmark suite\'s rank scale — 10%-trimmed mean of session values (one per real-world session, averaged across whichever suite scenarios you played that session).',
    'Benchmark floor change': 'CALCULATIONS-V4 §10.1: your bad-day performance on this benchmark suite\'s rank scale — Harrell-Davis p10 of session values, n-matched against the baseline period, same reliability rules as the per-scenario Floor (needs 8+ sessions each side).'
  };

  const cardHtml = ([k,v,c,side,big]) => '<div class="card'+(big?' big':'')+'" title="'+(TIPS[k]||'')+'"><div class="k">'+k+'</div><div class="v'+(c?' '+c:'')+'">'+v+'</div>'+(side||'')+'</div>';
  // Big cards carry the estimate plus its interval underneath — unless the
  // interval crosses zero, in which case both the number and its interval move
  // behind the "within noise" hover instead of sitting in the default view.
  const estCard = (k, e, avail) => {
    const ns = avail && e && e.pct != null && ciCrossesZero(e);
    return [k, avail ? (ns ? nsTag(e) : estStr(e)) : '—', avail ? estCls(e) : '',
      (avail && e && e.se != null && !ns) ? '<div class="vsub ci">'+ciStr(e).replace(/^ /,'')+'</div>' : '', true];
  };

  if(has('#benchHeadlineWrap')){
    if(benchChoices.length){
      $('#benchHeadlineWrap').style.display = 'block';
      $('#benchHeadlinePick').innerHTML = benchChoices
        .map(x => '<option value="'+esc(x.b.name)+'"'+(x.b.name===benchAggName?' selected':'')+'>'+esc(x.b.name)+'</option>').join('');
      const benchCards = [
        estCard('Benchmark ceiling change', benchAgg && benchAgg.ceiling, true),
        estCard('Benchmark typical change', benchAgg && benchAgg.typical, true),
        estCard('Benchmark floor change', benchAgg && benchAgg.floor, true)
      ];
      $('#benchHeadlineCards').innerHTML = benchCards.map(cardHtml).join('');
      $('#benchHeadlineNote').textContent = benchAgg
        ? benchAgg.scenariosPlayed + ' scenario' + (benchAgg.scenariosPlayed===1?'':'s') + ', ' + benchAgg.n.toLocaleString() + ' runs matched'
        : '';
    } else {
      $('#benchHeadlineWrap').style.display = 'none';
    }
  }

  // CALCULATIONS-V4 §10.3: phrasing is deliberately "sits in the Nth
  // percentile of the null distribution", never "improved Y by X%" - see the
  // big comment above computeAttribution() for why. n_comparisons and the
  // N-of-1 pointer are always shown alongside any candidates, not just on
  // hover, since a ranked list with neither looks far more certain than it is.
  if(has('#attribWrap')){
    if(attrib){
      $('#attribWrap').style.display = 'block';
      $('#attribNote').textContent = attrib.candidates.length
        ? attrib.candidates.length + ' of ' + attrib.nComparisons + ' scenarios tested clear the smallest worthwhile change'
        : 'none of ' + attrib.nComparisons + ' scenarios tested clear the smallest worthwhile change';
      const rows = attrib.candidates.map(c =>
        '<div class="attribrow"><div class="attribhead"><b>'+esc(c.scen)+'</b> sits in the <b>'+
        Math.round(c.percentile)+'th percentile</b> of the null distribution</div>'+
        '<div class="attribsub">'+c.nWeeks+' lagged weeks of data · implied swing between a light and heavy week on this: '+
        (c.effectPct>=0?'+':'')+c.effectPct.toFixed(1)+'% on '+esc(attrib.benchName)+'</div></div>'
      ).join('') || '<p class="attribempty">Played enough to test '+attrib.nComparisons+' scenario'+
        (attrib.nComparisons===1?'':'s')+' against a '+attrib.negControlN+'-scenario null, but none moved '+
        esc(attrib.benchName)+' by more than noise once lagged and compared to that null.</p>';
      $('#attribList').innerHTML = rows +
        '<p class="attribsub" style="margin-top:10px">Ranked against '+attrib.negControlN+' scenarios picked without regard '+
        'to plausibility, not a p-value — a high percentile is a lead worth testing, not an answer. To actually find out, '+
        'alternate blocks of a few weeks playing this vs not, and compare (the N-of-1 protocol).</p>';
    } else {
      $('#attribWrap').style.display = 'none';
    }
  }

  // CALCULATIONS-V4 §6.1: two headlines, always both, separately labelled -
  // Matched (real baseline data only) above the existing all-cells cards.
  if(has('#matchedHeadlineWrap')){
    const matchedCards = [
      estCard('Ceiling change', matchedPb, true),
      estCard('Typical change', matchedAvg, true),
      estCard('Floor change', matchedLow, true)
    ];
    $('#matchedHeadlineCards').innerHTML = matchedCards.map(cardHtml).join('');
    $('#matchedHeadlineNote').textContent = matchedComposition.all
      ? matchedComposition.matched + ' of ' + matchedComposition.all + ' cells have real data both sides' +
        (matchedComposition.matched < matchedComposition.all
          ? ' — the rest lean on a fitted familiarisation baseline (below)' : '')
      : '';
  }

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
  if(wEff != null && Math.abs(wEff) >= 1) caveats.push('Your first ~' + Math.round(TUNING.WARMUP_SECONDS/60) +
    ' minutes of a session average ' + (wEff>=0?'+':'') + wEff.toFixed(1) + '% vs later runs' +
    (excludeWarmup ? ' — those runs are being excluded.' : ' — consider enabling "Skip warmup".'));
  if(sortBy === 'data') caveats.push('Sorted by how precisely each scenario can measure a change (the width of its 95% interval), not by how good you are at it or how much you played it. Scenarios at the bottom are not worse \u2014 they are thinner, or their runs are split across more sensitivities.');
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
    const dcell = d => d ? deltaSpan(d.avgDelta) + (d.early ? ' '+earlyTag(TUNING.FAMILIAR_MIN_RUNS) : '') : '<span style="color:var(--ink3)">—</span>';
    const dcellPb = d => d ? deltaSpan(d.pbDelta) + (d.early ? ' '+earlyTag(TUNING.FAMILIAR_MIN_RUNS) : '') : '<span style="color:var(--ink3)">—</span>';
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
    // Say exactly how short the fullest cm/360 is, rather than a fixed "need
    // 3+" figure that had drifted from the real threshold (CM_LEVEL_MIN_N).
    const winCmCounts = {};
    cmAnalysisPool.forEach(r => {
      if(r.date>=windowStart && r.date<=windowEnd && r.cm360!=null){
        const b = Math.round(r.cm360);
        winCmCounts[b] = (winCmCounts[b]||0) + 1;
      }
    });
    const fullestCm = Object.values(winCmCounts).reduce((a,b) => Math.max(a,b), 0);
    const stillNeed = Math.max(1, TUNING.CM_LEVEL_MIN_N - fullestCm);
    $('#cmBreakdownWrap').innerHTML = '<p class="note">Not enough runs at any single cm/360 to break down performance by cm yet' +
      (fullestCm ? ' — your fullest cm/360 in this window has ' + fullestCm + ' run' + (fullestCm===1?'':'s') : '') +
      '. Need ' + stillNeed + ' more run' + (stillNeed===1?'':'s') + ' at one cm/360 to show a comparison with some accuracy; ' +
      'for the most accurate measurement, cms in comparison need ' + TUNING.CM_LEVEL_MIN_N + '+ runs each over the ' +
      spanDays + '-day window you\'re viewing.</p>';
  } else {
    $('#cmBreakdownWrap').style.display = 'none';
  }

  const colorByCm = hasCmData;
  const runQ = ($('#runSearch').value || '').trim().toLowerCase();
  const matched = runQ ? displayRows.filter(r => r.scen.toLowerCase().includes(runQ)) : displayRows;
  // Each scenario card draws an SVG chart, so rendering hundreds at once is the
  // expensive part - page them instead.
  const limit = listShowAll ? matched.length : Math.min(listLimit, matched.length);
  const shownRows = matched.slice(0, limit);
  if(has('#runSearchNote')){
    $('#runSearchNote').textContent = runQ
      ? (matched.length.toLocaleString() + ' of ' + displayRows.length.toLocaleString() + ' match "' + runQ + '" · showing ' + shownRows.length)
      : (displayRows.length.toLocaleString() + ' scenarios · showing ' + shownRows.length);
  }
  // Pinning a card to one cm re-runs the same machinery on just that cm's runs
  // rather than patching the numbers after the fact. The percentages, their
  // CIs, the power check and the baseline all have to move together or the card
  // starts claiming a comparison it never made. minRuns is 1 here on purpose:
  // you asked for this cm specifically, and each metric already withholds
  // itself below its own minimum instead of guessing.
  const cardView = r => {
    const cm = scenCm.get(r.scen.trim().toLowerCase());
    if(cm == null) return r;
    const at = x => x.scen === r.scen && x.cm360 != null && Math.round(x.cm360) === cm;
    const sub = computeTrends(pool.filter(at), windowStart, windowEnd, effCmpMode, 1,
                              analysisClusters, displayPool.filter(at));
    return sub.length ? sub[0] : r;
  };

  $('#list').innerHTML = shownRows.map(r => {
    const key = r.scen.trim().toLowerCase();
    const pinCm = scenCm.get(key);
    // v is what the card shows: the whole scenario, or just one cm of it.
    const v = cardView(r);
    // Pinned to a cm you have not played inside this window - say so rather
    // than quietly showing everything and letting the chip look broken.
    const pinMissed = pinCm != null && v === r;
    // Checked up front so the warning symbol can mention them: a card quietly
    // showing two dashes and no warning reads as a broken app.
    const missingCmp = [
      ['Ceiling (p90)', 'ceiling', TUNING.CEILING_MIN_SESS],
      ['Typical (trimmed)', 'typical', TUNING.TYPICAL_MIN_SESS],
      ['Floor (p10)', 'floor', TUNING.FLOOR_MIN_SESS]
    ].filter(h => { const e = v[h[1]]; return !e || e.pct == null; })
     .map(h => ({label: h[0], key: h[1], why: cmpWhy(v, h[1], h[2])}));
    const whyFor = key => { const m = missingCmp.find(x => x.key === key); return m ? m.why : null; };
    const row = (label, value, minN, est, key) => {
      const why = whyFor(key);
      return '<tr><td>'+label+'</td><td>'+
        (value==null
          ? '<span class="nodata" title="'+esc('Withheld until there are '+minN+' sessions: below that this figure moves with the sample size rather than with your play.')+'">s&lt;'+minN+'</span>'
          : fmt(value))+'</td>'+
        '<td>'+(why ? '<span class="nocmp" title="'+esc(label+' \u2014 '+why)+'">\u2014</span>' : estSpan(est))+'</td></tr>';
    };
    // One yellow warning symbol per card, opening the drawer, instead of two
    // 12px icons carrying their explanation in hover text nobody can read.
    const moreNeeded = Math.max(0, v.nRequired - v.nMin);
    const windowSpanDays = Math.max(1, (windowEnd - windowStart)/864e5);
    const ratePerDay = v.st.n / windowSpanDays;
    const etaDays = (!v.powered && ratePerDay > 0) ? Math.ceil(moreNeeded/ratePerDay) : null;
    const caveats = scenCaveats(v, {moreNeeded, etaDays, windowEnd, missingCmp});
    // Stashed for the drawer: the click handler runs long after this render,
    // and recomputing it there would mean re-deriving the whole row.
    SCEN_CAVEATS[key] = {title: r.scen, html: caveatsHtml(caveats)};
    // Stashed the same way, for the same reason: the export button's click
    // handler fires long after this render pass, against whichever card is
    // still on screen.
    SCEN_EXPORT[key] = {scen: r.scen, v, clusters: analysisClusters};
    const warnIcon = caveats.length
      ? '<button type="button" class="warnsym scenWarn" data-scen="'+esc(key)+'" ' +
        'title="'+caveats.length+' thing'+(caveats.length===1?'':'s')+' to know about this scenario — click to read">⚠</button>'
      : '';
    const infoIcon = '';
    // Session badge: this scenario overall, or — if that would show as a flat
    // 0.0% — the cm/360 actually being played right now (Batch 8).
    const zeroish = x => x == null || Math.abs(x) < 0.05;
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
    // The pin marker doubles as the way out of it: the chip is one click, but
    // once a card is filtered the obvious place to look is the line saying so.
    const pinNote = pinCm == null ? ''
      : (pinMissed
          ? ' · <span class="cmpin miss" title="Nothing at '+pinCm+'cm inside this window, so the card is showing every cm. Click to clear.">no '+pinCm+'cm runs here ✕</span>'
          : ' · <span class="cmpin" title="This card only — everything else on the page is untouched. Click to show every cm again.">'+pinCm+'cm only ✕</span>');
    // Offered whenever the scenario has been played at more than one
    // sensitivity at all. Whether there is enough of each to compare is the
    // panel's job to say, and saying it is more use than a missing button.
    const multiCm = new Set((r.rsAll || r.rs).filter(x => x.cm360 != null)
                                             .map(x => Math.round(x.cm360))).size > 1;
    const cmOpen = cmPanelOpen.has(key);
    // pb_surprise (CALCULATIONS-V4 §4.1) - never a %, since it isn't one; a
    // signed sigma distance from what n runs of pure chance alone would
    // produce is the whole point of not treating a record as a measurement.
    const surprise = pbSurprise(v.st.sorted);
    const surpriseCell = surprise == null
      ? '<span style="color:var(--ink3)">not a measurement</span>'
      : '<span style="color:var(--ink3)" title="How far your actual best sits from the maximum an unchanging player would be expected to reach after '+v.st.n+' runs, in standard deviations of your own score spread here. Near zero: your PB is what n runs of pure chance alone would produce — no skill signal needed to explain it. Still not a %, and still not proof of a real change: any one sample’s maximum can land above or below its own expectation.">'+
        (surprise>=0?'+':'')+surprise.toFixed(1)+'σ vs pure-chance expected max</span>';
    // Every card renders chart-left, metrics-right at up to 1920px (.scen-full)
    // - it used to be behind a per-card "Full width" toggle that was being
    // clicked every time anyway, same story as .scen-expanded below it.
    return '<div class="scen scen-expanded scen-full" data-scen="'+esc(key)+'"><h3>'+
      esc(r.scen)+' '+infoIcon+warnIcon+' '+sessBadge+
      (multiCm ? '<button type="button" class="minibtn cmToggle'+(cmOpen?' on':'')+'" data-scen="'+esc(key)+'">'+
        (cmOpen?'Hide score by cm':'Score by cm')+'</button>' : '')+
      // Server-only: there's nowhere on disk to write the CSV to without it.
      (SERVER_MODE ? '<button type="button" class="minibtn exportBtn" data-scen="'+esc(key)+'">Export data</button>' : '')+
      '</h3>'+
      '<p class="meta">'+v.st.n+' runs'+(v.zeroRuns ? ' <span class="zerotag" title="Runs that scored 0 — a NeverMiss that ended on the first shot, for example. Drawn on the chart, never counted in a percentage.">+'+v.zeroRuns+' scored 0</span>' : '')+' · spread '+fmt(v.st.cv)+'% · last played '+v.rs[v.rs.length-1].date.toISOString().slice(0,10)+
      (v.cells.length>1 ? ' · '+v.cells.length+' cm cells' : '')+pinNote+'</p>'+
      '<div class="scenbody"><div class="scennum">'+
      '<table><tr><th>metric</th><th>value</th><th>vs baseline (95% CI)</th></tr>'+
      '<tr><td>PB <span class="recordtag">record</span></td><td>'+fmt(v.st.record)+pbCmTag(v.rs)+'</td><td>'+surpriseCell+'</td></tr>'+
      row('Ceiling (p90)', v.st.ceiling, TUNING.CEILING_MIN_SESS, v.ceiling, 'ceiling')+
      row('Typical (trimmed)', v.st.typical, TUNING.TYPICAL_MIN_SESS, v.typical, 'typical')+
      row('Floor (p10)', v.st.floor, TUNING.FLOOR_MIN_SESS, v.floor, 'floor')+
      '</table>'+
      staleNote(v, windowEnd) +
      '</div><div class="scenchart">'+
      // The chart is drawn from the pinned runs, but the chips are built from
      // every run the scenario has - filter to 45cm and the other chips have to
      // still be there, or there is no way back out except undoing the filter.
      spark(v.rsAll || v.rs, colorByCm, r.rsAll || r.rs, pinCm, tradingLines)+
      '</div>'+
      '<div class="legend"><span><i style="background:var(--best)"></i>PB (step — it is a ratchet, not a slope)</span>'+
      '<span><i style="background:var(--med)"></i>rolling median</span>'+
      '<span><i style="background:var(--low)"></i>rolling bottom 10%</span>'+
      '<span><i style="background:var(--ink3)"></i>individual runs</span>'+
      '<span><i class="bandkey"></i>±1σ noise floor</span>'+
      (tradingLines ?
        '<span><i style="background:var(--tophi)"></i>topmost trend (first→latest top, projected)</span>'+
        '<span><i style="background:var(--lowlo)"></i>lowest trend (first→latest low, projected)</span>'+
        '<span><i style="background:var(--raw)"></i>run-to-run line</span>' : '')+
      '</div>'+
      '</div>'+
      // Deliberately the scenario's WHOLE history rather than the current
      // window: comparing sensitivities needs every run of each one it can get,
      // and the thing a short window would otherwise hide - that you played them
      // months apart - is measured and called out inside the panel itself.
      (cmOpen ? cmPanelHtml(r.scen, key, RUNS.filter(x =>
          runVisible(x) && x.scen === r.scen && x.score > 0)) : '')+
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

// Everything the card would otherwise have to say in 12px hover text. Returned
// as a list so the icon can say how many there are before you open it.
const SCEN_CAVEATS = {};
// Per-card data for the "Export data" button (Batch 11) — same stash pattern
// as SCEN_CAVEATS above, and for the same reason.
const SCEN_EXPORT = {};
function caveatsHtml(list){
  if(!list.length) return '<p>Nothing to flag on this one.</p>';
  return list.map(c => '<h3>' + c.t + '</h3><p>' + c.b + '</p>').join('') +
    '<p style="margin-top:20px;color:var(--ink3)">Every symbol on a card is listed under ' +
    '<b>Icon meanings</b> in the menu at the top of the page.</p>';
}
function scenCaveats(v, ctx){
  const out = [];
  if(!v.powered){
    out.push({
      t: 'Not enough runs to trust a small change',
      b: 'This scenario needs about <b>' + ctx.moreNeeded + ' more comparable run' +
         (ctx.moreNeeded === 1 ? '' : 's') + ' per side</b> before a ' + TUNING.TARGET_EFFECT +
         '% change could be told apart from noise' +
         (ctx.etaDays != null ? ' — roughly <b>' + ctx.etaDays + ' day' +
            (ctx.etaDays === 1 ? '' : 's') + '</b> at your recent pace on it' : '') + '. ' +
         'The requirement is not a fixed number: it scales with the square of how noisy ' +
         'this scenario is for you (spread here is ' + fmt(v.st.cv) + '%), which is why it ' +
         'differs from scenario to scenario.'
    });
  }
  if(v.usedEarlyBaseline){
    out.push({
      t: 'Some percentages use a stand-in baseline',
      b: 'There is no separate earlier period to compare against yet, so the rows tagged ' +
         '<span class="earlytag">early</span> are measured against a <b>familiarisation curve ' +
         'fitted to your run history</b> (needs at least ' + TUNING.FAMILIAR_MIN_RUNS + ' runs) ' +
         'instead — its estimated plateau, not your raw early scores, which run too low to use ' +
         'as a fair baseline. Treat those rows as a rough starting point rather than a measured ' +
         'change — they are given no confidence interval on purpose. Play it more and they become ' +
         'real comparisons.'
    });
  }
  const missing = ctx.missingCmp || [];
  if(missing.length){
    out.push({
      t: missing.length === 3
        ? 'None of the three figures can be compared to a baseline yet'
        : missing.length + ' of the three figures have no baseline comparison',
      b: missing.map(m => '<b>' + m.label + '</b> \u2014 ' + m.why).join('<br><br>') +
         '<br><br>A dash in that column is not a zero and not a bug: it is the app declining to ' +
         'print a number it cannot stand behind. The value on the left is still real \u2014 what is ' +
         'missing is a trustworthy <i>change</i> against the period before this window.'
    });
  }
  const staleDays = Math.floor((ctx.windowEnd - v.rs[v.rs.length-1].date) / 864e5);
  if(staleDays >= TUNING.STALE_SOFT_DAYS){
    out.push({
      t: 'Not played in ' + staleDays + ' days',
      b: 'These percentages are still measured against an old baseline, so they say more about ' +
         'where you left off than where you are now. Around <b>10 more runs</b> would give a ' +
         'current read.'
    });
  }
  if(v.zeroRuns){
    out.push({
      t: v.zeroRuns + ' run' + (v.zeroRuns === 1 ? '' : 's') + ' scored 0',
      b: 'Usually a NeverMiss that ended on the first shot. They are drawn on the chart as hollow ' +
         'marks along the bottom so you can see they happened, but they are kept out of every ' +
         'average — a zero measures the moment you lost, not a level of performance.'
    });
  }
  return out;
}

// Why a "vs baseline" cell is a dash, in words.
//
// A bare em-dash is honest and useless: it says "not measured" without saying
// what would fix it, and it looks identical whether the reason is "you have not
// played this enough yet" or "you have never played it at a sensitivity you
// also played earlier". Those need completely different things from you, so
// the card has to tell them apart.
//
// The usual cause is not a shortage of runs but the cm/360 split: runs are
// compared band against band on purpose (STATISTICS.md 3.3), so 16 runs across
// seven bands can leave every band too thin even though the card says 16.
function cmpWhy(v, key, minN){
  const cs = v.cells || [];
  const paired = cs.filter(c => c.w.n > 0 && c.b.n > 0);
  const bands = cs.length;
  const split = bands > 1
    ? ' These ' + v.st.n + ' runs are split across ' + bands + ' sensitivity bands, and each band is ' +
      'only ever compared against itself \u2014 otherwise moving your sens between the two periods would ' +
      'show up as a change in skill.'
    : '';
  if(!paired.length){
    return (cs.some(c => c.b.n > 0)
      ? 'Nothing in this window was played at a sensitivity you also played in the period before it, ' +
        'so there is no like-for-like comparison to make.'
      : 'There are no runs in the period before this window, so there is nothing to compare against yet.') + split;
  }
  const w = Math.max(...paired.map(c => c.wSess.n));
  const b = Math.max(...paired.map(c => c.bSess.n));
  // No label in here: both callers already name the row, and printing it twice
  // read as "Ceiling (p90) - Ceiling (p90) needs at least 8 sessions...".
  return 'Needs at least ' + minN + ' sessions on each side of the comparison (a session is one sitting, ' +
    'not one run). Your fullest sensitivity band has ' + w + ' in this window and ' + b + ' in the period before it.' + split;
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

// ---------------------------------------------------------------------------
// Score by cm/360, per scenario.
//
// The premise: how your score moves as sensitivity changes says something about
// what you are actually short of - arm stability, wrist control, micro speed.
// The rules for reading that are YOURS and live in app/data/categories.md as
// plain text. This file parses them and evaluates them; it does not contain any.
//
// Two things make this the easiest chart in the app to lie with, and both are
// handled explicitly rather than hoped away:
//
//   1. Sample size. A three-run cm sitting next to a two-hundred-run cm looks
//      like a data point and is a rumour. Levels below CM_LEVEL_MIN_N runs are
//      not plotted and take no part in any rule.
//   2. Time. If you played 60cm in March and 52cm in August, the difference
//      between them is eight months of practice, not eight cm of sensitivity.
//      Overlap is measured and said out loud when it is missing.
//
// Corporate Serf Dashboard has a sensitivity-vs-score plot. It is AGPL-3.0 and
// nothing has been taken from it - only the public description of the feature
// was read. Everything here is derived from this project's own cm machinery.
// ---------------------------------------------------------------------------
let CATEGORY_RULES = null;      // parsed app/data/categories.md
const cmPanelOpen = new Set();  // scenario keys with the panel expanded
let cmExtremes = false;         // include <25cm and >80cm

// Placeholder entries in the rules file are templates, not rules. Showing
// "(add your interpretation)" to somebody as a finding would be worse than
// showing nothing.
const RULE_PLACEHOLDER = /\(add your/i;

// A condition is `name` or `name(number)`, joined by AND. Anything else is
// reported back rather than silently ignored - a rule you wrote that the app
// cannot evaluate is something you need to know about.
function parseCondition(expr){
  const terms = expr.split(/\s+AND\s+/i).map(t => t.trim()).filter(Boolean);
  return terms.map(t => {
    const m = /^([a-z_]+)\s*(?:\(\s*(-?[\d.]+)\s*\))?/i.exec(t);
    if(!m) return {raw:t, ok:false};
    const known = ['faster_than','slower_than','higher_avg_at_faster','higher_avg_at_slower',
                   'pct_below_regular','regular_slower_than'];
    const takesArg = ['faster_than','slower_than','pct_below_regular','regular_slower_than'];
    const name = m[1].toLowerCase();
    const arg = m[2] == null ? null : parseFloat(m[2]);
    const extra = t.slice(m[0].length).trim();
    if(known.indexOf(name) === -1) return {raw:t, ok:false};
    if(takesArg.indexOf(name) !== -1 && arg == null) return {raw:t, ok:false};
    // Trailing prose ("at slower cm") is not a condition. Keep the rule, but
    // remember the words so they can be shown rather than quietly dropped.
    return {name, arg, extra, raw:t, ok:true};
  });
}

function parseCategoryRules(text){
  const cats = [];
  let entry = null, rule = null;
  const lines = text.split(/\r?\n/);
  // The file documents its own format in a fenced block at the top. Parsing
  // that would invent a "<Category> / <Sub-category>" entry holding a rule that
  // reads "WHEN: <condition>" - the instructions turning up as data.
  let fenced = false;
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(/^\s*```/.test(line)){ fenced = !fenced; continue; }
    if(fenced) continue;
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if(h3){
      const parts = h3[1].split('/').map(x => x.trim());
      entry = {cat: parts[0], sub: parts[1] || '', notes: [], rules: []};
      cats.push(entry);
      rule = null;
      continue;
    }
    if(/^##\s/.test(line)){ entry = null; rule = null; continue; }
    if(!entry) continue;
    const w = /^WHEN:\s*(.+?)\s*$/i.exec(line);
    if(w){
      rule = {when: w[1], terms: parseCondition(w[1]), then: ''};
      entry.rules.push(rule);
      continue;
    }
    const a = /^=>\s*(.+?)\s*$/.exec(line);
    if(a){ if(rule) rule.then = a[1]; continue; }
    // Indented continuation of the current interpretation.
    if(rule && rule.then && /^\s+\S/.test(line)){ rule.then += ' ' + line.trim(); continue; }
    // Free prose under a heading, before any WHEN - shown as context.
    if(!rule && line.trim() && !/^\s*$/.test(line)) entry.notes.push(line.trim());
  }
  // Drop the template entries entirely; keep real ones.
  cats.forEach(e => {
    e.rules = e.rules.filter(r => !RULE_PLACEHOLDER.test(r.when) && !RULE_PLACEHOLDER.test(r.then));
    e.notes = e.notes.filter(n => !RULE_PLACEHOLDER.test(n));
  });
  return cats;
}

// ---------------------------------------------------------------------------
// The measurement.
//
// One level per rounded cm/360, each with its own mean and its own 95% interval.
// Levels thinner than CM_LEVEL_MIN_N runs are dropped: the whole point of this
// view is comparing levels, and a level you cannot measure is not a comparison.
// ---------------------------------------------------------------------------
const CM_EXTREME_LO = 25, CM_EXTREME_HI = 80;
function cmLevels(runs, includeExtremes){
  const by = new Map();
  runs.forEach(r => {
    if(r.cm360 == null || !(r.score > 0)) return;
    const cm = Math.round(r.cm360);
    if(!includeExtremes && (cm < CM_EXTREME_LO || cm > CM_EXTREME_HI)) return;
    if(!by.has(cm)) by.set(cm, []);
    by.get(cm).push(r);
  });
  const out = [];
  by.forEach((rs, cm) => {
    if(rs.length < TUNING.CM_LEVEL_MIN_N) return;
    const scores = rs.map(r => r.score);
    const m = mean(scores), sdv = sd(scores);
    const dates = rs.map(r => r.date.getTime());
    out.push({cm, n: rs.length, mean: m, sd: sdv,
              se: sdv / Math.sqrt(rs.length),
              first: new Date(Math.min.apply(null, dates)),
              last:  new Date(Math.max.apply(null, dates))});
  });
  return out.sort((a,b) => a.cm - b.cm);
}

// Did you play these two sensitivities in the same stretch of time, or one
// after the other? If they never overlap, whatever separates their scores also
// contains however much you improved in between, and no amount of arithmetic
// here can tell the two apart.
//
// Measured on the pair the headline and every rule actually rest on - your best
// level against the one you play most - rather than the worst pair anywhere,
// which is usually two levels nothing is being concluded from.
function cmTimeOverlap(a, b){
  if(!a || !b || a.cm === b.cm) return null;
  const lo = Math.max(a.first.getTime(), b.first.getTime());
  const hi = Math.min(a.last.getTime(), b.last.getTime());
  const union = Math.max(a.last.getTime(), b.last.getTime()) -
                Math.min(a.first.getTime(), b.first.getTime());
  const disjoint = hi < lo;
  return {
    a, b, disjoint,
    gapDays: disjoint ? (lo - hi)/864e5 : 0,
    share: union > 0 ? Math.max(0, hi - lo)/union : 1
  };
}

function cmAnalysis(runs, includeExtremes){
  const levels = cmLevels(runs, includeExtremes);
  if(levels.length < 2) return {levels, enough:false};
  const regular = levels.reduce((x,y) => y.n > x.n ? y : x);
  const best    = levels.reduce((x,y) => y.mean > x.mean ? y : x);
  const worst   = levels.reduce((x,y) => y.mean < x.mean ? y : x);
  // The one comparison every interpretation leans on: is your best level really
  // better than the one you actually play, or is that gap inside the noise?
  const diff = best.cm === regular.cm ? null : (() => {
    const d = (best.mean - regular.mean) / regular.mean * 100;
    // SE of a ratio of two independent means, to first order.
    const rel = Math.sqrt((best.se/best.mean)**2 + (regular.se/regular.mean)**2) * 100;
    return {pct: d, se: rel * Math.abs(best.mean/regular.mean),
            ns: Math.abs(d) <= TUNING.CI_Z * rel};
  })();
  return {levels, enough:true, regular, best, worst, diff, overlap: cmTimeOverlap(best, regular)};
}

// ---------------------------------------------------------------------------
// Evaluating your rules against that.
// cm/360 is distance-per-turn, so a BIGGER number is a SLOWER sensitivity.
// ---------------------------------------------------------------------------
function evalTerm(term, a){
  switch(term.name){
    case 'faster_than':        return a.best.cm < term.arg;
    case 'slower_than':        return a.best.cm > term.arg;
    case 'regular_slower_than':return a.regular.cm > term.arg;
    case 'higher_avg_at_faster':
      return a.levels.some(l => l.cm < a.regular.cm && l.mean > a.regular.mean);
    case 'higher_avg_at_slower':
      return a.levels.some(l => l.cm > a.regular.cm && l.mean > a.regular.mean);
    case 'pct_below_regular':
      return a.levels.some(l => l.cm !== a.regular.cm &&
        (a.regular.mean - l.mean) / a.regular.mean * 100 >= term.arg);
    default: return false;
  }
}

function evalRules(entry, a){
  const fired = [], skipped = [];
  if(!entry || !a.enough) return {fired, skipped};
  entry.rules.forEach(r => {
    if(r.terms.some(t => !t.ok)){
      skipped.push({when: r.when, why: 'this app cannot evaluate ' +
        r.terms.filter(t => !t.ok).map(t => '"' + t.raw + '"').join(', ')});
      return;
    }
    if(r.terms.every(t => evalTerm(t, a))){
      const extra = r.terms.map(t => t.extra).filter(Boolean);
      fired.push({then: r.then, when: r.when, extra});
    }
  });
  return {fired, skipped};
}

// A first guess from the name, offered and labelled rather than assumed. It is
// substring matching on a scenario title, which is exactly as reliable as that
// sounds - it exists to save picking the same thing forty times, not to be
// right. Anything you pick yourself is remembered and wins.
function guessCategory(scen, cats){
  const n = scen.toLowerCase();
  const has = w => n.indexOf(w) !== -1;
  let cat = null, sub = null;
  if(has('smooth')) cat = 'Smoothness';
  else if(has('react')) cat = 'Reactive';
  else if(has('control') || has('tracking') || has('paradise') || has('centering')) cat = 'Control Tracking';
  else if(has('dynamic') || has('bounce') || has('strafe') || has('psalm') || has('popcorn')) cat = 'Dynamic Clicking';
  // "1w2ts", "1w3ts" etc is KovaaK's own naming for target switching, which is
  // clicking. A bare "ts" is not - it appears inside far too many words.
  else if(has('static') || has('click') || has('flick') || /\d+w\d+ts/.test(n)) cat = 'Static Clicking';
  if(has('micro')) sub = 'Micro';
  else if(has('wide')) sub = 'Wide';
  if(!cat) return null;
  const inCat = cats.filter(e => e.cat === cat);
  if(!inCat.length) return null;
  if(sub){
    const exact = inCat.find(e => e.sub === sub);
    if(exact) return exact;
  }
  // No sub-category in the name means Regular, not "whichever entry happens to
  // be written first in the file" - which was quietly labelling everything
  // Micro.
  return inCat.find(e => e.sub === 'Regular') || inCat.find(e => !e.sub) || inCat[0];
}

// ---------------------------------------------------------------------------
// The score-by-cm chart. Same axis rule as every other chart here: the y span
// comes from the SPREAD of the runs, not their min and max, so the visual size
// of a gap between two sensitivities tracks its size in units of your own noise
// (CHART-SCALING.md). Error bars are the 95% interval on each level's mean -
// without them this chart is a line drawn through eight rumours.
// ---------------------------------------------------------------------------
function cmChart(a, runs){
  const H = 260, W = Math.round(H * TUNING.CHART_ASPECT), PL = 54, PR = 16, PT = 16, PB = 34;
  const sc = chartScale(runs.filter(r => r.score > 0).map(r => r.score));
  // The bars must fit even when a level's interval reaches past the run spread.
  let lo = sc.lo, hi = sc.hi;
  a.levels.forEach(l => {
    lo = Math.min(lo, l.mean - TUNING.CI_Z*l.se);
    hi = Math.max(hi, l.mean + TUNING.CI_Z*l.se);
  });
  const cms = a.levels.map(l => l.cm);
  let xlo = Math.min.apply(null, cms), xhi = Math.max.apply(null, cms);
  const pad = Math.max(2, (xhi - xlo) * 0.12);
  xlo -= pad; xhi += pad;
  const x = cm => PL + (cm - xlo)/(xhi - xlo) * (W - PL - PR);
  const y = v => PT + (hi - v)/(hi - lo) * (H - PT - PB);

  let ticks = '';
  const step = niceStep((hi - lo)/4);
  for(let v = Math.ceil(lo/step)*step; v <= hi; v += step){
    ticks += '<line x1="'+PL+'" y1="'+y(v).toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y(v).toFixed(1)+
      '" stroke="currentColor" stroke-opacity=".10" stroke-width="1" vector-effect="non-scaling-stroke"/>'+
      '<text x="'+(PL-6)+'" y="'+(y(v)+3.5).toFixed(1)+'" text-anchor="end" font-size="11" fill="currentColor" opacity=".8">'+fmt(v)+'</text>';
  }
  let bars = '', dots = '', labels = '', path = '';
  a.levels.forEach((l, i) => {
    const cx = x(l.cm), top = y(l.mean + TUNING.CI_Z*l.se), bot = y(l.mean - TUNING.CI_Z*l.se);
    bars += '<line x1="'+cx.toFixed(1)+'" y1="'+top.toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+bot.toFixed(1)+
      '" stroke="var(--ink3)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>'+
      '<line x1="'+(cx-4).toFixed(1)+'" y1="'+top.toFixed(1)+'" x2="'+(cx+4).toFixed(1)+'" y2="'+top.toFixed(1)+
      '" stroke="var(--ink3)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>'+
      '<line x1="'+(cx-4).toFixed(1)+'" y1="'+bot.toFixed(1)+'" x2="'+(cx+4).toFixed(1)+'" y2="'+bot.toFixed(1)+
      '" stroke="var(--ink3)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
    path += (i?'L':'M') + cx.toFixed(1) + ',' + y(l.mean).toFixed(1);
    const isReg = l.cm === a.regular.cm, isBest = l.cm === a.best.cm;
    dots += '<circle cx="'+cx.toFixed(1)+'" cy="'+y(l.mean).toFixed(1)+'" r="'+(isReg?5:4)+
      '" fill="'+(isBest ? 'var(--best)' : (isReg ? 'var(--med)' : 'var(--ink2)'))+'">'+
      '<title>'+l.cm+'cm \u2014 '+l.n+' runs, avg '+fmt(l.mean)+' \u00b1'+fmt(TUNING.CI_Z*l.se)+
      (isReg?' (the one you play most)':'')+(isBest?' (your best average)':'')+'</title></circle>';
    labels += '<text x="'+cx.toFixed(1)+'" y="'+(H-12)+'" text-anchor="middle" font-size="11" fill="currentColor" opacity=".8">'+
      l.cm+'</text>'+
      '<text x="'+cx.toFixed(1)+'" y="'+(H-1)+'" text-anchor="middle" font-size="9" fill="currentColor" opacity=".45">n='+l.n+'</text>';
  });
  return '<svg class="cmchart" viewBox="0 0 '+W+' '+H+'" role="img" ' +
    'aria-label="Average score at each cm per 360, with 95% confidence intervals" ' +
    'style="color:var(--ink3)">' + ticks +
    '<path d="'+path+'" fill="none" stroke="var(--ink3)" stroke-width="1.4" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' +
    bars + dots + labels + '</svg>';
}
function niceStep(raw){
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------------------
// The panel on a scenario card.
// ---------------------------------------------------------------------------
function scenCatKey(){ return 'kva_scencat'; }
function loadScenCats(){
  try{ return JSON.parse(lsGet(scenCatKey()) || '{}'); }catch(e){ return {}; }
}
function saveScenCat(key, value){
  const all = loadScenCats();
  if(value) all[key] = value; else delete all[key];
  lsSet(scenCatKey(), JSON.stringify(all));
}

function catLabel(e){ return e.sub ? (e.cat + ' / ' + e.sub) : e.cat; }

// The rules file is markdown written by hand, so **bold** and `code` should
// render rather than show up as punctuation. Escaped first: this turns two
// specific patterns into tags and can never turn anything else into one.
function ruleText(str){
  return esc(str)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function cmPanelHtml(scen, key, runs){
  const cats = CATEGORY_RULES || [];
  const a = cmAnalysis(runs, cmExtremes);
  const chosenLabel = loadScenCats()[key];
  const guess = chosenLabel ? null : guessCategory(scen, cats);
  const entry = chosenLabel ? cats.find(e => catLabel(e) === chosenLabel) : guess;

  const picker = '<label class="cmcat">Read it as ' +
    '<select class="cmCatSel" data-scen="' + esc(key) + '">' +
    '<option value="">\u2014 pick a category \u2014</option>' +
    cats.map(e => {
      const lbl = catLabel(e);
      const sel = entry && catLabel(entry) === lbl;
      return '<option value="' + esc(lbl) + '"' + (sel ? ' selected' : '') + '>' + esc(lbl) +
        (e.rules.length ? '' : ' (no rules written yet)') + '</option>';
    }).join('') + '</select></label>' +
    (guess && !chosenLabel
      ? '<span class="cmguess" title="Guessed from the scenario name, which is exactly as reliable as that sounds. Pick the right one and it is remembered.">guessed from the name</span>'
      : '');

  if(!a.enough){
    return '<div class="cmpanel">' + cmWipNote() +
      '<p class="note">Not enough to compare yet. This needs at least two different ' +
      'sensitivities with <b>' + TUNING.CM_LEVEL_MIN_N + '+ runs each</b>' +
      (cmExtremes ? '' : ', counting only 25\u201380cm') +
      ' \u2014 a level you cannot measure is not a comparison, it is a rumour.</p>' +
      cmExtremeToggle() + '</div>';
  }

  const {fired, skipped} = evalRules(entry, a);

  // The comparison every interpretation below rests on, stated before them.
  let head;
  if(a.best.cm === a.regular.cm){
    head = '<p class="cmread">Your best average <b>is</b> the sensitivity you play most (<b>' +
      a.regular.cm + 'cm</b>, ' + a.regular.n + ' runs). Nothing to explain.</p>';
  } else {
    const d = a.diff;
    head = '<p class="cmread">You average ' +
      (d.ns
        ? '<span class="nstag" title="' + (d.pct>=0?'+':'') + d.pct.toFixed(1) + '%, 95% CI \u00b1' +
          (TUNING.CI_Z*d.se).toFixed(1) + '% \u2014 crosses zero.">within noise</span>'
        : '<b class="' + (d.pct>=0?'up':'dn') + '">' + (d.pct>=0?'+':'') + d.pct.toFixed(1) + '%</b>') +
      ' at <b>' + a.best.cm + 'cm</b> (' + a.best.n +
      ' runs) versus <b>' + a.regular.cm + 'cm</b>, the one you play most (' + a.regular.n + ' runs). ' +
      (d.ns
        ? '<b>That interval spans zero.</b> Your data cannot tell this apart from noise, so read anything below as a hypothesis, not a finding.'
        : '\u00b1' + (TUNING.CI_Z*d.se).toFixed(1) + '%, which does not span zero.') + '</p>';
  }

  // Time confound. This is the one that quietly ruins the whole chart. A week is
  // the line: two levels a fortnight apart could differ by a fortnight of
  // practice; two levels two days apart could not differ by anything that
  // matters, and crying wolf about that would train you to ignore the warning.
  let overlapNote = '';
  const ov = a.overlap;
  if(ov && ov.disjoint && ov.gapDays >= 7){
    overlapNote = '<p class="cmwarn">\u26a0 <b>You played these in different weeks, not side by side.</b> ' +
      'Your runs at ' + ov.a.cm + 'cm and at ' + ov.b.cm + 'cm never overlap \u2014 about ' +
      Math.round(ov.gapDays) + ' days apart. Whatever separates their scores also contains however ' +
      'much you improved in between, and nothing here can tell the two apart. Alternate them inside ' +
      'one stretch of days and this becomes a real comparison.</p>';
  } else if(ov && (ov.disjoint || ov.share < 0.25)){
    const gd = Math.max(1, Math.round(ov.gapDays));
    overlapNote = '<p class="note">Your runs at ' + ov.a.cm + 'cm and ' + ov.b.cm + 'cm ' +
      (ov.disjoint ? 'do not overlap, but sit only ' + gd + ' day' + (gd === 1 ? '' : 's') + ' apart'
                   : (ov.share < 0.01 ? 'barely overlap at all'
                        : 'overlap for only ' + Math.round(ov.share*100) + '% of the time they span')) +
      ' \u2014 close enough that improvement in between is unlikely to explain much, but worth knowing.</p>';
  }

  const readings = fired.length
    ? '<ul class="cmfindings">' + fired.map(f =>
        '<li>' + ruleText(f.then) + (f.extra.length
          ? ' <span class="dim">(the rule also said \u201c' + esc(f.extra.join(' ')) +
            '\u201d, which is prose rather than a condition, so it was not checked)</span>' : '') +
        '<span class="cmrule">' + esc(f.when) + '</span></li>').join('') + '</ul>'
    : (entry
        ? (entry.rules.length
            ? '<p class="note">None of the ' + entry.rules.length + ' rule' + (entry.rules.length===1?'':'s') +
              ' written for <b>' + esc(catLabel(entry)) + '</b> matched this scenario\'s shape.</p>'
            : '<p class="note">No rules are written for <b>' + esc(catLabel(entry)) +
              '</b> yet. Add them to <code>app/data/categories.md</code> \u2014 plain text, no code changes, ' +
              'reload and they apply.</p>')
        : '<p class="note">Pick a category above and any rules you have written for it are applied here.</p>');

  const notes = entry && entry.notes.length
    ? '<p class="note">' + entry.notes.map(ruleText).join(' ') + '</p>' : '';

  const skippedNote = skipped.length
    ? '<p class="note cmskip"><b>' + skipped.length + ' rule' + (skipped.length===1?'':'s') +
      ' not evaluated:</b> ' + skipped.map(x => esc(x.when) + ' \u2014 ' + esc(x.why)).join('; ') +
      '. Available conditions: <code>faster_than(cm)</code>, <code>slower_than(cm)</code>, ' +
      '<code>higher_avg_at_faster</code>, <code>higher_avg_at_slower</code>, ' +
      '<code>pct_below_regular(n)</code>, <code>regular_slower_than(cm)</code>, joined by <code>AND</code>.</p>'
    : '';

  return '<div class="cmpanel">' + cmWipNote() +
    '<div class="cmpanelbar">' + picker + cmExtremeToggle() + '</div>' +
    cmChart(a, runs) +
    '<p class="cmaxis">Average score at each cm/360, with its 95% interval. ' +
    'Only levels with <b>' + TUNING.CM_LEVEL_MIN_N + '+ runs</b> are drawn' +
    (cmExtremes ? '' : ', and 25\u201380cm only') + '. ' +
    '<span class="dim">Blue is the sensitivity you play most, green your best average.</span></p>' +
    head + overlapNote + notes + readings + skippedNote + '</div>';
}

function cmExtremeToggle(){
  return '<label class="chk cmext" title="Below 25cm and above 80cm are usually a slider accident or a one-off experiment rather than a sensitivity you play. Off by default.">' +
    '<input type="checkbox" class="cmExtremeChk"' + (cmExtremes ? ' checked' : '') +
    '> include under 25cm and over 80cm</label>';
}

function cmWipNote(){
  return '<p class="cmwip"><b>Work in progress.</b> The interpretations come from ' +
    '<code>app/data/categories.md</code>, which is mostly still a template \u2014 what it says is ' +
    'what you wrote in it. Measuring this properly needs a curated set of scenarios played across ' +
    'a spread of sensitivities on purpose: the baseline page, which is not built yet. ' +
    '<button type="button" class="linkbtn cmWhy">How this is read</button></p>';
}

// ---------------------------------------------------------------------------
// Month calendar.
//
// This month and the four before it. One number per month - Typical, the
// trimmed mean - and not three: Ceiling (p90) and Floor (p10) need more runs
// than a single month usually holds, so showing them here would be two
// confident-looking figures beside one honest one.
//
// Each month is measured against the month before it, through exactly the same
// machinery the rest of the page uses: per scenario, per sensitivity, combined
// by how precise each comparison is. A month whose interval spans zero reads
// "within noise" rather than a number, same as everywhere else.
// ---------------------------------------------------------------------------
const CAL_MONTHS = 5;
// The date pickers already own a short MONTH_NAMES; the calendar wants them
// written out.
const MONTH_LONG = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
let calCache = {key:null, html:''};

function monthStart(d, back){
  return new Date(d.getFullYear(), d.getMonth() - (back || 0), 1, 0, 0, 0, 0);
}

// Scenarios you had never played before that month and did play during it.
// Deliberately counted over ALL runs rather than the filtered pool: trying
// something for the first time is a fact about your month, not a measurement,
// and a warm-up exclusion should not be able to un-try it.
function newScenariosIn(a, b){
  const before = new Set(), during = new Set();
  RUNS.forEach(r => {
    // Restarts only. A run you played as a warm-up is still a scenario you
    // tried - the warm-up exclusion exists to stop biased scores entering a
    // measurement, and this is not a measurement.
    if(r.reset) return;
    const k = r.scen.trim().toLowerCase();
    if(r.date < a) before.add(k);
    else if(r.date < b) during.add(k);
  });
  let n = 0;
  during.forEach(k => { if(!before.has(k)) n++; });
  return n;
}

// A run that beat everything you had ever done on that scenario. First-ever
// runs are not PBs - there was nothing to beat.
function pbsIn(a, b){
  const best = {};
  let n = 0;
  // Same reasoning: a personal best set during a warm-up run is still a score
  // you got. Restarts and zeros cannot beat anything.
  RUNS.forEach(r => {
    if(r.reset || r.score <= 0) return;
    const k = r.scen.trim().toLowerCase();
    const prior = best[k];
    if(prior !== undefined && r.score > prior && r.date >= a && r.date < b) n++;
    if(prior === undefined || r.score > prior) best[k] = r.score;
  });
  return n;
}

function renderCalendar(pool, displayPool, clusters, cmpMode){
  if(!has('#calendarWrap')) return;
  if(!RUNS.length){ $('#calendarWrap').innerHTML = ''; return; }
  // Recomputing five months of trends on every 5-second poll is pure waste -
  // the calendar only moves when the data or the exclusions move.
  const key = [dataVersion, pool.length, excludeWarmup, excludeRefam, cmMode,
               cmPickValue, new Date().toDateString()].join('|');
  if(calCache.key === key){ $('#calendarWrap').innerHTML = calCache.html; return; }

  const now = RUNS[RUNS.length-1].date;
  const runsByDay = {};
  displayPool.forEach(r => { const k = r.date.toDateString(); runsByDay[k] = (runsByDay[k]||0)+1; });

  const cards = [];
  for(let back = 0; back < CAL_MONTHS; back++){
    const a = monthStart(now, back), b = monthStart(now, back - 1);
    const inMonth = pool.filter(r => r.date >= a && r.date < b);
    const rows = inMonth.length
      ? computeTrends(pool, a, new Date(b.getTime()-1), cmpMode, 1, clusters)
      : [];
    const cells = rows.reduce((acc, r) => acc.concat(r.cells), []);
    const typical = cells.length ? overallOf(cells.map(c => c.typical)) : null;
    const ns = typical && typical.se != null && Math.abs(typical.pct) <= TUNING.CI_Z * typical.se;
    const pctCls = !typical || typical.pct == null ? '' : (ns ? 'ns' : (typical.pct >= 0 ? 'up' : 'dn'));
    const pctTxt = !typical || typical.pct == null
      ? '<span class="calnone" title="Not enough comparable runs in this month to measure a change against the month before">—</span>'
      : ns
        ? '<span class="ns" title="Typical (trimmed mean) change against ' + MONTH_LONG[(a.getMonth()+11)%12] +
          ': ' + (typical.pct>=0?'+':'') + typical.pct.toFixed(1) + '%, 95% CI ±' + (TUNING.CI_Z*typical.se).toFixed(1) +
          '% — spans zero, so this is within noise">within noise</span>'
        : '<span class="' + pctCls + '" title="Typical (trimmed mean) change against ' +
          MONTH_LONG[(a.getMonth()+11)%12] + (typical.se != null
            ? ', 95% CI ±' + (TUNING.CI_Z*typical.se).toFixed(1) + '%'
            : '') + '">' + (typical.pct>=0?'+':'') + typical.pct.toFixed(1) + '%</span>';

    // Day strip, Monday-first. A month you barely touched should look like one.
    const days = new Date(b.getTime()-1).getDate();
    const lead = (new Date(a.getFullYear(), a.getMonth(), 1).getDay() + 6) % 7;
    let cellsHtml = '';
    for(let i=0;i<lead;i++) cellsHtml += '<i class="calday pad"></i>';
    let playedDays = 0;
    for(let d=1; d<=days; d++){
      const dt = new Date(a.getFullYear(), a.getMonth(), d);
      const n = runsByDay[dt.toDateString()] || 0;
      if(n) playedDays++;
      const lvl = n === 0 ? 0 : (n < 10 ? 1 : (n < 25 ? 2 : (n < 50 ? 3 : 4)));
      const future = dt > now;
      cellsHtml += '<i class="calday l' + lvl + (future ? ' future' : '') + '" title="' +
        d + ' ' + MONTH_LONG[a.getMonth()] + ' — ' + (n ? n + ' run' + (n===1?'':'s') : 'nothing played') + '"></i>';
    }

    const newScen = newScenariosIn(a, b);
    const pbs = pbsIn(a, b);
    const facts = [];
    if(pbs) facts.push('<span class="calfact good">' + pbs + ' PB' + (pbs===1?'':'s') + '</span>');
    if(newScen) facts.push('<span class="calfact new">' + newScen + ' new scenario' +
      (newScen===1?'':'s') + ' tried!</span>');

    cards.push('<div class="calmonth">' +
      '<div class="calhead"><b>' + MONTH_LONG[a.getMonth()] + ' ' + a.getFullYear() + '</b>' + pctTxt + '</div>' +
      '<div class="calbody"><div class="caldays">' + cellsHtml + '</div>' +
      '<div class="calside">' +
        '<div class="calmeta">' + inMonth.length.toLocaleString() + ' runs · ' +
          playedDays + ' day' + (playedDays===1?'':'s') + '</div>' +
        (facts.length ? '<div class="calfacts">' + facts.join('') + '</div>' : '') +
      '</div></div>' +
      '</div>');
  }

  calCache.key = key;
  calCache.html = '<div class="scen calwrap"><h3>Months' +
    '<button type="button" class="minibtn" id="calExplain">What is this?</button></h3>' +
    '<p class="calnote">Typical (trimmed mean) change against the month before. "Within noise" ' +
    'means the interval spans zero — hover it for the actual figure.</p>' +
    cards.join('') + '</div>';
  $('#calendarWrap').innerHTML = calCache.html;
}

// ---------------------------------------------------------------------------
// Reference drawer.
//
// The explanations used to be `title` text on 12px icons and a 9px "early"
// tag - which is where writing goes to not be read. Anything worth explaining
// now opens a panel wide enough to read it in, from one yellow warning symbol
// per card and from the menu bar.
// ---------------------------------------------------------------------------
function openSideTab(title, html, sourceBtn){
  const el = document.getElementById('sidetab');
  const scrim = document.getElementById('sidetabScrim');
  if(!el) return;
  document.getElementById('sidetabTitle').textContent = title;
  document.getElementById('sidetabBody').innerHTML = html;
  el.hidden = false; scrim.hidden = false;
  requestAnimationFrame(() => { el.classList.add('in'); scrim.classList.add('in'); });
  document.querySelectorAll('.menubtn[aria-expanded]').forEach(b => b.setAttribute('aria-expanded','false'));
  if(sourceBtn) sourceBtn.setAttribute('aria-expanded','true');
  openSideTab._src = sourceBtn || null;
  document.getElementById('sidetabClose').focus();
}
function closeSideTab(){
  const el = document.getElementById('sidetab');
  const scrim = document.getElementById('sidetabScrim');
  if(!el || el.hidden) return;
  el.classList.remove('in'); scrim.classList.remove('in');
  setTimeout(() => { el.hidden = true; scrim.hidden = true; }, 240);
  document.querySelectorAll('.menubtn[aria-expanded]').forEach(b => b.setAttribute('aria-expanded','false'));
  if(openSideTab._src) openSideTab._src.focus();
}

// The reference pages. Kept here rather than in the markup so the same text is
// available to simple.html and to the effects lab without being duplicated.
const SIDETAB_DOCS = {
  icons: {
    title: 'Icon meanings',
    html:
      '<p>Everything on a scenario card that is not a number.</p>' +
      '<div class="keyrow"><span class="keysym warnsym">⚠</span><span><b>Warning symbol</b> — ' +
        'this card has something you should know before trusting its percentages. Click it and this ' +
        'panel tells you exactly what, for that scenario: too few runs to detect a real change, a ' +
        'stand-in baseline, or a long gap since you last played it.</span></div>' +
      '<div class="keyrow"><span class="keysym"><span class="earlytag">early</span></span><span><b>early</b> — ' +
        'that percentage is measured against your first few runs of the scenario rather than a genuinely ' +
        'separate earlier period. A rough starting point, not a measured change, so it is given no ' +
        'confidence interval.</span></div>' +
      '<div class="keyrow"><span class="keysym">±</span><span><b>± a number</b> — the 95% confidence ' +
        'interval. If it spans zero, the change renders as <b>within noise</b> instead of a number: the ' +
        'data cannot tell it apart from noise, whatever the underlying figure says. Hover the words for ' +
        'the actual figure and interval.</span></div>' +
      '<div class="keyrow"><span class="keysym">n&lt;</span><span><b>n&lt;10</b> and friends — withheld, not zero. ' +
        'Each metric has its own minimum sample size and shows nothing below it rather than a number ' +
        'it has not earned.</span></div>' +
      '<div class="keyrow"><span class="keysym">●</span><span><b>Coloured dot and <code>52cm</code> chip</b> — ' +
        'a sensitivity this scenario has been played at. Click one to narrow <i>this card</i> to that ' +
        'cm; click it again to go back. Nothing else on the page moves.</span></div>' +
      '<div class="keyrow"><span class="keysym">PB</span><span><b>PB / most played</b> — which sensitivity your ' +
        'record was set at, and which one holds most of your runs.</span></div>' +
      '<div class="keyrow"><span class="keysym">record</span><span><b>record</b> — your best single run. It is ' +
        'shown but never turned into a percentage: the maximum of a sample rises as the sample grows, ' +
        'so "PB up 3%" can mean nothing more than "played more".</span></div>' +
      '<div class="keyrow"><span class="keysym">▲</span><span><b>avg up x% this session</b> — your average ' +
        'on that scenario has risen since this session started.</span></div>' +
      '<div class="keyrow"><span class="keysym">+n</span><span><b>scored 0</b> — runs that scored nothing, usually ' +
        'a NeverMiss that ended on the first shot. Drawn on the chart as hollow marks along the bottom, ' +
        'never counted in a percentage.</span></div>'
  },
  calendar: {
    title: 'Months',
    html:
      '<p>This month and the four before it.</p>' +
      '<h3>One number, not three</h3>' +
      '<p>Only <b>Typical</b> — the 10% trimmed mean — is shown per month. Ceiling (p90) and ' +
      'Floor (p10) are quantiles: they need more runs than a single month usually holds before ' +
      'they mean anything, so putting them here would be two confident-looking numbers next to ' +
      'one honest one.</p>' +
      '<h3>What it is measured against</h3>' +
      '<p>The month before it, through the same machinery as the rest of the page: compared within ' +
      'each scenario and each sensitivity, then combined weighted by how precise each comparison ' +
      'is. A month reading <b>within noise</b> has a confidence interval that spans zero — hover it ' +
      'for the actual figure. A dash means there were not enough comparable runs ' +
      'to say anything at all.</p>' +
      '<h3>The squares</h3>' +
      '<p>One per day, Monday first, shaded by how many runs you finished. A month you barely ' +
      'touched should look like one.</p>' +
      '<h3>New scenarios tried</h3>' +
      '<p>Scenarios you had <b>never</b> played before that month and played at least once during ' +
      'it. Counted across your whole history rather than the current filters — trying something ' +
      'for the first time is a fact about your month, not a measurement.</p>' +
      '<h3>PBs</h3>' +
      '<p>Runs that beat everything you had ever scored on that scenario. Your first ever run of ' +
      'something is not counted: there was nothing to beat.</p>' +
      '<p>Read it as a fun fact, not a measurement. A PB count rises with how much you play, and ' +
      'it rises fastest when you try new things — the second run of a brand new scenario beats the ' +
      'first almost every time. A month where you tried a lot of new scenarios will show a lot of ' +
      'PBs whether or not you got better at anything. The percentage above it is the one that ' +
      'controls for that.</p>'
  },
  scorebycm: {
    title: 'Score by cm',
    html:
      '<p>How your score moves as sensitivity changes can say something about what you are short of ' +
      '\u2014 arm stability, wrist control, micro speed. <b>What it says is whatever you wrote in ' +
      '<code>app/data/categories.md</code></b>. That file is plain text; edit it, reload, and the ' +
      'readings change. Nothing is hard-coded here.</p>' +
      '<h3>Two ways this chart lies, and what stops them</h3>' +
      '<p><b>Sample size.</b> A three-run sensitivity sitting next to a two-hundred-run one looks ' +
      'like a data point and is a rumour. A level needs <b>10+ runs</b> before it is drawn or used ' +
      'in any rule, and every point carries its 95% interval so you can see how much of the gap is ' +
      'real.</p>' +
      '<p><b>Time.</b> If you played 60cm in March and 52cm in August, what separates them is five ' +
      'months of practice, not eight centimetres. Overlap between your best level and the one you ' +
      'play most is measured, and said out loud when it is missing.</p>' +
      '<h3>The line above the readings</h3>' +
      '<p>Every interpretation rests on one comparison: your best-scoring sensitivity against the ' +
      'one you actually play. That comparison is stated with its interval before any rule fires. ' +
      'If the interval spans zero, what follows is a hypothesis, and the panel says so.</p>' +
      '<h3>Which direction is which</h3>' +
      '<p>cm/360 is how far the mouse travels for a full turn, so <b>a bigger number is a slower ' +
      'sensitivity</b>. 80cm is slower than 45cm. Every condition in the rules file reads that way.</p>' +
      '<h3>Extremes</h3>' +
      '<p>Below 25cm and above 80cm are excluded by default. They are usually a slider accident or ' +
      'a one-off experiment rather than a sensitivity you play. There is a toggle if you disagree.</p>' +
      '<h3>Still work in progress</h3>' +
      '<p>The rules file is mostly a template. And the honest way to measure this is a curated set ' +
      'of scenarios played deliberately across a spread of sensitivities \u2014 the baseline page, ' +
      'which is not built yet. Until then this reads whatever your normal play happens to contain, ' +
      'which was never designed to answer the question.</p>'
  },
  calc: {
    title: 'Calculation and reasoning',
    html:
      '<p>The short version. <code>CALCULATIONS.md</code> and <code>CHART-SCALING.md</code> in the ' +
      'app folder have the full working.</p>' +
      '<h3>Why not personal bests</h3>' +
      '<p>A PB is the maximum of <i>n</i> samples, and the expected maximum rises with <i>n</i> even ' +
      'when nothing about you has changed. Play more, PB more, learn nothing. So the record is shown ' +
      'and never turned into a percentage — instead its row shows how many standard deviations it ' +
      'sits from the maximum an unchanging player would be expected to reach from that many runs ' +
      'alone, using an exact table rather than the usual approximation, which is documented as ' +
      'unreliable at session-sized samples.</p>' +
      '<h3>The three numbers</h3>' +
      '<p><b>Ceiling</b> is the 90th percentile of your scores — a good day, not a fluke. ' +
      '<b>Typical</b> is a 10% trimmed mean: the best and worst tenth are dropped so one disaster or ' +
      'one miracle cannot move it. <b>Floor</b> is the 10th percentile — your bad days. The floor is ' +
      'the one that matters most: a rising floor is skill you own, a rising ceiling can be luck.</p>' +
      '<h3>Why sessions, not runs</h3>' +
      '<p>All three are computed on one value per play session (each session’s own trimmed mean), ' +
      'not on raw runs. Runs inside the same sitting share warm-up state, fatigue and mood, so they are ' +
      'not independent — treating them as if they were makes every confidence interval look several ' +
      'times tighter than it actually is. A session needs a handful of runs in it to count, and each ' +
      'figure is withheld until enough sessions exist.</p>' +
      '<h3>Why a change can be "not significant"</h3>' +
      '<p>Every percentage carries a 95% confidence interval. When that interval spans zero, the ' +
      'app does not print the number at all — it prints <b>within noise</b>, with the actual figure ' +
      'available on hover. Your data genuinely cannot distinguish it from noise, and being told ' +
      '"that is noise" is the point of this app.</p>' +
      '<h3>How many runs it takes</h3>' +
      '<p>Runs needed scales with the <i>square</i> of how noisy that scenario is for you: ' +
      '<code>n = 15.7 × (spread / effect)²</code>. A scenario with 4% spread needs about 10 runs a side ' +
      'to see a 5% change; one with 12% spread needs about 90. That is why one global "minimum runs" ' +
      'cannot be right, and why the warning symbol quotes a number per scenario.</p>' +
      '<h3>What is excluded</h3>' +
      '<p><b>Warm-up runs</b> — the first ~2 minutes of a session — are measurably lower (about 8% here) ' +
      'and are dropped by default — if ' +
      'your session lengths change between the two periods, that bias alone shows up as a fake skill ' +
      'change. <b>Re-familiarisation runs</b> after a long break are dropped for the same reason. ' +
      '<b>Restarts</b> never count: an abandoned attempt is not a run you played. <b>Zero-score runs</b> ' +
      'stay visible on the chart but out of every average — a NeverMiss zero is the moment you lost, ' +
      'not a level of performance.</p>' +
      '<h3>Sensitivity is not a detail</h3>' +
      '<p>Runs at different cm/360 are not the same distribution, so pooling them is treated as a bug. ' +
      'Comparisons are made within a sensitivity and then combined, weighted by how precise each one ' +
      'is.</p>' +
      '<h3>Why the charts look calm</h3>' +
      '<p>The y-axis is set from your <i>spread</i>, not from your best and worst run. Auto-fitting a ' +
      'chart to its own min and max stretches whatever variation exists to fill the frame, so a ' +
      'plateau and a breakthrough render identically. Here the vertical size of a change tracks its ' +
      'size in units of your own noise, and the shaded band is ±1σ: inside the band is a good day, ' +
      'clearing the band is progress.</p>' +
      '<h3>Sessions</h3>' +
      '<p>A new session starts after 30 minutes with no completed run — close the game, take a walk, ' +
      'or just stop for half an hour and the next run begins a new one. Sessions on the same day are ' +
      'counted together, with the breaks between them shown rather than hidden.</p>'
  }
};

// ---------------------------------------------------------------------------
// Notifications live ABOVE the page, not inside it.
//
// They used to be divs in the document flow, which meant every one of them
// pushed the page down as it appeared and yanked it back up when it went - and
// a notice that lands below the fold while you are reading a chart is not a
// notification, it is a surprise you find later. They are now a fixed overlay,
// bottom-right, over everything.
//
// The layer is created on demand rather than living in the markup, so every
// page gets it - index, simple, and the effects lab - without three copies of
// the same div.
// ---------------------------------------------------------------------------
const TOAST_DISMISSED = new Set();
function ensureToastLayer(){
  let l = document.getElementById('toastLayer');
  if(!l){
    l = document.createElement('div');
    l.id = 'toastLayer';
    l.className = 'toastlayer';
    l.setAttribute('role', 'status');
    l.setAttribute('aria-live', 'polite');
    document.body.appendChild(l);
  }
  return l;
}

// A second layer, in the middle of the viewport. Corner notices are things you
// glance at when you get round to it; a PB is the one event worth putting in
// front of your face. Both layers are position:fixed, so "the middle" means the
// middle of what you are looking at right now, whatever the page is scrolled to.
function ensureToastCenter(){
  let l = document.getElementById('toastCenter');
  if(!l){
    l = document.createElement('div');
    l.id = 'toastCenter';
    l.className = 'toastcenter';
    l.setAttribute('role', 'status');
    l.setAttribute('aria-live', 'polite');
    document.body.appendChild(l);
  }
  return l;
}

// Both layers, so a key can be found wherever it was put.
function findToast(key){
  const sel = '[data-key="' + CSS.escape(key) + '"]';
  return document.querySelector('#toastLayer ' + sel) ||
         document.querySelector('#toastCenter ' + sel);
}

// key   - one live toast per key; firing the same key again replaces it rather
//         than stacking six copies of "take a break".
// opts  - {kind:'warn'|'info'|'good'|'celebrate', ms:auto-dismiss (0 = sticky),
//          once:true = dismissing it silences that key for the session,
//          center:true = middle of the viewport instead of the corner}
function toast(key, html, opts){
  opts = opts || {};
  if(opts.once && TOAST_DISMISSED.has(key)) return null;
  const layer = opts.center ? ensureToastCenter() : ensureToastLayer();
  // Removed from wherever it currently is, not just from the layer it is about
  // to go into - otherwise the same key could end up living in both.
  const old = findToast(key);
  if(old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast toast-' + (opts.kind || 'info');
  el.dataset.key = key;
  el.innerHTML = '<div class="toast-body">' + html + '</div>' +
    '<button type="button" class="toast-x" aria-label="Dismiss">✕</button>';
  el.querySelector('.toast-x').addEventListener('click', () => {
    if(opts.once) TOAST_DISMISSED.add(key);
    closeToast(el);
  });
  layer.appendChild(el);
  // Two frames, so the browser has actually laid the element out before the
  // transition starts - otherwise it snaps in with no animation at all.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  if(opts.ms) setTimeout(() => closeToast(el), opts.ms);
  return el;
}
function closeToast(el){
  if(!el || !el.isConnected) return;
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => el.remove(), 260);
}
function dismissToast(key){
  closeToast(findToast(key));
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
  const t = achievementText(a);
  // Confetti is reserved for beating the scenario outright. A best-at-this-
  // sensitivity is real and worth saying, but there are as many of those as you
  // have sensitivities - if every one of them threw confetti across the whole
  // window, the whole-window confetti would stop meaning anything.
  const scenPb = a.kind === 'pb' && a.scope === 'scenario';
  toast('celebrate',
    '<div class="celebrate' + (scenPb ? ' big' : '') + '">' +
      '<div class="celebrate-in">' +
        '<div class="celebrate-t">' + (scenPb ? '🎉 ' : (a.kind === 'first' ? '⭐ ' : '★ ')) + t.title + '</div>' +
        '<div class="celebrate-s">' + t.sub + '</div>' +
      '</div>' +
    '</div>',
    {kind:'celebrate', ms: TUNING.CELEBRATE_MS, center: true});
  logMsg('achievement', {kind:a.kind, scope:a.scope, scen:a.scen, score:a.score});
  if(scenPb) runConfetti(fullScreenConfettiCanvas());
}

// The confetti used to be trapped inside the celebration card, which is a small
// box in a corner. A personal best gets the whole window.
function fullScreenConfettiCanvas(){
  const old = document.getElementById('confettiCanvas');
  if(old) old.remove();
  const cv = document.createElement('canvas');
  cv.id = 'confettiCanvas';
  cv.className = 'confetti-full';
  document.body.appendChild(cv);
  setTimeout(() => { if(cv.isConnected) cv.remove(); }, TUNING.CONFETTI_MS + 400);
  return cv;
}

// Small self-contained confetti - no library, works offline.
function runConfetti(cv){
  if(!cv) return;
  // Full-screen canvases have no meaningful parent box to measure, and a
  // devicePixelRatio-scaled backing store keeps the pieces crisp on a 4K panel.
  const full = cv.classList.contains('confetti-full');
  const rect = full ? {width: window.innerWidth, height: window.innerHeight}
                    : cv.parentElement.getBoundingClientRect();
  cv.width = Math.max(320, rect.width); cv.height = Math.max(90, rect.height);
  const ctx = cv.getContext('2d');
  const colors = ['#5fb98a','#4a9ee0','#e8c34a','#e08a3c','#c07be0'];
  const bits = [];
  // 90 pieces filled a small card; spread over a whole window they read as a
  // light drizzle. Scale with the area instead of picking a bigger constant.
  const count = full ? Math.min(420, Math.round(cv.width * cv.height / 4200)) : 90;
  // Full screen needs both a tighter start spread and more speed: pieces seeded
  // a whole 1080px above the fold, falling at card speed, leave the window
  // empty for the first two seconds of a ten-second celebration.
  const drop = full ? 2.4 : 1;
  for(let i=0;i<count;i++) bits.push({
    x: Math.random()*cv.width, y: -Math.random()*cv.height*(full ? 0.55 : 1),
    vx: (Math.random()-0.5)*1.6*drop, vy: (1.4 + Math.random()*2.4)*drop,
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
      b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.vy += 0.02*drop;
      // Over 10 seconds every piece would have fallen out of the card, leaving
      // an empty box for most of the celebration. Recycle them off the top
      // instead - unless we are already fading out, so the end stays clean.
      if(b.y - b.h > cv.height && fade === 1){
        b.y = -b.h; b.x = Math.random()*cv.width; b.vy = (1.4 + Math.random()*2.4)*drop;
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
  toast('break', '☕ <b>Take a break</b> — ' + esc(why) +
    '. Step away for a few minutes; aim is a focus skill and tired reps reinforce bad habits.',
    {kind:'warn'});
  logMsg('break reminder fired', why);
}
// Fires at most once per session (Batch 8) — renderSessionPanel re-runs on
// every poll tick, but re-showing this every 5s the whole time you're
// alt-tabbed would be its own kind of annoying.
let lowActiveNudgeShownFor = null;
let resetWarnShownFor = null;
function maybeFireLowActiveNudge(s){
  if(lowActiveNudgeShownFor === s.start.getTime()) return;
  const why = lowActiveDiagnosis(s);
  if(!why) return;
  lowActiveNudgeShownFor = s.start.getTime();
  toast('lowactive', '⏸ <b>Mostly idle this session</b> — ' + esc(why), {kind:'warn'});
  logMsg('low active-play nudge fired', {activePct: Math.round(s.activePct), spanSec: Math.round(s.spanSec)});
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
  if(!RUNS.length) return;
  const last = RUNS[RUNS.length-1].date.getTime();
  const idleMin = (Date.now() - last)/60000;
  if(idleMin >= 8 && idleMin < 25 && last > lastIdleNudge){
    lastIdleNudge = last;
    toast('idle', 'No completed run for ' + Math.floor(idleMin) +
      ' minutes. If you are restarting over and over, that is chasing an RNG PB rather than practising — ' +
      'let a run finish and read the score instead.', {kind:'warn', ms:45000});
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
  const todayBreak = today.reduce((a,x) => a + (x.breakBeforeSec || 0), 0);
  // Elapsed time comes from the PC clock while a session is still live. Reading
  // it off the last run's timestamp freezes the number the moment you stop
  // finishing runs, which is precisely when you want to watch it move.
  const liveMin = (Date.now() - now.getTime())/60000;
  const live = liveMin < TUNING.SESSION_GAP_MIN;
  SESSION_CLOCK.start = live ? s.start.getTime() : null;
  SESSION_CLOCK.playSec = s.playSec;
  const spanNow = live ? Math.max(s.spanSec, (Date.now() - s.start.getTime())/1000) : s.spanSec;
  const activeNow = spanNow > 0 ? Math.min(100, s.playSec/spanNow*100) : null;
  // Completed runs only, to match the Latest-session card. Restarts are
  // counted separately rather than inflating the day's total.
  const tRuns = today.reduce((a,x)=>a+x.completed,0);
  const tPlay = today.reduce((a,x)=>a+x.playSec,0);
  const tSpan = today.reduce((a,x)=>a+x.spanSec,0);

  const cov = s.durCoverage < 0.8
    ? '<p class="note" style="margin-top:8px">Run durations found for ' +
      Math.round(s.durCoverage*100) + '% of this session\'s runs; times are a lower bound.</p>' : '';
  const rush = rushDiagnosis(s);
  // Both of these are notifications, not readings, so they go over the page.
  // Once each per session: renderSessionPanel re-runs on every 5-second poll,
  // and re-showing the same warning forty times an hour is its own problem.
  const resetWarn = resetDiagnosis(s);
  if(resetWarn && resetWarnShownFor !== s.start.getTime()){
    resetWarnShownFor = s.start.getTime();
    toast('resetspam', esc(resetWarn), {kind:'warn'});
  }

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
      '<label class="chk followchk" title="Off: the panel stops naming what you are playing."><input type="checkbox" id="followScen"' +
      (followScen?' checked':'') + '> Follow current scenario</label>') + '</h3>' +
    (sessionCollapsed ? '' :
      nowPlaying +
      '<div class="cards" style="margin-bottom:0">' +
        card('Latest session', s.completed + ' runs') +
        card('Time in KovaaK\'s', fmtDur(spanNow), ' data-live="span"') +
        card('Actually playing', fmtDur(s.playSec) +
          (activeNow != null ? ' <span class="ci">(' + activeNow.toFixed(0) + '%)</span>' : ''),
          ' data-live="active"') +
        (s.breakBeforeSec != null
          ? card('Break before this', fmtDur(s.breakBeforeSec) +
              ' <span class="ci">(sitting ' + s.dayIndex + ' today)</span>')
          : '') +
        card('Median gap', s.medGap != null ? s.medGap.toFixed(1) + 's' : '—') +
        card('Scenarios', s.scens) +
        card('Today', tRuns + ' runs · ' + fmtDur(tPlay) + ' played' +
          (today.length > 1
            ? ' <span class="ci">(' + today.length + ' sittings, ' + fmtDur(todayBreak) + ' between)</span>'
            : '')) +
      '</div>' + cov +
      (rush ? '<p class="stalewarn">' + esc(rush) + '</p>' : '')) +
    '</div>';
  const t = document.getElementById('sessionToggle');
  if(t) t.addEventListener('click', () => { sessionCollapsed = !sessionCollapsed; renderSessionPanel(); });
  const f = document.getElementById('followScen');
  if(f) f.addEventListener('change', () => {
    followScen = f.checked; saveFollowScen();
    renderSessionPanel();
  });

  function card(k,v,attr){ return '<div class="card"'+(attr||'')+'><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }
}

// ---------------------------------------------------------------------------
// Live session clock. The two elapsed-time readouts are updated from the PC
// clock every second, and the whole panel is rebuilt once a minute so the
// numbers are re-validated against the actual run history rather than drifting
// on their own arithmetic forever.
// ---------------------------------------------------------------------------
const SESSION_CLOCK = {start:null, playSec:0, ticks:0};
function tickSessionClock(){
  if(!has('#sessionPanel') || !RUNS.length) return;
  const idleMin = (Date.now() - RUNS[RUNS.length-1].date.getTime())/60000;
  // Past the gap it is not one session any more, so stop counting.
  if(SESSION_CLOCK.start == null || idleMin >= TUNING.SESSION_GAP_MIN) return;
  if(++SESSION_CLOCK.ticks % 60 === 0){ renderSessionPanel(); return; }
  const span = (Date.now() - SESSION_CLOCK.start)/1000;
  const spanEl = document.querySelector('#sessionPanel [data-live="span"] .v');
  if(spanEl) spanEl.textContent = fmtDur(span);
  const actEl = document.querySelector('#sessionPanel [data-live="active"] .v');
  if(actEl && span > 0){
    const pct = Math.min(100, SESSION_CLOCK.playSec/span*100);
    actEl.innerHTML = fmtDur(SESSION_CLOCK.playSec) +
      ' <span class="ci">(' + pct.toFixed(0) + '%)</span>';
  }
}
setInterval(tickSessionClock, 1000);

// Called after the watcher pulls in new runs: surface what just landed so you
// can see the app reacting while you play, without hunting for it in the list.
function showLiveNote(sinceMs){
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
  // No "just played" pop-up. The session panel already carries the scenario,
  // the sensitivity and the score, it is on screen the whole time, and it does
  // not have to be dismissed. A notification that duplicates something already
  // visible is just something else to close.
  renderSessionPanel();
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

// One field, CSV-quoted only when it needs to be — same rule as RFC 4180.
function csvField(v){
  if(v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(cells){ return cells.map(csvField).join(','); }

// Everything a scenario's card shows, as two CSV tables in one file: the raw
// runs behind it, then every figure the card computed from them — so the
// app's own maths can be checked independently of trusting its display of it
// (Batch 11). Deliberately built from what's already in memory (the same `v`
// the card just rendered) rather than re-reading original CSVs: the fields
// that drops (accuracy/hits/TTK) feed none of the app's calculations, so they
// wouldn't add anything to audit.
async function exportScenario(key, btn){
  const rec = SCEN_EXPORT[key];
  if(!rec) return;
  const {scen, v, clusters} = rec;
  const runs = RUNS.filter(x => x.scen === scen)
                    .sort((a,b) => a.date - b.date);
  const lines = ['Runs', csvRow(['date', 'score', 'cm360', 'sensScale', 'duration_s', 'reset'])];
  runs.forEach(r => lines.push(csvRow([r.date.toISOString(), r.score, r.cm360, r.sensScale, r.dur, r.reset ? 1 : 0])));
  lines.push('', 'Calculations (this window)',
    csvRow(['metric', 'value', 'vs_baseline_pct', 'vs_baseline_se', 'early_baseline']));
  const stRow = (label, valueKey, changeKey) => {
    const chg = v[changeKey];
    lines.push(csvRow([label, v.st[valueKey],
      chg ? chg.pct : '', chg && chg.se != null ? chg.se : '', chg && chg.early ? 1 : '']));
  };
  lines.push(csvRow(['runs_in_window', v.st.n, '', '', '']));
  lines.push(csvRow(['record_PB', v.st.record, '', '', '']));
  stRow('ceiling_p90', 'ceiling', 'ceiling');
  stRow('typical_trimmed', 'typical', 'typical');
  stRow('floor_p10', 'floor', 'floor');
  lines.push(csvRow(['mean', v.st.mean, '', '', '']));
  lines.push(csvRow(['median', v.st.med, '', '', '']));
  lines.push(csvRow(['spread_cv_pct', v.st.cv, '', '', '']));
  lines.push(csvRow(['n_required_per_side', v.nRequired, '', '', '']));
  lines.push(csvRow(['powered', v.powered ? 1 : 0, '', '', '']));
  lines.push('', 'Per-cm-cluster cells',
    csvRow(['cm_cluster', 'n_window', 'n_baseline', 'ceiling_pct', 'typical_pct', 'floor_pct', 'powered']));
  v.cells.forEach(c => {
    const label = c.cluster >= 0 && clusters[c.cluster] ? clusters[c.cluster].label : 'all cm';
    lines.push(csvRow([label, c.w.n, c.b.n,
      c.ceiling ? c.ceiling.pct : '', c.typical ? c.typical.pct : '', c.floor ? c.floor.pct : '',
      c.powered ? 1 : 0]));
  });
  const label = btn.textContent;
  try {
    const resp = await fetch('api/export', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({scenario: scen, csv: lines.join('\n')})
    });
    btn.textContent = resp.ok ? 'Exported ✓' : 'Export failed';
  } catch(e){
    btn.textContent = 'Export failed';
  }
  setTimeout(() => { btn.textContent = label; }, 1800);
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

// CALCULATIONS-V4 §10.1 step 1: "use the suite's own normalised per-scenario
// scoring, not raw scores." A suite's scenarios have wildly different raw
// score scales (90 on a switching scenario, 22000 on a tracking one), so they
// cannot be averaged directly. Rank thresholds are the suite's own common
// scale: this maps a raw score onto a continuous "rank index" - 0 at the
// lowest named rank's threshold, 1 at the next, and so on, linearly
// interpolated between adjacent thresholds and linearly extrapolated past
// both ends using the nearest interval's slope (so a score just short of the
// bottom rank, or above the top one, still gets a value rather than null).
function rankIndexValue(score, ranks){
  if(score == null || !ranks || ranks.length < 2) return null;
  const n = ranks.length;
  if(score <= ranks[0].t){
    const slope = ranks[1].t - ranks[0].t;
    return slope ? (score - ranks[0].t) / slope : 0;
  }
  if(score >= ranks[n-1].t){
    const slope = ranks[n-1].t - ranks[n-2].t;
    return slope ? (n-1) + (score - ranks[n-1].t) / slope : n-1;
  }
  for(let i=0; i<n-1; i++){
    if(score >= ranks[i].t && score <= ranks[i+1].t){
      const slope = ranks[i+1].t - ranks[i].t;
      return slope ? i + (score - ranks[i].t) / slope : i;
    }
  }
  return null;
}

// Every pool run that lands on one of this suite's scenarios, converted to
// its rank-index value (step 1). `r.sessId`/`r.date` ride along for steps 2-3.
function benchmarkNormalizedRuns(b, pool){
  const rankMap = new Map(b.scenarios.map(sc => [sc.n.trim().toLowerCase(), sc.r]));
  const out = [];
  pool.forEach(r => {
    const ranks = rankMap.get(r.scen.trim().toLowerCase());
    if(!ranks) return;
    const v = rankIndexValue(r.score, ranks);
    if(v == null) return;
    out.push({date: r.date, scen: r.scen, sessId: r.sessId, v});
  });
  return out;
}

// §10.1 steps 2-3: reduce each scenario's session to one value (trimmed mean
// of its rank-index runs - same rule sessionValues() uses for a single
// scenario's raw scores), then average across every scenario played in that
// session into one suite-level session value. Unweighted by how many
// scenarios or runs fed a session - §3.1's "session values enter unweighted"
// applies at the suite level too, not just within a cell.
function benchmarkSessionValues(normRuns){
  const byScenSess = new Map();
  normRuns.forEach(r => {
    if(r.sessId == null) return;
    const key = r.scen + '|' + r.sessId;
    if(!byScenSess.has(key)) byScenSess.set(key, []);
    byScenSess.get(key).push(r.v);
  });
  const bySess = new Map();
  byScenSess.forEach((vals, key) => {
    if(vals.length < TUNING.SESSION_MIN_RUNS) return;
    const sessId = key.slice(key.lastIndexOf('|')+1);
    const sv = trimmedMean(vals.slice().sort((a,b)=>a-b), TUNING.TRIM_FRACTION);
    if(!bySess.has(sessId)) bySess.set(sessId, []);
    bySess.get(sessId).push(sv);
  });
  return [...bySess.values()].map(vals => mean(vals));
}

// §10.1 step 4: "apply §4 estimators, §5 rendering as normal" - once suite
// runs are reduced to one rank-index session value each, this is exactly the
// shape computeCells() feeds stats()/changeWithSE() for a single cell, so the
// same estimators (Harrell-Davis ceiling/floor with n-matching, trimmed-mean
// typical, noise-gated rendering) apply unchanged. No cm-cluster split here -
// the suite aggregate is deliberately basket-level, not cell-level; the
// caller's `pool` already carries whatever cm filter is active app-wide.
function computeBenchmarkAggregate(normRuns, windowStart, windowEnd, cmpMode){
  if(!normRuns.length) return null;
  const winLen = windowEnd.getTime() - windowStart.getTime();
  const baseStart = new Date(windowStart.getTime() - winLen);
  const mid = new Date(windowStart.getTime() + winLen/2);
  const winRuns = [], baseRuns = [];
  normRuns.forEach(r => {
    const t = r.date;
    if(cmpMode === 'prev'){
      if(t >= windowStart && t <= windowEnd) winRuns.push(r);
      else if(t >= baseStart && t < windowStart) baseRuns.push(r);
    } else {
      if(t >= mid && t <= windowEnd) winRuns.push(r);
      else if(t >= windowStart && t < mid) baseRuns.push(r);
    }
  });
  const wSess = stats(benchmarkSessionValues(winRuns), SESS_THRESH, true);
  const bSess = stats(benchmarkSessionValues(baseRuns), SESS_THRESH, true);
  const chronological = [...normRuns].sort((a,b)=>a.date-b.date).map(r=>r.v);
  const fallback = earlyBaseline(chronological);
  return {
    n: normRuns.length,
    scenariosPlayed: new Set(normRuns.map(r=>r.scen)).size,
    wSessN: wSess.n, bSessN: bSess.n,
    ceiling: changeWithSE(wSess, bSess, 'ceiling', fallback),
    typical: changeWithSE(wSess, bSess, 'typical', fallback),
    floor:   changeWithSE(wSess, bSess, 'floor', fallback)
  };
}

// ---------------------------------------------------------------------------
// Attribution with negative controls (CALCULATIONS-V4 §10.3)
// "Did playing X help Y?" is causal inference from observational data.
// Sessions with more of X are also sessions where you had time, were rested,
// were motivated, and played five other things — and reverse causation is
// live too (people play a scenario more once they're already improving on
// it). Every guard below exists to keep the feature honest about that, not
// to make it look more certain than it is:
//   - lagged, never contemporaneous: this week's dose against NEXT week's
//     change, never the same week's — a same-week read just measures "busy
//     weeks have more of everything."
//   - dose-response, not a single contrast: a Spearman rank correlation over
//     every lagged week pair, so a single lucky split can't manufacture it.
//     Spearman rather than a fixed bucket count because most scenarios don't
//     have enough weeks played to fill 3+ buckets with anything - a rank
//     correlation uses every week it has instead of throwing most away.
//   - negative controls, mandatory: the identical test run against
//     NEG_CONTROL_N scenarios picked without any regard to plausibility (see
//     pickNegControls), and every candidate is reported as where it falls
//     against that null, never on its own.
//   - no significance claims: n_comparisons is reported, nothing is ranked
//     by a p-value, and a candidate isn't even listed unless its implied
//     effect clears the app's existing smallest-worthwhile-change bar
//     (TUNING.TARGET_EFFECT — the same one requiredN()/powered already use,
//     not a new threshold invented for this one feature).
// A scenario that is itself part of the target benchmark is excluded from
// candidacy — testing whether playing a benchmark scenario moved that same
// benchmark isn't attribution, it's the definition of practice.
// ---------------------------------------------------------------------------

function weekKey(d){
  const day = (d.getDay() + 6) % 7; // Monday = 0, so week boundaries don't drift with locale
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

// §10.1 steps 2-3's own session-then-scenario reduction (benchmarkSessionValues),
// kept split by the calendar week each session's first run falls in instead of
// collapsed to one number — this is the outcome series (Y) the dose-response
// test regresses against.
function weeklyOutcome(normRuns){
  // Keyed by scen+'|'+sessId (a session can hold several scenarios) but the
  // value carries sessId back out as its native number — string-slicing it
  // back out of the key would silently mismatch sessDate's numeric keys below.
  const byScenSess = new Map(), sessDate = new Map();
  normRuns.forEach(r => {
    if(r.sessId == null) return;
    const key = r.scen + '|' + r.sessId;
    if(!byScenSess.has(key)) byScenSess.set(key, {sessId: r.sessId, vals: []});
    byScenSess.get(key).vals.push(r.v);
    if(!sessDate.has(r.sessId) || r.date < sessDate.get(r.sessId)) sessDate.set(r.sessId, r.date);
  });
  const bySess = new Map();
  byScenSess.forEach(({sessId, vals}) => {
    if(vals.length < TUNING.SESSION_MIN_RUNS) return;
    const sv = trimmedMean(vals.slice().sort((a,b)=>a-b), TUNING.TRIM_FRACTION);
    if(!bySess.has(sessId)) bySess.set(sessId, []);
    bySess.get(sessId).push(sv);
  });
  const byWeek = new Map();
  bySess.forEach((vals, sessId) => {
    const wk = weekKey(sessDate.get(sessId));
    if(!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(mean(vals));
  });
  const out = new Map();
  byWeek.forEach((vals, wk) => out.set(wk, mean(vals)));
  return out;
}

// Dose = a scenario's share of that week's total play time (sum of r.dur),
// not raw minutes — a week where X was most of a light week and a week
// where X was most of a heavy week both read as "high dose". That's what
// "controlling total volume" comes down to without a real regression
// library on hand: the share is close to orthogonal to how much you played
// overall that week, which a raw-minutes dose would not be.
function weeklyDose(scen, runs){
  const tot = new Map(), scenT = new Map();
  runs.forEach(r => {
    const wk = weekKey(r.date), dur = r.dur || 0;
    tot.set(wk, (tot.get(wk)||0) + dur);
    if(r.scen === scen) scenT.set(wk, (scenT.get(wk)||0) + dur);
  });
  const out = new Map();
  tot.forEach((t, wk) => { if(t > 0) out.set(wk, (scenT.get(wk)||0) / t); });
  return out;
}

function rankArray(a){
  const idx = a.map((_,i)=>i).sort((i,j)=>a[i]-a[j]);
  const ranks = new Array(a.length);
  let i = 0;
  while(i < idx.length){
    let j = i;
    while(j+1 < idx.length && a[idx[j+1]] === a[idx[i]]) j++;
    const avgRank = (i+j)/2 + 1;
    for(let k=i; k<=j; k++) ranks[idx[k]] = avgRank;
    i = j+1;
  }
  return ranks;
}
function pearson(a, b){
  const n = a.length;
  if(n < 2) return null;
  const ma = mean(a), mb = mean(b);
  let num=0, da=0, db=0;
  for(let i=0;i<n;i++){ const xa=a[i]-ma, xb=b[i]-mb; num+=xa*xb; da+=xa*xa; db+=xb*xb; }
  return (da===0 || db===0) ? null : num/Math.sqrt(da*db);
}
function spearman(a, b){ return (a.length===b.length && a.length>=2) ? pearson(rankArray(a), rankArray(b)) : null; }
function olsSlope(xs, ys){
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)**2; }
  return den ? num/den : null;
}

const WEEK_MS = 7*864e5;

// Builds the lagged (dose in week t) -> (outcome change t -> t+1) pairs for
// one scenario against one outcome series, and reduces them to the single
// statistic used both for ranking candidates and for the negative-control
// null: the Spearman correlation between dose and next-week change (itself a
// monotonicity/dose-response test), plus an implied effect size for the SWC
// gate — the predicted swing in outcome between a light and a heavy week on
// this scenario, expressed as a % of the average outcome level the same way
// every other change figure in this app is (changeWithSE's own convention).
function doseResponseTest(doseByWeek, outcomeByWeek){
  const doses = [], deltas = [];
  outcomeByWeek.forEach((yNext, wk) => {
    const wkPrev = wk - WEEK_MS;
    const yPrev = outcomeByWeek.get(wkPrev);
    const dose = doseByWeek.get(wkPrev);
    if(yPrev == null || dose == null) return;
    doses.push(dose);
    deltas.push(yNext - yPrev);
  });
  if(doses.length < TUNING.ATTRIB_MIN_WEEKS) return null;
  const corr = spearman(doses, deltas);
  if(corr == null) return null;
  const slope = olsSlope(doses, deltas);
  const sortedDoses = doses.slice().sort((a,b)=>a-b);
  const iqr = quantileAt(sortedDoses, 0.75) - quantileAt(sortedDoses, 0.25);
  const meanY = mean([...outcomeByWeek.values()]);
  const effectPct = (slope != null && meanY > 0) ? slope * iqr / meanY * 100 : null;
  return {corr, nWeeks: doses.length, effectPct};
}

// "10 scenarios with no plausible relationship" has no algorithmic
// plausibility test to run, so plausibility is deliberately not the
// selection criterion here — an evenly-spaced sample across the alphabet is
// arbitrary with respect to the results being tested, which is the property
// that actually matters for a null: it wasn't picked because it looked
// related (or unrelated). One shared pool is picked per computation (not
// re-picked per candidate), so every candidate is read against the same
// reference distribution.
function pickNegControls(scens, n){
  const pool = scens.slice().sort();
  if(pool.length <= n) return pool;
  const stride = pool.length / n;
  const out = [];
  for(let i=0; i<n; i++) out.push(pool[Math.min(pool.length-1, Math.floor(i*stride))]);
  return [...new Set(out)];
}

// Ties the pieces above together into the ranked candidate list §10.3 wants:
// every eligible scenario tested, a shared negative-control null built from
// an arbitrary slice of that same eligible set, each candidate reported as a
// percentile against that null, and nothing listed unless it also clears the
// SWC. `bench` is the same benchmark object driving the headline aggregate
// (§10.1) — Y is that benchmark's weekly outcome level, so "moving it" means
// moving the app's own primary metric, not an arbitrary pick.
function computeAttribution(bench, normRuns, allRuns){
  if(!bench || !normRuns.length) return null;
  const outcomeByWeek = weeklyOutcome(normRuns);
  if(outcomeByWeek.size < TUNING.ATTRIB_MIN_WEEKS + 1) return null;

  const benchScens = new Set(bench.scenarios.map(sc => sc.n.trim().toLowerCase()));
  const scenSeen = new Set();
  allRuns.forEach(r => { if(!benchScens.has(r.scen.trim().toLowerCase())) scenSeen.add(r.scen); });

  const results = new Map();
  scenSeen.forEach(scen => {
    const test = doseResponseTest(weeklyDose(scen, allRuns), outcomeByWeek);
    if(test) results.set(scen, test);
  });
  const tested = [...results.keys()];
  if(!tested.length) return null;

  const negControls = pickNegControls(tested, TUNING.NEG_CONTROL_N);
  const nullCorrs = negControls.map(s => results.get(s).corr);
  const percentileOf = (scen, r) => {
    const pool = nullCorrs.filter((_, i) => negControls[i] !== scen);
    if(!pool.length) return null;
    return pool.filter(v => v <= r).length / pool.length * 100;
  };

  const candidates = tested.map(scen => {
    const t = results.get(scen);
    return {scen, effectPct: t.effectPct, nWeeks: t.nWeeks, percentile: percentileOf(scen, t.corr)};
  })
  .filter(c => c.effectPct != null && c.percentile != null && Math.abs(c.effectPct) > TUNING.TARGET_EFFECT)
  .sort((a,b) => b.percentile - a.percentile || Math.abs(b.effectPct) - Math.abs(a.effectPct));

  return {benchName: bench.name, nComparisons: tested.length, negControlN: negControls.length, candidates: candidates.slice(0, 8)};
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

// Chips are a per-card toggle: click one and only THIS scenario narrows to that
// sensitivity, click it again and the card goes back to all of them. It used to
// drive the app-wide Specific-cm filter, so asking "how do I do at 45cm here?"
// silently re-filtered every other scenario on the page as well.
function cmDotLegend(rs, pinnedCm){
  const p = cmProfile(rs);
  if(!p) return '';
  const multi = p.buckets.length > 1;
  return '<div class="cmlegend">'+p.buckets.map(b => {
    const n = p.counts.get(b);
    const isMost = multi && p.most && b === p.most.cm;
    const isPb   = multi && b === p.pbCm;
    const on     = pinnedCm === b;
    const tags = (isMost ? '<b class="cmtag most">most played</b>' : '') +
                 (isPb   ? '<b class="cmtag pb">PB</b>' : '');
    return '<span class="cmchip'+(on?' on':'')+'" data-cm="'+b+'" tabindex="0" role="button" aria-pressed="'+
      (on?'true':'false')+'" title="'+n+' run'+(n===1?'':'s')+' at '+b+'cm'+
      (isMost ? ' — more than at any other sensitivity' : '')+
      (isPb ? ' — your record on this scenario was set here' : '')+
      (on ? ' — this card is showing only '+b+'cm. Click to show every cm again.'
          : ' — click to show only '+b+'cm on this card. Nothing else on the page moves.')+'">'+
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

// legendRs is the scenario's full run list even when rsAll has been filtered to
// one cm, so the chips never disappear out from under the filter that made them.
// ---------------------------------------------------------------------------
// Chart hover.
//
// A native title= would have done, except for two things the user actually
// asked about: it waits about a second before appearing, and it only fires when
// the pointer is genuinely over a 2px circle. Both are fixed here - the points
// are matched by nearest-neighbour inside a ~26px grab radius, so you aim at a
// region rather than at a dot, and the panel appears in a few tens of ms.
//
// Point data lives in a map keyed by the chart's id rather than in data-
// attributes: a 200-run chart would otherwise carry 15KB of JSON in its markup,
// times however many cards are open.
// ---------------------------------------------------------------------------
const SPARK_PTS = new Map();
let sparkSeq = 0;
const SPARK_GRAB_PX = 26;   // how close is close enough, in screen pixels
const SPARK_DELAY_MS = 45;  // vs roughly 1000ms for a browser tooltip

function sparkRegister(entry){
  const id = 'spark' + (++sparkSeq);
  SPARK_PTS.set(id, entry);
  // Charts are re-rendered wholesale, so old ids simply stop existing. Rather
  // than depending on a frame callback to notice - which never fires in a
  // background tab - cap the map: insertion order means the oldest are the
  // dead ones.
  while(SPARK_PTS.size > 120) SPARK_PTS.delete(SPARK_PTS.keys().next().value);
  return id;
}

let sparkTipEl = null, sparkTipTimer = 0, sparkTipFor = null;

function sparkTipNode(){
  if(!sparkTipEl){
    sparkTipEl = document.createElement('div');
    sparkTipEl.className = 'sparktip';
    sparkTipEl.hidden = true;
    document.body.appendChild(sparkTipEl);
  }
  return sparkTipEl;
}

function hideSparkTip(){
  clearTimeout(sparkTipTimer);
  sparkTipFor = null;
  if(sparkTipEl) sparkTipEl.hidden = true;
  document.querySelectorAll('svg.spark .sparkhl').forEach(c => c.setAttribute('opacity','0'));
}

function sparkTipHtml(pt){
  const d = new Date(pt.t);
  const pad = n => (n<10?'0':'') + n;
  const when = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()) +
               ' · ' + pad(d.getHours())+':'+pad(d.getMinutes());
  if(pt.zero){
    return '<div class="stt">Scored 0</div><div class="sts">'+when+'</div>' +
      '<div class="sts">Drawn so you can see it happened — kept out of every average.</div>';
  }
  const bits = [];
  if(pt.cm != null) bits.push(Math.round(pt.cm)+'cm/360');
  if(pt.dur) bits.push(Math.round(pt.dur)+'s');
  bits.push('run '+pt.i+' of '+pt.n);
  const vs = (pt.typ && pt.typ > 0)
    ? (() => { const p = (pt.score - pt.typ)/pt.typ*100;
               return '<div class="sts '+(p>=0?'up':'dn')+'">'+(p>=0?'+':'')+p.toFixed(1)+
                      '% vs typical ('+fmt(pt.typ)+')</div>'; })()
    : '';
  return '<div class="stt">'+fmt(pt.score)+
      (pt.pb ? ' <span class="sttpb">new PB</span>' : '')+'</div>'+
    '<div class="sts">'+when+'</div>'+
    '<div class="sts">'+bits.join(' · ')+'</div>'+vs;
}

function onSparkMove(e){
  const svg = e.target.closest ? e.target.closest('svg.spark') : null;
  if(!svg){ if(sparkTipFor) hideSparkTip(); return; }
  const d = SPARK_PTS.get(svg.id);
  if(!d || !d.pts.length) return;
  const box = svg.getBoundingClientRect();
  if(!box.width) return;
  const k = d.w / box.width;                       // viewBox units per screen px
  const vx = (e.clientX - box.left) * k, vy = (e.clientY - box.top) * k;
  const grab = SPARK_GRAB_PX * k;
  let bestPt = null, bestD = grab*grab;
  for(const p of d.pts){
    const dx = p.cx - vx, dy = p.cy - vy, q = dx*dx + dy*dy;
    if(q <= bestD){ bestD = q; bestPt = p; }
  }
  if(!bestPt){ if(sparkTipFor) hideSparkTip(); return; }

  const key = svg.id + ':' + bestPt.cx + ':' + bestPt.cy;
  const node = sparkTipNode();
  const show = () => {
    node.innerHTML = sparkTipHtml(bestPt);
    node.hidden = false;
    // Ring the point being read, so there is no doubt which one it is.
    const hl = svg.querySelector('.sparkhl');
    if(hl){
      hl.setAttribute('cx', bestPt.cx); hl.setAttribute('cy', bestPt.cy);
      hl.setAttribute('opacity', '.85');
    }
    // Placed clear of the cursor, and flipped rather than clipped at an edge.
    const r = node.getBoundingClientRect();
    let left = e.clientX + 16, top = e.clientY + 16;
    if(left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 16;
    if(top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 16;
    node.style.left = Math.max(8, left) + 'px';
    node.style.top = Math.max(8, top) + 'px';
  };
  if(sparkTipFor === key){ show(); return; }   // already up: follow instantly
  sparkTipFor = key;
  clearTimeout(sparkTipTimer);
  sparkTipTimer = setTimeout(show, node.hidden ? SPARK_DELAY_MS : 0);
}

document.addEventListener('mousemove', onSparkMove, {passive:true});
document.addEventListener('mouseleave', hideSparkTip);
window.addEventListener('scroll', hideSparkTip, {passive:true, capture:true});

function spark(rsAll, byCm, legendRs, pinnedCm, trading){
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

  // Every plotted run is also registered as a hover target. The dots stay 2px -
  // making them big enough to hit reliably would turn a 200-run chart into a
  // smear - so the grab radius is done in the pointer handler instead, where it
  // can be far larger than the mark it belongs to.
  const typ = sc.length >= TUNING.TYPICAL_MIN_N
    ? trimmedMean([...sc].sort((a,b)=>a-b), TUNING.TRIM_FRACTION) : null;
  const hover = [];
  let runningBest = -Infinity;
  const dots = rs.map((r,i)=>{
    const useCm = byCm && r.cm360!=null;
    const fill = useCm ? cmColor(Math.round(r.cm360)) : 'currentColor';
    const op = useCm ? '.8' : '.32';
    const rad = useCm ? 2.1 : 1.4;
    const wasPb = r.score > runningBest && i > 0;
    if(r.score > runningBest) runningBest = r.score;
    hover.push({cx:+x(i).toFixed(1), cy:+y(r.score).toFixed(1), c:fill,
                score:r.score, t:r.date.getTime(), cm:r.cm360, dur:r.dur,
                i:i+1, n:rs.length, pb:wasPb, typ});
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
    hover.push({cx:+x(at).toFixed(1), cy:+(H-P-2).toFixed(1), c:'var(--low)',
                score:0, t:z.date.getTime(), cm:z.cm360, dur:z.dur, zero:true});
    return '<circle cx="'+x(at).toFixed(1)+'" cy="'+(H-P-2).toFixed(1)+'" r="2.6" fill="none" '+
      'stroke="var(--low)" stroke-width="1.2" opacity=".65"/>';
  }).join('');

  // Trading lines (off by default, one toggle): a trader's-eye read laid over
  // the chart's own smoothed stats. Two trendlines run from your first run's
  // score (the only "top"/"low" you had at the start) to the run that set
  // your current all-time best/worst - wherever that landed - then project
  // across the FULL chart width rather than stopping at those two points, the
  // way a trendline through swing highs/lows gets extended on a price chart.
  // If the record was set on run 1 and never touched again, both anchors are
  // the same point and the line is flat, which is itself the honest read: it
  // has stood the whole time. The third line is no model at all, just every
  // run connected in order, for when the smoothing above is hiding the shape
  // of the noise itself.
  let tradingEls = '';
  if(trading && rs.length > 1){
    const xLo = PL, xHi = W-P;
    const angleOf = m => Math.atan2(-m, 1) * 180 / Math.PI;
    const trendLine = (i1, v1, i2, v2, color) => {
      const x1 = x(i1), y1 = y(v1), x2 = x(i2), y2 = y(v2);
      const m = Math.abs(x2 - x1) < 1e-6 ? 0 : (y2 - y1) / (x2 - x1);
      const b = y1 - m * x1;
      const yLo = m*xLo + b, yHi = m*xHi + b;
      const angle = angleOf(m);
      return '<path d="M'+xLo.toFixed(1)+','+yLo.toFixed(1)+'L'+xHi.toFixed(1)+','+yHi.toFixed(1)+
        '" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>'+
        '<text x="'+(xHi-4).toFixed(1)+'" y="'+(yHi-6).toFixed(1)+'" text-anchor="end" font-size="11" fill="'+color+'">'+
        (angle>0?'+':'')+angle.toFixed(1)+'°</text>';
    };
    const maxScore = Math.max(...sc), minScore = Math.min(...sc);
    const topIdx = sc.indexOf(maxScore), lowIdx = sc.indexOf(minScore);
    const rawPts = sc.map((v,i) => (i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)).join('');
    tradingEls =
      '<path d="'+rawPts+'" fill="none" stroke="var(--raw)" stroke-width="1" opacity=".55" vector-effect="non-scaling-stroke"/>'+
      trendLine(0, sc[0], topIdx, maxScore, 'var(--tophi)') +
      trendLine(0, sc[0], lowIdx, minScore, 'var(--lowlo)');
  }

  const sparkId = sparkRegister({w:W, h:H, pts:hover});
  return '<svg id="'+sparkId+'" class="spark" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Score over time with individual runs, a one-sigma noise band, PB steps, rolling median and rolling bottom ten percent" style="color:var(--ink3)">'+
    ticks + band + dots + zeroMarks +
    '<path d="'+pb+'" fill="none" stroke="var(--best)" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/>'+
    '<path d="'+low+'" fill="none" stroke="var(--low)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'+
    '<path d="'+med+'" fill="none" stroke="var(--med)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'+
    tradingEls +
    // Last, so the ring round the run you are reading sits on top of everything.
    '<circle class="sparkhl" r="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0"/></svg>'+
    scaleNote(s, zeros.length) +
    (byCm ? cmDotLegend(legendRs || rsAll, pinnedCm) : '');
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
// ---- menu bar and drawer wiring -------------------------------------------
if(has('#menubar')){
  $('#menubar').addEventListener('click', e => {
    const b = e.target.closest('.menubtn');
    if(!b) return;
    if(b.dataset.doc){
      const d = SIDETAB_DOCS[b.dataset.doc];
      if(d) openSideTab(d.title, d.html, b);
      return;
    }
    if(b.dataset.goto){
      const el = document.getElementById(b.dataset.goto);
      if(!el) return;
      // On a wide screen the calendar is already in the right-hand column, so
      // scrolling would be a jump to nowhere; flag it instead. On a narrow one
      // it is inline below the list, and this is how you reach it.
      const r = el.getBoundingClientRect();
      const onScreen = r.top < window.innerHeight * 0.9 && r.bottom > 60;
      if(!onScreen) el.scrollIntoView({behavior:'smooth', block:'start'});
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  });
}
if(has('#calendarWrap')){
  $('#calendarWrap').addEventListener('click', e => {
    if(e.target.id === 'calExplain'){
      const d = SIDETAB_DOCS.calendar;
      openSideTab(d.title, d.html, null);
    }
  });
}
if(has('#sidetabClose')) $('#sidetabClose').addEventListener('click', closeSideTab);
if(has('#sidetabScrim')) $('#sidetabScrim').addEventListener('click', closeSideTab);
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeSideTab(); });

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
if(has('#tradingLines')) $('#tradingLines').addEventListener('change', () => { tradingLines = $('#tradingLines').checked; render(); });
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
if(has('#benchHeadlinePick')){
  $('#benchHeadlinePick').addEventListener('change', e => {
    lsSet('kva_headline_bench', e.target.value);
    render();
  });
}
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
  // render() rebuilds the whole list, so a card that just grew (or shrank) can
  // end up off screen. Put it back under the cursor afterwards.
  const keepInView = key => {
    render();
    const el = document.querySelector('.scen[data-scen="' + CSS.escape(key) + '"]');
    if(el) el.scrollIntoView({block:'nearest'});
  };
  if(e.target.closest('.cmWhy')){
    const d = SIDETAB_DOCS.scorebycm;
    openSideTab(d.title, d.html, null);
    return;
  }
  const cmBtn = e.target.closest('.cmToggle');
  if(cmBtn){
    const key = cmBtn.dataset.scen;
    if(cmPanelOpen.has(key)) cmPanelOpen.delete(key); else cmPanelOpen.add(key);
    keepInView(key);
    return;
  }
  const warnBtn = e.target.closest('.scenWarn');
  if(warnBtn){
    const c = SCEN_CAVEATS[warnBtn.dataset.scen];
    if(c) openSideTab(c.title, c.html, warnBtn);
    return;
  }
  const exportBtn = e.target.closest('.exportBtn');
  if(exportBtn){
    exportScenario(exportBtn.dataset.scen, exportBtn);
    return;
  }
  const card = e.target.closest('.scen[data-scen]');
  const key = card && card.dataset.scen;
  if(!key) return;
  if(e.target.closest('.cmpin')){
    scenCm.delete(key);
    keepInView(key);
    return;
  }
  const chip = e.target.closest('.cmchip');
  if(chip){
    const cm = +chip.dataset.cm;
    // Toggle, and scoped to this one card.
    if(scenCm.get(key) === cm) scenCm.delete(key); else scenCm.set(key, cm);
    keepInView(key);
  }
});

// The category picker and the extremes toggle are form controls, so they need
// change rather than click - delegated onto the same never-replaced wrapper.
$('#list').addEventListener('change', e => {
  const sel = e.target.closest('.cmCatSel');
  if(sel){
    saveScenCat(sel.dataset.scen, sel.value);
    render();
    return;
  }
  if(e.target.closest('.cmExtremeChk')){
    cmExtremes = e.target.checked;
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
  // The effects lab is a workbench for animations and notifications. It ships
  // with every build (it is tiny, and being able to check a frozen release's
  // animations is the point) but only a dev build links to it.
  if(label === 'dev' && !document.getElementById('labLink')){
    $('#buildStamp').insertAdjacentHTML('beforeend',
      ' · <a id="labLink" href="lab.html">effects lab</a>');
  }
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
  // lab.html loads this file for the real celebrate/nudge/chart code and then
  // drives it with synthetic runs. Booting would fetch the config, pull 20k runs
  // and start the 5-second watcher poll, none of which the workbench wants.
  if(typeof window !== 'undefined' && window.KVA_LAB) return;
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
  // Plain text, read at load. Edit app/data/categories.md, reload, done - which
  // is the whole point of it being a text file and not a code table.
  try{
    const rc = await fetch('data/categories.md', {cache:'no-store'});
    if(rc.ok) CATEGORY_RULES = parseCategoryRules(await rc.text());
  }catch(err){ /* the score-by-cm panel says so if this is missing */ }
  logMsg('app start', {page: location.pathname.split('/').pop() || 'index.html', serverMode: SERVER_MODE,
                       benchmarks: BENCH_DATA.length,
                       cmRules: CATEGORY_RULES ? CATEGORY_RULES.reduce((a,e)=>a+e.rules.length,0) : 'none'});
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

  // betaInc: I_x(1,1) is just the uniform CDF, x itself; and the reflection
  // identity I_x(a,b) = 1 - I_(1-x)(b,a) holds for any a,b.
  t('betaInc(x,1,1) = x', betaInc(0.37, 1, 1), 0.37);
  t('betaInc reflection identity', betaInc(0.3, 2, 5) + betaInc(0.7, 5, 2), 1);
  // hdQuantile weights always sum to 1 (telescoping I_beta from 0 to 1), so a
  // constant array's weighted average is exactly that constant regardless of
  // p or n - a hand-derivable check that doesn't depend on the beta-function
  // internals being exactly right, just complete.
  t('hdQuantile of a constant is that constant', hdQuantile(FLAT, 0.90), 100);
  t('hdQuantile of a constant is that constant (p10)', hdQuantile(FLAT, 0.10), 100);
  // A symmetric sample with the median's symmetric weights averages to the mean.
  t('hdQuantile p50 of a symmetric sample is the mean', hdQuantile(A, 0.50), 5.5, 1e-9);
  t('hdQuantile p90 lies between the traditional p90 and the max',
    hdQuantile(A, 0.90) >= quantileAt(A, 0.90) - 1e-9 && hdQuantile(A, 0.90) <= 10, true);
  // Jackknife SE of a constant array is 0 - every leave-one-out draw is identical.
  t('hdQuantileSE of a constant is 0', hdQuantileSE(FLAT, 0.90), 0);
  t('hdQuantileSE needs at least 2 sessions', hdQuantileSE([5], 0.90), null);

  // expected-max table (CALCULATIONS-V4 §4.1) - checked against closed-form/
  // published values, not against itself.
  t('expectedMaxStd(1) = 0 (a single draw has no order-statistic bias)', expectedMaxStd(1), 0);
  t('expectedMaxStd(2) = 1/sqrt(pi), closed form', expectedMaxStd(2), 1/Math.sqrt(Math.PI), 1e-5);
  t('expectedMaxStd(10) matches the published table value', expectedMaxStd(10), 1.538750, 1e-4);
  t('expectedMaxStd is monotonically increasing in n', expectedMaxStd(50) < expectedMaxStd(100), true);
  t('expectedMaxStd falls back to the asymptotic beyond the table and stays increasing',
    expectedMaxStd(301) > expectedMaxStd(300) && isFinite(expectedMaxStd(301)), true);
  // pbSurprise: gated the same way CV is, and undefined for a constant sample
  // (sigma = 0). The A-array case is worked by hand: mean 5.5, sd sqrt(8.25),
  // record 10, expectedMaxStd(10) 1.538753.
  t('pbSurprise below HARD_FLOOR_N is withheld', pbSurprise(A.slice(0,5)), null);
  t('pbSurprise of a constant sample is withheld (sigma=0)', pbSurprise(FLAT), null);
  t('pbSurprise(1..10) matches the hand-worked value', pbSurprise(A), 0.027946, 1e-4);

  // n-matching (CALCULATIONS-V4 §4.3): below N_MATCH_RATIO it must fall
  // through to plain HD on each side unchanged (deterministic, so exact).
  const B8 = A.slice(0, 8);
  const belowRatio = nMatchedHD(A, B8, 0.5);
  t('nMatchedHD below ratio: window is plain HD', belowRatio.wQ, hdQuantile(A, 0.5));
  t('nMatchedHD below ratio: baseline is plain HD', belowRatio.bQ, hdQuantile(B8, 0.5));
  // Above the ratio, the untouched (smaller) side is still plain HD/jackknife;
  // the subsampled (larger) side is randomised, so only check it stays in range.
  const W20 = Array.from({length:20}, (_,i) => i+1), B5 = [1,2,3,4,5];
  const aboveRatio = nMatchedHD(W20, B5, 0.5);
  t('nMatchedHD above ratio: untouched side is plain HD', aboveRatio.bQ, hdQuantile(B5, 0.5));
  t('nMatchedHD above ratio: subsampled side stays in range',
    aboveRatio.wQ >= 1 && aboveRatio.wQ <= 20 && isFinite(aboveRatio.wSE) && aboveRatio.wSE >= 0, true);

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

  // hd=true switches Ceiling/Floor to Harrell-Davis; default stays traditional.
  const stHd = stats(A, SESS_THRESH, true);
  t('stats(hd) ceiling uses hdQuantile', stHd.ceiling, hdQuantile(A, TUNING.CEILING_Q));
  t('stats(hd) floor uses hdQuantile', stHd.floor, hdQuantile(A, TUNING.FLOOR_Q));
  t('stats() without hd still uses quantileAt', stats(A, SESS_THRESH).ceiling, quantileAt(A, TUNING.CEILING_Q));

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

  // cm chips are a PER-CARD toggle. They shipped as a global filter, so one
  // click on one scenario silently re-filtered every other scenario on the
  // page. These checks pin the two halves of the fix: the pressed state is
  // driven by what that card is pinned to, and every cm the scenario has ever
  // been played at stays listed while it is pinned - otherwise there is no way
  // back out except undoing the filter you cannot see.
  const CMRS = [{cm360:45, score:100}, {cm360:45, score:110}, {cm360:52, score:120}];
  const legOff = cmDotLegend(CMRS);
  const legOn  = cmDotLegend(CMRS, 45);
  t('cm legend lists one chip per cm', (legOff.match(/class="cmchip/g)||[]).length, 2);
  t('nothing pinned means nothing pressed', (legOff.match(/cmchip on/g)||[]).length, 0);
  t('pinning presses exactly one chip', (legOn.match(/cmchip on/g)||[]).length, 1);
  t('the pressed chip is the pinned cm', /data-cm="45"[^>]*aria-pressed="true"/.test(legOn), true);
  t('the other cm stays listed while pinned', /data-cm="52"[^>]*aria-pressed="false"/.test(legOn), true);
  // spark() draws the pinned runs but must build the chips from the full list.
  const SPRS = CMRS.map((r,i) => ({...r, date:new Date(2026,0,i+1)}));
  const pinnedOnly = SPRS.filter(r => r.cm360 === 45);
  t('chips come from the full list, not the filtered one',
    (spark(pinnedOnly, true, SPRS, 45).match(/class="cmchip/g)||[]).length, 2);

  // ---- sessions -----------------------------------------------------------
  // A new session after 30 minutes, and sessions on the same day tied together
  // by the break between them rather than merged or forgotten.
  const KEEP = RUNS;
  const mk = (iso, scen, score) => ({scen, date:new Date(iso), score, cm360:50,
                                     sensScale:'cm/360', dur:60, reset:false});
  RUNS = [
    mk('2026-03-02T10:00:00', 'A', 100),   // sitting 1
    mk('2026-03-02T10:20:00', 'A', 110),   // +20 min - same sitting
    mk('2026-03-02T13:00:00', 'A', 120),   // +2h40 - new sitting, same day
    mk('2026-03-03T09:00:00', 'B', 130)    // next day - new sitting, no break
  ];
  const SS = buildSessions();
  t('30-minute gap splits a session', SS.length, 3);
  t('20 minutes does not', SS[0].runs.length, 2);
  t('second sitting of the day is numbered', SS[1].dayIndex, 2);
  t('the break between them is kept', SS[1].breakBeforeSec, 2*3600 + 40*60);
  t('a new day is sitting 1 again', SS[2].dayIndex, 1);
  t('and carries no break', SS[2].breakBeforeSec, null);
  t('SESSION_GAP_MIN is 30', TUNING.SESSION_GAP_MIN, 30);

  // ---- month fun facts ----------------------------------------------------
  // 'A' existed before March, 'B' did not. Only 'B' is new; only the second
  // run of each scenario can be a PB, and a first-ever run never is.
  RUNS = [
    mk('2026-02-10T10:00:00', 'A', 100),
    mk('2026-03-04T10:00:00', 'A', 150),   // PB in March
    mk('2026-03-05T10:00:00', 'A',  90),   // not a PB
    mk('2026-03-06T10:00:00', 'B', 200),   // first ever - not a PB
    mk('2026-03-07T10:00:00', 'B', 210)    // PB in March
  ];
  const MA = new Date(2026, 2, 1), MB = new Date(2026, 3, 1);
  t('new scenarios tried counts only the never-played', newScenariosIn(MA, MB), 1);
  t('PBs exclude first-ever runs', pbsIn(MA, MB), 2);
  RUNS = KEEP;

  // ---- score by cm -------------------------------------------------------
  // The rules file documents its own format in a fenced block. Parsing that
  // would invent a category out of the instructions.
  const RULEDOC = [
    '```',
    '### <Category> / <Sub-category>',
    'WHEN: <condition>',
    '=> <what it means>',
    '```',
    '## 1. Static Clicking',
    '',
    '### Static Clicking / Micro',
    'WHEN: higher_avg_at_faster',
    '=> First line',
    '   continued on the next',
    '',
    'WHEN: regular_slower_than(80) AND pct_below_regular(50)',
    '=> Second rule',
    '',
    '### Static Clicking / Wide',
    'WHEN: (add your rule)',
    '=> (add your interpretation)',
    '',
    '### Made Up / Thing',
    'WHEN: banana(3)',
    '=> Never shown as a finding'
  ].join('\n');
  const RC = parseCategoryRules(RULEDOC);
  t('the format example is not a category', RC.some(e => e.cat === '<Category>'), false);
  t('real entries are parsed', RC.length, 3);
  t('two rules on the first entry', RC[0].rules.length, 2);
  t('indented lines continue the interpretation', RC[0].rules[0].then, 'First line continued on the next');
  t('AND splits into two conditions', RC[0].rules[1].terms.length, 2);
  t('a condition argument is a number', RC[0].rules[1].terms[0].arg, 80);
  t('template entries keep no rules', RC[1].rules.length, 0);
  t('an unknown condition is flagged, not dropped', RC[2].rules[0].terms[0].ok, false);

  // cm/360 is distance per turn: a BIGGER number is a SLOWER sensitivity.
  // Getting this backwards would invert every interpretation in the file.
  const LV = (cm, n, m) => ({cm, n, mean:m, sd:1, se:0.1,
                             first:new Date(2026,0,1), last:new Date(2026,0,20)});
  const AN = {levels:[LV(40,20,110), LV(55,50,100), LV(70,20,95)],
              regular: LV(55,50,100), best: LV(40,20,110)};
  t('faster_than: best 40cm is faster than 50', evalTerm({name:'faster_than', arg:50}, AN), true);
  t('slower_than: best 40cm is not slower than 50', evalTerm({name:'slower_than', arg:50}, AN), false);
  t('regular_slower_than: 55cm is not slower than 80', evalTerm({name:'regular_slower_than', arg:80}, AN), false);
  t('higher_avg_at_faster', evalTerm({name:'higher_avg_at_faster'}, AN), true);
  t('higher_avg_at_slower', evalTerm({name:'higher_avg_at_slower'}, AN), false);
  t('pct_below_regular(4) catches 70cm at -5%', evalTerm({name:'pct_below_regular', arg:4}, AN), true);
  t('pct_below_regular(20) does not', evalTerm({name:'pct_below_regular', arg:20}, AN), false);

  // Thin levels and extremes are not comparisons.
  const RN = [];
  const mkr = (cm, i) => ({scen:'X', date:new Date(2026,0,1+i), score:100+i, cm360:cm,
                           sensScale:'cm/360', dur:60, reset:false});
  for(let i=0;i<12;i++) RN.push(mkr(50, i));
  for(let i=0;i<12;i++) RN.push(mkr(90, i));   // extreme
  for(let i=0;i<3;i++)  RN.push(mkr(60, i));   // too thin
  t('levels under the minimum are dropped', cmLevels(RN, false).length, 1);
  t('extremes are excluded by default', cmLevels(RN, false).some(l => l.cm === 90), false);
  t('and included when asked', cmLevels(RN, true).length, 2);

  // Two levels played months apart cannot be compared to each other.
  const early = {cm:50, first:new Date(2026,0,1), last:new Date(2026,0,20)};
  const late  = {cm:60, first:new Date(2026,3,1), last:new Date(2026,3,20)};
  const together = {cm:60, first:new Date(2026,0,3), last:new Date(2026,0,18)};
  t('separate stretches are disjoint', cmTimeOverlap(early, late).disjoint, true);
  t('and the gap is measured in days', Math.round(cmTimeOverlap(early, late).gapDays), 71);
  t('interleaved stretches are not', cmTimeOverlap(early, together).disjoint, false);

  // ---- why a comparison is missing ---------------------------------------
  // The reason has to distinguish "not enough runs" from "no earlier period at
  // all" - they need completely different things from the player.
  const cell = (wn, bn) => ({w:{n:wn}, b:{n:bn}, wSess:{n:wn}, bSess:{n:bn}});
  const V1 = {st:{n:16}, cells:[cell(10,16), cell(0,1), cell(6,0), cell(0,0)]};
  const w1 = cmpWhy(V1, 'ceiling', 15);
  t('a thin comparison names the shortfall', /at least 15 sessions/.test(w1), true);
  t('and counts both sides of the fullest band', /10 in this window and 16/.test(w1), true);
  t('and explains the cm split', /split across 4 sensitivity bands/.test(w1), true);
  t('the reason never repeats the row name', /^Needs/.test(w1), true);

  const V2 = {st:{n:12}, cells:[cell(12,0), cell(3,0)]};
  t('no earlier period is said as such',
    /nothing to compare against yet/.test(cmpWhy(V2, 'typical', 10)), true);
  const V3 = {st:{n:12}, cells:[cell(12,0), cell(0,9)]};
  t('a sensitivity you no longer play is a different reason',
    /also played in the period before it/.test(cmpWhy(V3, 'typical', 10)), true);
  const V4 = {st:{n:30}, cells:[cell(15,15)]};
  t('one band does not claim a split', /split across/.test(cmpWhy(V4, 'floor', 20)), false);

  // ---- confetti is for a scenario PB only --------------------------------
  // A best at one sensitivity is real, but there are as many of those as you
  // have sensitivities. Whole-window confetti for each would mean nothing.
  const scenPbOf = a => a.kind === 'pb' && a.scope === 'scenario';
  t('scenario PB gets confetti', scenPbOf({kind:'pb', scope:'scenario'}), true);
  t('cm PB does not', scenPbOf({kind:'pb', scope:'cm'}), false);
  t('a new high on a thin scenario does not', scenPbOf({kind:'high', scope:'scenario'}), false);

  // ---- sorting by how well measured a scenario is ------------------------
  // Deliberately not run count: what decides whether a scenario can show you
  // progress is the width of its interval.
  const mkRow = (n, se) => ({st:{n}, nMin:n, typical: se == null ? null : {pct:1, se}});
  const rowsD = [mkRow(400, 3.0), mkRow(40, 0.8), mkRow(90, null), mkRow(20, null)];
  const ciH = r => (r.typical && r.typical.se != null) ? TUNING.CI_Z * r.typical.se : null;
  rowsD.sort((a,b) => {
    const ca = ciH(a), cb = ciH(b);
    if(ca != null && cb != null) return ca - cb;
    if(ca != null) return -1;
    if(cb != null) return 1;
    return (b.nMin - a.nMin) || (b.st.n - a.st.n);
  });
  t('the tightest interval sorts first, not the biggest pile of runs', rowsD[0].st.n, 40);
  t('a wide interval still beats no interval', rowsD[1].st.n, 400);
  t('unmeasurable rows fall to the bottom, most runs first', rowsD[3].st.n, 20);

  // ---- rankIndexValue: CALCULATIONS-V4 §10.1 step 1 normalisation ---------
  const RK = [{n:'cinnabar', t:100}, {n:'vermillion', t:200}, {n:'saffron', t:400}];
  t('rankIndexValue at exact threshold = its rank index', rankIndexValue(200, RK), 1);
  t('rankIndexValue at bottom threshold = 0', rankIndexValue(100, RK), 0);
  t('rankIndexValue interpolates linearly between ranks', rankIndexValue(150, RK), 0.5);
  t('rankIndexValue interpolates the wider upper interval', rankIndexValue(300, RK), 1.5);
  t('rankIndexValue extrapolates below the bottom rank', rankIndexValue(50, RK), -0.5);
  t('rankIndexValue extrapolates above the top rank', rankIndexValue(600, RK), 3);
  t('rankIndexValue on null score', rankIndexValue(null, RK), null);
  t('rankIndexValue needs at least 2 ranks', rankIndexValue(150, [{n:'a', t:100}]), null);

  // ---- fitFamiliarisation / earlyBaseline: CALCULATIONS-V4 §8 ------------
  t('below FAMILIAR_MIN_RUNS, no fit', fitFamiliarisation(new Array(TUNING.FAMILIAR_MIN_RUNS - 1).fill(100)), null);
  t('below FAMILIAR_MIN_RUNS, no early baseline either', earlyBaseline(new Array(TUNING.FAMILIAR_MIN_RUNS - 1).fill(100)), null);
  {
    // Synthetic exponential series with a known A/C/lambda, generated exactly
    // to spec (score(k) = A - C*exp(-k/lambda)) with k 1-based — the fit
    // should recover A and C from it essentially exactly (closed-form OLS on
    // noiseless data), independent of series length once past the gate.
    const A0 = 850, C0 = 200, lam = TUNING.LAMBDA;
    const synth = n => Array.from({length: n}, (_, i) => A0 - C0 * Math.exp(-(i+1) / lam));
    const fit60 = fitFamiliarisation(synth(60));
    t('fitFamiliarisation recovers A on noiseless data', fit60.level, A0, 1e-6);
    t('fitFamiliarisation recovers C on noiseless data', fit60.amplitude, C0, 1e-6);
    t('fitFamiliarisation reports the fixed lambda', fit60.lambda, lam);
    t('fitFamiliarisation n matches input length', fit60.n, 60);
    t('60 runs is still in familiarisation (< 3*lambda)', fit60.inFamiliarisation, true);

    const fit210 = fitFamiliarisation(synth(210));
    t('210 runs clears familiarisation (>= 3*lambda)', fit210.inFamiliarisation, false);

    const eb = earlyBaseline(synth(60));
    t('earlyBaseline ceiling/typical/floor/avg all collapse to the fitted level', eb.ceiling, A0, 1e-6);
    t('earlyBaseline typical = fitted level too', eb.typical, A0, 1e-6);
    t('earlyBaseline floor = fitted level too', eb.floor, A0, 1e-6);
    t('earlyBaseline avg = fitted level too', eb.avg, A0, 1e-6);
    t('earlyBaseline exposes n', eb.n, 60);
  }
  t('a flat (unimproving) series still fits, amplitude ~0', fitFamiliarisation(new Array(40).fill(500)).amplitude, 0, 1e-6);

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
