// title: ceramic-hats (Tone; noise+metal mix, pattern or density)
// engine: tone
export async function start({ Tone, params = {}, out }) {
  await Tone.start();
  await Tone.loaded?.();

  // Make sure the clock is actually running.
  if (Tone.Transport.state !== 'started') {
    try { Tone.Transport.start('+0.02'); } catch(_) {}
  }

  /* ---------- parse ---------- */
  const toNum   = (v, d)=> (Number.isFinite(+v) ? +v : d);
  const clamp01 = (x)=> Math.max(0, Math.min(1, +x||0));
  const clampI  = (x,lo,hi)=> Math.max(lo, Math.min(hi, Math.floor(+x||0)));

  const pos = Array.isArray(params._) ? params._ : [];
  const gainDb = toNum(params.gain, -10);
  const mode   = String(params.mode || 'pattern');           // 'pattern' | 'dens'
  const stepsIn= String(params.pattern ?? params.steps ?? 'x.x.x.x.x.x.x.x.').replace(/\s+/g,'');
  const len    = clampI(params.len ?? params.length ?? stepsIn.length || 16, 1, 64);
  const dens   = clamp01(toNum(params.density, 0.6));
  const swing  = clamp01(toNum(params.swing, 0));            // 0..1
  const tone   = toNum(params.tone, 9000);                   // bandpass Hz
  const hpCut  = toNum(params.hp, 6000);                     // highpass Hz
  const metalVol = toNum(params.metal, -14);                 // dB for metal layer
  const tickDiv  = String(params.div || '16n');              // grid

  /* ---------- audio chain ---------- */
  const hp  = new Tone.Filter(hpCut, 'highpass');
  const bp  = new Tone.Filter(tone, 'bandpass', { Q: 1 });
  const vol = new Tone.Volume(gainDb);
  hp.connect(bp); bp.connect(vol); vol.connect(out);

  // noise layer (crisp hats)
  const noise = new Tone.Noise('white').start();
  const env   = new Tone.AmplitudeEnvelope({ attack:0.001, decay:0.045, sustain:0, release:0.02 });
  noise.connect(env).connect(hp);

  // metallic ping layer (adds ceramic ping)
  const metal = new Tone.MetalSynth({
    frequency: 500,
    envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
    harmonicity: 5.1, modulationIndex: 8.5, resonance: 1100, octaves: 1.6,
    volume: metalVol
  }).connect(hp);

  // groove
  Tone.Transport.swingSubdivision = '16n';
  Tone.Transport.swing = swing;

  /* ---------- state ---------- */
  const state = {
    mode,
    steps: stepsIn.padEnd(len, '.').slice(0, len),
    len, dens,
    swing, tone, hpCut, metalVol, div: tickDiv
  };

  /* ---------- sequencer ---------- */
  let i = 0;
  const loop = new Tone.Loop((time) => {
    const hit = (state.mode === 'pattern')
      ? ((state.steps[i % state.len] || '.') !== '.')
      : (Math.random() < state.dens);

    i++;

    if (!hit) return;

    const vel = 0.6 + Math.random() * 0.35;          // humanize amplitude
    env.triggerAttackRelease(0.065, time, vel);
    metal.triggerAttackRelease('32n', time, vel);
  }, tickDiv).start(0);

  /* ---------- controller (stop + live update) ---------- */
  const controller = async () => {
    try { loop.stop(); loop.dispose(); } catch(_) {}
    try { noise.stop(); noise.dispose(); } catch(_) {}
    try { env.dispose(); } catch(_) {}
    try { metal.dispose(); } catch(_) {}
    try { hp.dispose(); bp.dispose(); vol.dispose(); } catch(_) {}
  };

  controller.update = (patch = {}) => {
    if ('pattern' in patch || 'steps' in patch) {
      const s = String(patch.pattern ?? patch.steps ?? '').replace(/\s+/g,'');
      if (s) { state.steps = s; state.mode = 'pattern'; }
    }
    if ('density' in patch || 'dens' in patch) {
      state.dens = clamp01(patch.density ?? patch.dens);
      state.mode = 'dens';
    }
    if ('len' in patch || 'length' in patch) {
      state.len = clampI(patch.len ?? patch.length, 1, 64);
      state.steps = state.steps.padEnd(state.len, '.').slice(0, state.len);
    }
    if ('swing' in patch) {
      state.swing = clamp01(patch.swing);
      Tone.Transport.swing = state.swing;
    }
    if ('tone' in patch) {
      state.tone = toNum(patch.tone, state.tone);
      try { bp.frequency.rampTo(state.tone, 0.03); } catch(_) { bp.frequency.value = state.tone; }
    }
    if ('hp' in patch) {
      state.hpCut = toNum(patch.hp, state.hpCut);
      try { hp.frequency.rampTo(state.hpCut, 0.03); } catch(_) { hp.frequency.value = state.hpCut; }
    }
    if ('metal' in patch) {
      state.metalVol = toNum(patch.metal, state.metalVol);
      try { metal.volume.rampTo(state.metalVol, 0.03); } catch(_) { metal.volume.value = state.metalVol; }
    }
    if ('gain' in patch) {
      const g = toNum(patch.gain, gainDb);
      try { vol.volume.rampTo(g, 0.03); } catch(_) { vol.volume.value = g; }
    }
    if ('div' in patch) {
      const want = String(patch.div || '16n');
      if (want !== state.div) {
        state.div = want;
        try { loop.interval = want; } catch(_) {}
      }
    }
  };

  return controller;
}
