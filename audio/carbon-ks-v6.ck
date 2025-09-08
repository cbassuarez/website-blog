// carbon-ks.ck — SAFE KS pluck (quiet by default)

// ----- clock -----
135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb / 4 => dur step;   // 16ths

// ----- tuning -----
55.0 => float root;    // A1
[1.0, 7.0/6.0, 3.0/2.0, 2.0] @=> float ji[];

// ----- signal path (very conservative levels) -----
Noise exc => Gain gate => DelayA d => LPF lp => Gain trim => NRev rv => Gain out => dac;

// input gate initially closed
0.0 => gate.gain;

// allocations
2::second => d.max;

// master trims (start LOW; raise trim.gain a little if needed)
0.004 => trim.gain;   // <- global loudness (safe)
0.10  => rv.mix;
1.00  => out.gain;

// feedback loop (stable)
d => OnePole loopLP => Gain fb => d;
0.985 => loopLP.pole;   // gentle lowpass in the loop
0.86  => fb.gain;       // < 1.0 = stable; kept conservative

// helpers
fun void tune(float f) {
    // clamp to sane range
    Math.max(20.0, f) => f;
    (1.0/f)::second => d.delay;
    // loop damping roughly tracks pitch
    Math.min(6000.0, Math.max(1200.0, f * 60.0)) => lp.freq;
}

fun void pluck(float a) {
    // hard cap excitation so it can't explode
    Math.min(0.04, Math.max(0.0, a)) => float amp;
    amp => gate.gain;
    2::ms => now;
    0.0 => gate.gain;
}

// confirm we're alive (tiny ping)
tune(root);
pluck(0.02);

// super-mellow pattern
[0,1,2,1, 0,1,3,2] @=> int pat[];
[0.28,0.22,0.24,0.22, 0.26,0.22,0.23,0.24] @=> float vel[];
0 => int k;

while (true) {
    int idx;
    pat[k % pat.size()] => idx;
    root * ji[idx % ji.size()] => float f;
    tune(f);
    vel[k % vel.size()] => float v;
    pluck(v);
    k++;
    step => now;
}
