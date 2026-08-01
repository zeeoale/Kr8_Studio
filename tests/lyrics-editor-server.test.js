import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';

test('Lyrics Editor API applies a controlled asset without saving project.json implicitly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-lyrics-server-'));
  const projectPath = path.join(directory, 'project.json');
  const blankPath = path.resolve('examples', 'blank.kr8', 'project.json');
  const original = await readFile(blankPath, 'utf8');
  await writeFile(projectPath, original, 'utf8');
  const server = await createEditorServer({
    projectPath,
    host: '127.0.0.1',
    port: 0,
    envPath: path.join(directory, 'missing.env')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const applyResponse = await fetch(`http://127.0.0.1:${port}/api/lyrics-editor/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document: {
          providerField: 'preserved',
          lines: [{ id: 'cue_1', startSeconds: 1, endSeconds: 2, text: 'Edited' }]
        },
        duration: 10
      })
    });
    assert.equal(applyResponse.status, 200);
    const payload = await applyResponse.json();
    assert.equal(payload.asset.path, 'assets/lyrics.kr8.json');
    assert.equal(payload.document.lines[0].id, 'cue_1');

    const assetResponse = await fetch(`http://127.0.0.1:${port}/api/assets/${payload.asset.id}`);
    assert.equal(assetResponse.status, 200);
    const controlled = await assetResponse.json();
    assert.equal(controlled.providerField, 'preserved');
    assert.equal(controlled.lines[0].text, 'Edited');

    const stillUnsaved = JSON.parse(await readFile(projectPath, 'utf8'));
    assert.equal(stillUnsaved.assets.some((asset) => asset.id === payload.asset.id), false);

    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/project`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: payload.project })
    });
    assert.equal(saveResponse.status, 200);
    const saved = JSON.parse(await readFile(projectPath, 'utf8'));
    assert.equal(saved.assets.some((asset) => asset.id === payload.asset.id), true);
    const reloadResponse = await fetch(`http://127.0.0.1:${port}/api/project/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'project.json' })
    });
    assert.equal(reloadResponse.status, 200);
    const reloaded = await reloadResponse.json();
    assert.equal(reloaded.project.assets.find((asset) => asset.id === payload.asset.id).path, 'assets/lyrics.kr8.json');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('browser core route serves Lyrics Editor modules and rejects arbitrary paths', async () => {
  const server = await createEditorServer({
    projectPath: path.resolve('examples', 'blank.kr8', 'project.json'),
    host: '127.0.0.1',
    port: 0,
    envPath: 'missing-lyrics-core.env'
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const schema = await fetch(`http://127.0.0.1:${port}/core/lyrics-editor/schema.js`);
    assert.equal(schema.status, 200);
    assert.match(await schema.text(), /normalizeLyricsDocument/);
    const blocked = await fetch(`http://127.0.0.1:${port}/core/lyrics-editor/..%2Fstorage.js`);
    assert.equal(blocked.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
