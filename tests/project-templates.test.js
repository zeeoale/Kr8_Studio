import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyProjectTemplate,
  createProjectTemplateFromProject,
  loadProjectTemplateLibrary,
  upsertProjectTemplateInLibrary
} from '../src/templates/projectTemplates.js';

function createProject(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'project_a',
    name: 'Project A',
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 180,
      backgroundColor: '#05070a'
    },
    assets: [
      { id: 'asset_cover', type: 'image', role: 'cover', path: 'assets/cover.jpg' },
      { id: 'asset_video', type: 'video', role: 'coverVideo', path: 'assets/video.mp4' },
      { id: 'asset_audio', type: 'audio', role: 'song', path: 'assets/audio.mp3' }
    ],
    layers: [
      {
        id: 'bg',
        type: 'shape',
        name: 'Background',
        visible: true,
        locked: false,
        parentId: null,
        order: 0,
        start: 0,
        end: 180,
        transform: { x: 960, y: 540, width: 1920, height: 1080 },
        opacity: 1,
        blendMode: 'normal',
        properties: { fill: '#000000' },
        effects: [],
        audioBindings: [],
        animations: []
      },
      {
        id: 'cover',
        type: 'image',
        name: 'Cover',
        visible: true,
        locked: false,
        parentId: null,
        order: 10,
        start: 0,
        end: 180,
        transform: { x: 960, y: 500, width: 900, height: 900 },
        opacity: 1,
        blendMode: 'normal',
        properties: { assetId: 'asset_cover', fit: 'cover', radius: 8 },
        effects: [],
        audioBindings: [],
        animations: []
      },
      {
        id: 'title',
        type: 'text',
        name: 'Song Title',
        visible: true,
        locked: false,
        parentId: null,
        order: 20,
        start: 0,
        end: 180,
        transform: { x: 960, y: 120, width: 1200, height: 90 },
        opacity: 1,
        blendMode: 'normal',
        properties: { text: 'Original Song', color: '#ffffff', fontSize: 64 },
        effects: [],
        audioBindings: [],
        animations: []
      }
    ],
    scenes: [],
    presets: [],
    migrations: [],
    metadata: {
      textStylePresets: [{ id: 'bright', name: 'Bright', properties: { color: '#ffffff' } }],
      source: { provider: 'tkmusic' }
    },
    ...overrides
  };
}

test('createProjectTemplateFromProject excludes song assets and track-specific text', () => {
  const template = createProjectTemplateFromProject(createProject(), { name: 'TK - Dubstep' });

  assert.equal(template.id, 'tpl_tk-dubstep');
  assert.equal(template.providerAgnostic, true);
  assert.equal(template.layers.find((layer) => layer.name === 'Cover').properties.assetId, undefined);
  assert.equal(template.layers.find((layer) => layer.name === 'Song Title').properties.text, undefined);
  assert.equal(template.metadata.source, undefined);
  assert.equal(template.metadata.textStylePresets.length, 1);
});

test('applyProjectTemplate preserves current cover asset and title text while applying look', () => {
  const source = createProject();
  const template = createProjectTemplateFromProject(source, { name: 'TK - Dubstep' });
  const target = createProject({
    name: 'Different Song',
    composition: {
      width: 1280,
      height: 720,
      fps: 24,
      duration: 300,
      backgroundColor: '#111111'
    },
    layers: createProject().layers.map((layer) => {
      if (layer.name === 'Cover') {
        return {
          ...layer,
          properties: { ...layer.properties, assetId: 'asset_other_cover' }
        };
      }
      if (layer.name === 'Song Title') {
        return {
          ...layer,
          properties: { ...layer.properties, text: 'Different Song' }
        };
      }
      return layer;
    })
  });

  const applied = applyProjectTemplate(target, template);
  const cover = applied.layers.find((layer) => layer.name === 'Cover');
  const title = applied.layers.find((layer) => layer.name === 'Song Title');

  assert.equal(applied.composition.width, 1920);
  assert.equal(applied.composition.fps, 30);
  assert.equal(applied.composition.duration, 300);
  assert.equal(cover.properties.assetId, 'asset_other_cover');
  assert.equal(title.properties.text, 'Different Song');
  assert.equal(title.transform.y, 120);
  assert.equal(title.end, 300);
  assert.equal(applied.metadata.appliedProjectTemplateName, 'TK - Dubstep');
});

test('project template library stores global templates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-project-template-'));
  const libraryPath = path.join(dir, 'presets', 'project-templates', 'library.json');
  await mkdir(path.dirname(libraryPath), { recursive: true });

  const template = createProjectTemplateFromProject(createProject(), { name: 'TK - Techno Minimal' });
  await upsertProjectTemplateInLibrary(libraryPath, template);
  const loaded = await loadProjectTemplateLibrary(libraryPath);

  assert.equal(loaded.version, 1);
  assert.equal(loaded.templates.length, 1);
  assert.equal(loaded.templates[0].scope, 'global');
  assert.equal(loaded.templates[0].name, 'TK - Techno Minimal');
});
