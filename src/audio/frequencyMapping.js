export function mapFrequencyBinsToBars(frequencyBins, barCount, options = {}) {
  const bins = Array.from(frequencyBins || []);
  const bars = Math.max(1, Math.round(Number(barCount || 1)));
  if (!bins.length) return new Array(bars).fill(0);

  const sampleRate = Number(options.sampleRate || 44100);
  const minFrequency = Math.max(1, Number(options.minFrequency ?? 40));
  const maxFrequency = Math.max(minFrequency + 1, Number(options.maxFrequency ?? 16000));
  const gain = Math.max(0, Number(options.gain ?? 1));
  const sensitivity = Math.max(0.01, Number(options.sensitivity ?? 1.08));
  const floor = clamp01(Number(options.floor ?? 0.04));
  const highFrequencyBoost = Math.max(0, Number(options.highFrequencyBoost ?? 0.35));
  const lowFrequencyDamping = clamp01(Number(options.lowFrequencyDamping ?? 0.42));
  const midFrequencyDamping = clamp01(Number(options.midFrequencyDamping ?? 0.18));
  const noiseGate = clamp01(Number(options.noiseGate ?? 0.025));
  const nyquist = sampleRate / 2;
  const logMin = Math.log10(minFrequency);
  const logMax = Math.log10(Math.min(maxFrequency, nyquist));
  const output = [];

  for (let index = 0; index < bars; index += 1) {
    const startT = index / bars;
    const endT = (index + 1) / bars;
    const startFreq = 10 ** (logMin + (logMax - logMin) * startT);
    const endFreq = 10 ** (logMin + (logMax - logMin) * endT);
    const startBin = frequencyToBin(startFreq, bins.length, sampleRate);
    const endBin = Math.max(startBin + 1, frequencyToBin(endFreq, bins.length, sampleRate));
    const energy = rangeEnergy(bins, startBin, endBin);
    const gated = Math.max(0, (energy - noiseGate) / Math.max(0.001, 1 - noiseGate));
    const lowDamp = 1 - lowFrequencyDamping * Math.max(0, 1 - startT / 0.32);
    const midDamp = 1 - midFrequencyDamping * Math.max(0, 1 - Math.abs(startT - 0.42) / 0.28);
    const perceptual = gated * clamp01(lowDamp) * clamp01(midDamp);
    const boosted = perceptual * (1 + highFrequencyBoost * startT * startT);
    const driven = Math.max(0, boosted * gain);
    const compressed = driven / (1 + driven);
    const shaped = Math.pow(compressed, sensitivity);
    output.push(clamp01(Math.max(floor, shaped)));
  }

  return output;
}

function frequencyToBin(frequency, binCount, sampleRate) {
  const nyquist = sampleRate / 2;
  return Math.max(0, Math.min(binCount - 1, Math.floor((frequency / nyquist) * binCount)));
}

function rangeEnergy(values, start, end) {
  let total = 0;
  let peak = 0;
  let count = 0;
  for (let index = start; index < Math.min(values.length, end); index += 1) {
    const value = Number(values[index] || 0);
    total += value;
    peak = Math.max(peak, value);
    count += 1;
  }
  if (!count) return 0;
  const average = total / count;
  return average * 0.76 + peak * 0.24;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}
