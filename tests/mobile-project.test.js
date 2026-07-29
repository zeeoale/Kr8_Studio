import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';
import { applyMobileLayerAction, applyMobileVerticalFormat, patchMobileLayer } from '../src/mobile/project.js';

test('mobile format always converts composition and layer geometry to 9:16', () => {
  const vertical = applyMobileVerticalFormat(project());
  assert.equal(vertical.composition.width, 1080);
  assert.equal(vertical.composition.height, 1920);
  assert.equal(vertical.composition.outputTarget, '9:16');
  assert.equal(vertical.layers[0].transform.x, 540);
  assert.equal(vertical.layers[0].transform.y, 960);
  assert.equal(vertical.layers[0].transform.width, 1080);
  assert.equal(vertical.layers[0].transform.height, 1920);
  assert.equal(vertical.metadata.privateNote, 'preserve me');
});

test('mobile layer patches and actions preserve unsupported project data', () => {
  let current = patchMobileLayer(project(), 'background', {
    opacity: 0.5,
    transform: { x: 400 },
    properties: { fill: '#112233' }
  });
  assert.equal(current.layers[0].opacity, 0.5);
  assert.equal(current.layers[0].properties.fill, '#112233');
  assert.equal(current.layers[0].properties.desktopOnly, 'keep');
  const duplicated = applyMobileLayerAction(current, 'background', 'duplicate');
  current = duplicated.project;
  assert.equal(current.layers.length, 2);
  assert.notEqual(duplicated.selectedLayerId, 'background');
  current = applyMobileLayerAction(current, duplicated.selectedLayerId, 'delete').project;
  assert.equal(current.layers.length, 1);
  assert.equal(current.metadata.privateNote, 'preserve me');
});

test('mobile editor endpoints persist vertical format and safe layer edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kr8-mobile-editor-'));
  const projectPath = path.join(root, 'project.json');
  await writeFile(projectPath, `${JSON.stringify(project(), null, 2)}\n`);
  const server = await createEditorServer({ projectPath, host: '127.0.0.1', port: 0, envPath: 'missing-mobile-editor.env' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const verticalResponse = await fetch(`${origin}/api/mobile/project/vertical`, { method: 'POST' });
    const vertical = await verticalResponse.json();
    assert.equal(verticalResponse.status, 200);
    assert.equal(vertical.composition.verticalReady, true);

    const patchResponse = await fetch(`${origin}/api/mobile/layers/background`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { opacity: 0.42, properties: { fill: '#334455' } } })
    });
    const patched = await patchResponse.json();
    assert.equal(patchResponse.status, 200);
    assert.equal(patched.layers[0].opacity, 0.42);
    assert.equal(patched.layers[0].properties.fill, '#334455');

    const duplicateResponse = await fetch(`${origin}/api/mobile/layers/background/action`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'duplicate' })
    });
    const duplicated = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicated.layers.length, 2);

    const saved = JSON.parse(await readFile(projectPath, 'utf8'));
    assert.equal(saved.composition.width, 1080);
    assert.equal(saved.layers[0].properties.desktopOnly, 'keep');
    assert.equal(saved.metadata.privateNote, 'preserve me');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function project() {
  return {
    schemaVersion: 1,
    id: 'mobile_project',
    name: 'Mobile Project',
    composition: { width: 1920, height: 1080, fps: 30, duration: 60, backgroundColor: '#000000', pixelAspectRatio: 1 },
    assets: [],
    layers: [{
      id: 'background', type: 'shape', name: 'Background', visible: true, locked: false, parentId: null,
      order: 0, start: 0, end: 60,
      transform: { x: 960, y: 540, width: 1920, height: 1080, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
      opacity: 1, blendMode: 'normal', properties: { fill: '#000000', desktopOnly: 'keep' }, effects: [], audioBindings: [], animations: []
    }],
    scenes: [], presets: [], migrations: [], metadata: { privateNote: 'preserve me' }
  };
}
