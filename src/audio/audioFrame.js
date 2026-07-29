export function createSilentAudioFrame(time = 0, binCount = 64, waveformSize = 1024) {
  return {
    time,
    waveform: new Float32Array(waveformSize),
    frequencyBins: new Float32Array(binCount),
    sampleRate: 44100,
    bass: 0,
    mids: 0,
    highs: 0,
    energy: 0,
    rms: 0,
    transient: 0,
    beat: false
  };
}
