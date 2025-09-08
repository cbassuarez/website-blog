// carbon-ks.ck — Karplus–Strong pluck set (JI), SAFE LEVELS
// 135 BPM, A1 root. Runs and is audible immediately.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 4.0 => dur step;  // 16th notes

55.0 => float root;  // A1
[ 1.0, 7.0/6.0, 3.0/2.0, 2.0 ] @=> float ji[];

// ----- mixer / verb (conservative) -----
Gain mix => NRev verb => dac;
0.05 => mix.gain;   // was hot; keep low
0.08 => verb.mix;

// ----- KS voice -----
class KSVoice {
    Noise n => Gain excite => DelayA d => LPF lp => Gain fb;
    fb => d;                   // feedback loop
    d => HPF hp => Pan2 pan => Gain tap; // output tap with HPF
    2::second => d.max;

    0.0 => excite.gain;
    0.965 => fb.gain;    // tamer feedback
    4200.0 => lp.freq;   // loss in loop
    80.0 => hp.freq;     // high-pass to avoid rumble/DC

    fun void connect(Gain dest) { tap => dest; }
    fun void setPan(float p)    { p => pan.pan; }
    fun void setDamp(float hz)  { hz => lp.freq; }
    fun void setFeedback(float g){ g => fb.gain; }
    fun void setHPF(float hz)   { hz => hp.freq; }

    fun void pluck(float f, float amp) {
        (second / f) => dur del;
        del => d.delay;
        // conservative excitation; Noise is already ±1
        Math.min(0.12, Math.max(0.0, amp*0.18)) => excite.gain;
        2::ms => now;
        0.0 => excite.gain;
    }
}

// ----- ensemble -----
4 => int N;
KSVoice v[N];
for (0 => int i; i < N; i++) {
    v[i].connect(mix);
    (i$float / (N-1)$float * 1.6 - 0.8) => v[i].setPan;
    v[i].setDamp(3800.0 - 300.0 * i);
    0.962 + 0.002 * i => v[i].setFeedback;
    80.0 + 10.0 * i => v[i].setHPF;
}

// pattern / dynamics (slightly softer)
[ 0,1,2,1,  0,1,3,2 ] @=> int pat[];
[ 0.70, 0.55, 0.62, 0.58,  0.70, 0.55, 0.62, 0.60 ] @=> float vel[];
0 => int k;

while (true) {
    k % N => int vi;
    pat[k % pat.size()] => int pidx; // not 'pi' (reserved)
    v[vi].pluck(root * ji[pidx], vel[k % vel.size()]);
    k++;
    step => now;
}
