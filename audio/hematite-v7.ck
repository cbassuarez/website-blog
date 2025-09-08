// hematite-reson.ck — AUDIBLE, STABLE MODAL BANK (no feedback)

// ---------- clock ----------
135.0 => float bpm;
(60.0 / bpm) :: second => dur spb;
spb / 2 => dur hitInt;   // 8ths

// ---------- master bus ----------
Gain sum => NRev rev => Gain out => dac;
0.22  => out.gain;    // overall loudness
0.12  => rev.mix;

// ---------- exciters ----------
Impulse imp => Gain excBus => Gain dry => sum;
Noise n     => ADSR env   => excBus;

0.035 => dry.gain;             // tiny dry tick
0.30  => n.gain;               // pre-env noise level
env.set(2::ms, 60::ms, 0.0, 20::ms);

// ---------- modal bank (no feedback loops) ----------
fun void buildBank(float baseHz)
{
    // inharmonic-ish ratios + per-mode gains (balanced, audible)
    [1.00, 1.41, 1.79, 2.15, 2.32, 2.63] @=> float r[];
    [0.11, 0.10, 0.09, 0.08, 0.07, 0.06] @=> float g[];  // taps

    for (0 => int i; i < r.size(); i++)
    {
        ResonZ rz; Gain tap;
        excBus => rz => tap => sum;

        baseHz * r[i] => rz.freq;
        Math.max(25.0, 90.0 - i * 12.0) => rz.Q;   // moderate Q
        g[i] => tap.gain;
    }
}

// center ~A3
220.0 => float base;
buildBank(base);

// ---------- strike (audible, safe) ----------
fun void strike(float amt)
{
    // impulse tick
    Math.min(0.9, Math.max(0.0, amt)) => float a;
    a => imp.next;
    1::samp => now;

    // brief noise burst into the same bus
    env.keyOn();
    60::ms => now;
    env.keyOff();
}

// boot confirm
strike(0.85);

// pattern
while (true)
{
    hitInt => now;
    strike(0.70);
}
