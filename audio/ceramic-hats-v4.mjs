// title: ceramic-hats (Tone; noise+metal mix, pattern or density)
// engine: tone
export default async function start(ctx){
  const Tone = ctx.Tone;
  const params = ctx.params || {};
  const out = ctx.out;

  await Tone.start();
  try { if (Tone.Transport.state !== 'started') Tone.Transport.start('+0.02'); } catch(e) {}

  function toNum(v, d){ v = Number(v); return isFinite(v) ? v : d; }
  function clamp01(x){ x = Number(x); if (!isFinite(x)) x=0; if (x<0) x=0; if (x>1) x=1; return x; }
  function clampI(x, lo, hi){ x = Math.floor(Number(x)); if (!isFinite(x)) x=lo; if (x<lo) x=lo; if (x>hi) x=hi; return x; }

  var gainDb = toNum(params.gain, -10);
  var mode   = String(params.mode || 'pattern'); // 'pattern' | 'dens'
  var stepsIn = String(params.pattern != null ? params.pattern : (params.steps != null ? params.steps : 'x.x.x.x.x.x.x.x.')).replace(/\s+/g,'');
  var len    = clampI(params.len != null ? params.len : (params.length != null ? params.length : stepsIn.length || 16), 1, 64);
  var dens   = clamp01(toNum(params.density != null ? params.density : params.dens, 0.6));
  var swing  = clamp01(toNum(params.swing, 0));
  var toneHz = toNum(params.tone, 9000);
  var hpHz   = toNum(params.hp, 6000);
  var metalVol = toNum(params.metal, -14);
  var tickDiv  = String(params.div || '16n');

  var sink = (out && typeof out.connect === 'function') ? out : new Tone.Gain(1).toDestination();

  var hp  = new Tone.Filter({ type: 'highpass', frequency: hpHz });
  var bp  = new Tone.Filter({ type: 'bandpass', frequency: toneHz, Q: 1 });
  var vol = new Tone.Volume(gainDb);
  hp.connect(bp); bp.connect(vol); vol.connect(sink);

  var noise = new Tone.Noise('white').start();
  var env   = new Tone.AmplitudeEnvelope({ attack:0.001, decay:0.045, sustain:0, release:0.02 });
  noise.connect(env).connect(hp);

  var metal = null;
  if (Tone.MetalSynth){
    metal = new Tone.MetalSynth({
      frequency: 500,
      envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 8.5, resonance: 1100, octaves: 1.6,
      volume: metalVol
    }).connect(hp);
  }

  Tone.Transport.swingSubdivision = '16n';
  Tone.Transport.swing = swing;

  var state = {
    mode: mode,
    steps: (stepsIn + Array(len+1).join('.')).slice(0, len),
    len: len,
    dens: dens,
    swing: swing,
    toneHz: toneHz,
    hpHz: hpHz,
    metalVol: metalVol,
    div: tickDiv
  };

  var i = 0;
  var loop = new Tone.Loop(function(time){
    var stepHit = false;
    if (state.mode === 'pattern'){
      var ch = state.steps.charAt(i % state.len) || '.';
      stepHit = (ch !== '.');
    } else {
      stepHit = (Math.random() < state.dens);
    }
    i++;
    if (!stepHit) return;
    var vel = 0.6 + Math.random() * 0.35;
    try { env.triggerAttackRelease(0.065, time, vel); } catch(e){}
    if (metal) { try { metal.triggerAttackRelease('32n', time, vel); } catch(e){} }
  }, tickDiv).start(0);

  function controller(){
    try { loop.stop(); loop.dispose(); } catch(e){}
    try { noise.stop(); noise.dispose(); } catch(e){}
    try { env.dispose(); } catch(e){}
    if (metal){ try { metal.dispose(); } catch(e){} }
    try { hp.dispose(); bp.dispose(); vol.dispose(); } catch(e){}
  }

  controller.update = function(patch){
    patch = patch || {};
    if (patch.pattern != null || patch.steps != null){
      var s = String(patch.pattern != null ? patch.pattern : patch.steps).replace(/\s+/g,'');
      if (s) { state.steps = s; state.mode = 'pattern'; }
    }
    if (patch.density != null || patch.dens != null){
      state.dens = clamp01(patch.density != null ? patch.density : patch.dens);
      state.mode = 'dens';
    }
    if (patch.len != null || patch.length != null){
      state.len = clampI(patch.len != null ? patch.len : patch.length, 1, 64);
      if (state.steps.length < state.len) state.steps += Array(state.len - state.steps.length + 1).join('.');
      if (state.steps.length > state.len) state.steps = state.steps.slice(0, state.len);
    }
    if (patch.swing != null){
      state.swing = clamp01(patch.swing);
      Tone.Transport.swing = state.swing;
    }
    if (patch.tone != null){
      state.toneHz = toNum(patch.tone, state.toneHz);
      try { bp.frequency.rampTo(state.toneHz, 0.03); } catch(e) { bp.frequency.value = state.toneHz; }
    }
    if (patch.hp != null){
      state.hpHz = toNum(patch.hp, state.hpHz);
      try { hp.frequency.rampTo(state.hpHz, 0.03); } catch(e) { hp.frequency.value = state.hpHz; }
    }
    if (patch.metal != null && metal){
      state.metalVol = toNum(patch.metal, state.metalVol);
      try { metal.volume.rampTo(state.metalVol, 0.03); } catch(e) { metal.volume.value = state.metalVol; }
    }
    if (patch.gain != null){
      var g = toNum(patch.gain, gainDb);
      try { vol.volume.rampTo(g, 0.03); } catch(e) { vol.volume.value = g; }
    }
    if (patch.div != null){
      var want = String(patch.div || '16n');
      if (want !== state.div) {
        state.div = want;
        try { loop.interval = want; } catch(e){}
      }
    }
  };

  return controller;
}
