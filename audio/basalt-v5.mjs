// basalt.mjs — Amen macro-kit (Tone.js) — v1.3.3
// Fixes: syntax error in patterns; use Tone.ToneAudioBuffer loader; small safety tweaks.

const DEFAULT_URL =
  'https://raw.githubusercontent.com/cbassuarez/website-blog/main/audio/amen/amen.wav';

// canonical onset map (0..1)
const AMEN_ONSETS = [
  0.000, 0.071, 0.118, 0.176,
  0.226, 0.277, 0.329, 0.382,
  0.441, 0.493, 0.545, 0.595,
  0.644, 0.701, 0.753, 0.808
];

const PATTERNS = {
  amen:  [0,1,2,3,4,5,6,7, 8,9,10,11, 12,13,14,15],
  half:  [0,null,4,null, 8,null,12,null],
  // ✅ fixed: no "6=null"
  sparse:[0,null,2,null, 4,null,6,null, 8,null,10,null, 12,null,14,null],
  fill:  [0,1,2,3,4,5,6,7, 8,9,10,11, 12,13,14,15, 15,14,13,12, 11,10,9,8, 7,6,5,4, 3,2,1,0]
};

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const coerce=(v)=>{const s=String(v).trim();
  if(/^(on|off)$/i.test(s))return s.toLowerCase()==='on';
  if(/^(true|false)$/i.test(s))return s.toLowerCase()==='true';
  if(/^-?\d+(\.\d+)?$/.test(s))return Number(s);
  return v;
};

// Robust loader that lets Tone handle decoding/fetch/CORS
async function loadToneBuffer(Tone, url){
  return await new Promise((resolve, reject)=>{
    const buf = new Tone.ToneAudioBuffer({
      url,
      onload: () => resolve(buf),
      onerror: (e) => reject(e || new Error('buffer load failed'))
    });
  });
}

function makeSlicesFromOnsets(duration){
  const out=[];
  for(let i=0;i<AMEN_ONSETS.length;i++){
    const s=AMEN_ONSETS[i]*duration;
    const e=(i+1<AMEN_ONSETS.length?AMEN_ONSETS[i+1]:1.0)*duration;
    out.push({start:s,dur:Math.max(0.04,e-s)});
  }
  return out;
}
function makeSlicesGridN(duration, N){
  const step = duration/N;
  return Array.from({length:N},(_,i)=>({start:i*step,dur:step}));
}

