// carbon-ks.ck — Karplus–Strong (SAFE BUILD)
// Goals: guaranteed audio, very low default level, no runaway feedback.

135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb/4 => dur step;                   // 16ths

55.0 => float root;                  // A1
[1.0, 7.0/6.0, 3.0/2.0, 2.0] @=> float ji[];

// ---------- Master (super conservative) ----------
Gain mix => NRev rev => Gain out => dac;
0.004  => mix.gain;     // MAIN OUTPUT TRIM — adjust this if needed
0.10   => rev.mix;
1.0    => out.gain;

// ---------- Single KS voice with safety ----------
class KS {
    Noise exc => Gain eg => OnePole hp => DelayA d => LPF lp => Gain fb;
    fb => d;                     // feedback loop
    d  => OnePole dcBlock => Gain tap;
    2::second => d.max;

    0.0  => eg.gain;
    0.97 => fb.gain;            // conservative feedback
    4200 => lp.freq;
    0.995 => hp.pole;           // remove DC into loop
    0.995 => dcBlock.pole;      // remove DC on output

    fun void connect(UGen u) { tap => u; }
    fun void tune(float f)   { (second/f) => d.delay; }
    fun void setDamp(float hz){ hz => lp.freq; }
    fun void setFB(float g)  { Math.min(0.985, Math.max(0.80, g)) => fb.gain; }

    // soft excitation; hard cap inside
    fun void pluck(float amp){
        Math.min(0.05, Math.max(0.0, amp)) => float a;
        a => eg.gain;
        2::ms => now;
        0.0 => eg.gain;
    }
}

KS v;
v.connect(mix);
v.setDamp(3600.0);
v.setFB(0.965);

// tiny “I’m alive” ping once at start (safe level)
spork ~ (fun void(){ v.tune(root); v.pluck(0.02); 80::ms => now; })();

// pattern (very tame dynamics)
[0,1,2,1, 0,1,3,2] @=> int pat[];
[0.30,0.22,0.26,0.23, 0.30,0.22,0.26,0.24] @=> float vel[];
0 => int k;

while(true){
    root * ji[ pat[k%pat.size()] ] => float f;
    v.tune(f);
    v.pluck(vel[k%vel.size()]);
    k++;
    step => now;
}
