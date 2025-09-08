// hematite-reson.ck — Modal resonator (gong/plate) with internal strike
// 135 BPM 8th-note hits. Uses Noise + ADSR into a bank of BPFs.
// Runs and is audible immediately.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 2.0 => dur hitInt; // 8ths

// ----- excitation -----
Noise n => ADSR env => Gain in;
env.set(2::ms, 80::ms, 0.0, 10::ms);
0.0 => in.gain;

// ----- modal bank using BPF -----
class ModalBank {
    Gain bus; // input
    Gain sum; // output (to be connected by caller)
    1.0 => sum.gain;

    fun void build(float f[], float q[], float g[]) {
        // connect input to a set of BPFs in parallel
        for (0 => int i; i < f.size(); i++) {
            bus => BPF b => Gain tap => sum;
            f[i] => b.freq;
            q[i] => b.Q;
            g[i] * 0.10 => tap.gain; // per-mode gain (conservative)
        }
    }
}

ModalBank mb;
in => mb.bus;
mb.sum => Gain out => NRev verb => dac;
0.18 => out.gain;
0.06 => verb.mix;

// ----- banks -----
fun void bank_gong(float base, float F[], float Q[], float G[]) {
    [ 1.00, 1.41, 1.79, 2.15, 2.30, 2.63 ] @=> float r[];
    r.size() => int n; n => F.size; n => Q.size; n => G.size;
    for (0 => int i; i < n; i++) {
        base * r[i] => F[i];
        50.0 + (i*18.0) => Q[i];
        1.0 / (1.0 + i*0.6) => G[i];
    }
}

fun void bank_plate(float base, float F[], float Q[], float G[]) {
    [ 1.00, 1.26, 1.51, 1.62, 1.96, 2.40 ] @=> float r[];
    r.size() => int n; n => F.size; n => Q.size; n => G.size;
    for (0 => int i; i < n; i++) {
        base * r[i] => F[i];
        80.0 + (i*22.0) => Q[i];
        1.0 / (1.0 + i*0.5) => G[i];
    }
}

// ----- build one bank (gong by default) -----
220.0 => float base; // A3-ish
float F[]; float Q[]; float G[];
bank_gong(base, F, Q, G);
mb.build(F, Q, G);

// ----- strike helper -----
fun void strike(float amt) {
    // reset and one-shot the ADSR burst
    env.keyOff(); 1::ms => now;
    env.keyOn();
    Math.min(0.8, Math.max(0.0, amt)) => in.gain;   // how hard we hit
    // the envelope will decay; turn off after a bit
    90::ms => now;
    0.0 => in.gain;
    env.keyOff();
}

// ----- loop -----
while (true) {
    strike(0.85);
    hitInt => now;
}
