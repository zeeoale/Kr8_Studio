import assert from 'node:assert/strict';
import test from 'node:test';

import { mapFrequencyBinsToBars } from '../src/audio/frequencyMapping.js';

test('mapFrequencyBinsToBars reduces FFT bins to requested bar count', () => {
  const bins = new Float32Array(1024).fill(0.2);
  const bars = mapFrequencyBinsToBars(bins, 64);

  assert.equal(bars.length, 64);
  assert.ok(bars.every((value) => value >= 0 && value <= 1));
});

test('mapFrequencyBinsToBars preserves high-frequency energy with boost', () => {
  const bins = new Float32Array(1024);
  bins[900] = 0.9;

  const bars = mapFrequencyBinsToBars(bins, 64, {
    minFrequency: 40,
    maxFrequency: 20000,
    gain: 1,
    sensitivity: 1,
    floor: 0,
    highFrequencyBoost: 1.2
  });

  const firstHalfMax = Math.max(...bars.slice(0, 32));
  const secondHalfMax = Math.max(...bars.slice(32));
  assert.ok(secondHalfMax > firstHalfMax);
  assert.ok(secondHalfMax > 0.1);
});

test('mapFrequencyBinsToBars avoids hard saturation for strong low and mid energy', () => {
  const bins = new Float32Array(1024);
  for (let index = 4; index < 220; index += 1) {
    bins[index] = index < 80 ? 0.95 : 0.78;
  }

  const bars = mapFrequencyBinsToBars(bins, 64, {
    minFrequency: 40,
    maxFrequency: 16000,
    gain: 1.35,
    sensitivity: 0.82,
    floor: 0.04,
    highFrequencyBoost: 0.55
  });

  const lowMid = bars.slice(0, 40);
  assert.ok(Math.max(...lowMid) < 0.8);
  assert.ok(lowMid.some((value) => value > 0.2 && value < 0.75));
});

test('mapFrequencyBinsToBars keeps whisper-like low and mid energy restrained', () => {
  const bins = new Float32Array(1024);
  for (let index = 3; index < 260; index += 1) {
    bins[index] = index < 90 ? 0.42 : 0.36;
  }
  bins[760] = 0.72;

  const bars = mapFrequencyBinsToBars(bins, 128, {
    minFrequency: 35,
    maxFrequency: 15000,
    gain: 0.78,
    sensitivity: 1.24,
    floor: 0.025,
    highFrequencyBoost: 0.9,
    lowFrequencyDamping: 0.55,
    midFrequencyDamping: 0.26,
    noiseGate: 0.04
  });

  const lowMidMax = Math.max(...bars.slice(0, 76));
  const highMax = Math.max(...bars.slice(76));
  assert.ok(lowMidMax < 0.36);
  assert.ok(highMax > lowMidMax);
});
