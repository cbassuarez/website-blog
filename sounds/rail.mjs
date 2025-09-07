// title: rail — polyrhythm primer (JI, laptop-safe)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  // ---------- parse controls (positional sugar: "9 a2")
  const pos = Array.isArray(params?._) ? params._ : [];
  const div   = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 4, 1, 9);
  const pitch = String(params.pitch ?? pos.find(x=>/^[A-G]#?\d$/i.test(x)) ?? 'A3').toUpperCase();
  const dur   = toNum(params.dur, 0.22);
  const wave  = String(params.wave ?? 'pluck');
  const gain  = toNum(params.gain, -12);

  // ---------- safety chain
  const hp = new Tone.Filter(120,'highpass');
  const lp = new Tone.Filter(11000,'lowpass');
  const vol= new Tone.Volume(gain);
  hp.connect(lp); lp.connect(vol); vol.connect(out);

  // ---------- voice
  let src;
  if (wave==='pluck'){ src = new Tone.PluckSynth({ attackNoise: 0.7, dampening: 3800, resonance: .96 }).connect(hp); }
  else if (wave==='fm'){ src = new Tone.FMSynth().connect(hp); }
  else { src = new Tone.Synth({ oscillator:{type:'sine'} }).connect(hp); }

  // ---------- JI pitch
  const hz = noteToHz(pitch);

  // ---------- independent clock (no Transport), 60 bpm → 4 s bar
  const barSec = 4;
  const clock = new Tone.Clock((time)=>{
    src.triggerAttackRelease(hz, dur, time);
  }, div / barSec); // frequency = events/sec

  clock.start();
  return () => { try{ clock.stop(); clock.dispose(); src.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} };
}

/* ---------- helpers (tiny) ---------- */
function toNum(v, d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function noteToHz(note){
  // A4=440 ET offset → JI correction table (5/7-limit hybrid)
  const pc = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
  const ratios = {A:1, 'A#':16/15, B:9/8, C:6/5, 'C#':5/4, D:4/3, 'D#':45/32, E:3/2, F:8/5, 'F#':5/3, G:9/5, 'G#':15/8};
  const m = /^([A-G])(#?)(\d)$/.exec(String(note).toUpperCase()); if(!m) return 440;
  const name = (m[1]+m[2]); const oct = Number(m[3]);
  const pcIndex = pc.indexOf(name); const s = semisFromA4(name, oct);
  const r = ratios[name] || 1;
  const et_pc = Math.pow(2, (pcIndex)/12); // ET within the octave from A
  return 440 * (r/et_pc) * Math.pow(2, (s - pcIndex)/12);
}
function semisFromA4(name, oct){
  const map = {A:0,'A#':1,B:2,C:3,'C#':4,D:5,'D#':6,E:7,F:8,'F#':9,G:10,'G#':11};
  const pc = map[name]; const dOct = oct - 4;
  return dOct*12 + pc; // relative to A4
}
