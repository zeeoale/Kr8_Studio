import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importCoverAsset } from '../src/assets/coverImport.js';

test('importCoverAsset copies cover into project assets with collision-safe name', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-cover-import-'));
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'assets', 'cover.png'), 'existing');
  const project = {
    assets: [
      { id: 'tk_cover', type: 'image', role: 'cover', path: '../TKMusic/cover.jpeg', missing: false }
    ]
  };

  const result = await importCoverAsset(project, projectDir, {
    filename: 'cover.png',
    data: Buffer.from('new-cover')
  });

  assert.equal(result.project.assets.length, 2);
  assert.equal(result.asset.metadata.imported, true);
  assert.equal(result.asset.path, 'assets/cover-1.png');
  assert.equal(await readFile(path.join(projectDir, 'assets', 'cover-1.png'), 'utf8'), 'new-cover');
});

test('importCoverAsset rejects missing or unsupported cover files', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-cover-import-bad-'));
  await assert.rejects(
    () => importCoverAsset({ assets: [] }, projectDir, { filename: 'cover.gif', data: Buffer.from('x') }),
    /PNG, JPG, JPEG, or WEBP/
  );
  await assert.rejects(
    () => importCoverAsset({ assets: [] }, projectDir, { filename: 'cover.png', data: Buffer.alloc(0) }),
    /missing or empty/
  );
});