export default async function start({ Tone, context, params={}, out }){
  // unlock / resume
  try{ await Tone.start(); }catch(_){}
  try{ if(Tone.getContext().rawContext.state!=='running') await Tone.getContext().rawContext.resume(); }catch(_){}

  const P = {
    url:        params.url || DEFAULT_URL,
    sourceBPM:  Number(params.src || params.sourceBPM || 135),
    bpm:        Number(params.bpm || 135),
    gain:       Number(params.gain || -12),
    hpf:        Number(params.hpf || 70),
    lpf:        Number(params.lpf || 11000),

    // separate buses
    fxGain:     Number(params.fxGain || 6),   // dB for chopped taps
    duck:       clamp(Number(params.duck ?? 0.35), 0, 1), // base loop level while macro held

    crush:      clamp(Number(params.crush || 0), 0, 1),

    macro:      String(params.macro || params.mode || 'freeze').toLowerCase(), // freeze|stutter|chop|slow|screw|invert
    freezeLen:  Math.max(0.03, Number(params.freezeLen || 0.18)),
    pattern:    String(params.pattern || 'amen').toLowerCase(),
    swing:      clamp(Number(params.swing || 0), 0, 0.4),
    slowdown:   Math.max(2, parseInt(params.slowdown || 2,10)),
    map:        String(params.map || 'onset').toLowerCase(),     // onset|grid
    grid:       clamp(parseInt(params.grid || 16,10)||16, 4, 32),
    debug:      !!coerce(params.debug || false)
  };

  // nodes
  const gMain = new Tone.Gain(Tone.dbToGain(P.gain));
  const HPF   = new Tone.Filter(P.hpf,'highpass');
  const LPF   = new Tone.Filter(P.lpf,'lowpass');

  const baseGate = new Tone.Gain(1);     // lets us duck base during macro
  const dry      = new Tone.Gain(1);

  // independent buses
  const fxBus    = new Tone.Gain(1);     // manipulated audio
  const crushBus = new Tone.Gain(0);     // parallel crushed base
  const sum      = new Tone.Gain(1);
  const crusher  = new Tone.BitCrusher({ bits:8 });

  // wiring
  baseGate.connect(dry);
  baseGate.connect(crushBus);
  crushBus.connect(crusher).connect(sum);
  fxBus.connect(sum);
  dry.connect(sum);
  sum.connect(HPF).connect(LPF).connect(gMain).connect(out);

  // sources
  const base = new Tone.GrainPlayer({ loop:true,  grainSize:0.05, overlap:0.33, playbackRate:1 });
  const fx   = new Tone.GrainPlayer({ loop:false, grainSize:0.05, overlap:0.33, playbackRate:1 });
  base.connect(baseGate);
  fx.connect(fxBus);

  // load sample via Tone's loader
  const tbuf = await loadToneBuffer(Tone, P.url);
  base.buffer = tbuf;
  fx.buffer   = tbuf;
  const duration = tbuf.duration;

  // slices
  let gridN   = [4,8,12,16,24,32].includes(P.grid) ? P.grid : 16;
  let slices  = (P.map==='grid') ? makeSlicesGridN(duration, gridN) : makeSlicesFromOnsets(duration);

  // baseline loop
  const rateBase = clamp(P.bpm, 30, 220) / Math.max(30, P.sourceBPM);
  let baseStartAt = Tone.now() + 0.03; // tiny offset to avoid race
  base.playbackRate = rateBase; base.reverse = false;
  base.start(baseStartAt, 0);

  // helpers
  function applyCrush(){
    const bits = Math.round(8 - 5*clamp(P.crush,0,1));
    crusher.bits = clamp(bits,3,8);
    crushBus.gain.rampTo(clamp(P.crush,0,1), 0.05);
  }
  function applyFxGain(){ fx.volume.value = Number(P.fxGain) || 0; }
  applyCrush(); applyFxGain();

  const stepsPerBeatFactor = (grid)=> (grid/4);
  function gridHz(){ return (clamp(P.bpm,30,220)/60) * stepsPerBeatFactor(gridN); }
  function stepDurationSec(){ return 1 / gridHz(); }
  function currentStepIndexNow(){
    const t = Tone.now() - baseStartAt;
    return Math.floor(t * gridHz());
  }
  function timeUntilNextStep(){
    const t = Tone.now() - baseStartAt;
    const phase = (t * gridHz()) % 1;
    return (1 - phase) / gridHz();
  }
  function stepStartOffset(stepIdx){
    const N = gridN;
    const frac = ((stepIdx % N) + N) % N / N;
    return frac * duration;
  }
  function nearestOnsetToOffset(off){
    let best=0, dmin=1e9;
    for(let i=0;i<slices.length;i++){
      const d=Math.abs(slices[i].start - off);
      if(d<dmin){ dmin=d; best=i; }
    }
    return slices[best];
  }
  function scheduleFXTap(time, offset, dur, reverse=false){
    offset = clamp(offset,0,Math.max(0,duration-0.01));
    dur    = Math.max(0.03, Math.min(dur, duration-offset));
    fx.reverse = !!reverse;
    fx.start(time, offset, dur);
  }

  // macro (Shift+Space)
  let macroOn=false;
  let stepIdx=0;
  const clk = new Tone.Clock((t)=>onStep(t), gridHz());

  function onStep(baseTime){
    if(!macroOn) return;

    const isOdd = (stepIdx % 2) === 1;
    const sd = stepDurationSec();
    const swingDelay = isOdd ? (P.swing * 0.5 * sd) : 0;
    const t = baseTime + swingDelay;

    const stepOff = stepStartOffset(stepIdx);
    const stepLen = duration / gridN;

    switch(P.macro){
      case 'freeze': {
        scheduleFXTap(t, stepOff, Math.min(P.freezeLen, stepLen*0.9), false);
        break;
      }
      case 'stutter': {
        const s = nearestOnsetToOffset(stepOff);
        scheduleFXTap(t, s.start, Math.min(P.freezeLen, s.dur), false);
        break;
      }
      case 'chop': {
        const pat = PATTERNS[P.pattern] || PATTERNS.amen;
        const pick = pat[stepIdx % pat.length];
        if (pick != null){
          const off = stepStartOffset(Math.floor(pick * (gridN/16)));
          const d   = Math.min(P.freezeLen, duration / gridN);
          scheduleFXTap(t, off, d, false);
        }
        break;
      }
      case 'screw':
      case 'invert': {
        const d = Math.min(P.freezeLen, stepLen);
        scheduleFXTap(t, stepOff + Math.min(d*0.95, stepLen*0.95), d, true);
        scheduleFXTap(t + d*0.95, stepOff + Math.min(d*1.9, stepLen*0.95), d*0.9, true);
        break;
      }
      case 'slow': {
        const newRate = rateBase / Math.max(2, P.slowdown);
        if (Math.abs(base.playbackRate - newRate) > 1e-4){
          base.playbackRate = newRate;
        }
        break;
      }
      default: {
        scheduleFXTap(t, stepOff, Math.min(P.freezeLen, stepLen), false);
      }
    }

    stepIdx++;
  }

  // key handlers (Shift+Space while terminal focused)
  const INPUT = '#cb-input';
  const hasFocus = ()=>{ const el=document.querySelector(INPUT); return el && document.activeElement===el; };

  const onDown = (e)=>{
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!spaceish || !e.shiftKey) return;
    if(!hasFocus()) return;
    e.preventDefault();
    if(macroOn) return;
    macroOn = true;

    stepIdx = currentStepIndexNow();
    const delay = timeUntilNextStep();
    clk.frequency.value = gridHz();
    clk.start(Tone.now() + delay);

    baseGate.gain.rampTo(clamp(P.duck, 0, 1), 0.03);
    fxBus.gain.rampTo(1, 0.01);

    if (P.macro === 'screw'){
      base.playbackRate = rateBase * 0.5;
    }
  };
  const onUp = (e)=>{
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!spaceish) return;
    if(!macroOn) return;
    macroOn = false;
    clk.stop();

    baseGate.gain.rampTo(1, 0.05);
    if (P.macro === 'slow' || P.macro === 'screw'){
      base.playbackRate = rateBase;
    }
  };
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup',   onUp,   true);

  if(P.debug) console.log('[basalt v1.3.3] ready', {bpm:P.bpm, sourceBPM:P.sourceBPM, grid:gridN, fxGain:P.fxGain, duck:P.duck});

  // controller
  const controller = async function stop(){
    try{ clk.stop(); }catch(_){}
    try{ base.stop(); fx.stop(); }catch(_){}
    try{ base.dispose(); fx.dispose(); }catch(_){}
    try{ crusher.dispose(); dry.dispose(); fxBus.dispose(); crushBus.dispose(); sum.dispose(); }catch(_){}
    try{ HPF.dispose(); LPF.dispose(); gMain.dispose(); baseGate.dispose(); }catch(_){}
    try{
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup',   onUp,   true);
    }catch(_){}
  };

  controller.update = function update(patch={}){
    for(const [k,v] of Object.entries(patch)){ if(k in P) P[k]=coerce(v); }

    gMain.gain.rampTo(Tone.dbToGain(P.gain), 0.05);
    HPF.frequency.rampTo(clamp(P.hpf,20,2000), 0.05);
    LPF.frequency.rampTo(clamp(P.lpf,200,20000), 0.05);
    applyCrush();
    applyFxGain();

    const newRate = clamp(P.bpm,30,220) / Math.max(30, P.sourceBPM);
    if (P.macro!=='slow' && P.macro!=='screw') base.playbackRate = newRate;

    const newGrid = [4,8,12,16,24,32].includes(parseInt(P.grid,10)) ? parseInt(P.grid,10) : gridN;
    if (newGrid !== gridN){
      gridN = newGrid;
      slices = (P.map==='grid') ? makeSlicesGridN(duration, gridN)
                                : makeSlicesFromOnsets(duration);
    }
    clk.frequency.value = gridHz();

    if ('map' in patch){
      slices = (String(P.map).toLowerCase()==='grid')
        ? makeSlicesGridN(duration, gridN)
        : makeSlicesFromOnsets(duration);
    }

    return true;
  };

  return controller;
}
