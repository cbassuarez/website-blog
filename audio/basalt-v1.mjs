// basalt.mjs — Amen break kit (Tone.js) — v1.0.1
// Guaranteed-audio version: explicit unlock, reliable sample load, started clock, connects to `out`.

const DEFAULT_URL =
  'https://raw.githubusercontent.com/cbassuarez/website-blog/main/audio/amen/amen.wav';

// Canonical Amen onset map (16 slices; normalized 0..1 positions)
const AMEN_ONSETS = [
  0.000, 0.071, 0.118, 0.176,
  0.226, 0.277, 0.329, 0.382,
  0.441, 0.493, 0.545, 0.595,
  0.644, 0.701, 0.753, 0.808
];

// Built-in patterns (index into 0..15)
const PATTERNS = {
  amen:   [0,1,2,3, 4,5,6,7, 8,9,10,11, 12,13,14,15],
  dnb2:   [0,1,1,3, 4,5,5,7, 8,9,9,11, 12,13,14,14,
           0,1,2,2, 4,4,6,7, 8,8,10,11, 12,12,14,15],
  half:   [0,null,4,null, 8,null,12,null, 0,null,4,null, 8,null,12,null],
  sparse: [0,null,2,null, 4,null,6,null, 8,null,10,null, 12,null,14,null],
  fill:   [0,1,2,3, 4,5,6,7, 8,9,10,11, 12,13,14,15,
           15,14,13,12, 11,10,9,8, 7,6,5,4, 3,2,1,0],
  screw:  [0,1,2,3, 4,5,6,7, 8,9,10,11, 12,13,14,15,
           15,15,14,14, 13,13,12,12, 11,11,10,10, 9,9,8,8]
};

// Utility: clamp
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Utility: parse booleans/numbers from params
function coerce(v){
  if (typeof v === 'boolean') return v;
  const s = String(v).trim();
  if (/^(on|off)$/i.test(s)) return s.toLowerCase()==='on';
  if (/^(true|false)$/i.test(s)) return s.toLowerCase()==='true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return v;
}

