// title: basalt — amen kit (grain-stretch, onset slices, live set)
// engine: tone
// usage examples:
//   play basalt                         // default groove @142 bpm
//   play basalt pattern=dnb2 swing=0.12
//   play basalt map=grid16 bpm=150
//   play basalt crush=0.25 glitch=0.15
//   set s1 mode=stutter freezeLen=0.25
//   set s1 slowdown=2                  // play every 2nd 16th (immediate, no tape)
//   set s1 invert=on                   // reverse playback (instant)
//   set s1 pattern=fill
//   set s1 bpm=128 swing=0.08
//   set s1 grain=0.05 overlap=0.35
export async function start({ Tone, params={}, out }) {
  await Tone.start();
  await Tone.loaded();

  /* ---------- params / sugar ---------- */
  const pos = Array.isArray(params._) ? params._ : [];
  const get = (k, d) => {
    if (params[k] != null) return params[k];
    const hit = pos.find(t => String(t).toLowerCase().startsWith(k + '='));
    return hit ? hit.split('=').slice(1).join('=').trim() : d;
  };
  const toNum = (v, d) => {
    const n = Number(v); return Number.isFinite(n) ? n : d;
  };
  const toBool = (v, d=false) => {
    if (v === true || v === false) return v;
    const s = String(v||'').toLowerCase();
    if (!s) return d;
    return ['1','true','on','yes','y'].includes(s);
  };

  /* ---------- audio chain (safety + FX) ---------- */
  const vol   = new Tone.Volume(toNum(get('gain', -12), -12));
  const hp    = new Tone.Filter(70, 'highpass');         // laptop-safe
  const lp    = new Tone.Filter(11000, 'lowpass');
  const crush = new Tone.BitCrusher(8);                  // 8 bits (min = more crush)
  // We’ll map crushAmount 0..1 to bits 8..3 (musical range)
  const crushWet = new Tone.Gain(0);                     // manual wet
  const dryTap   = new Tone.Gain(1);

  // bus: [player]→(dry+crush)→ hp → lp → vol → out
  dryTap.connect(hp); crush.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);
  crushWet.connect(crush); // we’ll feed player into both dryTap and crushWet

  /* ---------- sample player (GrainPlayer for time-stretch) ---------- */
  const defaultUrl = 'https://drive.google.com/file/d/13n8UWPSfY-Oy2mtZaj_DNv_RV-mME6Pc/';
  const url = String(get('url', defaultUrl));

  const player = new Tone.GrainPlayer({
    url,
    loop: false,
    grainSize: toNum(get('grain', 0.04), 0.04),     // 40 ms grains
    overlap:  toNum(get('overlap', 0.33), 0.33),    // 33% overlap
    playbackRate: 1,
    fadeIn: 0.003, fadeOut: 0.003,
    onload: () => { STATE.bufDur = player.buffer?.duration || STATE.bufDur; }
  }).sync(); // we’ll schedule in audio time, but syncing lets us use Tone.Transport if desired later

  // route player into parallel dry / crush
  player.connect(dryTap);
  player.connect(crushWet);

  /* ---------- canonical onset map + grid16 fallback ---------- */
  // Relative (0..1) positions for common Amen onsets (approx; robust across sources)
  const AMEN_ONSETS = [
    0.000, 0.057, 0.101, 0.153, 0.210, 0.262, 0.314, 0.367,
    0.423, 0.473, 0.530, 0.582, 0.634, 0.689, 0.742, 0.795
  ];
  const STATE = {
    bpm:       toNum(get('bpm', 142), 142),
    swing:     toNum(get('swing', 0.0), 0.0),       // 0..0.2 good
    map:       String(get('map','onset')).toLowerCase(), // onset | grid16
    pattern:   String(get('pattern','amen')).toLowerCase(),
    mode:      String(get('mode','normal')).toLowerCase(), // normal|stutter|freeze|chop|screw
    slowdown:  Math.max(1, Math.floor(toNum(get('slowdown', 1), 1))), // 1=normal, 2=every 2nd 16th…
    invert:    toBool(get('invert', false), false),
    glitch:    Math.max(0, Math.min(1, toNum(get('glitch', 0.0), 0.0))), // 0..1 prob
    crushAmt:  Math.max(0, Math.min(1, toNum(get('crush', 0.0), 0.0))), // 0..1
    freezeLen: Math.max(0.03, toNum(get('freezeLen', 0.20), 0.20)),     // seconds of micro-stutter when active
    grain:     toNum(get('grain', 0.04), 0.04),
    overlap:   toNum(get('overlap', 0.33), 0.33),
    bufDur:    2.0,
    running:   true,
    shiftHeld: false,   // macro gate (Shift+Space)
    spaceHeld: false
  };

  // apply initial crush wet/bit mapping
  function setCrushWet(x){
    const bits = Math.round(8 - 5 * Math.max(0, Math.min(1, x))); // 0→8bits, 1→3bits
    try { crush.bits = Math.max(1, Math.min(16, bits)); } catch(_){}
    crushWet.gain.rampTo(Math.max(0, Math.min(1, x)), 0.06);
  }
  setCrushWet(STATE.crushAmt);

  /* ---------- patterns (16th steps; -1 = rest) ---------- */
  // All patterns are 16 or 32 steps using onset slice indices 0..15
  const PATS = {
    amen:  [0,1,2,3, 4,5,6,7, 8,9,10,11, 12,13,14,15],
    // classic DnB-ish 2 bar roll (32)
    dnb2:  [0,2,3,5, 7,7,6,5, 8,10,11,13, 15,15,14,13,
            0,2,3,5, 4,6,6,5, 8,10,11,13, 15,14,13,11],
    half:  [0,-1,2,-1, 4,-1,6,-1, 8,-1,10,-1, 12,-1,14,-1],
    sparse:[0,-1,2,-1, -1,5,-1,-1, 8,-1,-1,11, -1,-1,14,-1],
    fill:  [0,1,2,3, 7,6,5,4, 8,9,10,11, 15,14,13,12],
    // 2-bar chopped inversion
    screw: [15,14,13,12, 11,10,9,8, 7,6,5,4, 3,2,1,0,
            12,13,14,15, 8,9,10,11, 4,5,6,7, 0,1,2,3]
  };
  function pickPat(name){
    return PATS[name] || PATS.amen;
  }

  /* ---------- slice table (offsets + per-slice length) ---------- */
  function buildSlices(bufferDur){
    const on = AMEN_ONSETS.slice();
    const offsets = on.map(x => x * bufferDur);
    const lengths = on.map((x,i)=> ((on[i+1] ?? 1) - x) * bufferDur);
    // grid16 fallback (evenly spaced)
    const gOff = new Array(16).fill(0).map((_,i)=> (i/16) * bufferDur);
    const gLen = new Array(16).fill(bufferDur/16);
    return STATE.map === 'onset'
      ? { off: offsets, len: lengths }
      : { off: gOff,    len: gLen };
  }

  let SL = buildSlices(STATE.bufDur);

  /* ---------- clock (independent; no Transport dependence) ---------- */
  const stepDur = () => (60 / Math.max(30, STATE.bpm)) / 4; // 16th seconds, guard low BPM
  const clock = new Tone.Clock(tick, 1 / stepDur());        // frequency = steps/sec
  clock.start();

  // re-tune frequency on BPM change
  function retuneClock(){ try{ clock.frequency.value = 1 / stepDur(); }catch(_){} }

  /* ---------- scheduling helpers ---------- */
  let stepIdx = 0;       // absolute step counter
  let lastSlice = 0;     // last actually fired slice
  function swingOffsetFor(stepTime, idx){
    // simple classic swing on odd 16ths: delay by swing * 1/16 note
    const sixteen = stepDur();
    const odd = (idx % 2) === 1;
    return odd ? STATE.swing * sixteen : 0;
  }
  function randomGlitchSlice(){
    // pick a neighboring or distant slice; tasteful spread
    const r = Math.random();
    if (r < 0.5) return (lastSlice + (Math.random()<0.5 ? -1 : +1) + 16) % 16;
    return Math.floor(Math.random() * 16);
  }

  // core tick (one 16th logical step)
  function tick(time){
    if (!STATE.running) return;

    // slowdown: only fire every Nth step (no tape; immediate density change)
    if ((stepIdx % STATE.slowdown) !== 0) { stepIdx++; return; }

    const pat = pickPat(STATE.pattern);
    const i = stepIdx % pat.length;
    let slice = pat[i];
    if (slice < 0) { stepIdx++; return; }

    // glitch substitution
    if (Math.random() < STATE.glitch) slice = randomGlitchSlice();

    // schedule time w/ swing
    const t = time + swingOffsetFor(time, i);

    // pull slice offsets (buffer may not be loaded yet; guard)
    const off = (SL.off[slice] || 0);
    const len = Math.max(0.035, (SL.len[slice] || 0.12) - 0.004); // trim a hair

    // mode/invert handling
    const rev = !!STATE.invert || STATE.mode === 'screw';
    const dur = Math.min(len, stepDur() * STATE.slowdown); // don’t overrun step window

    if (STATE.mode === 'freeze' || (STATE.shiftHeld && STATE.spaceHeld) || STATE.mode === 'stutter'){
      // micro-stutter: repeat the last (or current) grain in fast taps
      const baseOff = (STATE.mode === 'stutter') ? (SL.off[lastSlice] || off) : off;
      const tap = Math.max(0.03, Math.min(STATE.freezeLen, dur));
      const reps = Math.max(1, Math.floor(dur / tap));
      for (let r=0; r<reps; r++){
        player.reverse = rev;
        const startOffset = rev
          ? Math.max(0, (STATE.bufDur - baseOff - tap))
          : baseOff;
        player.start(t + r*tap, startOffset, tap);
      }
      lastSlice = slice;
      stepIdx++;
      return;
    }

    // normal/chop/screw:
    // 'chop' gently shortens grains; 'screw' reverses
    const useDur = (STATE.mode === 'chop') ? Math.min(dur, 0.09) : dur;
    player.reverse = rev;
    const startOffset = rev
      ? Math.max(0, (STATE.bufDur - off - useDur))
      : off;
    player.start(t, startOffset, useDur);

    lastSlice = slice;
    stepIdx++;
  }

  /* ---------- live updates (for `set sN k=v`) ---------- */
  function apply(patch = {}){
    let retune = false, rebuild = false, regrain=false;

    if ('pattern' in patch)    STATE.pattern  = String(patch.pattern||'').toLowerCase() || STATE.pattern;
    if ('mode' in patch)       STATE.mode     = String(patch.mode||'').toLowerCase()    || STATE.mode;
    if ('slowdown' in patch) { STATE.slowdown = Math.max(1, Math.floor(Number(patch.slowdown)||1)); }
    if ('invert' in patch)     STATE.invert   = toBool(patch.invert, STATE.invert);

    if ('bpm' in patch){ STATE.bpm = Math.max(30, Number(patch.bpm)||STATE.bpm); retune = true; }
    if ('swing' in patch){ STATE.swing = Math.max(0, Math.min(0.4, Number(patch.swing)||0)); }

    if ('glitch' in patch){ STATE.glitch = Math.max(0, Math.min(1, Number(patch.glitch)||0)); }
    if ('crush'  in patch){ STATE.crushAmt = Math.max(0, Math.min(1, Number(patch.crush)||0)); setCrushWet(STATE.crushAmt); }

    if ('freezeLen' in patch){ STATE.freezeLen = Math.max(0.03, Number(patch.freezeLen)||STATE.freezeLen); }

    if ('map' in patch){
      const m = String(patch.map||'').toLowerCase();
      if (m === 'onset' || m === 'grid16'){ STATE.map = m; rebuild = true; }
    }

    if ('grain' in patch){ STATE.grain = Math.max(0.01, Number(patch.grain)||STATE.grain); regrain=true; }
    if ('overlap' in patch){ STATE.overlap = Math.max(0.05, Math.min(0.9, Number(patch.overlap)||STATE.overlap)); regrain=true; }

    if ('gain' in patch){ try{ vol.volume.rampTo(Number(patch.gain)||-12, 0.05); }catch(_){} }

    if (retune) retuneClock();
    if (rebuild) SL = buildSlices(STATE.bufDur);
    if (regrain){ try{ player.grainSize = STATE.grain; player.overlap = STATE.overlap; }catch(_){} }
  }

  /* ---------- keyboard macro: Shift+Space = momentary freeze ---------- */
  // Only when the terminal input has focus (id: cb-input). We isolate handlers so
  // multiple running engines don’t stack listeners.
  const keyHandler = (e) => {
    const target = document.getElementById('cb-input') || document.activeElement;
    const focused = (target && (target.id === 'cb-input' || target.getAttribute('data-role') === 'cli'));
    if (!focused) return;
    if (e.type === 'keydown'){
      if (e.key === 'Shift') STATE.shiftHeld = true;
      if (e.code === 'Space' && e.shiftKey){ STATE.spaceHeld = true; e.preventDefault(); }
    } else if (e.type === 'keyup'){
      if (e.key === 'Shift') STATE.shiftHeld = false;
      if (e.code === 'Space'){ STATE.spaceHeld = false; }
    }
  };
  window.addEventListener('keydown', keyHandler, true);
  window.addEventListener('keyup',   keyHandler, true);

  /* ---------- react to buffer load (slice rebuild) ---------- */
  const waitBuf = async () => {
    // If buffer not yet ready, poll a few times gracefully
    for (let i=0;i<60;i++){
      const d = player.buffer?.duration;
      if (d && isFinite(d) && d > 0.2){ STATE.bufDur = d; SL = buildSlices(d); break; }
      await Tone.Time('16n').toSeconds(); // tiny yield
      await new Promise(r=>setTimeout(r, 8));
    }
  };
  try { await waitBuf(); } catch(_){}

  /* ---------- return controller (stopper function with .update) ---------- */
  const stop = async () => {
    STATE.running = false;
    try { clock.stop(); clock.dispose(); } catch(_){}
    try { player.stop(); player.dispose(); } catch(_){}
    try { crush.dispose(); } catch(_){}
    try { dryTap.dispose(); crushWet.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); } catch(_){}
    try {
      window.removeEventListener('keydown', keyHandler, true);
      window.removeEventListener('keyup',   keyHandler, true);
    } catch(_){}
  };
  stop.update = apply; // <- critical for `set sN …`

  return stop;
}
