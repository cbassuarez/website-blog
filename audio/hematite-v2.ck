// hematite-reson.ck — Modal resonator with internal hits, audible on run.
// 135 BPM 8th-note hits, "gong" bank, subtle verb.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 2.0 => dur hitInt; // 8ths

// ----- modal banks -----
fun void bank_gong(float base, float freqs[], float qs[], float gains[]) {
    [ 1.00, 1.41, 1.79, 2.15, 2.30, 2.63 ] @=> float r[];
    r.size() => int n;
    n => freqs.size; n => qs.size; n => gains.size;
    for (0 => int i; i < n; i++) {
        base * r[i] => freqs[i];
        80 + (i*25) => qs[i];
        1.0 / (1 + i*0.6) => gains[i];
    }
}

fun void bank_plate(float base, float freqs[], float qs[], float gains[]) {
    [ 1.00, 1.26, 1.51, 1.62, 1.96, 2.40 ] @=> float r[];
    r.size() => int n;
    n => freqs.size; n => qs.size; n => gains.size;
    for (0 => int i; i < n; i++) {
        base * r[i] => freqs[i];
        120 + (i*35) => qs[i];
        1.0 / (1 + i*0.5) => gains[i];
    }
}

// ----- modal structure -----
class ModalBank {
    Gain bus; // input sum
    Gain sum; // output sum
    0.0 => sum.gain;

    fun void build(float f[], float q[], float g[]) {
        for (0 => int i; i < f.size(); i++) {
            // parallel resonators, each taps to sum
            bus => Resonz r => Gain tap => sum;
            f[i] => r.freq;
            q[i] => r.Q;
            g[i] * 0.12 => tap.gain;  // per-mode level (conservative)
        }
        1.0 => sum.gain;
    }
}

// ----- graph -----
Impulse imp => Gain in;
ModalBank mb;
in => mb.bus;

mb.sum => Gain out => NRev verb => dac;
0.06 => verb.mix;
0.18 => out.gain;

// ----- defaults -----
220.0 => float base; // A3-ish
float F[]; float Q[]; float G[];
bank_gong(base, F, Q, G);
mb.build(F, Q, G);

// excitation: two short taps
fun void excite(float amp) {
    amp => imp.next;
    1::samp => now;
    amp * 0.6 => imp.next;
}

// loop
0.85 => float hitAmp;

while (true) {
    (220.0 + Std.rand2f(-3.0, 3.0)) => base;
    // (optional) slight retuning by rebuilding would be heavier; keep static
    excite(hitAmp);
    hitInt => now;
}
