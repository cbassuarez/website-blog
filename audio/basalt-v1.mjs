// basalt.mjs — Amen macro-kit (Tone.js) — v1.2.0
// Baseline = continuous loop (grain-stretch to BPM). Macro (Shift+Space) = momentary FX.
// Audible flags: bpm, gain, hpf/lpf, crush. Macro styles: freeze | stutter | chop | slow | screw | invert.

const DEFAULT_URL =
  'https://raw.githubusercontent.com/cbassuarez/website-blog/main/audio/amen/amen.wav';

// Canonical onset map (0..1)
const AMEN_ONSETS = [
  0.000, 0.071, 0.118, 0.176,
  0.226, 0.277, 0.329, 0.382,
  0.441, 0.493, 0.545, 0.595,
  0.644, 0.701, 0.753, 0.808
];

// Simple patterns for macro “chop”
const PATTERNS = {
  amen:  [0,1,2,3,4,5,6,7, 8,9,10,11, 12,13,14,15],
  half:  [0,null,4,null, 8,null,12,null],
  sparse:[0,null,2,null, 4,null,6,null, 8,null,10,null, 12,null,14,null],
  fill:  [0,1,2,3,4,5,6,7, 8,9,10,11, 12,13,14,15, 15,14,13,12, 11,10,9,8, 7,6,5,4, 3,2,1,0]
};

const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const coerce = (v)=>{
  if (typeof v === 'boolean') return v;
  const s = String(v).trim();
  if (/^(on|off)$/i.test(s)) return s.toLowerCase()==='on';
  if (/^(true|false)$/i.test(s)) return s.toLowerCase()==='true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return v;
};

