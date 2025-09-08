// carbon-ks.ck — Karplus–Strong pluck set (JI), audible on run.
// 135 BPM, A1 root, light verb.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 4.0 => dur step;  // 16th-notes

55.0 => float root;  // A1
[ 1.0, 7.0/6.0, 3.0/2.0, 2.0 ] @=> float ji[];

// ----- mixer / fx -----
Gain mix => NRev verb => dac;
0.14 => mix.gain;
0.08 => verb.mix;

// ----- KS voice -----
class KSVoice {
    Noise n => Gain excite => DelayA d => LPF lp => Gain fb;
    fb => d;                   // feedback loop
    d => Pan2 pan => Gain tap; // output tap
    2::second => d.max;

    0.0 => excite.gain;
    0.98 => fb.gain;
    5000.0 => lp.freq;

    fun void connect(Gain dest) { tap => dest; }
    fun void setPan(float p)    { p => pan.pan; }
    fun void setDamp(float hz)  { hz => lp.freq; }
    fun void setFeedback(float g){ g => fb.gain; }

    fun void pluck(float f, float amp) {
        (second / f) => dur del;
        del => d.delay;
        Math.max(0.0, amp) => excite.gain;
        3::ms => now;
        0.0 => excite.gain;
    }
}

// ----- ensemble -----
4 => int N;
KSVoice v[N];
for (0 => int i; i < N; i++) {
    v[i].connect(mix);
    (i$float / (N-1)$float * 1.6 - 0.8) => v[i].setPan;
    v[i].setDamp(4800.0 - 400.0 * i);
    0.97 + 0.01 * i => v[i].setFeedback;
}

// pattern / dynamics
[ 0,1,2,1,  0,1,3,2 ] @=> int pat[];
[ 0.9, 0.7, 0.85, 0.75,  0.9, 0.7, 0.85, 0.8 ] @=> float vel[];
0 => int k;

while (true) {
    k % N => int vi;
    pat[k % pat.size()] => int pidx; // renamed from 'pi' → 'pidx'

    v[vi].pluck(root * ji[pidx], vel[k % vel.size()]);
    k++;
    step => now;
}
