// ---------------------------------------------------------------------------
// Effects lab. Drives the real functions in core.js with synthetic runs so the
// animations and notifications can be looked at without waiting for a PB to
// happen, or hand-editing a CSV to provoke one.
//
// It deliberately does NOT copy any of the effects. A copy drifts, and a copy
// that drifts is worse than no lab at all: you would be tuning something the
// app does not do. Everything here either calls into core.js or sets the state
// core.js reads (RUNS, TUNING, the once-per-session guards).
//
// core.js sees window.KVA_LAB and skips its own boot, so nothing is fetched and
// the watcher poll never starts.
// ---------------------------------------------------------------------------

// Deterministic, so two screenshots of the same effect are comparable. A fresh
// Math.random() each load would change the chart under you while you tune.
function rng(seed){
  let x = seed >>> 0;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

const SCEN = "Lab Smoothsphere Voltaic";
const OTHER = "Lab 1w2ts Reload";

// Builds a history the app can reason about: one scenario played at two
// sensitivities over a few weeks, then a session happening right now.
function makeRuns(opts){
  const r = rng(20260901);
  const out = [];
  const now = Date.now();
  const push = (msAgo, scen, score, cm, dur, reset) => out.push({
    scen, date: new Date(now - msAgo), score: Math.round(score),
    cm360: cm, sensScale: 'cm/360', dur, reset: !!reset
  });

  // Three weeks of history, so PBs and baselines are real rather than empty.
  for(let d = 21; d >= 1; d--){
    const runs = 6 + Math.floor(r() * 5);
    for(let i = 0; i < runs; i++){
      const ms = d*864e5 - i*90000;
      const trend = (21 - d) * 6;            // slow improvement to chart
      push(ms, SCEN, 3800 + trend + (r()-0.5)*260, r() < 0.35 ? 45 : 52, 55 + r()*8);
      if(r() < 0.35) push(ms - 40000, OTHER, 920 + trend*0.2 + (r()-0.5)*70, 45, 60);
    }
    // A NeverMiss-style zero: drawn on the chart, never counted in a %.
    if(d % 7 === 0) push(d*864e5 - 300000, SCEN, 0, 52, 3);
  }

  // The session happening right now. Gap length is what decides "actually
  // playing %", so the idle switch stretches it rather than faking the number.
  // Gaps have to exceed the run length or "actually playing" comes out over
  // 100% - the app is right and the synthetic data would be the thing lying.
  const gap = opts.idleSession ? 380000 : 75000;
  const n = 22;
  for(let i = n; i >= 1; i--){
    const ms = i * gap;
    push(ms, SCEN, 3930 + (r()-0.5)*240, 52, 58 + r()*6);
    // Restarts only exist in the folder at all when "log every run" is on, and
    // they come BEFORE the run you finally finish - that is what a restart is.
    if(opts.logEvery){
      const spam = opts.resetSpam ? 6 : 1;
      for(let k = 0; k < spam; k++) push(ms + 1000 + k*400, SCEN, 0, 52, 0, true);
    }
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}

const labState = {logEvery: false, resetSpam: false, idleSession: false, full: false, pinned: false};

function labRebuild(){
  RUNS = makeRuns(labState);
  SCEN_NAMES = new Set(RUNS.map(x => x.scen));
  // Session badges are accumulated as runs land, so replay them once. They are
  // const objects in core.js - emptied in place, not reassigned.
  [sessionAvg, sessionAvgByCm].forEach(o => Object.keys(o).forEach(k => delete o[k]));
  RUNS.forEach(noteSessionAvg);
  lowActiveNudgeShownFor = null;
  renderSessionPanel();
  labCard();
}

// The real chart and the real chips, on the synthetic runs. Wrapped in the same
// markup the run list uses so the CSS being previewed is the CSS that ships.
function labCard(){
  const rs = RUNS.filter(x => x.scen === SCEN);
  const usable = rs.filter(x => x.score > 0);
  const st = stats(usable.map(x => x.score));
  document.getElementById('labCard').innerHTML =
    '<div class="scen scen-expanded' + (labState.full ? ' scen-full' : '') + '"><h3>' +
      esc(SCEN) + '</h3>' +
      '<p class="meta">' + st.n + ' runs · spread ' + fmt(st.cv) + '% · synthetic</p>' +
      '<div class="scenbody"><div class="scennum">' +
      '<table><tr><th>metric</th><th>value</th></tr>' +
      '<tr><td>PB <span class="recordtag">record</span></td><td>' + fmt(st.record) + pbCmTag(usable) + '</td></tr>' +
      '<tr><td>Ceiling (p90)</td><td>' + fmt(st.ceiling) + '</td></tr>' +
      '<tr><td>Typical (trimmed)</td><td>' + fmt(st.typical) + '</td></tr>' +
      '<tr><td>Floor (p10)</td><td>' + fmt(st.floor) + '</td></tr></table>' +
      '</div><div class="scenchart">' +
      spark(rs, true, rs, labState.pinned ? 52 : undefined) +
      '</div>' +
      '<div class="legend"><span><i style="background:var(--best)"></i>PB (step)</span>' +
      '<span><i style="background:var(--med)"></i>rolling median</span>' +
      '<span><i style="background:var(--low)"></i>rolling bottom 10%</span>' +
      '<span><i style="background:var(--ink3)"></i>individual runs</span>' +
      '<span><i class="bandkey"></i>±1σ noise floor</span></div>' +
      '</div></div>';
}

// Achievement objects in the shape classifyAchievement() produces, so
// celebrate() and achievementText() get exactly what they get in the app.
const ACH = {
  pb:    {kind:'pb',    scope:'scenario', scen:SCEN, score:4310, prev:4180, n:187},
  pbcm:  {kind:'pb',    scope:'cm', cm:52, scen:SCEN, score:4290, prev:4205, n:96},
  high:  {kind:'high',  scope:'scenario', scen:SCEN, score:4055, prev:3990, n:3},
  first: {kind:'first', scope:'scenario', scen:SCEN, score:3820}
};

const FIRE = {
  pb:    () => celebrate(ACH.pb),
  pbcm:  () => celebrate(ACH.pbcm),
  high:  () => celebrate(ACH.high),
  first: () => celebrate(ACH.first),
  clearcel: () => {
    dismissToast('celebrate');
    const cv = document.getElementById('confettiCanvas');
    if(cv) cv.remove();
  },

  break: () => fireBreak('30 runs since your last break'),
  lowactive: () => {
    // Fires once per session by design; clear the guard so the lab can repeat it.
    lowActiveNudgeShownFor = null;
    const s = buildSessions().pop();
    if(!s || !lowActiveDiagnosis(s)){
      labSay('Nothing to fire: this session is not idle enough. Tick “Mostly idle session” ' +
             'above — the nudge needs under ' + TUNING.LOW_ACTIVE_PCT + '% active over at least ' +
             (TUNING.LOW_ACTIVE_MIN_SPAN_SEC/60) + ' minutes.');
      return;
    }
    maybeFireLowActiveNudge(s);
  },
  idle: () => {
    // checkIdleNudge reads the clock against the newest run, so age one.
    const last = RUNS[RUNS.length-1];
    const kept = last.date;
    last.date = new Date(Date.now() - 12*60000);
    lastIdleNudge = 0;
    checkIdleNudge();
    last.date = kept;
  },
  live: () => {
    // The whole chain: a run lands, the best achievement in it celebrates, the
    // session panel updates and the break counter ticks.
    const fresh = {scen: SCEN, date: new Date(), score: 4330, cm360: 52,
                   sensScale: 'cm/360', dur: 58, reset: false};
    RUNS.push(fresh);
    showLiveNote(fresh.date.getTime() - 1000);
  },

  undismiss: () => {
    try{ localStorage.removeItem(lsKey('kva_loghint')); localStorage.removeItem('kva_loghint'); }catch(e){}
    renderSessionPanel();
  },
  resession: () => labRebuild(),

  cardsize: () => {
    labState.full = !labState.full;
    document.querySelector('[data-fire="cardsize"]').textContent =
      labState.full ? '⤡ Exit full width' : '⤢ Full width';
    labCard();
  },
  pinchip: () => { labState.pinned = !labState.pinned; labCard(); }
};

function labSay(msg){
  toast('labsay', esc(msg), {kind:'warn', ms:8000});
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-fire]');
  if(b && FIRE[b.dataset.fire]) FIRE[b.dataset.fire]();
});

// Timing knobs. Written straight into TUNING so the next fire uses them; the
// lab never writes them back to the file, so a reload is always the real values.
function wireMs(inputId, labelId, key){
  const el = document.getElementById(inputId);
  const show = () => {
    el.value = TUNING[key] / 1000;
    document.getElementById(labelId).textContent = (TUNING[key]/1000) + 's';
  };
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    if(v > 0) TUNING[key] = v * 1000;
    document.getElementById(labelId).textContent = (TUNING[key]/1000) + 's';
  });
  show();
}
wireMs('celMs', 'celShow', 'CELEBRATE_MS');
wireMs('confMs', 'confShow', 'CONFETTI_MS');

['labLogEvery|logEvery', 'labSpam|resetSpam', 'labIdleSess|idleSession'].forEach(pair => {
  const [id, key] = pair.split('|');
  document.getElementById(id).addEventListener('change', e => {
    labState[key] = e.target.checked;
    // Restart spam is only visible when the game is writing restarts at all.
    if(key === 'resetSpam' && e.target.checked && !labState.logEvery){
      labState.logEvery = true;
      document.getElementById('labLogEvery').checked = true;
    }
    labRebuild();
  });
});

labRebuild();
