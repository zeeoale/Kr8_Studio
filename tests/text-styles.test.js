import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEXT_STYLE_PRESETS,
  applyTextStylePreset,
  ensureProjectTextStylePresets
} from '../src/text/styles.js';

test('applyTextStylePreset updates text layer readability properties without changing identity', () => {
  const layer = {
    id: 'title',
    type: 'text',
    name: 'Song Title',
    properties: {
      text: 'Demo',
      fontSize: 68,
      color: '#ffffff'
    }
  };

  const styled = applyTextStylePreset(layer, 'dark-on-light');

  assert.equal(styled.id, 'title');
  assert.equal(styled.properties.text, 'Demo');
  assert.equal(styled.properties.textStyleId, 'dark-on-light');
  assert.equal(styled.properties.color, '#15181E');
  assert.equal(styled.properties.strokeColor, '#FFFFFF');
  assert.ok(styled.properties.strokeWidth > 0);
});

test('ensureProjectTextStylePresets stores default presets while preserving metadata', () => {
  const project = ensureProjectTextStylePresets({
    metadata: {
      title: 'Track',
      textStylePresets: [
        {
          id: 'custom-title',
          name: 'Custom Title',
          properties: { color: '#abcdef' }
        }
      ]
    }
  });

  assert.equal(project.metadata.title, 'Track');
  assert.ok(project.metadata.textStylePresets.some((preset) => preset.id === 'custom-title'));
  assert.ok(project.metadata.textStylePresets.some((preset) => preset.id === 'bright-on-dark'));
  assert.ok(TEXT_STYLE_PRESETS.length >= 5);
});
