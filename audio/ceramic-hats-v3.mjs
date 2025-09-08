// title: ceramic-hats (Tone; noise+metal mix, pattern or density)
// engine: tone
export default async function start({ Tone, params = {}, out }) {
  // Ensure audio is running
  await Tone.start();
  try { if (Tone.Transport.state !== 'started') Tone.Transport.start('+0.02'); } catch(_) {}

  /* ---------- parse ---------- */
  const toNum   = (v, d)=> (Number.isFinite(+v) ? +v : d);
  const clamp01 = (x)=> Math.max(0, Math.min(1, +x||0));
  const clampI  = (x,lo,hi)=> Math.max(lo, Math.min(hi, Math.floor(+x||0)));

  const gainDb = toNum(params.gain, -10);
  const mode   = String(params.mode || 'pattern');           // 'pattern' | 'dens'
  const stepsIn= String(params.pattern ?? params.steps ?? 'x.x.x.x.x.x.x.x.').replace(/\s+/g,'');
  const len    = clampI(params.len ?? params.length ?? stepsIn.length || 16, 1, 64);
  const dens   = clamp01(toNum(params.density ?? params.dens, 0.6));
  const swing  = clamp01(toNum(params.swing, 0));            // 0..1
  const toneHz = toNum(params.tone, 9000);                   // bandpass center
  const hpHz   = toNum(params.hp, 6000);                     // highpass
  const metalVol = toNum(params.metal, -14);                 // dB
  const tickDiv  = String(params.div || '16n');              // grid

  /* ---------- audio chain ---------- */
  // if `out` is missing, fail-safe to destination (keeps sound guaranteed)
  const sink = (out && typeof out.connect === 'function') ? out : new Tone.Gain(1).toDestination();

  const hp  = new Tone.Filter({ type: 'highpass', frequency: hpHz });
  const bp  = new Tone.Filter({ type: 'bandpass', frequency: toneHz, Q: 1 });
  const vol = new Tone.Volume(gainDb);
  hp.connect(bp); bp.connect(vol); vol.connect(sink);

  // Noise layer
  const noise = new Tone.Noise('white').start();
  const env   = new Tone.AmplitudeEnvelope({ attack:0.001, decay:0.045, sustain:0, release:0.02 });
  noise.connect(env).connect(hp);

  // Metallic ping layer (optional if available)
  const metal = (Tone.MetalSynth)
    ? new Tone.MetalSynth({
        frequency: 500,
        envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 8.5, resonance: 1100, octaves: 1.6,
        volume: metalVol
      }).connect(hp)
    : null;

  // Groove
  Tone.Transport.swingSubdivision = '16n';
  Tone.Transport.swing = swing;

  /* ---------- state ---------- */
  const state = {
    mode,
    steps: stepsIn.padEnd(len, '.').slice(0, len),
    len, dens,
    swing, toneHz, hpHz, metalVol, div: tickDiv
  };

  /* ---------- sequencer ---------- */
  let i = 0;
  const loop = new Tone.Loop((time) => {
    const hit = (state.mode === 'pattern')
      ? ((state.steps[i % state.len] || '.') !== '.')
      : (Math.random() < state.dens);
    i++;
    if (!hit) return;

    const vel = 0.6 + Math.random() * 0.35;
    env.triggerAttackRelease(0.065, time, vel);
    if (metal) metal.triggerAttackRelease('32n', time, vel);
  }, tickDiv).start(0);

  /* ---------- controller (stop + live update) ---------- */
  const controller = async () => {
    try { loop.stop(); loop.dispose(); } catch(_) {}
    try { noise.stop(); noise.dispose(); } catch(_) {}
    try { env.dispose(); } catch(_) {}
    try { metal?.dispose(); } catch(_) {}
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
      state.toneHz = toNum(patch.tone, state.toneHz);
      try { bp.frequency.rampTo(state.toneHz, 0.03); } catch(_) { bp.frequency.value = state.toneHz; }
    }
    if ('hp' in patch) {
      state.hpHz = toNum(patch.hp, state.hpHz);
      try { hp.frequency.rampTo(state.hpHz, 0.03); } catch(_) { hp.frequency.value = state.hpHz; }
    }
    if ('metal' in patch && metal) {
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
