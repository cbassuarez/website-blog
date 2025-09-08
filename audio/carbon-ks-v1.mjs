// carbon-ks.ck
// Karplus–Strong pluck set (JI), self-playing ostinato.
// Safe defaults: 135 BPM, A1 root (55 Hz), mild reverb.
// Runs & sounds immediately under WebChucK.

// -------------------- tempo --------------------
135.0 => float bpm;
60.0 / bpm => float spb;
spb / 4.0 => dur step;   // 16th

// -------------------- tuning ------------------
55.0 => float root;      // A1
[ 1.0, 7.0/6.0, 3.0/2.0, 2.0 ] @=> float ji[];  // 1/1, 7/6, 3/2, 2/1

// -------------------- mixer / fx --------------
Gain mix => NRev verb => dac;
0.12 => mix.gain;
0.08  => verb.mix;       // subtle space

// -------------------- voice -------------------
class KSVoice {
    Noise n => Gain excite => DelayA d => LPF lp => Gain fb;
    // feedback loop:
    fb => d;

    // tap to output (with pan)
    d => Pan2 pan => Gain tap;
    2::second => d.max;

    0.0 => excite.gain;
    0.98 => fb.gain;     // feedback amount
    5000.0 => lp.freq;   // damping (lower = darker)

    fun void connect(Gain dest) { tap => dest; }
    fun void setPan(float p)    { p => pan.pan; }

    fun void setDamp(float hz)  { hz => lp.freq; }
    fun void setFeedback(float g) { g => fb.gain; }

    fun void pluck(float f, float amp) {
        // set delay to period
        (second / f) => dur del;
        del => d.delay;

        // short burst of noise into the line
        Math.max(0.0, amp) => excite.gain;
        3::ms => now;
        0.0 => excite.gain;
    }
}

// -------------------- ensemble ----------------
4 => int N;
KSVoice v[N];
for (0 => int i; i < N; i++) {
    v[i].connect(mix);
    (i$float / (N-1)$float * 1.6 - 0.8) => v[i].setPan; // spread -0.8..0.8
    v[i].setDamp(4800.0 - 400.0 * i);                    // slight timbre offsets
    0.97 + 0.01 * i => v[i].setFeedback;                // feedback variation
}

// -------------------- pattern -----------------
// indices into ji[] — a simple rolling ostinato
[ 0,1,2,1,  0,1,3,2 ] @=> int pat[];
0 => int k;

// dynamics
[ 0.9, 0.7, 0.85, 0.75,  0.9, 0.7, 0.85, 0.8 ] @=> float vel[];

// -------------------- player ------------------
while (true) {
    // voice round-robin
    k % N => int i;
    pat[k % pat.size()] => int pi;
    vel[k % vel.size()] => float a;

    // frequency from JI ratio
    (root * ji[pi]) => float f;

    v[i].pluck(f, a);

    k++;
    step => now;
}
