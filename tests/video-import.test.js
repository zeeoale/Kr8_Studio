import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importCoverVideoAsset } from '../src/assets/videoImport.js';

test('importCoverVideoAsset copies video into project assets with collision-safe name', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-cover-video-import-'));
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await importCoverVideoAsset({ assets: [] }, projectDir, {
    filename: 'cover-loop.mp4',
    data: Buffer.from('first-video')
  });

  const result = await importCoverVideoAsset({ assets: [] }, projectDir, {
    filename: 'cover-loop.mp4',
    data: Buffer.from('second-video')
  });

  assert.equal(result.asset.type, 'video');
  assert.equal(result.asset.role, 'coverVideo');
  assert.equal(result.asset.path, 'assets/cover-loop-1.mp4');
  assert.equal(result.asset.metadata.muted, true);
  assert.equal(await readFile(path.join(projectDir, 'assets', 'cover-loop-1.mp4'), 'utf8'), 'second-video');
});

test('importCoverVideoAsset rejects missing or unsupported video files', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-cover-video-import-bad-'));

  await assert.rejects(
    () => importCoverVideoAsset({ assets: [] }, projectDir, { filename: 'cover.gif', data: Buffer.from('x') }),
    /MP4, WEBM, or MOV/
  );
  await assert.rejects(
    () => importCoverVideoAsset({ assets: [] }, projectDir, { filename: 'cover.mp4', data: Buffer.alloc(0) }),
    /missing or empty/
  );
});
