// tungsten-kick.mjs
// Materials kick: punchy sine body + click, drive + comp, Transport-locked
// Works with your SoundEngines runner. Live-tweak via:  set sN key value

export default async function start({ Tone, context, params = {}, out }) {
  // ---------------- Defaults ----------------
  const P = {
    // Patterning
    grid: '16n',            // '4n'|'8n'|'16n'|'32n'
    pattern: '',            // step string like "x---x---x---x---" (wins over density if non-empty)
    density: 1.0,           // 0..1 probability per step when pattern is empty
    seed: 0,                // deterministic density when > 0

    // Tone
    tune: 0,                // semitone offset (-24..+24)
    baseNote: 'C1',         // root pitch for the body trigger (C1~49Hz)
    pitchAmt: 18,           // semitones swept by the attack (6..36)
    pitchEnv: 0.04,         // seconds for pitch sweep decay (0.01..0.12)
    thump: 0.32,            // body decay seconds (0.08..0.6)
    hold: 0.002,            // body attack/hold
    click: 0.35,            // click level (0..1)
    clickTone: 4200,        // click lowpass cutoff (Hz)

    // FX / Gain staging
    drive: 2.5,             // waveshaper drive (0..8)
    lpf: 16000,             // final low-pass (Hz)
    comp: 5,                // post-drive compressor makeup/strength (0..10)
    gain: -6,               // final output level (dB)
    humanize: 0.004,        // ± jitter seconds on triggers
    accent: 0.0,            // 0..1 extra velocity on steps flagged with 'X'
  };

  Object.assign(P, params || {});

  // -------------- Helpers --------------
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const dbToGain = (db) => Math.pow(10, db / 20);
  const pow2 = (x) => Math.pow(2, x);

  // Deterministic RNG for density
  let rngState = P.seed >>> 0;
  const rnd = () => {
    // xorshift32
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >> 17;  rngState >>>= 0;
    rngState ^= rngState << 5;   rngState >>>= 0;
    return (rngState >>> 0) / 4294967296;
  };

  // Parse step string ("x- x X _" accepted)
  function parsePattern(str = '', grid = '16n') {
    const s = (String(str || '')).replace(/\s+/g, '');
    if (!s) return null; // signal "use density"
    const steps = [...s].map((ch) => {
      if (ch === 'x' || ch === 'X') return ch; // 'X' = accent
      if (ch === 'o' || ch === '•') return 'x';
      return '-';
    });
    return { steps, grid };
  }

  // Compute note from semitone offset
  function noteFrom(base = 'C1', semi = 0) {
    // Tone.Frequency handles strings + transposition
    try { return Tone.Frequency(base).transpose(semi).toNote(); }
    catch { return 'C1'; }
  }

  // -------------- Synthesis chain --------------
  const finalGain = new Tone.Gain(dbToGain(P.gain));
  const postLP = new Tone.Filter(P.lpf, 'lowpass');
  const comp = new Tone.Compressor({
    threshold: -14,
    ratio: 4,
    attack: 0.006,
    release: 0.12
  });
  const drive = new Tone.WaveShaper((x) => {
    // simple soft clip curve depending on P.drive
    const k = clamp(P.drive, 0, 8);
    const a = 1 + k * 0.6;
    return Math.tanh(a * x);
  }, 4096);

  // Kick body: MembraneSynth does a great job; we push ranges via params
  const body = new Tone.MembraneSynth({
    envelope: { attack: P.hold, decay: P.thump, sustain: 0.0, release: 0.0 },
    pitchDecay: clamp(P.pitchEnv, 0.005, 0.2),
    octaves: clamp(P.pitchAmt / 12, 0.2, 4.0),
    volume: -3 // headroom before drive
  });

  // Click: filtered noise ping
  const clickEnv = new Tone.AmplitudeEnvelope({ attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 });
  const clickFilt = new Tone.Filter(P.clickTone, 'lowpass');
  const clickSrc = new Tone.Noise('white');
  const clickLevel = new Tone.Gain(clamp(P.click, 0, 1));

  clickSrc.connect(clickFilt);
  clickFilt.connect(clickEnv);
  clickEnv.connect(clickLevel);

  // Route: [body + click] -> drive -> comp -> LPF -> finalGain -> out
  const preMix = new Tone.Gain(1);
  body.connect(preMix);
  clickLevel.connect(preMix);
  preMix.connect(drive);
  drive.connect(comp);
  comp.connect(postLP);
  postLP.connect(finalGain);

  // IMPORTANT: connect to provided 'out'
  if (out && typeof out.connect === 'function') finalGain.connect(out);

  // -------------- Sequencing --------------
  let seq = null;
  let stepIdx = 0;
  let parsed = parsePattern(P.pattern, P.grid);

  function triggerAt(time, accented = false) {
    const velBase = 0.95;
    const vel = clamp(velBase + (accented ? clamp(P.accent, 0, 1) : 0), 0, 1);
    const n = noteFrom(P.baseNote, P.tune | 0);

    // Humanize
    const j = clamp((Math.random() - 0.5) * 2 * (P.humanize || 0), -0.02, 0.02);
    const t = time + j;

    // retrigger body + click
    try {
      body.envelope.attack = clamp(P.hold, 0.0002, 0.02);
      body.envelope.decay = clamp(P.thump, 0.04, 1.2);
      body.pitchDecay = clamp(P.pitchEnv, 0.005, 0.2);
      body.octaves = clamp(P.pitchAmt / 12, 0.2, 4.0);
      body.triggerAttackRelease(n, '8n', t, vel);
    } catch {}

    try {
      clickLevel.gain.rampTo(clamp(P.click, 0, 1), 0.001);
      clickFilt.frequency.rampTo(clamp(P.clickTone, 500, 16000), 0.001);
      clickSrc.start(t);
      clickEnv.triggerAttackRelease('8n', t);
      clickSrc.stop(t + 0.03);
    } catch {}
  }

  function rebuildDriveCurve() {
    try {
      drive.set({
        oversample: '2x'
      });
      // Recreate curve to reflect new drive
      drive.curve = new Float32Array(4096).map((_, i) => {
        const x = (i / 2048) - 1; // -1..+1
        const k = clamp(P.drive, 0, 8);
        const a = 1 + k * 0.6;
        return Math.tanh(a * x);
      });
    } catch {}
  }

  function makeSequence() {
    if (seq) { try { seq.dispose(); } catch {} seq = null; }
    parsed = parsePattern(P.pattern, P.grid);

    if (parsed && parsed.steps && parsed.steps.length) {
      const steps = parsed.steps.slice(); // copy
      stepIdx = 0;
      seq = new Tone.Loop((time) => {
        const ch = steps[stepIdx % steps.length];
        const fire = (ch === 'x' || ch === 'X');
        if (fire) triggerAt(time, ch === 'X');
        stepIdx++;
      }, P.grid);
    } else {
      // Density model
      stepIdx = 0;
      seq = new Tone.Loop((time) => {
        const p = clamp(P.density, 0, 1);
        const r = (P.seed ? rnd() : Math.random());
        if (r < p) triggerAt(time, false);
        stepIdx++;
      }, P.grid);
    }
    seq.start(0);
  }

  // Initial param apply
  rebuildDriveCurve();
  comp.ratio = 3 + clamp(P.comp, 0, 10) * 0.3;
  postLP.frequency.value = clamp(P.lpf, 200, 20000);
  finalGain.gain.value = dbToGain(P.gain);

  // Ensure Transport exists (don’t force-start; you have a central clock)
  makeSequence();

  // -------------- Controller (stop + update) --------------
  let disposed = false;
  const controller = async function stop() {
    if (disposed) return;
    disposed = true;
    try { if (seq) { seq.stop(0); seq.dispose(); } } catch {}
    try { clickSrc.stop(); } catch {}
    [body, clickEnv, clickFilt, clickSrc, clickLevel, preMix, drive, comp, postLP, finalGain]
      .forEach(n => { try { n.dispose && n.dispose(); } catch {} });
  };

  controller.update = (patch = {}) => {
    // Merge & clamp
    Object.assign(P, patch || {});
    if (typeof patch.grid !== 'undefined' || typeof patch.pattern !== 'undefined' || typeof patch.density !== 'undefined') {
      makeSequence();
    }
    if (typeof patch.seed !== 'undefined') rngState = (P.seed >>> 0);

    if (typeof patch.tune !== 'undefined' ||
        typeof patch.pitchEnv !== 'undefined' ||
        typeof patch.pitchAmt !== 'undefined' ||
        typeof patch.thump !== 'undefined' ||
        typeof patch.hold !== 'undefined') {
      // these are read at trigger time; nothing to do immediately
    }

    if (typeof patch.click !== 'undefined') clickLevel.gain.rampTo(clamp(P.click, 0, 1), 0.03);
    if (typeof patch.clickTone !== 'undefined') clickFilt.frequency.rampTo(clamp(P.clickTone, 300, 16000), 0.03);

    if (typeof patch.drive !== 'undefined') rebuildDriveCurve();
    if (typeof patch.comp  !== 'undefined') comp.ratio = 3 + clamp(P.comp, 0, 10) * 0.3;
    if (typeof patch.lpf   !== 'undefined') postLP.frequency.rampTo(clamp(P.lpf, 200, 20000), 0.03);
    if (typeof patch.gain  !== 'undefined') finalGain.gain.rampTo(dbToGain(P.gain), 0.02);
    if (typeof patch.humanize !== 'undefined' ||
        typeof patch.accent   !== 'undefined') {
      // used at trigger time
    }
    return true;
  };

  // Expose current params for hot-restart fallback (your engine may use this)
  controller.params = () => ({ ...P });

  return controller;
}
