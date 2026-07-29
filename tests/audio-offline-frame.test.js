import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAudioFrameFromPeaks,
  createAudioFrameFromSamples,
  createSilentAudioFrame,
  Kr8AudioPreview,
  selectAudioDuration,
  smoothAudioFrame
} from '../src/editor/public/audio-engine.js';

test('offline audio frame creates timestamped silent data without peaks', () => {
  const frame = createAudioFrameFromPeaks([], 12.5, 180, { binCount: 32, waveformSize: 128 });

  assert.equal(frame.time, 12.5);
  assert.equal(frame.frequencyBins.length, 32);
  assert.equal(frame.waveform.length, 128);
  assert.equal(frame.energy, 0);
});

test('offline audio frame keeps visualizer energy available across export timestamps', () => {
  const peaks = Array.from({ length: 120 }, (_, index) => {
    const pulse = Math.sin(index / 7) * 0.5 + 0.5;
    return Math.max(0.05, Math.min(1, pulse * (index % 17 === 0 ? 1 : 0.45)));
  });

  const first = createAudioFrameFromPeaks(peaks, 10, 120, { binCount: 64, waveformSize: 256 });
  const later = createAudioFrameFromPeaks(peaks, 75, 120, { binCount: 64, waveformSize: 256 });

  assert.equal(first.frequencyBins.length, 64);
  assert.equal(later.frequencyBins.length, 64);
  assert.ok(first.energy > 0);
  assert.ok(later.energy > 0);
  assert.notDeepEqual([...first.frequencyBins], [...later.frequencyBins]);
});

test('offline sample analysis preserves frequency differences for export visualizers', () => {
  const sampleRate = 8000;
  const length = sampleRate;
  const lowTone = new Float32Array(length);
  const highTone = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    lowTone[index] = Math.sin((Math.PI * 2 * 120 * index) / sampleRate) * 0.8;
    highTone[index] = Math.sin((Math.PI * 2 * 1800 * index) / sampleRate) * 0.8;
  }

  const lowFrame = createAudioFrameFromSamples(lowTone, 0.5, sampleRate, {
    binCount: 64,
    windowSize: 512
  });
  const highFrame = createAudioFrameFromSamples(highTone, 0.5, sampleRate, {
    binCount: 64,
    windowSize: 512
  });

  assert.ok(lowFrame.bass > highFrame.bass);
  assert.ok(highFrame.highs > lowFrame.highs);
});

test('offline sample analysis keeps quiet passages lower than loud passages', () => {
  const sampleRate = 8000;
  const length = sampleRate;
  const quiet = new Float32Array(length);
  const loud = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const tone = Math.sin((Math.PI * 2 * 240 * index) / sampleRate);
    quiet[index] = tone * 0.08;
    loud[index] = tone * 0.8;
  }

  const quietFrame = createAudioFrameFromSamples(quiet, 0.5, sampleRate, {
    binCount: 64,
    windowSize: 512
  });
  const loudFrame = createAudioFrameFromSamples(loud, 0.5, sampleRate, {
    binCount: 64,
    windowSize: 512
  });

  assert.ok(loudFrame.energy > quietFrame.energy);
});

test('offline smoothing damps sudden visualizer jumps between export frames', () => {
  const previous = createSilentAudioFrame(4, 4);
  const current = {
    ...createSilentAudioFrame(4, 4),
    frequencyBins: new Float32Array([1, 1, 1, 1]),
    waveform: new Float32Array([1, 1, 1, 1]),
    energy: 1,
    loudness: 1
  };

  const smoothed = smoothAudioFrame(current, previous, 0.75);

  assert.ok(smoothed.energy > previous.energy);
  assert.ok(smoothed.energy < current.energy);
  assert.deepEqual([...smoothed.frequencyBins], [0.25, 0.25, 0.25, 0.25]);
});

test('preview output volume state is separate from media element volume', () => {
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class {
    constructor() {
      this.volume = 1;
      this.muted = false;
      this.crossOrigin = '';
      this.preload = '';
    }
  };
  try {
    const preview = new Kr8AudioPreview();

    preview.setOutputVolume(0.25);
    preview.setOutputMuted(true);

    assert.equal(preview.outputVolume, 0.25);
    assert.equal(preview.outputMuted, true);
    assert.equal(preview.audio.volume, 1);
    assert.equal(preview.audio.muted, false);
  } finally {
    globalThis.Audio = originalAudio;
  }
});

test('selectAudioDuration prefers decoded and project duration over unreliable media metadata', () => {
  assert.equal(selectAudioDuration({
    decodedDuration: 0,
    projectDuration: 321.941,
    mediaDuration: 540
  }), 321.941);

  assert.equal(selectAudioDuration({
    decodedDuration: 326,
    projectDuration: 321.941,
    mediaDuration: 540
  }), 326);
});

test('selectAudioDuration falls back to media duration when project and decoded duration are unavailable', () => {
  assert.equal(selectAudioDuration({
    decodedDuration: 0,
    projectDuration: 0,
    mediaDuration: 540
  }), 540);
});
