import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listRenderHistory } from '../src/exports/history.js';

test('listRenderHistory returns recent render metadata from project exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-export-history-'));
  const videosDir = path.join(dir, 'exports', 'videos');
  await mkdir(videosDir, { recursive: true });
  await writeFile(path.join(videosDir, 'first.mp4'), 'video-a');
  await writeFile(path.join(videosDir, 'second.mp4'), 'video-bb');
  await writeFile(path.join(videosDir, 'first.render.json'), JSON.stringify({
    type: 'kr8-render-metadata',
    rendererMode: 'direct-mp4',
    createdAt: '2026-07-12T10:00:00.000Z',
    outputPath: path.join(videosDir, 'first.mp4'),
    startTimestamp: 0,
    duration: 10,
    fps: 30,
    frameCount: 300,
    expectedFrameCount: 300,
    hasAudio: true,
    benchmark: {
      client: {
        mode: 'raw-rgba',
        averageFps: 31.2,
        averageFrameRenderMs: 4.8
      },
      server: {
        averageStdinWriteMs: 14.4,
        ffmpegEncodeMs: 1020
      }
    }
  }));
  await writeFile(path.join(videosDir, 'second.render.json'), JSON.stringify({
    type: 'kr8-render-metadata',
    rendererMode: 'png-sequence-mp4-draft',
    createdAt: '2026-07-12T11:00:00.000Z',
    relativePath: 'exports/videos/second.mp4',
    startTimestamp: 65,
    duration: 5,
    fps: 12,
    frameCount: 60,
    expectedFrameCount: 60,
    hasAudio: false
  }));

  const history = await listRenderHistory(dir);

  assert.equal(history.length, 2);
  assert.equal(history[0].relativePath, 'exports/videos/second.mp4');
  assert.equal(history[0].metadataRelativePath, 'exports/videos/second.render.json');
  assert.equal(history[0].rendererMode, 'png-sequence-mp4-draft');
  assert.equal(history[0].sizeBytes, 8);
  assert.equal(history[1].relativePath, 'exports/videos/first.mp4');
  assert.equal(history[1].hasAudio, true);
  assert.equal(history[1].benchmark.client.mode, 'raw-rgba');
  assert.equal(history[1].benchmark.client.averageFps, 31.2);
  assert.equal(history[1].benchmark.server.ffmpegEncodeMs, 1020);
});

test('listRenderHistory ignores invalid metadata and paths outside exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-export-history-'));
  const videosDir = path.join(dir, 'exports', 'videos');
  await mkdir(videosDir, { recursive: true });
  await writeFile(path.join(videosDir, 'bad.render.json'), '{ nope');
  await writeFile(path.join(videosDir, 'wrong-type.render.json'), JSON.stringify({
    type: 'other'
  }));
  await writeFile(path.join(videosDir, 'outside.render.json'), JSON.stringify({
    type: 'kr8-render-metadata',
    createdAt: '2026-07-12T11:00:00.000Z',
    outputPath: path.join(os.tmpdir(), 'outside.mp4')
  }));

  const history = await listRenderHistory(dir);

  assert.deepEqual(history, []);
});
