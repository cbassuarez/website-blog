// title: rail — polyrhythm primer (JI, laptop-safe)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  // positional sugar: "9 a2"
  const pos = Array.isArray(params?._) ? params._ : [];
  const div   = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 4, 1, 9);
  const pitch = String(params.pitch ?? pos.find(x=>/^[A-G][#b]?\d$/i.test(x)) ?? 'A3').toUpperCase();
  const dur   = toNum(params.dur, 0.22);
  const wave  = String(params.wave ?? 'sine'); // 'sine' | 'square' | 'triangle' | 'fm'
  const gain  = toNum(params.gain, -12);

  // ---------- exact JI Hz
  const hz = jiNoteHz(pitch);
  console.debug('[rail] pitch=%s hz=%s', pitch, hz);

  // ---------- generator (exact-Hz oscillator)
  const osc = new Tone.Oscillator({ frequency: hz, type: (wave==='square'||wave==='triangle') ? wave : 'sine' }).start();

  // optional light FM flavor
  let fmMod = null, fmGain = null;
  if (wave === 'fm') {
    fmMod = new Tone.Oscillator({ frequency: hz * 2, type: 'sine' }).start();
    fmGain = new Tone.Gain(hz * 0.35); // Hz deviation
    fmMod.connect(fmGain); fmGain.connect(osc.frequency);
  }

  // ---------- envelope + safety chain
  const env = new Tone.AmplitudeEnvelope({
    attack: 0.004,
    decay:  Math.max(0.06, dur * 0.35),
    sustain: 0.0,
    release: 0.02
  });

  const hp=new Tone.Filter(120,'highpass'), lp=new Tone.Filter(11000,'lowpass'), vol=new Tone.Volume(gain);
  osc.connect(env); env.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);

  // ---------- independent clock (no Transport), 60 bpm → 4 s bar
  const barSec = 4;
  const clock = new Tone.Clock((time)=>{ env.triggerAttackRelease(dur, time); }, div / barSec);
  clock.start();

  return () => {
    try{
      clock.stop(); clock.dispose();
      env.dispose(); osc.dispose();
      if (fmMod) fmMod.dispose();
      if (fmGain) fmGain.dispose();
      hp.dispose(); lp.dispose(); vol.dispose();
    }catch(_){}
  };
}

/* helpers */
function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }

// JI frequency from letter name (relative to the correct A for that octave)
// Supports flats: Bb, Db, Eb, Gb, Ab
function jiNoteHz(note){
  const m = /^([A-G])([#b]?)(\d)$/i.exec(String(note).trim());
  if (!m) return 440;
  let pc = m[1].toUpperCase();
  const acc = m[2]; const oct = +m[3];

  // flats → sharps
  const flats = { BB:'A#', DB:'C#', EB:'D#', GB:'F#', AB:'G#' };
  pc = (acc === 'b') ? (flats[pc+'B'] || pc) : (acc === '#') ? (pc+'#') : pc;

  // 5/7-limit hybrid JI ratios within the octave (relative to A)
  const R = { 'A':1/1, 'A#':16/15, 'B':9/8, 'C':6/5, 'C#':5/4, 'D':4/3,
              'D#':45/32, 'E':3/2, 'F':8/5, 'F#':5/3, 'G':9/5, 'G#':15/8 };
  const order = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
  const idx = order.indexOf(pc); if (idx < 0) return 440;

  // For A/A#/B anchor to A of SAME octave; for C..G# anchor to A of PREV octave
  const baseAOct = (idx <= 2) ? oct : (oct - 1);
  const baseAFreq = 440 * Math.pow(2, baseAOct - 4); // A4=440
  return baseAFreq * (R[pc] || 1);
}
