// basalt.mjs — Amen Beat Repeat (Tone.js) — v1.4.0
// Deterministic, Ableton-style: grid-quantized capture + repeat while Shift+Space is held.

const DEFAULT_URL =
  'https://raw.githubusercontent.com/cbassuarez/website-blog/main/audio/amen/amen.wav';

// Canonical onset map (0..1) — used only if you switch to map='onset'
const AMEN_ONSETS = [
  0.000, 0.071, 0.118, 0.176,
  0.226, 0.277, 0.329, 0.382,
  0.441, 0.493, 0.545, 0.595,
  0.644, 0.701, 0.753, 0.808
];

const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const coerce = (v)=>{ const s=String(v).trim();
  if(/^(on|off)$/i.test(s)) return s.toLowerCase()==='on';
  if(/^(true|false)$/i.test(s)) return s.toLowerCase()==='true';
  if(/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return v;
};

// Robust buffer loader (lets Tone handle decode/CORS)
async function loadToneBuffer(Tone, url){
  return await new Promise((resolve, reject)=>{
    const buf = new Tone.ToneAudioBuffer({
      url,
      onload: () => resolve(buf),
      onerror: (e) => reject(e || new Error('buffer load failed'))
    });
  });
}

function slicesFromOnsets(duration){
  const out=[];
  for(let i=0;i<AMEN_ONSETS.length;i++){
    const s = AMEN_ONSETS[i]*duration;
    const e = (i+1<AMEN_ONSETS.length?AMEN_ONSETS[i+1]:1.0)*duration;
    out.push({start:s, dur:Math.max(0.04, e-s)});
  }
  return out;
}
function makeGrid(duration, N){
  const step = duration/N;
  return Array.from({length:N},(_,i)=>({start:i*step, dur:step}));
}

export default async function start({ Tone, context, params={}, out }){
  try{ await Tone.start(); }catch(_){}
  try{ if(Tone.getContext().rawContext.state!=='running') await Tone.getContext().rawContext.resume(); }catch(_){}

  // ---------- PARAMETERS (Beat Repeat style) ----------
  const P = {
    url:        params.url || DEFAULT_URL,
    sourceBPM:  Number(params.src || params.sourceBPM || 135),
    bpm:        Number(params.bpm || 135),

    gain:       Number(params.gain || -12),     // master out dB
    hpf:        Number(params.hpf || 70),
    lpf:        Number(params.lpf || 11000),

    // Beat Repeat core
    grid:       clamp(parseInt(params.grid || 16,10)||16, 4, 32), // base grid steps per bar
    triplets:   !!coerce(params.triplets || false),               // restrict grid to /3 multiples if true
    length:     parseLen(params.length || '1/8'),  // slice length (steps) e.g. 1/16, 1/8T, 2 (steps)
    interval:   parseLen(params.interval || '1/8'),// retrigger interval (steps)
    offset:     parseInt(params.offset || 0, 10) || 0, // steps shift from captured anchor
    swing:      clamp(Number(params.swing || 0), 0, 0.4), // 0..0.4 (applies to odd repeats)

    gate:       !!coerce(params.gate ?? true),    // Gate: mute base while repeating
    duck:       clamp(Number(params.duck ?? 0.35), 0, 1), // if not gate, how much to lower base
    mix:        clamp(Number(params.mix ?? 1.0), 0, 1),   // FX level when not gating
    fxGain:     Number(params.fxGain || 6),       // extra dB on repeats

    map:        String(params.map || 'grid').toLowerCase(), // 'grid' or 'onset'
    debug:      !!coerce(params.debug || false)
  };

  // normalize step lengths if triplets are forced
  function parseSteps(s){
    // accept "1/8", "1/8T", numeric steps
    if (typeof s === 'number') return s|0;
    const m = String(s).trim().toUpperCase().match(/^(\d+)\s*$/);
    if (m) return parseInt(m[1],10);
    const f = String(s).trim().toUpperCase();
    const trip = /T$/.test(f);
    const m2 = f.match(/^1\/(\d+)(T)?$/);
    if (!m2) return null;
    const d = parseInt(m2[1],10);
    // convert musical fraction to steps at current grid
    // 1 bar = grid steps; 1/4 note = grid/4 steps
    const steps = Math.max(1, Math.round(P.grid / (d/4) * (trip?2/3:1)));
    return steps;
  }
  function parseLen(v){
    const steps = parseSteps(v);
    return steps || 2; // default 1/8 at grid=16
  }

  // ---------- SIGNAL GRAPH ----------
  const gMain = new Tone.Gain(Tone.dbToGain(P.gain));
  const HPF = new Tone.Filter(P.hpf,'highpass');
  const LPF = new Tone.Filter(P.lpf,'lowpass');

  const baseGate = new Tone.Gain(1);       // for Gate/Duck
  const dry      = new Tone.Gain(1);
  const fxBus    = new Tone.Gain(1);

  baseGate.connect(dry);
  const sum = new Tone.Gain(1);
  dry.connect(sum);
  fxBus.connect(sum);
  sum.connect(HPF).connect(LPF).connect(gMain).connect(out);

  // Sources: base loop (time-stretched), and a one-shot player for repeats
  const base = new Tone.GrainPlayer({ loop:true, grainSize:0.05, overlap:0.33, playbackRate:1 });
  const fx   = new Tone.GrainPlayer({ loop:false, grainSize:0.05, overlap:0.33, playbackRate:1 });
  base.connect(baseGate);
  fx.connect(fxBus);

  // Buffer
  const tbuf = await loadToneBuffer(Tone, P.url);
  base.buffer = tbuf;
  fx.buffer   = tbuf;
  const duration = tbuf.duration;

  // Slice map
  let gridN = P.grid;
  let slices = (P.map==='onset') ? slicesFromOnsets(duration) : makeGrid(duration, gridN);

  // Clocking
  const rateBase = clamp(P.bpm, 30, 220) / Math.max(30, P.sourceBPM);
  base.playbackRate = rateBase;
  fx.playbackRate   = rateBase; // keep repeats in time with base

  let baseStartAt = Tone.now() + 0.03;
  base.start(baseStartAt, 0);

  // helpers → grid timing
  function gridHz(){ return (clamp(P.bpm,30,220)/60) * (gridN/4); } // steps/sec
  function stepSec(){ return 1 / gridHz(); }
  function nowStep(){ return Math.floor((Tone.now() - baseStartAt) * gridHz()); }
  function nextStepDelay(){
    const t = Tone.now() - baseStartAt;
    const phase = (t * gridHz()) % 1;
    return (1 - phase) / gridHz();
  }
  function stepToOffset(stepIdx){
    const N = gridN;
    const frac = ((stepIdx % N) + N) % N / N; // 0..1
    return frac * duration;
  }

  // scheduling
  function scheduleTap(time, offset, dur, reverse=false){
    fx.reverse = !!reverse;
    fx.start(time, clamp(offset,0,Math.max(0,duration-0.01)), Math.max(0.03, Math.min(dur, duration)));
  }

  // Beat Repeat state
  let macroOn=false;
  let anchorStep=0;
  let repClock=null;
  let repCount=0;

  function startRepeatAtBoundary(){
    anchorStep = nowStep() + 1;                     // first repeat aligns to NEXT step
    repCount = 0;

    const delay   = nextStepDelay();
    const intStps = parseLen(P.interval);
    const lenStps = parseLen(P.length);

    if (repClock){ try{repClock.stop(); repClock.dispose();}catch(_){ } repClock=null; }

    repClock = new Tone.Clock((t)=>{
      const odd      = (repCount % 2) === 1;
      const swingDel = odd ? (P.swing * 0.5 * stepSec() * intStps) : 0;

      const thisStartStep = anchorStep + P.offset + (repCount * intStps);
      const off   = stepToOffset(thisStartStep);
      const dur   = lenStps * stepSec();

      scheduleTap(t + swingDel, off, dur, false);
      repCount++;
    }, gridHz()/intStps);

    // gate/duck + fx level
    const fxLevel = Tone.dbToGain(P.fxGain) * (P.gate ? 1 : P.mix);
    fxBus.gain.setValueAtTime(fxLevel, Tone.now());
    baseGate.gain.rampTo(P.gate ? 0 : (1 - clamp(P.duck,0,1)), 0.02);

    repClock.start(Tone.now() + delay);
  }

  function stopRepeat(){
    if (repClock){ try{ repClock.stop(); repClock.dispose(); }catch(_){ } repClock=null; }
    baseGate.gain.rampTo(1, 0.04);
  }

  // Key handlers: Shift+Space
  const INPUT = '#cb-input';
  const hasFocus = ()=>{ const el=document.querySelector(INPUT); return el && document.activeElement===el; };

  const onDown = (e)=>{
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!spaceish || !e.shiftKey) return;
    if(!hasFocus()) return;
    e.preventDefault();
    if (macroOn) return;
    macroOn = true;
    startRepeatAtBoundary();
  };
  const onUp = (e)=>{
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!spaceish) return;
    if(!macroOn) return;
    macroOn = false;
    stopRepeat();
  };
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup',   onUp,   true);

  if(P.debug) console.log('[basalt v1.4.0] ready', {bpm:P.bpm, src:P.sourceBPM, grid:gridN});

  // ---------- CONTROLLER ----------
  const controller = async function stop(){
    try{ stopRepeat(); }catch(_){}
    try{ base.stop(); fx.stop(); }catch(_){}
    try{ base.dispose(); fx.dispose(); }catch(_){}
    try{ dry.dispose(); fxBus.dispose(); sum.dispose(); }catch(_){}
    try{ HPF.dispose(); LPF.dispose(); gMain.dispose(); baseGate.dispose(); }catch(_){}
    try{
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup',   onUp,   true);
    }catch(_){}
  };

  controller.update = function update(patch={}){
    for(const [k,v] of Object.entries(patch)){ if(k in P) P[k]=coerce(v); }

    // io + filters
    gMain.gain.rampTo(Tone.dbToGain(P.gain), 0.05);
    HPF.frequency.rampTo(clamp(P.hpf,20,2000), 0.05);
    LPF.frequency.rampTo(clamp(P.lpf,200,20000), 0.05);

    // tempo
    const r = clamp(P.bpm,30,220) / Math.max(30, P.sourceBPM);
    base.playbackRate = r; fx.playbackRate = r;

    // grid / map
    const newGrid = clamp(parseInt(P.grid,10)||16, 4, 32);
    if (newGrid !== gridN){
      gridN = newGrid;
      slices = (P.map==='onset') ? slicesFromOnsets(duration) : makeGrid(duration, gridN);
    }
    if ('map' in patch){
      slices = (String(P.map).toLowerCase()==='onset') ? slicesFromOnsets(duration)
                                                      : makeGrid(duration, gridN);
    }

    // if repeating, refresh clock division + mix/gate immediately
    if (macroOn && repClock){
      const intStps = parseLen(P.interval);
      repClock.frequency.value = gridHz()/intStps;
      const fxLevel = Tone.dbToGain(P.fxGain) * (P.gate ? 1 : P.mix);
      fxBus.gain.rampTo(fxLevel, 0.02);
      baseGate.gain.rampTo(P.gate ? 0 : (1 - clamp(P.duck,0,1)), 0.02);
    }

    return true;
  };

  return controller;

  // ---------- utils ----------
  function parseLen(x){ return parseSteps(x) || 2; }
  function parseSteps(s){
    if (typeof s === 'number') return s|0;
    const f = String(s).trim().toUpperCase();
    const mNum = f.match(/^(\d+)$/); if (mNum) return parseInt(mNum[1],10);
    const m = f.match(/^1\/(\d+)(T)?$/); if (!m) return null;
    const denom = parseInt(m[1],10);
    const isTrip = !!m[2] || P.triplets;
    // steps per bar at denom: 1/4 = grid/4 steps, 1/8 = grid/8
    const steps = Math.round(P.grid / (denom/4) * (isTrip?2/3:1));
    return Math.max(1, steps);
  }
}
