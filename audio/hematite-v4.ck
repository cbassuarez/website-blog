// hematite-reson.ck — Modal/gong-ish resonator via parallel comb loops
// No exotic UGens: just DelayA + LPF feedback loops. Audible on first run.

135.0 => float bpm;
60.0 / bpm => float spb;
spb::second / 2.0 => dur hitInt; // 8ths

// -------- master (conservative) --------
Gain sum => NRev verb => Gain master => dac;
0.18  => sum.gain;
0.08  => verb.mix;
0.8   => master.gain;

// -------- excitation: short noise burst --------
Noise n => ADSR env => Gain in;
env.set(2::ms, 120::ms, 0.0, 10::ms);
0.0 => in.gain;

// -------- a single "comb mode" --------
class CombMode {
    Gain input => DelayA d => LPF lp => Gain fb;
    fb => d;              // feedback loop
    d => Gain tap;        // output tap to be connected outside
    2::second => d.max;

    // defaults
    0.965 => fb.gain;     // decay time
    4200.0 => lp.freq;    // loss in loop

    fun void tune(float freq) { (second / freq) => d.delay; }
    fun void damp(float hz)   { hz => lp.freq; }
    fun void setGain(float g) { g => tap.gain; }
    fun UGen inlet()   { return input; }
    fun UGen outlet()  { return tap; }
}

// -------- modal bank built from CombMode --------
class CombBank {
    Gain bus; // external input
    Gain out; // summed output

    CombMode modes[8];

    fun void build(float base) {
        // simple gong-ish ratios
        [ 1.00, 1.41, 1.79, 2.15, 2.32, 2.63 ] @=> float r[];
        for (0 => int i; i < r.size() && i < modes.size(); i++) {
            bus => modes[i].inlet();          // feed excitation in
            modes[i].outlet() => out;         // sum to output
            modes[i].tune(base * r[i]);
            modes[i].damp(3600.0 - i*220.0);  // higher mode = slightly brighter
            (0.18 / (1.0 + i*0.5)) => modes[i].setGain; // per-mode level (tame)
        }
    }
}

CombBank mb;
in => mb.bus;
mb.out => sum;

// build a “gong” centered around ~A3
220.0 => float base;
mb.build(base);

// -------- strike helper (reliable & audible) --------
fun void strike(float amt) {
    env.keyOff(); 1::ms => now;
    env.keyOn();
    Math.min(0.8, Math.max(0.0, amt)) => in.gain;
    140::ms => now;  // burst width
    0.0 => in.gain;
    env.keyOff();
}

// -------- loop --------
while (true) {
    strike(0.85);
    hitInt => now;
}
