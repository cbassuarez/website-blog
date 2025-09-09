// title: Glyph Fountain — console braille fountain (audio reactive)
// engine: three
// desc: High‑resolution braille particle fountain anchored at the bottom-left (prompt area).
//       Consumes window.CB_AUDIO {rms, peak, bands, flux} and supports runtime updates via
//       postMessage({type:'cb:set', patch}). Presets: calm | live | bursty | noisy.
(function GlyphFountain(){
  try{
    // ---- Config & State ----------------------------------------------------
    const cfg = {
      // Visual sizing
      res: 'med',        // low | med | high
      fps: 30,           // target fps
      palette: 'braille',// braille | (future: heavy|linework)
      // Emitter
      origin: 'prompt',  // prompt|bottom-left|center|offset
      offsetX: 10,       // columns (for origin=offset)
      offsetY: -4,       // rows (negative from bottom)
      spread: 0.55,      // radians half-angle around upward
      rate: 120,         // base particles/sec
      size: 1,           // stamp size in subcells (1..3)
      // Dynamics
      gravity: 0.16,     // +downwards per second
      windX: 0.00,       // lateral drift
      swirl: 0.28,       // rotational field strength
      drag: 0.06,        // air resistance (0..1)
      // Trails/ink
      persistence: 0.90, // trail multiplier per frame
      bleed: 0.05,       // diffuse into neighbors 0..1
      density: 1.0,      // subcell intensity multiplier
      // Audio mapping multipliers
      a_rate: 3.0,       // rms → spawn multiplier
      a_burst: 120,      // flux → extra spawns
      a_spread: 0.35,    // low band → spread add
      a_swirl: 0.30,     // mid band → swirl add
      a_sparkle: 0.75    // high band → sparkle chance
    };

    const presets = {
      calm(){ Object.assign(cfg, {
        res:'med', fps:30, palette:'braille',
        spread:0.45, rate:80, size:1,
        gravity:0.14, windX:0.00, swirl:0.20, drag:0.06,
        persistence:0.92, bleed:0.04, density:1.0,
        a_rate:2.2, a_burst:80, a_spread:0.25, a_swirl:0.20, a_sparkle:0.4
      }); },
      live(){ Object.assign(cfg, {
        res:'med', fps:45, palette:'braille',
        spread:0.55, rate:120, size:1,
        gravity:0.16, windX:0.00, swirl:0.28, drag:0.06,
        persistence:0.90, bleed:0.05, density:1.0,
        a_rate:3.2, a_burst:140, a_spread:0.35, a_swirl:0.30, a_sparkle:0.75
      }); },
      bursty(){ Object.assign(cfg, {
        res:'high', fps:45, palette:'braille',
        spread:0.65, rate:100, size:1,
        gravity:0.15, windX:0.00, swirl:0.34, drag:0.05,
        persistence:0.88, bleed:0.06, density:1.1,
        a_rate:3.5, a_burst:220, a_spread:0.40, a_swirl:0.35, a_sparkle:0.90
      }); },
      noisy(){ Object.assign(cfg, {
        res:'low', fps:30, palette:'braille',
        spread:0.75, rate:160, size:1,
        gravity:0.12, windX:0.03, swirl:0.45, drag:0.04,
        persistence:0.86, bleed:0.08, density:1.2,
        a_rate:3.8, a_burst:240, a_spread:0.45, a_swirl:0.38, a_sparkle:1.0
      }); }
    };

    // choose reasonable default
    presets.live();

    // ---- Console-print mode (no DOM overlay) -------------------------------
    const toParent = (msg)=>{ try{ parent.postMessage(msg, '*'); }catch(_){ } };

    // ---- Grid & measurement -----------------------------------------------
    function measureCell(){
      const t = document.createElement('pre');
      t.textContent = '⣿'.repeat(80)+'\n'+'⣿'.repeat(80);
      t.style.cssText = 'position:absolute;left:-9999px;top:-9999px;line-height:1;font:inherit;';
      document.body.appendChild(t);
      const r = t.getBoundingClientRect();
      t.remove();
      const cw = r.width/80; const ch = r.height/2; return {cw,ch};
    }

    let cols=0, rows=0, subW=0, subH=0, cw=8, ch=16;

    function pickRes(){ return (cfg.res==='high')? 1.0 : (cfg.res==='low'? 0.70 : 0.85); }
    function resize(){
      const m = measureCell(); cw = m.cw; ch = m.ch;
      const pad = 2; // safety
      const scale = pickRes();
      cols = Math.max(60, Math.floor((innerWidth/cw)*scale) - pad);
      rows = Math.max(24, Math.floor((innerHeight/ch)*scale) - pad);
      subW = cols*2; subH = rows*4; // braille subcells
      ink = new Float32Array(subW*subH); // reset ink on resize
      // parent can choose to keep history; do not clear
    }

    // ---- Ink buffer & renderer --------------------------------------------
    let ink = new Float32Array(1);
    const clamp01 = (v)=> v<0?0:(v>1?1:v);
    const subIdx = (sx,sy)=> (sy>=0 && sy<subH && sx>=0 && sx<subW) ? (sy*subW + sx) : -1;
    function deposit(sx,sy, w){
      const i = subIdx(sx,sy); if (i>=0) ink[i] = Math.min(1, ink[i] + w);
    }
    function bleedAround(sx,sy, amt){
      if (amt<=0) return;
      const a = amt*0.25;
      deposit(sx-1,sy, a); deposit(sx+1,sy, a);
      deposit(sx,sy-1, a); deposit(sx,sy+1, a);
    }
    // Cell intensity (average of 2x4 subcells)
    function cellVal(cx,cy){
      const baseX=cx*2, baseY=cy*4;
      let acc=0, n=0;
      for(let dy=0; dy<4; dy++){
        for(let dx=0; dx<2; dx++){
          const i = subIdx(baseX+dx, baseY+dy);
          if (i>=0){ acc += ink[i]; n++; }
        }
      }
      return n ? (acc/n) : 0;
    }
    // Code-like palette (no dot glyphs)
    const codeChars = [' ','`','.',',',':',';','-','_','~','/','\\','|','(',')','[',']','{','}','<','>','+','=','*','#','%','@'];
    function charFromVal(v){
      const idx = Math.max(0, Math.min(codeChars.length-1, Math.floor(v * (codeChars.length-1))));
      return codeChars[idx];
    }
    function renderLine(y){
      // Map per-cell intensity to code-like characters
      let line='';
      for(let x=0;x<cols;x++){
        const v = cellVal(x,y) * cfg.density;
        line += charFromVal(v);
      }
      return line;
    }
    function printTick(){
      // send one line to parent CLI; parent appends as a new line (nowrap)
      const line = renderLine(rows-1);
      toParent({ type:'cb:print', line });
    }

    // ---- Particles ---------------------------------------------------------
    const MAXP = 4000;
    const px = new Float32Array(MAXP);
    const py = new Float32Array(MAXP);
    const vx = new Float32Array(MAXP);
    const vy = new Float32Array(MAXP);
    const life = new Float32Array(MAXP);
    const age  = new Float32Array(MAXP);
    let pCount = 0;

    function kill(i){
      if (i < pCount-1){
        px[i]=px[pCount-1]; py[i]=py[pCount-1]; vx[i]=vx[pCount-1]; vy[i]=vy[pCount-1]; life[i]=life[pCount-1]; age[i]=age[pCount-1];
      }
      pCount--;
    }

    const rand = Math.random;
    const TAU = Math.PI*2;
    function spawn(n, baseSpeed=8){
      // Emitter position (in char coords)
      const ex = emitterX();
      const ey = emitterY();
      for(let k=0; k<n && pCount<MAXP; k++){
        const i = pCount++;
        px[i] = ex + (rand()*0.5 - 0.25); // subtle jitter
        py[i] = ey + (rand()*0.2 - 0.10);
        const dir = -Math.PI/2 + (rand()*2 - 1)*cfg.spread; // around upward
        const spd = baseSpeed * (0.7 + rand()*0.6);
        vx[i] = Math.cos(dir) * spd + cfg.windX*2;
        vy[i] = Math.sin(dir) * spd - cfg.gravity*2;
        const L = 1.6 + rand()*1.1; // seconds
        life[i] = L; age[i] = 0;
      }
    }

    // Swirl force around emitter (simple rotational field)
    function swirlForce(x,y){
      const cx = emitterX(), cy = emitterY() - 8; // center a bit above origin
      const dx = x - cx, dy = y - cy;
      const r2 = Math.max(1, dx*dx + dy*dy);
      const k  = cfg.swirl / r2; // decays with radius
      // perpendicular: (-dy, dx)
      return { fx: -dy * k, fy: dx * k };
    }

    // ---- Audio coupling ----------------------------------------------------
    function A(){ return (window.CB_AUDIO && +window.CB_AUDIO.rms) || 0; }
    function FLUX(){ return (window.CB_AUDIO && +window.CB_AUDIO.flux) || 0; }
    function BAND(i){ const b = (window.CB_AUDIO && window.CB_AUDIO.bands)||[]; return +((b[i|0])||0); }

    // ---- Emitter anchoring -------------------------------------------------
    function emitterX(){
      if (cfg.origin==='center') return cols*0.5;
      if (cfg.origin==='bottom-left' || cfg.origin==='prompt') return 10;
      if (cfg.origin==='offset') return Math.max(2, Math.min(cols-2, (cfg.offsetX|0)));
      return 10;
    }
    function emitterY(){
      if (cfg.origin==='center') return rows*0.55;
      if (cfg.origin==='bottom-left' || cfg.origin==='prompt') return rows - 6;
      if (cfg.origin==='offset') return Math.max(2, Math.min(rows-2, rows + (cfg.offsetY|0)));
      return rows - 6;
    }

    // ---- Main loop ---------------------------------------------------------
    let last = performance.now();
    let acc = 0; const frame = 1/Math.max(1, cfg.fps);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function step(){
      const now = performance.now();
      const dt = Math.min(0.050, (now - last)/1000);
      last = now; acc += dt;

      // decay trails each frame chunk we simulate
      const decay = cfg.persistence;

      while(acc >= frame){
        acc -= frame;

        // fade existing ink
        for(let i=0;i<ink.length;i++) ink[i] *= decay;

        if (!reduced){
          // audio
          const a = clamp01(A());
          const flux = clamp01(FLUX());
          const low  = clamp01(BAND(2));
          const mid  = clamp01(BAND(8));
          const high = clamp01(BAND(12));

          // dynamic mapping
          const spawnRate = (cfg.rate * (1 + a*cfg.a_rate)) + (flux * cfg.a_burst);
          const addSpread = low * cfg.a_spread;
          const addSwirl  = mid * cfg.a_swirl;
          const sparkle   = high * cfg.a_sparkle;

          const want = spawnRate * frame;
          const nSpawn = Math.min(400, (want|0));
          const baseSpd = 9 + a*8;
          // temp push
          const prevSpread = cfg.spread, prevSwirl = cfg.swirl;
          cfg.spread = Math.min(1.2, cfg.spread + addSpread);
          cfg.swirl  = cfg.swirl + addSwirl;
          spawn(nSpawn, baseSpd);
          cfg.spread = prevSpread; cfg.swirl = prevSwirl;

          // update particles
          const g = cfg.gravity, d = Math.max(0, Math.min(1, cfg.drag));
          for(let i=0;i<pCount;i++){
            // forces
            const S = swirlForce(px[i], py[i]);
            vx[i] += (S.fx + cfg.windX) * frame * 60;
            vy[i] += (S.fy + g) * frame * 60;
            vx[i] *= (1 - d*frame*60*0.5);
            vy[i] *= (1 - d*frame*60*0.5);
            px[i] += vx[i] * frame;
            py[i] += vy[i] * frame;

            // stamp trail
            const sx = (px[i]*2)|0, sy = (py[i]*4)|0;
            if (sx>=0 && sx<subW && sy>=0 && sy<subH){
              const w = 0.5 * cfg.density * (cfg.size);
              deposit(sx, sy, w);
              if (cfg.bleed>0) bleedAround(sx, sy, cfg.bleed*w);
              // sparkle: chance to add a nearby dot
              if (sparkle>0 && Math.random() < sparkle*0.03) deposit(sx + (Math.random()>.5?1:-1), sy, w*0.6);
            }

            // life
            age[i] += frame;
            if (age[i] > life[i] || py[i] > rows+2 || px[i]<-2 || px[i]>cols+2){ kill(i); i--; }
          }
        }
      }

      // print one line per frame to emulate CLI stream
      printTick();
      requestAnimationFrame(step);
    }

    // ---- Patching (cb:set) -------------------------------------------------
    function applyPreset(name){
      const k = String(name||'').toLowerCase();
      if (presets[k]) presets[k]();
    }
    function applyPatch(p){
      if (!p || typeof p!=='object') return;
      if (p.preset) applyPreset(p.preset);
      const map = ['res','fps','palette','origin','offsetX','offsetY','spread','rate','size','gravity','windX','swirl','drag','persistence','bleed','density','a_rate','a_burst','a_spread','a_swirl','a_sparkle'];
      for (const k of map){ if (k in p) cfg[k] = p[k]; }
      // clamp
      cfg.fps = Math.max(10, Math.min(60, cfg.fps|0));
      cfg.size = Math.max(1, Math.min(3, cfg.size|0));
      cfg.spread = Math.max(0, Math.min(1.5, +cfg.spread));
      cfg.persistence = Math.max(0.70, Math.min(0.98, +cfg.persistence));
      cfg.bleed = Math.max(0, Math.min(0.3, +cfg.bleed));
      // rebuild grid on res change
      resize();
    }
    window.addEventListener('message', (e)=>{
      const d = e && e.data; if (!d || d.type!=='cb:set') return;
      try{ applyPatch(d.patch||{}); }catch(_){ }
    });

    // ---- Boot --------------------------------------------------------------
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(step);

  }catch(err){ console.error('GlyphFountain failed', err); }
})();
