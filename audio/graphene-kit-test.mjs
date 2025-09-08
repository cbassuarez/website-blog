// title: graphene — granular glitch kit (Tone engine, laptop-safe)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  /* ---------- params & presets ---------- */
  const P = normParams(params || {});
  applyPreset(P); // sets baseline; explicit flags in P already override

  /* ---------- safety chain / master bus ---------- */
  const hp   = new Tone.Filter(30, 'highpass');
  const lp   = new Tone.Filter(12000, 'lowpass');
  const drv  = new Tone.Distortion(dbToDrive(P.drive)); drv.wet.value = 1;
  const crush= new Tone.BitCrusher(4); crush.wet.value = clamp01(P.crush);
  const comp = new Tone.Limiter(-2); // gentle safety
  const master = new Tone.Gain(dbToGain(-6)); // headroom before limiter

  hp.connect(lp); lp.connect(drv); drv.connect(crush); crush.connect(master); master.connect(comp); comp.connect(out);

  // tiny plate for clap/snare
  const verb = new Tone.Reverb({ decay: 0.9, wet: clamp01(P.verb) });
  verb.connect(master);

  /* ---------- per-voice synths & gains ---------- */
  const vGain = {
    kick : new Tone.Gain(dbToGain(P.kGain)).connect(hp),
    snare: new Tone.Gain(dbToGain(P.sGain)).connect(hp),
    hat  : new Tone.Gain(dbToGain(P.hGain)).connect(hp),
    clap : new Tone.Gain(dbToGain(P.cGain)).connect(hp),
    perc : new Tone.Gain(dbToGain(P.pGain)).connect(hp),
  };

  const kick  = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, oscillator:{ type:'sine'}, envelope:{ attack:0.001, decay:0.28, sustain:0.0, release:0.03 } }).connect(vGain.kick);
  const kClick= new Tone.NoiseSynth({ noise:{type:'white'}, envelope:{ attack:0.0005, decay:0.01, sustain:0.0, release:0.01 } }).connect(vGain.kick);
  const snBody= new Tone.NoiseSynth({ noise:{type:'white'}, envelope:{ attack:0.001, decay:0.12, sustain:0, release:0.03 } });
  const snBP  = new Tone.Filter(1800, 'bandpass'); snBody.connect(snBP).connect(vGain.snare);
  const snTone= new Tone.Synth({ oscillator:{type:'sine'}, envelope:{ attack:0.001, decay:0.08, sustain:0, release:0.02 } }).connect(vGain.snare);
  const hatNs = new Tone.NoiseSynth({ noise:{type:'white'}, envelope:{ attack:0.0005, decay:0.03, sustain:0, release:0.01 } });
  const hatHP = new Tone.Filter(8000, 'highpass'); hatNs.connect(hatHP).connect(vGain.hat);
  const clapN = new Tone.NoiseSynth({ noise:{type:'white'}, envelope:{ attack:0.001, decay:0.05, sustain:0, release:0.02 } }).connect(vGain.clap);
  const cSend = new Tone.Gain( clamp01(P.verb) ).connect(verb);
  vGain.snare.connect(cSend); vGain.clap.connect(cSend);

  // perc: inharmonic blips or noise pops (set by P.pMode)
  const percTone = new Tone.Synth({ oscillator:{type:'sine'}, envelope:{ attack:0.0008, decay:0.04, sustain:0, release:0.02 } }).connect(vGain.perc);
  const percNs   = new Tone.NoiseSynth({ envelope:{ attack:0.0008, decay:0.025, sustain:0, release:0.02 } }).connect(vGain.perc);

  /* ---------- patterns (step strings or density) ---------- */
  const prng = mulberry32(P.seed|0);
  const steps = P.len|0;
  const pat = {
    kick : compilePattern(P.kPat, P.kDen, steps, prng, 1),
    snare: compilePattern(P.sPat, P.sDen, steps, prng, 2),
    hat  : compilePattern(P.hPat, P.hDen, steps, prng, 3),
    clap : compilePattern(P.cPat, P.cDen, steps, prng, 4),
    perc : compilePattern(P.pPat, P.pDen, steps, prng, 5),
  };
  const acc = { // accents for step strings (X)
    kick : accentsFrom(P.kPat, steps),
    snare: accentsFrom(P.sPat, steps),
    hat  : accentsFrom(P.hPat, steps),
    clap : accentsFrom(P.cPat, steps),
    perc : accentsFrom(P.pPat, steps),
  };

  /* ---------- clock & scheduler ---------- */
  const barSec   = 240 / P.bpm;
  const stepSec  = barSec / steps;
  const eighth   = barSec / 8;
  const swingAmt = clamp(P.swing, 0, 0.65); // 0..~0.65 (0.5 = straight)
  const humanMs  = Math.max(0, P.human);

  let i = -1; let barCount = 0; let stutter = { on:false, until:0 };

  const clock = new Tone.Clock((t0) => {
    i = (i + 1) % steps;
    if (i === 0) { // new bar
      barCount++;
      // maybe glitch/stutter for a short window
      if (Math.random() < clamp01(P.glitch)) {
        const dur = randomChoice([1/8, 1/6, 1/4]) * barSec;
        stutter.on = true;
        stutter.until = t0 + dur;
        // briefly goose crusher wet
        const target = Math.min(1, P.crush + 0.2);
        crush.wet.cancelAndHoldAtTime(t0);
        crush.wet.setValueAtTime(crush.wet.value, t0);
        crush.wet.linearRampToValueAtTime(target, t0 + dur * 0.4);
        crush.wet.linearRampToValueAtTime(clamp01(P.crush), t0 + dur);
      }
    }

    // step time with swing + humanize
    let t = t0;
    if ((steps % 2 === 0) && (i % (steps/8) === (steps/8 - 1))) {
      // off-8th positions: delay by swing
      const swingOffset = (swingAmt - 0.5) * 2 * (eighth / 2); // classic feel
      if (swingOffset > 0) t += swingOffset;
    }
    if (humanMs > 0) t += ( (prng()*2 - 1) * humanMs ) / 1000;

    // schedule voices
    if (P.kick && pat.kick[i])  hitKick(t, acc.kick[i], prng, P);
    if (P.snare && pat.snare[i]) hitSnare(t, acc.snare[i], prng, P);
    if (P.hat && pat.hat[i])    hitHat(t, acc.hat[i], prng, P);
    if (P.clap && pat.clap[i])  hitClap(t, acc.clap[i], prng, P);
    if (P.perc && pat.perc[i])  hitPerc(t, acc.perc[i], prng, P);

    // stutter overlay: inject rapid hats/perc for the window
    if (stutter.on) {
      const now = t0;
      if (now >= stutter.until) {
        stutter.on = false;
      } else {
        const micro = stepSec / 4; // ~1/64
        for (let k = 1; k <= 3; k++) {
          const tt = t0 + k * micro * 0.33;
          if (P.hat)  hitHat(tt, 1.0, prng, P, 0.6);
          if (P.perc) hitPerc(tt, 1.0, prng, P, 0.6);
        }
      }
    }
  }, 1 / stepSec);

  clock.start();

  /* ---------- voice triggers ---------- */
  function hitKick(time, accent, R, P) {
    const vel  = accentVel(accent) * 1.0;
    const tone = clamp01(P.kTone);
    // body
    kick.triggerAttackRelease(60, '8n', time, vel);
    // click grain
    if (tone > 0) kClick.triggerAttackRelease('64n', time, vel * tone);
    // ratchet?
    maybeRatchet(P.kRat, P.ratSteps, time, (tt)=> {
      kick.triggerAttackRelease(60, '32n', tt, vel*0.7);
      if (tone>0) kClick.triggerAttackRelease('64n', tt, vel*0.5*tone);
    });
  }

  function hitSnare(time, accent, R, P) {
    const vel = accentVel(accent) * 0.9;
    // noise body tilt
    const tilt = lerp(1200, 2800, clamp01(P.sTone));
    snBP.frequency.setValueAtTime(tilt, time);
    snBody.triggerAttackRelease('16n', time, vel);
    if (P.sTone > 0.2) snTone.triggerAttackRelease(lerpHz(180, 240, R()), '16n', time, vel*0.5);
    maybeRatchet(P.sRat, P.ratSteps, time, (tt)=> snBody.triggerAttackRelease('32n', tt, vel*0.6));
  }

  function hitHat(time, accent, R, P, scale=1.0) {
    const vel = accentVel(accent) * 0.6 * scale;
    // AM-ish fizz via quick detune of filter (cheap “metal”)
    hatHP.frequency.setValueAtTime(7800 + 1000*clamp01(P.hTone), time);
    hatNs.triggerAttackRelease('64n', time, vel);
    maybeRatchet(P.hRat, P.ratSteps, time, (tt)=> hatNs.triggerAttackRelease('64n', tt, vel*0.65));
  }

  function hitClap(time, accent, R, P) {
    const vel = accentVel(accent) * 0.8;
    const taps = 3 + Math.floor(R()*3); // 3–5 slaps
    const base = Math.max(20, Math.min(240, P.cTail|0));
    for (let n=0; n<taps; n++){
      const off = (R()*0.008) * (n===0?0:1); // 0–8ms
      clapN.triggerAttackRelease((base/1000)+'s', time+off, vel*(n?0.7:1));
    }
    maybeRatchet(P.cRat, P.ratSteps, time, (tt)=> clapN.triggerAttackRelease('64n', tt, vel*0.5));
  }

  function hitPerc(time, accent, R, P, scale=1.0) {
    const vel = accentVel(accent) * 0.7 * scale;
    if (P.pMode === 'noise') {
      percNs.triggerAttackRelease('64n', time, vel);
    } else if (P.pMode === 'mix') {
      percNs.triggerAttackRelease('64n', time, vel*0.6);
      percTone.triggerAttackRelease(lerpHz(400, 1100, R()), '64n', time+0.003, vel*0.7);
    } else { // blip
      const f = inharmonic(R);
      percTone.triggerAttackRelease(f, '64n', time, vel);
    }
    maybeRatchet(P.pRat, P.ratSteps, time, (tt)=> percTone.triggerAttackRelease(inharmonic(R), '128n', tt, vel*0.6));
  }

  function maybeRatchet(prob, steps, t0, fire){
    if (Math.random() < clamp01(prob)) {
      const n = clamp(Math.round(steps||3), 2, 4);
      const gap = stepSec / n;
      for (let k=1;k<n;k++) fire(t0 + k*gap*0.5);
    }
  }

  /* ---------- teardown ---------- */
  return () => {
    try{ clock.stop(); clock.dispose(); }catch(_){}
    try{ [kick,kClick,snBody,snBP,snTone,hatNs,hatHP,clapN,percTone,percNs,verb].forEach(x=>x.dispose?.()); }catch(_){}
    try{ Object.values(vGain).forEach(g=>g.dispose?.()); }catch(_){}
    try{ [hp,lp,drv,crush,master,comp].forEach(n=>n.dispose?.()); }catch(_){}
  };

  /* ---------- helpers ---------- */
  function normParams(p){
    const toNum = (v,d)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
    const onoff = (v)=> String(v||'on').toLowerCase()!=='off';
    return {
      // globals
      bpm: toNum(p.bpm, 96),
      len: clamp(parseInt(p.len??16,10)||16, 8, 32),
      swing: Number.isFinite(+p.swing)? +p.swing : 0.56,
      human: toNum(p.human, 6),
      preset: parseInt(p.preset||1,10),
      drive: toNum(p.drive, -6),
      crush: toNum(p.crush, 0.15),
      verb:  toNum(p.verb, 0.12),
      glitch: toNum(p.glitch, 0.10),
      seed: parseInt(p.seed||1,10),

      // toggles
      kick: onoff(p.kick), snare: onoff(p.snare), hat: onoff(p.hat), clap: onoff(p.clap), perc: onoff(p.perc),

      // gains
      kGain: toNum(p.kGain, -2), sGain: toNum(p.sGain, -4), hGain: toNum(p.hGain, -8), cGain: toNum(p.cGain, -6), pGain: toNum(p.pGain, -8),

      // tone
      kTone: toNum(p.kTone, 0.6), sTone: toNum(p.sTone, 0.5), hTone: toNum(p.hTone, 0.5), cTail: toNum(p.cTail, 110),
      pMode: (p.pMode||'blip').toString().toLowerCase(),

      // ratchets
      kRat: toNum(p.kRat, 0.06), sRat: toNum(p.sRat, 0.04), hRat: toNum(p.hRat, 0.08), cRat: toNum(p.cRat, 0.02), pRat: toNum(p.pRat, 0.10),
      ratSteps: clamp(parseInt(p.ratSteps||3,10), 2, 4),

      // patterns (step strings have priority over density)
      kPat: cleanPat(p.kPat), sPat: cleanPat(p.sPat), hPat: cleanPat(p.hPat), cPat: cleanPat(p.cPat), pPat: cleanPat(p.pPat),
      kDen: den(p.kDen, 0.8), sDen: den(p.sDen, 0.35), hDen: den(p.hDen, 0.75), cDen: den(p.cDen, 0.20), pDen: den(p.pDen, 0.20),
    };
    function cleanPat(s){ return (s && String(s).trim()) || ''; }
    function den(v,d){ const n=Number(v); return Number.isFinite(n)? clamp01(n) : d; }
  }

  function applyPreset(P){
    switch (P.preset|0){
      case 2: // Glass Drift
        P.bpm=96; P.hDen=0.65; P.cTail=110; P.verb=0.16; P.glitch=0.06; P.crush=0.12; P.drive=-6; break;
      case 3: // Busy Weave
        P.bpm=108; P.hDen=0.9; P.kRat=0.10; P.sRat=0.08; P.pDen=0.35; P.glitch=0.12; break;
      case 4: // Low Ember
        P.bpm=84; P.hDen=0.55; P.sDen=0.35; P.cTail=140; P.verb=0.2; P.glitch=0.05; P.crush=0.10; break;
      case 5: // Finale
        P.bpm=120; P.hDen=0.9; P.sDen=0.55; P.pDen=0.4; P.crush=0.28; P.drive=-4; P.glitch=0.22; break;
      default: // Primer
        // leave defaults
        break;
    }
  }

  function compilePattern(stepStr, density, steps, prng, salt){
    if (stepStr && stepStr.length) {
      const s = stepStr.replace(/\s+/g,'');
      const arr = new Array(steps).fill(false);
      for (let i=0;i<steps;i++){
        const c = s[i % s.length] || '-';
        arr[i] = (c==='x' || c==='X');
      }
      return arr;
    }
    // density model (deterministic per step)
    const arr = new Array(steps).fill(false);
    for (let i=0;i<steps;i++){
      const r = frac32(P.seed ^ (i*73856093) ^ (salt*19349663));
      arr[i] = (r < clamp01(density));
    }
    return arr;
  }
  function accentsFrom(stepStr, steps){
    const out = new Array(steps).fill(0);
    if (!stepStr) return out;
    const s = stepStr.replace(/\s+/g,'');
    for (let i=0;i<steps;i++){
      const c = s[i % s.length] || '-';
      out[i] = (c==='X') ? 1 : 0;
    }
    return out;
  }

  function accentVel(accent){ return accent ? 1.25 : 1.0; }
  function dbToGain(db){ return Math.pow(10, db/20); }
  function dbToDrive(db){ // map -12..-3 → 0.2..0.7 roughly
    const n = clamp(-db, 0, 18) / 18;
    return 0.15 + 0.7*n;
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function clamp01(v){ return clamp(Number(v)||0, 0, 1); }
  function lerp(a,b,t){ return a + (b-a)*clamp01(t); }
  function lerpHz(a,b,t){ return Math.max(1, lerp(a,b,t)); }
  function inharmonic(R){
    const base = lerpHz(380, 980, R());
    const ratio = [1, 1.27, 1.47][Math.floor(R()*3)];
    return base*ratio;
  }

  // PRNGs
  function mulberry32(a){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ t>>>15, t|1); t ^= t + Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14) >>> 0) / 4294967296; }; }
  function frac32(x){ // simple hash → [0,1)
    let t = x|0; t ^= t << 13; t ^= t >>> 17; t ^= t << 5; return ((t>>>0) % 100000) / 100000;
  }
  function randomChoice(arr){ return arr[Math.floor(Math.random()*arr.length)] }
}
