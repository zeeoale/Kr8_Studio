import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendFrameSequenceExportBatch,
  createFrameSequenceExportSession,
  finalizeFrameSequenceExportSession,
  saveFrameExport,
  saveFrameSequenceExport
} from '../src/exports/frameExport.js';

test('saveFrameExport writes a PNG frame inside project exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-frame-export-'));
  const dataUrl = `data:image/png;base64,${Buffer.from('png-data').toString('base64')}`;

  const result = await saveFrameExport(dir, {
    dataUrl,
    timestamp: 65.25,
    projectName: 'Glass (Dubstep Remix)'
  });

  assert.equal(result.relativePath, 'exports/frames/glass-dubstep-remix-01m05s25.png');
  assert.equal(await readFile(result.outputPath, 'utf8'), 'png-data');
});

test('saveFrameExport rejects non-PNG data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-frame-export-'));
  await assert.rejects(() => saveFrameExport(dir, {
    dataUrl: 'data:image/jpeg;base64,AAAA',
    timestamp: 0,
    projectName: 'Bad'
  }), /PNG data URL/);
});

test('saveFrameSequenceExport writes ordered PNG frames and manifest', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-clip-export-'));
  const dataUrl = `data:image/png;base64,${Buffer.from('clip-frame').toString('base64')}`;

  const result = await saveFrameSequenceExport(dir, {
    projectName: 'Takara(宝物)',
    startTimestamp: 42.62,
    fps: 6,
    frames: [
      { timestamp: 42.62, dataUrl },
      { timestamp: 42.79, dataUrl }
    ]
  });

  assert.equal(result.frameCount, 2);
  assert.equal(result.fps, 6);
  assert.equal(result.relativePath, 'exports/clips/takara-00m42s62-2f');
  assert.equal(result.frames[0].relativePath, 'exports/clips/takara-00m42s62-2f/frame-0001-00m42s62.png');
  assert.equal(await readFile(result.frames[1].outputPath, 'utf8'), 'clip-frame');

  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.type, 'kr8-frame-sequence');
  assert.equal(manifest.frameCount, 2);
  assert.equal(manifest.frames[0].relativePath, 'frame-0001-00m42s62.png');
});

test('saveFrameSequenceExport rejects invalid clip frames', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-clip-export-'));
  await assert.rejects(() => saveFrameSequenceExport(dir, {
    projectName: 'Bad Clip',
    frames: [{ timestamp: 0, dataUrl: 'data:image/jpeg;base64,AAAA' }]
  }), /PNG data URL/);
});

test('frame sequence batch export writes all frames before manifest finalize', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-clip-batch-export-'));
  const dataUrl = `data:image/png;base64,${Buffer.from('batch-frame').toString('base64')}`;
  const session = await createFrameSequenceExportSession(dir, {
    projectName: 'Batch Clip',
    startTimestamp: 10,
    fps: 30,
    expectedFrameCount: 10
  });

  await appendFrameSequenceExportBatch(session, {
    offset: 0,
    frames: Array.from({ length: 4 }, (_, index) => ({ timestamp: 10 + index / 30, dataUrl }))
  });
  await appendFrameSequenceExportBatch(session, {
    offset: 4,
    frames: Array.from({ length: 6 }, (_, index) => ({ timestamp: 10 + (index + 4) / 30, dataUrl }))
  });

  const result = await finalizeFrameSequenceExportSession(session);
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));

  assert.equal(result.frameCount, 10);
  assert.equal(manifest.frameCount, 10);
  assert.equal(manifest.expectedFrameCount, 10);
  assert.equal(manifest.frames.at(-1).relativePath, 'frame-0010-00m10s30.png');
  assert.equal(await readFile(result.frames.at(-1).outputPath, 'utf8'), 'batch-frame');
});
