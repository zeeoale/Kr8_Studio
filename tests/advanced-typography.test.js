import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TYPOGRAPHY_PRESETS,
  applyTypographyPreset,
  createTypographyPresetFromLayer,
  ensureProjectTypographyPresets,
  normalizeAdvancedTextProperties,
  reconcileTextLines,
  splitTextLines,
  syncLegacyTextProperties
} from '../src/text/advancedTypography.js';
import { validateProject } from '../src/project/schema.js';
import { deserializeProject, serializeProject } from '../src/project/io.js';
import { createTkNoirPulsePreset } from '../src/presets/tk-noir-pulse.js';

test('legacy text properties migrate into optional advanced typography without data loss', () => {
  const legacy = {
    text: 'THE SPACE\nBETWEEN\nNOTES',
    fontFamily: 'Problem in Wisconsin',
    fontSize: 92,
    color: '#fefefe',
    align: 'left',
    letterSpacing: 1.5,
    unknownFutureProperty: { keep: true }
  };

  const normalized = normalizeAdvancedTextProperties(legacy);
  const serialized = syncLegacyTextProperties(normalized);

  assert.equal(normalized.typography.fontFamily, 'Problem in Wisconsin');
  assert.equal(normalized.typography.fontSize, 92);
  assert.equal(serialized.text, legacy.text);
  assert.deepEqual(serialized.unknownFutureProperty, { keep: true });
  assert.deepEqual(splitTextLines(serialized.text), ['THE SPACE', 'BETWEEN', 'NOTES']);
});

test('line reconciliation preserves stable ids and overrides where possible', () => {
  const first = reconcileTextLines('THE SPACE\nBETWEEN\nNOTES', {
    enabled: true,
    lines: []
  });
  first.lines[1].offsetX = 24;
  first.lines[2].scaleX = 0.78;

  const edited = reconcileTextLines('THE SPACE\nNEW LINE\nBETWEEN\nNOTES', first);
  const between = edited.lines.find((line) => line.textSnapshot === 'BETWEEN');
  const notes = edited.lines.find((line) => line.textSnapshot === 'NOTES');

  assert.equal(between.id, first.lines[1].id);
  assert.equal(between.offsetX, 24);
  assert.equal(notes.id, first.lines[2].id);
  assert.equal(notes.scaleX, 0.78);
  assert.equal(new Set(edited.lines.map((line) => line.id)).size, edited.lines.length);
});

test('typography presets omit text content and include seven built-in styles', () => {
  assert.deepEqual(
    TYPOGRAPHY_PRESETS.map((preset) => preset.name),
    [
      'Clean Editorial',
      'Stacked Title',
      'Condensed Poster',
      'Distressed Horror',
      'Static Glitch',
      'Noir Jazz',
      'Wide Cinematic'
    ]
  );

  const layer = {
    id: 'text_layer',
    name: 'Song Title',
    properties: {
      text: 'Do not save this title',
      typography: { fontFamily: 'Problem in Wisconsin', lineHeight: 0.72 }
    }
  };
  const preset = createTypographyPresetFromLayer(layer, { name: 'My Display Type' });

  assert.equal('text' in preset, false);
  assert.equal('properties' in preset, false);
  assert.equal(preset.typography.fontFamily, 'Problem in Wisconsin');
  assert.equal(preset.typography.lineHeight, 0.72);
});

test('applying a typography preset preserves current text and unknown fields', () => {
  const layer = {
    id: 'text_layer',
    name: 'Song Title',
    properties: {
      text: 'CURRENT TITLE',
      unknownFutureProperty: 42,
      typography: { fontSize: 70 }
    }
  };
  const result = applyTypographyPreset(layer, TYPOGRAPHY_PRESETS[1]);

  assert.equal(result.properties.text, 'CURRENT TITLE');
  assert.equal(result.properties.unknownFutureProperty, 42);
  assert.equal(result.properties.typographyPresetId, 'stacked-title');
});

test('advanced typography extensions validate without changing schemaVersion', () => {
  const preset = createTkNoirPulsePreset({
    seed: 'advanced-schema',
    title: 'Schema',
    artist: 'TKMusic',
    coverAssetId: 'asset_cover'
  });
  const title = preset.layers.find((layer) => layer.name === 'Song Title');
  title.properties = syncLegacyTextProperties({
    ...title.properties,
    typography: {
      ...title.properties.typography,
      fontFamily: 'Problem in Wisconsin',
      lineHeight: 0.68,
      scaleX: 0.9
    },
    lineEditing: reconcileTextLines('THE SPACE\nBETWEEN\nNOTES', { enabled: true }),
    textEffects: {
      distressed: { enabled: false, seed: 1337 },
      glitch: { enabled: false, seed: 808 }
    }
  });
  title.properties.text = 'THE SPACE\nBETWEEN\nNOTES';

  const now = new Date().toISOString();
  const project = ensureProjectTypographyPresets({
    schemaVersion: 1,
    id: 'kr8_advanced_typography',
    name: 'Advanced Typography',
    createdAt: now,
    updatedAt: now,
    composition: preset.composition,
    assets: [
      { id: 'asset_cover', type: 'image', role: 'cover', path: 'assets/cover.jpeg', missing: false }
    ],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [preset.id],
    migrations: [],
    metadata: {}
  });

  const validation = validateProject(project);
  assert.equal(project.schemaVersion, 1);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  const serialized = serializeProject(project);
  assert.deepEqual(deserializeProject(serialized), JSON.parse(serialized));
});
