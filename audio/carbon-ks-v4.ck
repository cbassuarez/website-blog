// carbon-ks.ck — Karplus–Strong pluck set (JI) — SAFE LEVELS
// 135 BPM, A1 root. Audibly plays immediately, conservative output.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 4.0 => dur step;       // 16ths

55.0 => float root;                   // A1
[ 1.0, 7.0/6.0, 3.0/2.0, 2.0 ] @=> float ji[];

// -------- master (very conservative!) --------
Gain mix => NRev verb => Gain master => dac;
0.010 => mix.gain;    // <- MAIN OUTPUT LEVEL (very low; raise if needed)
0.08  => verb.mix;
1.0   => master.gain; // keep at 1.0; adjust mix.gain instead

// -------- single KS voice --------
class KSVoice {
    Noise n => Gain excite => DelayA d => LPF lp => Gain fb;
    fb => d;                                // feedback loop
    2::second => d.max;

    // output tap (HPF cleans rumble / DC)
    d => HPF hp => Pan2 pan => Gain tap;

    // defaults (tame)
    0.0   => excite.gain;
    0.960 => fb.gain;       // lower than before
    4200  => lp.freq;
    90.0  => hp.freq;

    fun void connect(Gain dest) { tap => dest; }
    fun void setPan(float p)    { p => pan.pan; }
    fun void setDamp(float hz)  { hz => lp.freq; }
    fun void setFeedback(float g){ g => fb.gain; }

    fun void pluck(float f, float amp) {
        (second / f) => dur del;
        del => d.delay;
        Math.min(0.08, Math.max(0.0, amp * 0.12)) => excite.gain; // much softer
        2::ms => now;
        0.0 => excite.gain;
    }
}

// -------- small ensemble (3 voices, safer) --------
3 => int N;
KSVoice v[N];
for (0 => int i; i < N; i++) {
    v[i].connect(mix);
    (i$float/(N-1)$float * 1.6 - 0.8) => v[i].setPan;
    v[i].setDamp(3600.0 - 240.0 * i);
    0.958 + 0.002 * i => v[i].setFeedback;
}

// pattern / dynamics (tame)
[ 0,1,2,1,  0,1,3,2 ] @=> int pat[];
[ 0.65, 0.52, 0.58, 0.55,  0.65, 0.52, 0.58, 0.57 ] @=> float vel[];
0 => int k;

while (true) {
    k % N => int vi;
    pat[k % pat.size()] => int pidx;   // DO NOT name this 'pi' (reserved)
    v[vi].pluck(root * ji[pidx], vel[k % vel.size()]);
    k++;
    step => now;
}
