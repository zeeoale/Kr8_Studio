import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findLatestValidReelExport, validatePublishMedia } from '../src/publish/media.js';

test('latest Reel resolver selects the newest existing Reel metadata', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-reel-'));
  const directory = path.join(project, 'exports', 'reels');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'old.mp4'), 'old');
  await writeFile(path.join(directory, 'new.mp4'), 'new');
  await writeReel(directory, 'old', '2026-07-20T10:00:00.000Z');
  await writeReel(directory, 'new', '2026-07-20T11:00:00.000Z');

  const latest = await findLatestValidReelExport(project);
  assert.equal(latest.relativePath, 'exports/reels/new.mp4');
});

test('latest Reel resolver rejects paths outside exports/reels', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-reel-safe-'));
  const directory = path.join(project, 'exports', 'reels');
  await mkdir(directory, { recursive: true });
  const outside = path.join(project, 'project.json');
  await writeFile(outside, '{}');
  await writeFile(path.join(directory, 'bad.reel.json'), JSON.stringify({ type: 'kr8-reel-render-metadata', outputPath: outside, createdAt: new Date().toISOString() }));
  assert.equal(await findLatestValidReelExport(project), null);
});

test('media validation accepts a compatible H.264 MP4', async () => {
  const filePath = await tempVideo('valid.mp4');
  const result = await validatePublishMedia(filePath, { probe: async () => compatibleProbe() });
  assert.equal(result.valid, true);
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.videoCodec, 'h264');
});

test('provider-neutral media validation reports missing and structurally invalid probe data', async () => {
  const missing = await validatePublishMedia(path.join(os.tmpdir(), 'does-not-exist.mp4'));
  assert.equal(missing.valid, false);
  assert.match(missing.errors[0], /missing or unreadable/);

  const filePath = await tempVideo('invalid.mov');
  const result = await validatePublishMedia(filePath, { probe: async () => ({ ...compatibleProbe(), videoCodec: 'mpeg2video', width: 0, fps: 0, duration: 0 }) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4);
});

async function tempVideo(name) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-media-'));
  const filePath = path.join(directory, name);
  await writeFile(filePath, 'video');
  return filePath;
}

function compatibleProbe() {
  return { hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 30, duration: 30, videoCodec: 'h264', audioCodec: 'aac' };
}

async function writeReel(directory, name, createdAt) {
  await writeFile(path.join(directory, `${name}.reel.json`), JSON.stringify({
    type: 'kr8-reel-render-metadata', createdAt, relativePath: `exports/reels/${name}.mp4`, duration: 10
  }));
}
