// title: tie — JI plucks (Karplus-like delay, laptop-safe)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const pos   = Array.isArray(params?._) ? params._ : [];
  const pitch = String(params.pitch ?? pos.find(x=>/^[A-G][#b]?\d$/i.test(x)) ?? 'C4').toUpperCase();
  const div   = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 3, 1, 9);
  const damp  = clamp(toNum(params.damp, 0.5), 0, 1);   // 0=bright/long, 1=dark/short
  const bright= clamp(toNum(params.bright, 0.3), 0, 1); // tone color
  const cycle = String(params.cycle ?? 'off').toLowerCase(); // 'off'|'up'|'down'
  const gain  = toNum(params.gain, -12);

  let hz = jiNoteHz(pitch);

  // Excitation: short noise burst, then feed a tuned delay with filtering
  const noise = new Tone.Noise('white').start();
  const exciteEnv = new Tone.AmplitudeEnvelope({ attack:0.001, decay:0.01, sustain:0, release:0.01 });

  const delay = new Tone.FeedbackDelay(1/Math.max(50,hz), 0.98); // tuned to period
  const dampLP = new Tone.Filter(4000 - 3500*damp, 'lowpass');   // more damping -> darker
  const toneHP = new Tone.Filter(80 + 3000*bright, 'highpass');

  const hp=new Tone.Filter(120,'highpass'), lp=new Tone.Filter(10000,'lowpass'), vol=new Tone.Volume(gain);
  noise.connect(exciteEnv); exciteEnv.connect(delay);
  delay.connect(dampLP); dampLP.connect(toneHP); toneHP.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);

  const barSec=4, interval=barSec/div;
  let on=true, t=null;

  const tick=()=>{
    if(!on) return;
    // re-tune delay each hit (in case hz changed from cycle)
    delay.delayTime.setValueAtTime(1/Math.max(50,hz), Tone.now());
    exciteEnv.triggerAttackRelease(0.005);
    // octave cycling
    if (cycle==='up')   hz = hz*2 > 4000 ? hz/4 : hz*2;
    if (cycle==='down') hz = hz/2 < 55   ? hz*4 : hz/2;
    t = setTimeout(tick, interval*1000);
  };
  tick();

  return ()=>{ on=false; clearTimeout(t); try{ [noise, exciteEnv, delay, dampLP, toneHP, hp, lp, vol].forEach(n=>n.dispose?.()); }catch(_){} };
}

/* helpers */
function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function jiNoteHz(note){
  const m=/^([A-G])([#b]?)(\d)$/i.exec(String(note).trim()); if(!m) return 261.6;
  let pc=m[1].toUpperCase(); const acc=m[2]; const oct=+m[3];
  const flats={BB:'A#',DB:'C#',EB:'D#',GB:'F#',AB:'G#'}; pc=(acc==='b')?(flats[pc+'B']||pc):(acc==='#')?(pc+'#'):pc;
  const R={'A':1,'A#':16/15,'B':9/8,'C':6/5,'C#':5/4,'D':4/3,'D#':45/32,'E':3/2,'F':8/5,'F#':5/3,'G':9/5,'G#':15/8};
  const order=['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; const idx=order.indexOf(pc); if(idx<0) return 261.6;
  const baseAOct=(idx<=2)?oct:(oct-1); const baseAFreq=440*Math.pow(2, baseAOct-4); return baseAFreq*(R[pc]||1);
}
