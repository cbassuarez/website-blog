// hematite-reson.ck — modal bank via ResonZ, NO feedback loops

// ----- clock -----
135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb / 2 => dur hitInt;   // 8ths

// ----- master bus (quiet defaults) -----
Gain sum => NRev rev => Gain out => dac;
0.12  => out.gain;   // overall loudness (lower if needed)
0.10  => rev.mix;

// ----- exciter (short noise tick) -----
Noise n => ADSR env => Gain exc;
0.25 => n.gain;                 // noise level (pre-envelope)
env.set(2::ms, 60::ms, 0.0, 20::ms);
0.0  => exc.gain;               // will set per-strike

// small DRY tap so you always hear something
exc => Gain dry => sum;
0.030 => dry.gain;

// ----- modal bank (stable; no internal feedback) -----
fun void buildBank(float baseHz) {
    // simple inharmonic-ish set
    [1.00, 1.41, 1.79, 2.15, 2.32, 2.63] @=> float r[];
    // per-mode post gains (kept small)
    [0.070, 0.055, 0.045, 0.040, 0.035, 0.030] @=> float g[];
    for (0 => int i; i < r.size(); i++) {
        ResonZ rz;
        exc => rz => Gain tap => sum;
        baseHz * r[i] => rz.freq;
        // moderate Q = ring without runaway
        Math.max(20.0, 80.0 - i * 10.0) => float Q;
        Q => rz.Q;
        g[i] => tap.gain;
    }
}

// pick a reasonable center (A3-ish)
220.0 => float base;
buildBank(base);

// strike helper (safe)
fun void strike(float amt) {
    // tiny boost per hit; still clamped by tap gains + out.gain
    Math.min(0.9, Math.max(0.0, amt)) => exc.gain;
    env.keyOff(); 1::ms => now;
    env.keyOn();
    100::ms => now;
    0.0 => exc.gain;
    env.keyOff();
}

// audible confirm
strike(0.85);

// loop
while (true) {
    hitInt => now;
    strike(0.75);
}
