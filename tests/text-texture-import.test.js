import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importTextTextureAsset } from '../src/assets/textTextureImport.js';

test('text texture import is relative, collision-safe, and keeps source project fields', async () => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-text-texture-'));
  await mkdir(path.join(projectDirectory, 'assets'), { recursive: true });
  const project = {
    schemaVersion: 1,
    metadata: { unknownFutureField: true },
    assets: []
  };

  const first = await importTextTextureAsset(project, projectDirectory, {
    filename: 'paper grain.png',
    data: Buffer.from('first')
  });
  const second = await importTextTextureAsset(first.project, projectDirectory, {
    filename: 'paper grain.png',
    data: Buffer.from('second')
  });

  assert.equal(first.asset.role, 'texture');
  assert.equal(first.asset.path, 'assets/text-texture-paper-grain.png');
  assert.equal(second.asset.path, 'assets/text-texture-paper-grain-1.png');
  assert.equal(path.isAbsolute(first.asset.path), false);
  assert.equal(second.project.metadata.unknownFutureField, true);
  assert.equal(
    await readFile(path.join(projectDirectory, second.asset.path), 'utf8'),
    'second'
  );
});

test('text texture import rejects unsupported and missing files', async () => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-text-texture-bad-'));
  await assert.rejects(
    () => importTextTextureAsset({ assets: [] }, projectDirectory, {
      filename: 'texture.gif',
      data: Buffer.from('x')
    }),
    /PNG, JPG, JPEG, or WEBP/
  );
  await assert.rejects(
    () => importTextTextureAsset({ assets: [] }, projectDirectory, {
      filename: 'texture.png',
      data: Buffer.alloc(0)
    }),
    /missing or empty/
  );
});

