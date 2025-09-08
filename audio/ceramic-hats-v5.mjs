// title: ceramic-hats (minimal, safe)
// engine: tone
export default async function start(ctx){
  const Tone   = ctx.Tone;
  const out    = ctx.out;
  const params = ctx.params || {};

  await Tone.start();
  if (Tone.Transport.state !== 'started') { try { Tone.Transport.start('+0.02'); } catch(_){} }

  function n(v,d){ v = Number(v); return isFinite(v) ? v : d; }
  function c01(x){ x = Number(x); if (!isFinite(x)) x=0; if (x<0) x=0; if (x>1) x=1; return x; }
  function i(x,lo,hi){ x = Math.floor(Number(x)); if (!isFinite(x)) x=lo; if (x<lo) x=lo; if (x>hi) x=hi; return x; }

  const state = {
    gain:  n(params.gain, -10),
    hp:    n(params.hp, 7000),
    tone:  n(params.tone, 10000),
    swing: c01(n(params.swing, 0)),
    mode:  String(params.mode || 'pattern'), // 'pattern'|'dens'
    steps: String(params.pattern != null ? params.pattern : (params.steps != null ? params.steps : 'x.x.x.x.x.x.x.x.')).replace(/\s+/g,''),
    len:   i(params.len != null ? params.len : (params.length != null ? params.length : 16), 1, 64),
    dens:  c01(n(params.density != null ? params.density : params.dens, 0.6)),
    div:   String(params.div || '16n')
  };
  if (!state.steps) state.steps = 'x.x.x.x.x.x.x.x.';
  if (state.steps.length < state.len) state.steps = (state.steps + '................................').slice(0, state.len);
  if (state.steps.length > state.len) state.steps = state.steps.slice(0, state.len);

  const sink = (out && typeof out.connect === 'function') ? out : new Tone.Gain(1).toDestination();

  const hip = new Tone.Filter({ type:'highpass', frequency: state.hp });
  const bp  = new Tone.Filter({ type:'bandpass', frequency: state.tone, Q: 1 });
  const vol = new Tone.Volume(state.gain);
  hip.connect(bp); bp.connect(vol); vol.connect(sink);

  const noise = new Tone.Noise('white').start();
  const env   = new Tone.AmplitudeEnvelope({ attack:0.001, decay:0.05, sustain:0, release:0.02 });
  noise.connect(env).connect(hip);

  Tone.Transport.swingSubdivision = '16n';
  Tone.Transport.swing = state.swing;

  let idx = 0;
  const loop = new Tone.Loop(time => {
    let hit = false;
    if (state.mode === 'pattern'){
      const ch = state.steps.charAt(idx % state.len) || '.';
      hit = (ch !== '.');
    } else {
      hit = (Math.random() < state.dens);
    }
    idx++;
    if (!hit) return;
    const vel = 0.65 + Math.random()*0.3;
    try { env.triggerAttackRelease(0.07, time, vel); } catch(_){}
  }, state.div).start(0);

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { noise.stop(); noise.dispose(); } catch(_){}
    try { env.dispose(); hip.dispose(); bp.dispose(); vol.dispose(); } catch(_){}
  }

  stop.update = function(patch){
    patch = patch || {};
    if (patch.pattern != null || patch.steps != null){
      const s = String(patch.pattern != null ? patch.pattern : patch.steps).replace(/\s+/g,'');
      if (s){ state.steps = s; state.mode = 'pattern'; }
    }
    if (patch.density != null || patch.dens != null){
      state.dens = c01(n(patch.density != null ? patch.density : patch.dens, state.dens));
      state.mode = 'dens';
    }
    if (patch.len != null || patch.length != null){
      state.len = i(patch.len != null ? patch.len : patch.length, 1, 64);
      if (state.steps.length < state.len) state.steps = (state.steps + '................................').slice(0, state.len);
      if (state.steps.length > state.len) state.steps = state.steps.slice(0, state.len);
    }
    if (patch.div != null){
      const d = String(patch.div||'16n');
      if (d !== state.div){ state.div = d; try { loop.interval = d; } catch(_){} }
    }
    if (patch.swing != null){ state.swing = c01(n(patch.swing, state.swing)); Tone.Transport.swing = state.swing; }
    if (patch.gain != null){ const g = n(patch.gain, state.gain); state.gain = g; try { vol.volume.rampTo(g, 0.03); } catch(_) { vol.volume.value = g; } }
    if (patch.hp   != null){ const f = n(patch.hp, state.hp);   state.hp   = f; try { hip.frequency.rampTo(f, 0.03); } catch(_) { hip.frequency.value = f; } }
    if (patch.tone != null){ const f = n(patch.tone, state.tone); state.tone = f; try { bp.frequency.rampTo(f, 0.03); } catch(_) { bp.frequency.value = f; } }
    if (patch.mode != null){ state.mode = String(patch.mode); }
  };

  return stop;
}