async function loadAudioBuffer(Tone, url){
  const ac = Tone.getContext().rawContext;
  const res = await fetch(url, { cache:'no-store', mode:'cors', credentials:'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const ab = await res.arrayBuffer();
  return await ac.decodeAudioData(ab);
}

function makeSlicesFromOnsets(duration){
  const out = [];
  for (let i=0;i<AMEN_ONSETS.length;i++){
    const s = AMEN_ONSETS[i]*duration;
    const e = (i+1<AMEN_ONSETS.length?AMEN_ONSETS[i+1]:1.0)*duration;
    out.push({ start:s, dur:Math.max(0.04, e-s) });
  }
  return out;
}
function makeSlicesGrid16(duration){
  const step = duration/16;
  return Array.from({length:16},(_,i)=>({ start:i*step, dur:step }));
}

export default async function start({ Tone, context, params = {}, out }){
  // 1) Unlock audio
  try{ await Tone.start(); }catch(_){}
  try{ if (Tone.getContext().rawContext.state!=='running') await Tone.getContext().rawContext.resume(); }catch(_){}

  // 2) Params
  const P = {
    url:      params.url || DEFAULT_URL,
    sourceBPM:Number(params.src || params.sourceBPM || 142),
    bpm:      Number(params.bpm || 142),
    gain:     Number(params.gain || -12),
    hpf:      Number(params.hpf || 70),
    lpf:      Number(params.lpf || 11000),
    crush:    clamp(Number(params.crush || 0), 0, 1),

    // Macro setup
    macro:    String(params.macro || params.mode || 'freeze').toLowerCase(), // freeze|stutter|chop|slow|screw|invert
    freezeLen:Math.max(0.03, Number(params.freezeLen || 0.18)),
    pattern:  String(params.pattern || 'amen').toLowerCase(),
    swing:    clamp(Number(params.swing || 0), 0, 0.4),
    slowdown: Math.max(2, parseInt(params.slowdown || 2, 10)), // slow factor when macro=slow
    map:      String(params.map || 'onset').toLowerCase(),     // onset|grid16
    debug:    !!coerce(params.debug || false)
  };

  // 3) Nodes & chain
  const gMain = new Tone.Gain(Tone.dbToGain(P.gain));  // master for this patch
  const HPF   = new Tone.Filter(P.hpf, 'highpass');
  const LPF   = new Tone.Filter(P.lpf, 'lowpass');

  // Crush bus: dry + wet -> sum
  const split = new Tone.Gain(1);
  const dry   = new Tone.Gain(1).connect(split);
  const wet   = new Tone.Gain(0).connect(split);
  const crusher = new Tone.BitCrusher({ bits: 8 });
  wet.connect(crusher); crusher.connect(split);

  split.connect(HPF); HPF.connect(LPF); LPF.connect(gMain); gMain.connect(out);

  // 4) Players: base loop + FX taps
  const base = new Tone.GrainPlayer({
    loop: true,
    grainSize: 0.05,
    overlap: 0.33,
    playbackRate: 1,
  });
  const fx = new Tone.GrainPlayer({
    loop:false,
    grainSize: 0.05,
    overlap: 0.33,
    playbackRate: 1,
  });

  // Wiring: both into dry/wet (so crush applies to both)
  base.fan(dry, wet);
  fx.fan(dry, wet);

  // 5) Load sample
  const buf = await loadAudioBuffer(Tone, P.url);
  base.buffer = new Tone.ToneAudioBuffer(buf);
  fx.buffer   = base.buffer;

  const duration = base.buffer.duration;
  let slices = (P.map==='grid16') ? makeSlicesGrid16(duration) : makeSlicesFromOnsets(duration);

  // 6) Baseline loop: time-stretch to BPM (no chopping)
  const rateBase = clamp(P.bpm, 30, 220) / Math.max(30, P.sourceBPM);
  let baseStartAt = Tone.now();
  base.playbackRate = rateBase;
  base.reverse = false;
  base.start(baseStartAt, 0);

  // Helper: compute current offset (seconds into buffer) of the baseline loop
  function baseOffsetNow(){
    const t = Tone.now() - baseStartAt;
    const off = (t * rateBase) % duration;
    return off < 0 ? off + duration : off;
  }

  // 7) Crush mix
  function applyCrush(){
    const bits = Math.round(8 - 5 * clamp(P.crush, 0, 1));
    crusher.bits = clamp(bits, 3, 8);
    wet.gain.rampTo(clamp(P.crush, 0, 1), 0.05);
  }
  applyCrush();

  // 8) Macro engine (momentary with Shift+Space)
  let macroOn = false;
  let stepIdx = 0;
  const sixteenthHz = (P.bpm/60)*4; // 16ths per second
  const macroClock = new Tone.Clock(t => macroTick(t), sixteenthHz);

  function pat(){ return PATTERNS[P.pattern] || PATTERNS.amen; }
  function nearestOnsetIndex(off){
    let best = 0, bestd = 1e9;
    for (let i=0;i<slices.length;i++){
      const d = Math.abs(slices[i].start - off);
      if (d<bestd){ best=i; bestd=d; }
    }
    return best;
  }

  function scheduleFXTap(time, offset, dur, reverse=false){
    offset = clamp(offset, 0, Math.max(0, duration-0.01));
    dur    = Math.max(0.03, Math.min(dur, duration-offset));
    fx.reverse = !!reverse;
    fx.start(time, offset, dur);
  }

  function macroTick(baseTime){
    if (!macroOn) return;
    // swing on odd steps
    const isOdd = (stepIdx % 2) === 1;
    const stepDur = 1 / sixteenthHz;
    const swingDelay = isOdd ? (P.swing * 0.5 * stepDur) : 0;
    const t = baseTime + swingDelay;

    const offNow = baseOffsetNow();
    const idxNow = nearestOnsetIndex(offNow);

    switch (P.macro){
      case 'freeze': {
        // grab the exact now-slice and loop a tiny grain at that offset
        const dur = P.freezeLen;
        scheduleFXTap(t, offNow, dur, false);
        break;
      }
      case 'stutter': {
        // repeat last onset explicitly (not current sub-slice)
        const s = slices[idxNow];
        const dur = Math.min(P.freezeLen, s.dur);
        scheduleFXTap(t, s.start, dur, false);
        break;
      }
      case 'chop': {
        // step through pattern; null = rest
        const p = pat();
        const sel = p[stepIdx % p.length];
        if (sel != null){
          const s = slices[clamp(sel,0,slices.length-1)];
          const dur = Math.min(P.freezeLen, s.dur);
          scheduleFXTap(t, s.start, dur, false);
        }
        break;
      }
      case 'slow': {
        // while held, slow the BASE loop (immediate, not tape)
        const newRate = rateBase / Math.max(2, P.slowdown);
        if (Math.abs(base.playbackRate - newRate) > 1e-4){
          base.playbackRate = newRate;
        }
        break;
      }
      case 'screw':
      case 'invert': {
        // quick reversed grains around current slice (audibly different)
        const s = slices[idxNow];
        const g = Math.min(P.freezeLen, s.dur);
        // two reversed taps for texture
        scheduleFXTap(t, s.start+g, g, true);
        scheduleFXTap(t + g*0.9, s.start+g*2, g, true);
        break;
      }
      default: {
        // fallback freeze
        scheduleFXTap(t, offNow, Math.min(P.freezeLen, 0.18), false);
      }
    }

    stepIdx++;
  }

  // Key handling (robust)
  const INPUT_SEL = '#cb-input';
  const hasTerminalFocus = () => {
    const el = document.querySelector(INPUT_SEL);
    return el && document.activeElement === el;
  };
  const keyDown = (e) => {
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if (!spaceish || !e.shiftKey) return;
    if (!hasTerminalFocus()) return;
    e.preventDefault();
    if (macroOn) return;          // ignore repeats
    macroOn = true;
    stepIdx = 0;

    // for 'slow', we apply immediately; others use clock taps
    if (P.macro !== 'slow') macroClock.start();
  };
  const keyUp = (e) => {
    const spaceish = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if (!spaceish) return;
    if (!macroOn) return;
    macroOn = false;
    macroClock.stop();

    // restore baseline after slow macro
    if (P.macro === 'slow') base.playbackRate = rateBase;
  };
  window.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup',   keyUp,   true);

  if (P.debug){
    console.log('[basalt] loop ready', { url:P.url, duration, rateBase });
  }

  // 9) Controller
  const controller = async function stop(){
    try{ macroClock.stop(); }catch(_){}
    try{ base.stop(); fx.stop(); }catch(_){}
    try{ base.dispose(); fx.dispose(); }catch(_){}
    try{ crusher.dispose(); dry.dispose(); wet.dispose(); split.dispose(); }catch(_){}
    try{ HPF.dispose(); LPF.dispose(); gMain.dispose(); }catch(_){}
    try{
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup',   keyUp,   true);
    }catch(_){}
  };

  controller.update = function update(patch = {}){
    for (const [k,v] of Object.entries(patch)){
      if (k in P) P[k] = coerce(v);
    }

    // audible immediately
    gMain.gain.rampTo(Tone.dbToGain(P.gain), 0.05);
    HPF.frequency.rampTo(clamp(P.hpf,20,2000), 0.05);
    LPF.frequency.rampTo(clamp(P.lpf,200,20000), 0.05);
    applyCrush();

    // BPM / base rate
    const newRate = clamp(P.bpm, 30, 220) / Math.max(30, P.sourceBPM);
    if (Math.abs(newRate - base.playbackRate) > 1e-4 && P.macro!=='slow'){
      base.playbackRate = newRate;
    }

    // macro clock rate (16ths)
    const newHz = (clamp(P.bpm,30,220)/60)*4;
    if (Math.abs(newHz - macroClock.frequency.value) > 1e-6){
      macroClock.frequency.value = newHz;
    }

    // slice map switch
    if ('map' in patch){
      slices = (String(P.map).toLowerCase()==='grid16')
        ? makeSlicesGrid16(duration)
        : makeSlicesFromOnsets(duration);
    }

    return true;
  };

  return controller;
}
