// hematite-reson.ck — Parallel comb "gong", guaranteed audible.
// Adds small dry passthrough so strikes are heard even if modes are subtle.

135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb/2 => dur hitInt;           // 8ths

// ---------- Master ----------
Gain sum => NRev rev => Gain out => dac;
0.30  => sum.gain;   // overall level
0.10  => rev.mix;
0.9   => out.gain;

// ---------- Exciter (noise burst) ----------
Noise n => ADSR env => Gain in;
0.35 => n.gain;
env.set(2::ms, 120::ms, 0.0, 30::ms);
0.0 => in.gain;

// small DRY tap to ensure audibility
Gain dry;
in => dry => sum;
0.04 => dry.gain;

// ---------- Comb mode ----------
class CombMode {
    Gain input => DelayA d => LPF lpf => Gain fb;
    fb => d;
    d  => Gain tap;
    2::second => d.max;

    0.966 => fb.gain;
    5000  => lpf.freq;

    fun void tune(float f){ (second/f) => d.delay; }
    fun void damp(float hz){ hz => lpf.freq; }
    fun void setLevel(float g){ g => tap.gain; }
    fun UGen inlet(){ return input; }
    fun UGen outlet(){ return tap; }
}

// ---------- Bank ----------
class Bank {
    Gain bus; Gain out;
    CombMode m[6];

    fun void build(float base){
        [1.00,1.41,1.79,2.15,2.32,2.63] @=> float r[];
        for (0=>int i; i<r.size(); i++){
            bus => m[i].inlet();
            m[i].outlet() => out;
            m[i].tune(base*r[i]);
            m[i].damp(4800 - i*300);
            // Louder per-mode than before, but still safe:
            (0.22 / (1.0 + i*0.45)) => m[i].setLevel;
        }
    }
}

Bank b;
in => b.bus;
b.out => sum;

// center ≈ A3
220.0 => float base;
b.build(base);

// strike helper
fun void strike(float amt){
    env.keyOff(); 1::ms => now;
    env.keyOn();
    Math.min(0.9, Math.max(0.0, amt)) => in.gain;
    140::ms => now;
    0.0 => in.gain;
    env.keyOff();
}

// start with a confirmatory hit
strike(0.85);

while(true){
    hitInt => now;
    strike(0.75);
}
