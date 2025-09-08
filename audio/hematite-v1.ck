// hematite-reson.ck
// Modal resonator fed by internal impulse hits.
// Safe defaults: 135 BPM pulse, 'gong' bank, gentle verb.
// Runs & sounds immediately under WebChucK.

// -------------------- tempo --------------------
135.0 => float bpm;
60.0 / bpm => float spb;
spb / 2.0 => dur hitInt;   // 8th-note hits

// -------------------- bank presets -------------
fun void bank_gong(float base, float freqs[], float qs[], float gains[]) {
    // rough inharmonic-ish set
    [ 1.00, 1.41, 1.79, 2.15, 2.30, 2.63 ] @=> float r[];
    r.size() => int n;

    n => freqs.size; n => qs.size; n => gains.size;
    for (0 => int i; i < n; i++) {
        base * r[i] => freqs[i];
        80 + (i*25) => qs[i];           // broader for low, narrower for highs
        1.0 / (1 + i*0.6) => gains[i];  // gentle roll-off
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

// -------------------- modal array --------------
class ModalBank {
    Gain bus;          // common input
    Gain sum;          // summed output
    0.0 => sum.gain;

    // build resonators from spec arrays
    fun void build(float f[], float q[], float g[]) {
        for (0 => int i; i < f.size(); i++) {
            ResonZ r => Gain tap => sum;
            bus => r; // parallel
            f[i] => r.freq;
            q[i] => r.Q;
            g[i] * 0.12 => tap.gain;   // per-mode gain
        }
        1.0 => sum.gain;
    }
}

// -------------------- graph --------------------
Impulse imp => Gain in => ModalBank mb;
in => mb.bus;

mb.sum => Dyno limiter => NRev verb => dac;
0.06 => verb.mix;
0.0  => limiter.makeup;  // transparent; just safety

// -------------------- defaults -----------------
220.0 => float base;     // base modal frequency ~A3
float F[]; float Q[]; float G[];
bank_gong(base, F, Q, G);
mb.build(F, Q, G);

// excitation shape utility
fun void excite(float amp) {
    // a short two-tap impulse for richer excitation
    amp => imp.next;
    1::samp => now;
    amp * 0.6 => imp.next;
}

// -------------------- decay & hit loop ----------
6.0 => float decaySeconds;         // overall decay "macro"
0.85 => float hitAmp;              // base hit strength

// simple evolving hits
while (true) {
    // randomize base a little for life
    (220.0 + Std.rand2f(-3.0, 3.0)) => base;

    // excite
    excite(hitAmp);

    // optional slow envelope on output sum (macro decay feel)
    // (set once per hit)
    // tip: you can shorten/lengthen by changing decaySeconds
    // (we keep it static here for stability)

    hitInt => now;
}
