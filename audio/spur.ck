// title: spur-ck — metallic polyrhythm engine (3/4/5/7)
// engine: chuck
// desc: Layered "rail spikes": short metallic pings from modal stacks.
//       Four interlocking divisions at 60bpm (bar=4s): 3, 4, 5, 7.
// usage: play spur-ck      (then stop <ns> / stop all)
//
// ----- knobs (edit & re-run) -----
4::second => dur BAR;          // 60 bpm bar
[ 3, 4, 5, 7 ] @=> int DIVS[]; // polymeter divisions
0.18 => float BASE_GAIN;       // global output gain
// ---------------------------------

// output chain
Gain master => dac;
master.gain(BASE_GAIN);

// simple modal "ping": 3 detuned sines with short decays
fun void ping(float f, float loud){
    // partials (metal-ish)
    [1.00, 2.01, 2.62] @=> float ratio[];
    [0.9 , 0.4 , 0.25] @=> float amp[];

    for (0 => int i; i < ratio.size(); i++){
        SinOsc s => Gain g => master;
        s.freq(f * ratio[i]);
        g.gain(loud * amp[i]);
        // exponential-ish decay
        0.0 => float t;
        0.12 => float dur;   // seconds
        int N = (dur::second / samp) $ int;
        for (0 => int n; n < N; n++){
            Math.exp(-10.0 * (n $ float / N)) => float env;
            g.gain(loud * amp[i] * env);
            1::samp => now;
        }
        // cleanup
        0 => g.gain; 2::ms => now; g =< master; s =< g;
    }
}

// a voice that ticks at BAR/div and pings a chosen “rail” frequency
fun void railVoice(float freq, int div, float loud){
    (BAR / div) => dur T;
    // random small phase to de-lock
    Math.random2f(0.0, 0.15) * T => now;

    while(true){
        spork ~ ping(freq, loud);
        T => now;
    }
}

// choose 4 rail freqs across spectrum
[ 220.0, 330.0, 495.0, 742.5 ] @=> float rails[]; // A3, E4-ish, etc.
[ 0.25 , 0.20 , 0.18 , 0.15  ] @=> float louds[];

for (0 => int i; i < 4; i++){
    spork ~ railVoice(rails[i], DIVS[i%DIVS.size()], louds[i]);
}

// keep alive
while(true) 1::second => now;
