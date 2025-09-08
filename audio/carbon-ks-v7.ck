// carbon-ks.ck — SAFE & AUDIBLE KS PLUCK

// ---------- clock ----------
135.0 => float bpm;
(60.0 / bpm) :: second => dur spb;
spb / 4 => dur step;   // 16ths

// ---------- tuning ----------
55.0 => float root;    // A1
[ 1.0, 7.0/6.0, 3.0/2.0, 2.0 ] @=> float ji[];

// ---------- signal path ----------
Impulse imp => DelayA d => LPF lp => Gain trim => NRev rv => Gain out => dac;

// KS feedback loop (stable)
d => OnePole loopLP => Gain fb => d;

// allocations / initial settings
2::second => d.max;
0.985 => loopLP.pole;   // loss in the loop
0.86  => fb.gain;       // < 1.0 = stable
4000 => lp.freq;        // lowpass after delay

// loudness (set here first if needed)
0.018 => trim.gain;     // 🔈 master for the string
0.10  => rv.mix;        // small room
1.00  => out.gain;

// ---------- helpers ----------
fun void tune(float f)
{
    Math.max(20.0, f) => f;
    (1.0/f) :: second => d.delay;                    // period
    Math.min(6000.0, Math.max(1200.0, f*60.0)) => lp.freq;
}

fun void pluck(float amp)
{
    Math.min(0.4, Math.max(0.0, amp)) => float a;   // cap the hit
    a => imp.next;                                   // 1-sample impulse
    1::samp => now;                                  // let it go through
}

// ---------- boot ping (audible) ----------
tune(root);
pluck(0.25);

// gentle ostinato
[0,1,2,1, 0,1,3,2] @=> int pat[];
[0.30,0.24,0.26,0.24, 0.28,0.24,0.25,0.26] @=> float vel[];
0 => int k;

while (true)
{
    pat[k % pat.size()] => int idx;
    root * ji[idx % ji.size()] => float f;
    tune(f);
    pluck(vel[k % vel.size()]);
    k++;
    step => now;
}
