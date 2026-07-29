import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateKeyframes,
  evaluateLayerAnimations,
  interpolateValue
} from '../src/animation/evaluate.js';

test('keyframes interpolate numeric values and honor easing', () => {
  assert.equal(evaluateKeyframes([
    { time: 0, value: 0 },
    { time: 10, value: 100, easing: 'linear' }
  ], 2.5), 25);
  assert.equal(interpolateValue(10, 20, 0.5), 15);
});

test('existing animation tracks can target advanced typography and line offsets', () => {
  const layer = {
    id: 'animated_text',
    transform: { x: 100 },
    opacity: 1,
    properties: {
      typography: { letterSpacing: 0, lineHeight: 0.8 },
      textEffects: {
        glitch: { amount: 0 },
        glow: { intensity: 0 }
      },
      lineEditing: {
        lines: [{ id: 'line_a', offsetX: 0 }]
      }
    },
    animations: [
      track('transform.x', 100, 200),
      track('opacity', 1, 0),
      track('properties.typography.letterSpacing', 0, 12),
      track('properties.typography.lineHeight', 0.8, 1.2),
      track('properties.textEffects.glitch.amount', 0, 0.6),
      track('properties.textEffects.glow.intensity', 0, 1),
      track('properties.lineEditing.lines.0.offsetX', 0, 40)
    ]
  };

  const evaluated = evaluateLayerAnimations(layer, 5);

  assert.equal(evaluated.transform.x, 150);
  assert.equal(evaluated.opacity, 0.5);
  assert.equal(evaluated.properties.typography.letterSpacing, 6);
  assert.equal(evaluated.properties.typography.lineHeight, 1);
  assert.equal(evaluated.properties.textEffects.glitch.amount, 0.3);
  assert.equal(evaluated.properties.textEffects.glow.intensity, 0.5);
  assert.equal(evaluated.properties.lineEditing.lines[0].offsetX, 20);
  assert.equal(layer.transform.x, 100);
});

function track(targetProperty, start, end) {
  return {
    id: `track_${targetProperty}`,
    enabled: true,
    targetProperty,
    keyframes: [
      { time: 0, value: start },
      { time: 10, value: end }
    ]
  };
}

