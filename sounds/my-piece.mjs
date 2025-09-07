// title: Warm Fifths (drone)
// engine: tone

export async function start({Tone, params}) {
  const vol = new Tone.Volume(-6).toDestination();
  const polysynth = new Tone.PolySynth(Tone.Synth).connect(vol);
  const f = Number(params.freq || 110);
  polysynth.triggerAttack([f, f*1.5]); // A + E
  return () => polysynth.triggerRelease(['A2','E3']);
}
