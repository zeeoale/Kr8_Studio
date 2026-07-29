export function downsamplePeaks(samples, bucketCount) {
  const count = Math.max(1, Math.floor(bucketCount || 1));
  const peaks = new Array(count).fill(0);
  if (!samples || samples.length === 0) return peaks;

  const bucketSize = samples.length / count;
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((i + 1) * bucketSize)));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      peak = Math.max(peak, Math.abs(Number(samples[j]) || 0));
    }
    peaks[i] = Math.min(1, peak);
  }
  return peaks;
}

export function mixdownToMono(audioBuffer) {
  if (!audioBuffer || !audioBuffer.numberOfChannels) return new Float32Array();
  const length = audioBuffer.length;
  const output = new Float32Array(length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      output[i] += data[i] / audioBuffer.numberOfChannels;
    }
  }
  return output;
}
