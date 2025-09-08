// ceramic-hats.mjs
// Metallic closed hats using Tone.MetalSynth, grid/step or density.

export default async function start({ Tone, context, params = {}, out }) {
  const P = {
    grid: '16n',
    pattern: 'x-x-x-x-x-x-x-x-',
    density: 1.0,      // used when pattern === ''
    seed: 0,
    // tone / env
    freq: 8_000,       // synth frequency-ish (MetalSynth uses harmonic model)
    res: 600,          // resonance (Q-like)
    modIndex: 8,
    harmonicity: 5.1,
    decay: 0.06,
    // mix
    hp: 6_500,
    lpf: 18_000,
    gain: -10,         // dB
    drive: 0.0,
    humanize: 0.002,
    accent: 0.15
  };
  Object.assign(P, params || {});
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const db2gain = (db) => Math.pow(10, db/20);

  // synth
  const hat = new Tone.MetalSynth({
    frequency: clamp(P.freq, 400, 12000),
    envelope: { attack: 0.001, decay: clamp(P.decay, 0.01, 0.3), release: 0.03 },
    resonance: clamp(P.res, 50, 700),
    harmonicity: clamp(P.harmonicity, 0.5, 12),
    modulationIndex: clamp(P.modIndex, 0.1, 40),
    volume: -6
  });

  // fx/mix
  const hp = new Tone.Filter(clamp(P.hp, 1000, 18000), 'highpass');
  const shaper = new Tone.Distortion(clamp(P.drive, 0, 1));
  const lp = new Tone.Filter(clamp(P.lpf, 500, 20000), 'lowpass');
  const vol = new Tone.Gain(db2gain(P.gain));
  hat.chain(hp, shaper, lp, vol);
  if (out && out.connect) vol.connect(out);

  // seq
  let seq = null, step = 0;
  let rng = P.seed >>> 0;
  const rnd = () => (rng = (rng ^ (rng << 13)) >>> 0, rng = (rng ^ (rng >>> 17)) >>> 0, rng = (rng ^ (rng << 5)) >>> 0, (rng>>>0)/4294967296);
  const parse = (s) => {
    const a = String(s||'').replace(/\s+/g,'');
    return a ? [...a].map(c => (c==='X'?'X':(c==='x'||c==='o')?'x':'-')) : null;
  };
  let pat = parse(P.pattern);

  function trig(time, acc=false){
    const j = (Math.random() - 0.5) * 2 * (P.humanize || 0);
    const t = time + j;
    try { hat.set({
      frequency: clamp(P.freq, 400, 12000),
      envelope: { attack: 0.001, decay: clamp(P.decay, 0.01, 0.3), release: 0.03 },
      resonance: clamp(P.res, 50, 700),
      harmonicity: clamp(P.harmonicity, 0.5, 12),
      modulationIndex: clamp(P.modIndex, 0.1, 40),
    }); } catch(_){}
    const vel = clamp(0.75 + (acc ? P.accent : 0), 0, 1);
    try { hat.triggerAttackRelease('32n', t, vel); } catch(_){}
  }

  function rebuild(){
    if (seq) { try{ seq.stop(0); seq.dispose(); }catch(_){ } seq = null; }
    pat = parse(P.pattern);
    step = 0;
    if (pat){
      seq = new Tone.Loop((time)=>{
        const ch = pat[step % pat.length];
        if (ch==='x'||ch==='X') trig(time, ch==='X');
        step++;
      }, P.grid);
    } else {
      seq = new Tone.Loop((time)=>{
        const p = clamp(P.density, 0, 1);
        const r = P.seed ? rnd() : Math.random();
        if (r < p) trig(time, false);
        step++;
      }, P.grid);
    }
    seq.start(0);
  }
  rebuild();

  const controller = async function stop(){
    try{ seq && seq.stop(0); seq && seq.dispose(); }catch(_){}
    [hat,hp,shaper,lp,vol].forEach(n=>{ try{ n.dispose && n.dispose(); }catch(_){ }});
  };
  controller.update = (patch={})=>{
    Object.assign(P, patch||{});
    if (patch.pattern!==undefined || patch.grid!==undefined || patch.density!==undefined || patch.seed!==undefined) rebuild();
    if (patch.freq!==undefined || patch.res!==undefined || patch.modIndex!==undefined || patch.harmonicity!==undefined || patch.decay!==undefined){
      hat.set({
        frequency: clamp(P.freq, 400, 12000),
        resonance: clamp(P.res, 50, 700),
        modulationIndex: clamp(P.modIndex, 0.1, 40),
        harmonicity: clamp(P.harmonicity, 0.5, 12),
        envelope: { attack: 0.001, decay: clamp(P.decay, 0.01, 0.3), release: 0.03 }
      });
    }
    if (patch.hp!==undefined) hp.frequency.rampTo(clamp(P.hp, 1000, 18000), 0.03);
    if (patch.drive!==undefined) shaper.distortion = clamp(P.drive, 0, 1);
    if (patch.lpf!==undefined) lp.frequency.rampTo(clamp(P.lpf, 500, 20000), 0.03);
    if (patch.gain!==undefined) vol.gain.rampTo(db2gain(P.gain), 0.02);
    return true;
  };
  controller.params = ()=>({ ...P });
  return controller;
}
