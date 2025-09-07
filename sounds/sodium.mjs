// title: sodium — JI drones (beating partials)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const base  = String(params.base ?? 'A2').toUpperCase();
  const set   = String(params.set ?? 'pentad').toLowerCase(); // 'pentad' | 'septimal3' | 'triad'
  const voices= clampInt(params.voices ?? 3, 1, 5);
  const spread= toNum(params.spread, 6);     // cents random ±spread
  const drift = toNum(params.drift, 0.15);   // Hz random ±drift
  const attack= toNum(params.attack, 1.5);
  const gain  = toNum(params.gain, -18);

  const hp = new Tone.Filter(70,'highpass'); const lp = new Tone.Filter(9000,'lowpass'); const vol= new Tone.Volume(gain);
  hp.connect(lp); lp.connect(vol); vol.connect(out);

  const baseHz = noteToHz(base);
  const banks = {
    pentad:    ['1/1','5/4','3/2','15/8','9/8'],
    septimal3: ['1/1','7/6','7/5','7/4','3/2'],
    triad:     ['1/1','5/4','3/2']
  };
  const ratios = (banks[set] || banks.pentad).slice(0, voices);

  const osc = [];
  for (const r of ratios){
    const f = baseHz * ratioToFloat(r);
    const v = new Tone.FatOscillator({ type:'sine', count:3, spread:5, frequency: f + randRange(-drift,drift) }).start();
    const a = new Tone.AmplitudeEnvelope({ attack, decay: 1.0, sustain: 0.9, release: 2.0 });
    v.connect(a); a.connect(hp);
    a.triggerAttack('+0.01');
    osc.push({ v, a });
  }

  return () => { try{ for (const o of osc){ o.a.triggerRelease(); } }catch(_){} setTimeout(()=>{ try{ osc.forEach(o=>{o.v.dispose(); o.a.dispose();}); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} }, 3000); };
}

/* helpers */
function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function randRange(a,b){ return a + Math.random()*(b-a); }
function ratioToFloat(r){ if (typeof r==='number') return r; const [n,d]=String(r).split('/').map(Number); return (n&&d)?(n/d):1; }
function noteToHz(note){ /* same mapping as rail */ 
  const pc=['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; const ratios={A:1,'A#':16/15,B:9/8,C:6/5,'C#':5/4,D:4/3,'D#':45/32,E:3/2,F:8/5,'F#':5/3,G:9/5,'G#':15/8};
  const m=/^([A-G])(#?)(\d)$/.exec(String(note).toUpperCase()); if(!m) return 220;
  const name=(m[1]+m[2]); const oct=Number(m[3]); const pcIndex=pc.indexOf(name);
  const s=semisFromA4(name,oct); const r=ratios[name]||1; const et_pc=Math.pow(2,(pcIndex)/12);
  return 440*(r/et_pc)*Math.pow(2,(s-pcIndex)/12);
}
function semisFromA4(name,oct){ const map={A:0,'A#':1,B:2,C:3,'C#':4,D:5,'D#':6,E:7,F:8,'F#':9,G:10,'G#':11}; return (oct-4)*12 + map[name]; }
