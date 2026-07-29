import { downsamplePeaks, mixdownToMono } from './waveform-utils.js';

export class Kr8AudioPreview {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'metadata';
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.outputGain = null;
    this.outputVolume = 1;
    this.outputMuted = false;
    this.frequencyBytes = new Uint8Array();
    this.timeDomainBytes = new Uint8Array();
    this.frame = createSilentAudioFrame();
    this.lastEnergy = 0;
  }

  load(src) {
    if (this.audio.src !== new URL(src, window.location.href).href) {
      this.audio.src = src;
      this.frame = createSilentAudioFrame();
      this.lastEnergy = 0;
    }
  }

  async analyzeWaveform(src, bucketCount = 900) {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Audio fetch failed with HTTP ${response.status}`);
    }

    const data = await response.arrayBuffer();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const decodeContext = new AudioContextCtor();
    try {
      const buffer = await decodeContext.decodeAudioData(data.slice(0));
      const samples = mixdownToMono(buffer);
      return {
        duration: buffer.duration,
        peaks: downsamplePeaks(samples, bucketCount),
        samples,
        sampleRate: buffer.sampleRate
      };
    } finally {
      await decodeContext.close?.();
    }
  }

  async play() {
    await this.ensureGraph();
    await this.context.resume();
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(time) {
    if (Number.isFinite(time)) {
      const duration = this.duration;
      this.audio.currentTime = duration > 0
        ? Math.max(0, Math.min(time, duration))
        : Math.max(0, time);
    }
  }

  get currentTime() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  async ensureGraph() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      this.frequencyBytes = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeDomainBytes = new Uint8Array(this.analyser.fftSize);
      this.outputGain = this.context.createGain();
      this.updateOutputGain();
      this.source = this.context.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.outputGain);
      this.outputGain.connect(this.context.destination);
    }
  }

  setOutputVolume(volume) {
    this.outputVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    this.updateOutputGain();
  }

  setOutputMuted(muted) {
    this.outputMuted = Boolean(muted);
    this.updateOutputGain();
  }

  updateOutputGain() {
    if (this.outputGain) {
      this.outputGain.gain.value = this.outputMuted ? 0 : this.outputVolume;
    }
  }

  updateFrame() {
    if (!this.analyser) {
      this.frame.time = this.currentTime;
      return this.frame;
    }

    this.analyser.getByteFrequencyData(this.frequencyBytes);
    this.analyser.getByteTimeDomainData(this.timeDomainBytes);

    const bins = normalizeBytes(this.frequencyBytes);
    const waveform = normalizeWaveform(this.timeDomainBytes);
    const bass = averageRange(bins, 0.01, 0.12);
    const mids = averageRange(bins, 0.12, 0.48);
    const highs = averageRange(bins, 0.48, 0.92);
    const energy = averageRange(bins, 0.01, 0.92);
    const rms = calculateRms(waveform);
    const transient = Math.max(0, energy - this.lastEnergy);
    const beat = transient > 0.12 && bass > 0.35;

    this.lastEnergy = this.lastEnergy * 0.72 + energy * 0.28;
    this.frame = {
      time: this.currentTime,
      waveform,
      frequencyBins: bins,
      sampleRate: this.context?.sampleRate || 44100,
      bass,
      mids,
      highs,
      energy,
      rms,
      transient,
      beat,
      loudness: energy
    };

    return this.frame;
  }
}

export function createSilentAudioFrame(binCount = 64, waveformSize = 1024) {
  return {
    time: 0,
    waveform: new Float32Array(waveformSize),
    frequencyBins: new Float32Array(binCount),
    sampleRate: 44100,
    bass: 0,
    mids: 0,
    highs: 0,
    energy: 0,
    rms: 0,
    transient: 0,
    beat: false,
    loudness: 0
  };
}

export function createAudioFrameFromPeaks(peaks, time, duration, options = {}) {
  const values = Array.from(peaks || [], (value) => Math.max(0, Math.min(1, Number(value) || 0)));
  const binCount = Math.max(16, Math.round(Number(options.binCount || 128)));
  const waveformSize = Math.max(64, Math.round(Number(options.waveformSize || 1024)));
  if (!values.length || !(duration > 0)) {
    const silent = createSilentAudioFrame(binCount, waveformSize);
    silent.time = Number(time || 0);
    return silent;
  }

  const safeTime = Math.max(0, Math.min(Number(time || 0), duration));
  const position = (safeTime / duration) * (values.length - 1);
  const localPeak = samplePeakWindow(values, position, 3);
  const localAverage = sampleAverageWindow(values, position, 10);
  const previousAverage = sampleAverageWindow(values, position - 8, 8);
  const transient = Math.max(0, localAverage - previousAverage);
  const energy = clamp01(localAverage * 0.78 + localPeak * 0.34);

  const frequencyBins = new Float32Array(binCount);
  for (let index = 0; index < binCount; index += 1) {
    const t = index / Math.max(1, binCount - 1);
    const lowTilt = 1 - t * 0.58;
    const highTexture = 0.55 + t * 0.7;
    const lookAhead = (t - 0.5) * 22;
    const bandPeak = samplePeakWindow(values, position + lookAhead, 2 + t * 5);
    const phase = Math.sin((safeTime * 7.5) + index * 0.47) * 0.08;
    const shaped = (bandPeak * 0.56 + energy * 0.44) * lowTilt * highTexture + phase;
    frequencyBins[index] = clamp01(shaped);
  }

  const waveform = new Float32Array(waveformSize);
  for (let index = 0; index < waveformSize; index += 1) {
    const t = index / Math.max(1, waveformSize - 1);
    const envelope = samplePeakWindow(values, position + (t - 0.5) * 14, 2);
    waveform[index] = Math.sin((safeTime * 14) + t * Math.PI * 8) * envelope * 0.82;
  }

  const bass = averageRange(frequencyBins, 0.01, 0.12);
  const mids = averageRange(frequencyBins, 0.12, 0.48);
  const highs = averageRange(frequencyBins, 0.48, 0.92);
  const rms = calculateRms(waveform);

  return {
    time: safeTime,
    waveform,
    frequencyBins,
    sampleRate: Number(options.sampleRate || 44100),
    bass,
    mids,
    highs,
    energy,
    rms,
    transient,
    beat: transient > 0.1 && bass > 0.25,
    loudness: energy
  };
}

export function createAudioFrameFromSamples(samples, time, sampleRate, options = {}) {
  const values = samples || new Float32Array();
  const rate = Math.max(1, Number(sampleRate || 44100));
  const binCount = Math.max(16, Math.round(Number(options.binCount || 128)));
  const windowSize = Math.max(256, Math.round(Number(options.windowSize || 1024)));
  const waveformSize = Math.max(64, Math.round(Number(options.waveformSize || 1024)));
  const duration = values.length / rate;
  if (!values.length || !(duration > 0)) {
    return createAudioFrameFromPeaks([], time, duration, { binCount, waveformSize, sampleRate: rate });
  }

  const safeTime = Math.max(0, Math.min(Number(time || 0), duration));
  const center = Math.round(safeTime * rate);
  const start = center - Math.floor(windowSize / 2);
  const window = new Float32Array(windowSize);
  for (let index = 0; index < windowSize; index += 1) {
    const sourceIndex = start + index;
    const sample = sourceIndex >= 0 && sourceIndex < values.length ? values[sourceIndex] : 0;
    const hann = 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / Math.max(1, windowSize - 1));
    window[index] = sample * hann;
  }

  const frequencyBins = new Float32Array(binCount);
  for (let index = 0; index < binCount; index += 1) {
    const frequency = ((index + 0.5) / binCount) * (rate / 2);
    const magnitude = spectralMagnitude(window, frequency, rate);
    frequencyBins[index] = magnitudeToAnalyserValue(magnitude);
  }

  const waveform = new Float32Array(waveformSize);
  for (let index = 0; index < waveformSize; index += 1) {
    const sourceIndex = Math.round(start + (index / Math.max(1, waveformSize - 1)) * (windowSize - 1));
    waveform[index] = sourceIndex >= 0 && sourceIndex < values.length ? values[sourceIndex] : 0;
  }

  const bass = averageRange(frequencyBins, 0.01, 0.12);
  const mids = averageRange(frequencyBins, 0.12, 0.48);
  const highs = averageRange(frequencyBins, 0.48, 0.92);
  const energy = averageRange(frequencyBins, 0.01, 0.92);
  const rms = calculateRms(waveform);

  return {
    time: safeTime,
    waveform,
    frequencyBins,
    sampleRate: rate,
    bass,
    mids,
    highs,
    energy,
    rms,
    transient: 0,
    beat: bass > 0.42 && energy > 0.28,
    loudness: energy
  };
}

export function smoothAudioFrame(currentFrame, previousFrame, smoothing = 0.72) {
  if (!previousFrame) return currentFrame;
  const amount = Math.max(0, Math.min(0.98, Number(smoothing) || 0));
  const nextAmount = 1 - amount;
  const binCount = Math.max(currentFrame.frequencyBins?.length || 0, previousFrame.frequencyBins?.length || 0);
  const waveformSize = Math.max(currentFrame.waveform?.length || 0, previousFrame.waveform?.length || 0);
  const frequencyBins = new Float32Array(binCount);
  const waveform = new Float32Array(waveformSize);

  for (let index = 0; index < binCount; index += 1) {
    frequencyBins[index] = (previousFrame.frequencyBins?.[index] || 0) * amount
      + (currentFrame.frequencyBins?.[index] || 0) * nextAmount;
  }
  for (let index = 0; index < waveformSize; index += 1) {
    waveform[index] = (previousFrame.waveform?.[index] || 0) * amount
      + (currentFrame.waveform?.[index] || 0) * nextAmount;
  }

  const bass = averageRange(frequencyBins, 0.01, 0.12);
  const mids = averageRange(frequencyBins, 0.12, 0.48);
  const highs = averageRange(frequencyBins, 0.48, 0.92);
  const energy = averageRange(frequencyBins, 0.01, 0.92);
  const rms = calculateRms(waveform);
  const transient = Math.max(0, energy - Number(previousFrame.energy || 0));

  return {
    ...currentFrame,
    frequencyBins,
    waveform,
    bass,
    mids,
    highs,
    energy,
    rms,
    transient,
    beat: transient > 0.12 && bass > 0.35,
    loudness: energy
  };
}

export function selectAudioDuration(options = {}) {
  const decodedDuration = positiveDuration(options.decodedDuration);
  if (decodedDuration) return decodedDuration;

  const projectDuration = positiveDuration(options.projectDuration);
  if (projectDuration) return projectDuration;

  return positiveDuration(options.mediaDuration);
}

function normalizeBytes(bytes, outputBins = 64) {
  const result = new Float32Array(outputBins);
  const bucketSize = Math.max(1, Math.floor(bytes.length / outputBins));
  for (let i = 0; i < outputBins; i += 1) {
    let sum = 0;
    let count = 0;
    const start = i * bucketSize;
    const end = Math.min(bytes.length, start + bucketSize);
    for (let j = start; j < end; j += 1) {
      sum += bytes[j] / 255;
      count += 1;
    }
    result[i] = count ? sum / count : 0;
  }
  return result;
}

function normalizeWaveform(bytes) {
  const result = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    result[i] = (bytes[i] - 128) / 128;
  }
  return result;
}

function averageRange(values, startRatio, endRatio) {
  const start = Math.max(0, Math.floor(values.length * startRatio));
  const end = Math.max(start + 1, Math.min(values.length, Math.ceil(values.length * endRatio)));
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += values[i] || 0;
  return sum / (end - start);
}

function calculateRms(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

function samplePeakWindow(values, center, radius) {
  const start = Math.max(0, Math.floor(center - radius));
  const end = Math.min(values.length - 1, Math.ceil(center + radius));
  let peak = 0;
  for (let index = start; index <= end; index += 1) {
    peak = Math.max(peak, values[index] || 0);
  }
  return peak;
}

function sampleAverageWindow(values, center, radius) {
  const start = Math.max(0, Math.floor(center - radius));
  const end = Math.min(values.length - 1, Math.ceil(center + radius));
  let total = 0;
  let count = 0;
  for (let index = start; index <= end; index += 1) {
    total += values[index] || 0;
    count += 1;
  }
  return count ? total / count : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function positiveDuration(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function spectralMagnitude(samples, frequency, sampleRate) {
  let real = 0;
  let imaginary = 0;
  const scalar = (Math.PI * 2 * frequency) / sampleRate;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = scalar * index;
    const sample = samples[index] || 0;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return Math.sqrt(real * real + imaginary * imaginary) / samples.length;
}

function magnitudeToAnalyserValue(magnitude) {
  const scaled = Math.max(1e-8, magnitude * 4);
  const decibels = 20 * Math.log10(scaled);
  return clamp01((decibels + 90) / 70);
}
