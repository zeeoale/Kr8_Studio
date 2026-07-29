import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { deserializeProject, serializeProject } from '../src/project/io.js';
import { validateProject } from '../src/project/schema.js';
import {
  deleteLayer,
  duplicateLayer,
  reorderLayer,
  toggleLayerLock,
  toggleLayerVisibility
} from '../src/layers/operations.js';
import { resolveAssetPath } from '../src/shared/path.js';

const fixturePath = path.resolve('examples', 'kr8-demo-landscape.kr8', 'project.json');
const fixtureDir = path.dirname(fixturePath);

async function loadFixture() {
  return deserializeProject(await readFile(fixturePath, 'utf8'));
}

test('loads public Kr8 demo project', async () => {
  const project = await loadFixture();
  const result = validateProject(project);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.ok(project.layers.length >= 5);
  assert.ok(project.layers.some((layer) => layer.type === 'shape'));
  assert.ok(project.layers.some((layer) => layer.type === 'image'));
  assert.ok(project.layers.some((layer) => layer.type === 'text'));
  assert.ok(project.layers.some((layer) => layer.type === 'visualizer'));
  assert.equal(project.schemaVersion, 1);
});

test('serialize and deserialize fixture without data loss', async () => {
  const originalText = await readFile(fixturePath, 'utf8');
  const project = deserializeProject(originalText);
  const roundTripped = deserializeProject(serializeProject(project));
  assert.deepEqual(roundTripped, project);
});

test('reorder updates order while preserving layer ids', async () => {
  const project = await loadFixture();
  const idsBefore = project.layers.map((layer) => layer.id).sort();
  const target = project.layers[0];
  const reordered = reorderLayer(project, target.id, 1);
  const idsAfter = reordered.layers.map((layer) => layer.id).sort();
  assert.deepEqual(idsAfter, idsBefore);
  assert.notDeepEqual(reordered.layers.map((layer) => layer.id), project.layers.map((layer) => layer.id));
});

test('visibility toggle only changes selected layer visibility', async () => {
  const project = await loadFixture();
  const target = project.layers[0];
  const next = toggleLayerVisibility(project, target.id);
  assert.equal(next.layers.find((layer) => layer.id === target.id).visible, !target.visible);
  assert.equal(next.layers.filter((layer) => layer.id !== target.id).every((layer) => layer.visible === project.layers.find((original) => original.id === layer.id).visible), true);
});

test('lock toggle only changes selected layer lock', async () => {
  const project = await loadFixture();
  const target = project.layers[1];
  const next = toggleLayerLock(project, target.id);
  assert.equal(next.layers.find((layer) => layer.id === target.id).locked, !target.locked);
});

test('duplicate creates new layer id and preserves source details', async () => {
  const project = await loadFixture();
  const source = project.layers.find((layer) => layer.type === 'image');
  const result = duplicateLayer(project, source.id);
  const copy = result.project.layers.find((layer) => layer.id === result.duplicatedLayerId);
  assert.ok(copy);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.type, source.type);
  assert.equal(copy.properties.assetId, source.properties.assetId);
  assert.equal(copy.audioBindings.length, source.audioBindings.length);
  assert.notEqual(copy.audioBindings[0].id, source.audioBindings[0].id);
});

test('delete removes layer and keeps remaining project valid', async () => {
  const project = await loadFixture();
  const target = project.layers.find((layer) => layer.type === 'visualizer');
  const next = deleteLayer(project, target.id);
  assert.equal(next.layers.some((layer) => layer.id === target.id), false);
  assert.equal(validateProject(next).valid, true);
});

test('cover asset path resolves relative to project.json directory', async () => {
  const project = await loadFixture();
  const cover = project.assets.find((asset) => asset.role === 'cover');
  const resolved = resolveAssetPath(fixtureDir, cover);
  assert.equal(path.isAbsolute(resolved), true);
  assert.ok(resolved.endsWith(path.join('kr8-demo-landscape.kr8', 'assets', '16_9_Demo_Cover.png')));
});
