import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCompositionFormat,
  getCompositionFormatId
} from '../src/editor/public/composition-formats.js';

test('getCompositionFormatId detects built-in project formats', () => {
  assert.equal(getCompositionFormatId({ width: 1920, height: 1080 }), 'landscape-1080p');
  assert.equal(getCompositionFormatId({ width: 1080, height: 1920 }), 'vertical-1080p');
  assert.equal(getCompositionFormatId({ width: 1080, height: 1080 }), 'square-1080p');
  assert.equal(getCompositionFormatId({ width: 1234, height: 567 }), 'custom');
});

test('applyCompositionFormat updates composition and scales layer transforms', () => {
  const project = {
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 180,
      backgroundColor: '#000000'
    },
    layers: [
      {
        id: 'title',
        name: 'Song Title',
        type: 'text',
        transform: {
          x: 960,
          y: 540,
          width: 960,
          height: 120,
          rotation: 0,
          scaleX: 1,
          scaleY: 1
        }
      }
    ],
    metadata: {
      title: 'Track'
    }
  };

  const vertical = applyCompositionFormat(project, 'vertical-1080p');
  const layer = vertical.layers[0];

  assert.equal(vertical.composition.width, 1080);
  assert.equal(vertical.composition.height, 1920);
  assert.equal(vertical.composition.duration, 180);
  assert.equal(vertical.composition.outputTarget, '9:16');
  assert.equal(vertical.metadata.title, 'Track');
  assert.deepEqual(vertical.metadata.outputTargets, ['9:16']);
  assert.equal(layer.transform.x, 540);
  assert.equal(layer.transform.y, 960);
  assert.equal(layer.transform.width, 540);
  assert.equal(layer.transform.height, 120 * (1920 / 1080));
  assert.equal(layer.transform.scaleX, 1);
  assert.equal(layer.transform.scaleY, 1);
});

test('applyCompositionFormat can preserve layer transforms', () => {
  const project = {
    composition: { width: 1920, height: 1080, fps: 30, duration: 10, backgroundColor: '#000' },
    layers: [{ id: 'cover', transform: { x: 960, y: 540, width: 400, height: 400 } }],
    metadata: {}
  };

  const square = applyCompositionFormat(project, 'square-1080p', { scaleLayers: false });

  assert.equal(square.composition.width, 1080);
  assert.deepEqual(square.layers[0].transform, project.layers[0].transform);
});
