// title: switchyard — phase & swing (JI)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const pos = Array.isArray(params?._) ? params._ : [];
  const div    = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 4, 1, 9);
  const pitch  = String(params.pitch ?? pos.find(x=>/^[A-G]#?\d$/i.test(x)) ?? 'A3').toUpperCase();
  const offset = clamp(Number(params.offset ?? 0), 0, 1);     // 0..1 of bar
  const swing  = clamp(Number(params.swing ?? 0), 0, 0.4);   // fraction of interval
  const dur    = toNum(params.dur, 0.18);
  const gain   = toNum(params.gain, -12);

  const hp = new Tone.Filter(120,'highpass'); const lp = new Tone.Filter(11000,'lowpass'); const vol= new Tone.Volume(gain);
  hp.connect(lp); lp.connect(vol); vol.connect(out);
  const synth = new Tone.Synth({ oscillator:{type:'sine'} }).connect(hp);

  const hz = noteToHz(pitch);
  const barSec = 4, baseInt = barSec/div;
  let on=true, count=0, t=null;

  const kick = (delay=0)=>{
    if(!on) return;
    const now = Tone.now() + delay;
    synth.triggerAttackRelease(hz, dur, now);
    count++;
    const isEven = (count%2)===0;
    const sgn = isEven ? -1 : +1;
    const swingOffset = sgn * (baseInt * swing * 0.5);
    t = setTimeout(()=>kick(), (baseInt + swingOffset)*1000);
  };

  // apply phase offset first
  setTimeout(()=>kick(), offset*barSec*1000);

  return ()=>{ on=false; clearTimeout(t); try{ synth.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){ } };
}

/* helpers */
function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function noteToHz(note){ /* same as rail */ 
  const pc = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
  const ratios = {A:1,'A#':16/15,B:9/8,C:6/5,'C#':5/4,D:4/3,'D#':45/32,E:3/2,F:8/5,'F#':5/3,G:9/5,'G#':15/8};
  const m = /^([A-G])(#?)(\d)$/.exec(String(note).toUpperCase()); if(!m) return 440;
  const name=(m[1]+m[2]); const oct=Number(m[3]);
  const pcIndex=pc.indexOf(name); const s=semisFromA4(name,oct);
  const r=ratios[name]||1; const et_pc=Math.pow(2,(pcIndex)/12);
  return 440*(r/et_pc)*Math.pow(2,(s-pcIndex)/12);
}
function semisFromA4(name,oct){ const map={A:0,'A#':1,B:2,C:3,'C#':4,D:5,'D#':6,E:7,F:8,'F#':9,G:10,'G#':11}; return (oct-4)*12 + map[name]; }
