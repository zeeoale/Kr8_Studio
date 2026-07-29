import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadProject, saveProject, serializeProject, deserializeProject } from '../src/project/io.js';
import { validateProject } from '../src/project/schema.js';
import { createTkNoirPulsePreset } from '../src/presets/tk-noir-pulse.js';
import { importTkMusicTrack } from '../src/tkmusic/importTrack.js';

test('TK Noir Pulse preset validates as a project foundation', () => {
  const preset = createTkNoirPulsePreset({
    seed: 'preset-test',
    title: 'Preset Test',
    artist: 'TKMusic',
    coverAssetId: 'asset_cover',
    duration: 120
  });

  const now = new Date().toISOString();
  const project = {
    schemaVersion: 1,
    id: 'kr8_project_test',
    name: 'Preset Test',
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
  };

  const result = validateProject(project);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('project serialization and deserialization preserve stable ids', () => {
  const preset = createTkNoirPulsePreset({
    seed: 'stable-seed',
    title: 'Stable Song',
    artist: 'TKMusic',
    coverAssetId: 'asset_cover',
    duration: 90
  });

  const project = {
    schemaVersion: 1,
    id: 'kr8_stable_project',
    name: 'Stable Song',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    composition: preset.composition,
    assets: [
      { id: 'asset_cover', type: 'image', role: 'cover', path: 'assets/cover.jpeg', missing: false }
    ],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [preset.id],
    migrations: [],
    metadata: {}
  };

  const roundTripped = deserializeProject(serializeProject(project));
  assert.deepEqual(roundTripped.layers.map((layer) => layer.id), project.layers.map((layer) => layer.id));
  assert.deepEqual(roundTripped.scenes.map((scene) => scene.id), project.scenes.map((scene) => scene.id));
});

test('saveProject and loadProject round-trip project.json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-project-'));
  const preset = createTkNoirPulsePreset({ seed: 'io', title: 'IO Song', artist: 'TKMusic', coverAssetId: 'asset_cover' });
  const project = {
    schemaVersion: 1,
    id: 'kr8_io_project',
    name: 'IO Song',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    composition: preset.composition,
    assets: [
      { id: 'asset_cover', type: 'image', role: 'cover', path: 'assets/cover.jpeg', missing: false }
    ],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [preset.id],
    migrations: [],
    metadata: {}
  };

  await saveProject(dir, project);
  const loaded = await loadProject(dir);
  assert.equal(loaded.id, project.id);
  assert.equal(loaded.layers.length, project.layers.length);
});

test('validator rejects embedded base64 asset paths', () => {
  const preset = createTkNoirPulsePreset({ seed: 'base64', title: 'Base64 Song', artist: 'TKMusic', coverAssetId: 'asset_cover' });
  const project = {
    schemaVersion: 1,
    id: 'kr8_bad_asset_project',
    name: 'Bad Asset',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    composition: preset.composition,
    assets: [
      { id: 'asset_cover', type: 'image', role: 'cover', path: 'data:image/png;base64,AAAA', missing: false }
    ],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [preset.id],
    migrations: [],
    metadata: {}
  };

  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('data URI')));
});

test('TKMusic import creates relative asset paths and handles missing subtitles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-tkmusic-'));
  const trackDir = path.join(root, 'track');
  const outputDir = path.join(root, 'example.kr8');
  await mkdir(trackDir, { recursive: true });
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(path.join(trackDir, 'cover.jpeg'), 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: 'fixture-track-id',
    title: 'Fixture Track',
    artist: 'TKMusic',
    lyrics: '[Verse]\nHello',
    source: { provider: 'suno', profile: 'fixture' }
  }, null, 2));

  const result = await importTkMusicTrack({ trackDir, outputDir });
  assert.equal(result.status, 'created');
  assert.ok(result.warnings.includes('Lyrics asset not found.'));
  assert.ok(result.warnings.includes('Subtitle asset not found.'));

  const project = JSON.parse(await readFile(path.join(outputDir, 'project.json'), 'utf8'));
  assert.equal(validateProject(project).valid, true);
  assert.ok(project.assets.every((asset) => !path.isAbsolute(asset.path)));
  assert.ok(project.source.trackDir.includes('..'));
});

test('TKMusic import estimates duration from aligned lyrics when metadata has no duration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-tkmusic-duration-'));
  const trackDir = path.join(root, 'track');
  const subtitleDir = path.join(trackDir, 'postprod', 'subtitles');
  const outputDir = path.join(root, 'duration.kr8');
  await mkdir(subtitleDir, { recursive: true });
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(path.join(trackDir, 'cover.jpeg'), 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: 'duration-track-id',
    title: 'Duration Track',
    artist: 'TKMusic',
    lyrics: '[Intro]\nHello',
    source: { provider: 'suno', profile: 'fixture' }
  }, null, 2));
  await writeFile(path.join(subtitleDir, 'suno_aligned.json'), JSON.stringify({
    lines: [
      { startSeconds: 1, endSeconds: 2, text: 'Hello' },
      { startSeconds: 8, endSeconds: 314.5, text: 'Goodbye' }
    ]
  }, null, 2));

  const result = await importTkMusicTrack({ trackDir, outputDir });

  assert.equal(result.project.composition.duration, 314.5);
});
