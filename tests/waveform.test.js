import assert from 'node:assert/strict';
import test from 'node:test';

import { downsamplePeaks, mixdownToMono } from '../src/audio/waveform.js';

test('downsamplePeaks returns stable peak buckets', () => {
  const samples = Float32Array.from([0, 0.5, -1, 0.25, -0.25, 0.75, 0.1, -0.4]);
  const peaks = downsamplePeaks(samples, 4);
  assert.deepEqual(peaks.slice(0, 3), [0.5, 1, 0.75]);
  assert.ok(Math.abs(peaks[3] - 0.4) < 0.000001);
});

test('downsamplePeaks handles empty samples', () => {
  assert.deepEqual(downsamplePeaks(new Float32Array(), 3), [0, 0, 0]);
});

test('mixdownToMono averages channels', () => {
  const fakeBuffer = {
    numberOfChannels: 2,
    length: 3,
    getChannelData(channel) {
      return channel === 0
        ? Float32Array.from([1, 0, -1])
        : Float32Array.from([0, 1, -1]);
    }
  };

  assert.deepEqual(Array.from(mixdownToMono(fakeBuffer)), [0.5, 0.5, -1]);
});