// Load WAV robustly (fetch + decode) → AudioBuffer
async function loadAudioBuffer(Tone, url){
  const ac = Tone.getContext().rawContext;
  const res = await fetch(url, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const ab = await res.arrayBuffer();
  return await ac.decodeAudioData(ab);
}

// Build slice table from onset map (seconds)
function makeSlicesFromOnsets(duration){
  const len = AMEN_ONSETS.length;
  const out = [];
  for (let i=0;i<len;i++){
    const start = AMEN_ONSETS[i] * duration;
    const end   = (i+1 < len ? AMEN_ONSETS[i+1] : 1.0) * duration;
    out.push({ start, dur: Math.max(0.04, end - start) });
  }
  return out;
}

// Equal grid (16 slices)
function makeSlicesGrid16(duration){
  const step = duration / 16;
  return Array.from({length:16}, (_,i)=>({ start: i*step, dur: step }));
}

// Main entry point
export default async function start({ Tone, context, params = {}, out }) {
  // ----- 1) Unlock audio deterministically
  try { await Tone.start(); } catch(_){}
  try {
    const ctx = Tone.getContext().rawContext;
    if (ctx.state !== 'running') await ctx.resume();
  } catch(_){}

  // ----- 2) Read initial params
  const P = {
    url:      params.url || DEFAULT_URL,
    pattern:  (params.pattern || 'amen').toLowerCase(),
    mode:     (params.mode || 'normal').toLowerCase(), // normal|stutter|freeze|chop|screw
    bpm:      Number(params.bpm || 142),
    swing:    clamp(Number(params.swing || 0), 0, 0.4),
    slowdown: Math.max(1, parseInt(params.slowdown || 1, 10)),
    invert:   !!coerce(params.invert || false),
    glitch:   clamp(Number(params.glitch || 0), 0, 1),
    crush:    clamp(Number(params.crush || 0), 0, 1),
    freezeLen:Math.max(0.03, Number(params.freezeLen || 0.20)),
    grain:    Math.max(0.01, Number(params.grain || 0.04)),
    overlap:  clamp(Number(params.overlap || 0.33), 0.05, 0.9),
    gain:     Number(params.gain || -12),
    map:      (params.map || 'onset').toLowerCase(), // onset|grid16
    debug:    !!coerce(params.debug || false)
  };

  // ----- 3) Nodes (all Tone nodes; connect ONLY to provided `out`)
  const gain = new Tone.Gain(Tone.dbToGain(P.gain));
  const hpf  = new Tone.Filter(70,  'highpass');
  const lpf  = new Tone.Filter(11000,'lowpass');

  // Parallel bit-crush: dry + crushed, then sum back
  const crushSplit = new Tone.Gain(1);
  const dryTap     = new Tone.Gain(1).connect(crushSplit);
  const wetTap     = new Tone.Gain(0).connect(crushSplit); // will set by P.crush
  const bitCrusher = new Tone.BitCrusher({ bits: 8 });
  wetTap.connect(bitCrusher);
  bitCrusher.connect(crushSplit);

  const mixer = new Tone.Gain(1);
  // chain: (dry+wet) → HPF → LPF → gain → out
  crushSplit.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(gain);
  gain.connect(out);

  // ----- 4) Player
  const player = new Tone.GrainPlayer({
    url: undefined, // we’ll set buffer directly after decode
    loop: false,
    grainSize: P.grain,
    overlap:   P.overlap,
    playbackRate: 1,
    detune: 0
  });

  // IMPORTANT: connect player into dry/wet taps (not directly to out)
  player.fan(dryTap, wetTap);

  // ----- 5) Load + slice
  const audioBuf = await loadAudioBuffer(Tone, P.url);
  player.buffer = new Tone.ToneAudioBuffer(audioBuf);

  const duration = player.buffer.duration;
  let slices = (P.map === 'grid16') ? makeSlicesGrid16(duration) : makeSlicesFromOnsets(duration);

  // Update wet/dry mix for crusher
  function applyCrushMix(){
    // map P.crush 0..1 → bits 8..3 and wet level 0..1
    const bits = Math.round(8 - 5 * clamp(P.crush, 0, 1));
    bitCrusher.bits = clamp(bits, 3, 8);
    wetTap.gain.rampTo(clamp(P.crush, 0, 1), 0.05);
  }
  applyCrushMix();

  // ----- 6) Scheduler (Tone.Clock @ 16th note rate of *our* BPM)
  let stepIdx = 0;
  let barCounter = 0;
  let frozen = false;        // momentary macro (Shift+Space)
  let lastSliceIdx = 0;

  const Hz = (P.bpm / 60) * 4; // 16th notes per second
  const clock = new Tone.Clock(t => tick(t), Hz);
  clock.start();

  // ---- Debug help
  if (P.debug) {
    console.log('[basalt] loaded amen:', { url: P.url, duration });
    console.log('[basalt] first tick at ~', Tone.now());
  }

  // ----- 7) Keyboard macro (only when terminal input is focused)
  const INPUT_SEL = '#cb-input';
  function hasTerminalFocus(){
    const el = document.querySelector(INPUT_SEL);
    return el && document.activeElement === el;
  }
  const keyDown = e => {
    if (!hasTerminalFocus()) return;
    if (e.code === 'Space' && e.shiftKey){ frozen = true; e.preventDefault(); }
  };
  const keyUp = e => {
    if (e.code === 'Space'){ frozen = false; }
  };
  window.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup',   keyUp,   true);

  // ----- 8) Helpers
  function currentPattern(){
    return PATTERNS[P.pattern] || PATTERNS.amen;
  }
  function randInt(n){ return Math.floor(Math.random()*n); }

  function sliceForStep(idx){
    const pat = currentPattern();
    if (!pat.length) return null;
    const n = pat.length;
    const s = pat[idx % n];
    if (s == null) return null;
    let i = clamp(s, 0, slices.length-1);

    // glitch (neighbor or random swap)
    if (P.glitch > 0 && Math.random() < P.glitch){
      const r = Math.random();
      if (r < 0.5){
        i = clamp(i + (Math.random()<0.5?-1:1), 0, slices.length-1);
      }else{
        i = randInt(slices.length);
      }
    }
    return { i, ...slices[i] };
  }

  function effectiveStepTime(baseTime){
    // swing: delay odd 16ths by up to ~60ms at 142bpm with swing~0.15
    const isOdd = (stepIdx % 2) === 1;
    const stepDur = 1 / Hz; // seconds per 16th
    const delay   = isOdd ? (P.swing * 0.5 * stepDur) : 0;
    // slowdown: only trigger on multiples
    if ((stepIdx % P.slowdown) !== 0) return null;
    return baseTime + delay;
  }

  function scheduleHit(time){
    const pat = sliceForStep(stepIdx);
    if (!pat) return;

    lastSliceIdx = pat.i;

    let start = pat.start;
    let dur   = pat.dur;

    // Modes
    if (P.mode === 'chop'){
      dur = Math.min(dur, 0.09);
    }
    const reverse = P.invert || P.mode === 'screw';
    if (reverse){
      // play the slice reversed by flipping start/offset within slice
      const end = pat.start + dur;
      // GrainPlayer can't negative rate; emulate by offsetting backwards with short grains
      // We approximate by launching short taps from the end backwards:
      const taps = Math.max(1, Math.ceil(dur / Math.max(0.04, P.grain)));
      const g = Math.max(0.03, Math.min(P.freezeLen, dur));
      for (let k=0;k<taps;k++){
        const frac = k / taps;
        const off  = end - frac * dur - g;
        player.start(time + k * g, clamp(off, 0, duration-0.01), g);
      }
      return;
    }

    // normal / stutter / freeze
    if (frozen || P.mode === 'freeze'){
      // repeat the *current* or *last* tap
      const g = P.freezeLen;
      player.start(time, start, Math.min(g, dur));
      return;
    }
    if (P.mode === 'stutter'){
      const g = P.freezeLen;
      // stutter the *last* hit if exists, otherwise current
      const ref = slices[lastSliceIdx] || pat;
      player.start(time, ref.start, Math.min(g, ref.dur));
      return;
    }

    // normal
    player.start(time, start, dur);
  }

  // The clock callback
  function tick(baseTime){
    const t = effectiveStepTime(baseTime);
    if (t != null) scheduleHit(t);
    stepIdx++;
    if (stepIdx % 16 === 0) barCounter++;
  }

  // ----- 9) Apply initial param connections
  gain.gain.value = Tone.dbToGain(P.gain);
  player.grainSize = P.grain;
  player.overlap   = P.overlap;

  // ----- 10) Controller (stopper function + .update)
  const controller = async function stop(){
    try { clock.stop(); } catch(_){}
    try { player.stop(); } catch(_){}
    try { player.dispose(); } catch(_){}
    try { bitCrusher.dispose(); } catch(_){}
    try { dryTap.dispose(); wetTap.dispose(); crushSplit.dispose(); } catch(_){}
    try { hpf.dispose(); lpf.dispose(); gain.dispose(); } catch(_){}
    try {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup',   keyUp,   true);
    } catch(_){}
  };

  controller.update = function update(patch = {}){
    // coerce & apply in place
    for (const [k,v] of Object.entries(patch)) {
      if (!(k in P)) continue;
      P[k] = coerce(v);
    }
    // re-derive
    gain.gain.rampTo(Tone.dbToGain(P.gain), 0.05);
    player.grainSize = Math.max(0.01, Number(P.grain));
    player.overlap   = clamp(Number(P.overlap), 0.05, 0.9);
    applyCrushMix();

    // BPM / clock
    const newHz = (Math.max(30, Number(P.bpm)) / 60) * 4;
    if (Math.abs(newHz - clock.frequency.value) > 1e-6){
      clock.frequency.value = newHz;
    }

    // Slices map
    if (patch.map){
      slices = (String(P.map).toLowerCase() === 'grid16')
        ? makeSlicesGrid16(duration)
        : makeSlicesFromOnsets(duration);
    }

    // Pattern name is read each tick; nothing else to do.
    return true;
  };

  return controller;
}
