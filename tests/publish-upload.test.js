import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MIB, contentRangeFor, createChunkPlan, uploadFileInChunks } from '../src/publish/chunks.js';

test('chunk plan sends files under 5 MiB as one whole chunk', () => {
  const plan = createChunkPlan(2 * MIB);
  assert.equal(plan.totalChunkCount, 1);
  assert.equal(plan.chunkSize, 2 * MIB);
  assert.deepEqual(plan.chunks[0], { index: 0, start: 0, end: 2 * MIB - 1, length: 2 * MIB });
});

test('chunk plan merges the remainder into the final chunk', () => {
  const plan = createChunkPlan(34 * MIB, 16 * MIB);
  assert.equal(plan.totalChunkCount, 2);
  assert.equal(plan.chunks[0].length, 16 * MIB);
  assert.equal(plan.chunks[1].length, 18 * MIB);
  assert.equal(contentRangeFor(plan.chunks[1], plan.fileSize), `bytes ${16 * MIB}-${34 * MIB - 1}/${34 * MIB}`);
});

test('chunk uploader retries network errors and 5xx then reports exact progress', async () => {
  const filePath = await smallFile();
  let calls = 0;
  const progress = [];
  const result = await uploadFileInChunks({
    filePath,
    fileSize: 8,
    contentType: 'video/mp4',
    uploadUrl: 'https://upload.example.test/session?token=kept',
    plan: smallPlan(),
    retryBaseMs: 0,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://upload.example.test/session?token=kept');
      assert.ok(init.headers['content-range']);
      if (calls === 1) throw new Error('network');
      if (calls === 2) return response(503);
      return response(init.headers['content-range'].startsWith('bytes 0-') ? 206 : 201);
    },
    onProgress: (value) => progress.push(value)
  });

  assert.equal(calls, 4);
  assert.equal(result.bytesSent, 8);
  assert.equal(result.retryCount, 2);
  assert.equal(result.progress, 1);
  assert.ok(progress.some((item) => item.status === 'retrying'));
});

test('chunk uploader does not retry permanent 4xx responses', async () => {
  const filePath = await smallFile();
  let calls = 0;
  await assert.rejects(() => uploadFileInChunks({
    filePath, fileSize: 8, contentType: 'video/mp4', uploadUrl: 'https://upload.example.test', plan: smallPlan(),
    retryBaseMs: 0, fetchImpl: async () => { calls += 1; return response(416); }
  }), /HTTP 416/);
  assert.equal(calls, 1);
});

test('chunk uploader identifies an expired upload URL', async () => {
  const filePath = await smallFile();
  await assert.rejects(() => uploadFileInChunks({
    filePath, fileSize: 8, contentType: 'video/mp4', uploadUrl: 'https://upload.example.test', plan: smallPlan(),
    fetchImpl: async () => response(403)
  }), (error) => error.code === 'upload_url_expired');
});

test('chunk uploader cancellation aborts the active request without deleting the file', async () => {
  const filePath = await smallFile();
  const controller = new AbortController();
  const upload = uploadFileInChunks({
    filePath, fileSize: 8, contentType: 'video/mp4', uploadUrl: 'https://upload.example.test', plan: smallPlan(), signal: controller.signal,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(upload, (error) => error.code === 'cancelled');
  const { stat } = await import('node:fs/promises');
  assert.equal((await stat(filePath)).isFile(), true);
});

async function smallFile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-upload-'));
  const filePath = path.join(directory, 'clip.mp4');
  await writeFile(filePath, Buffer.from('12345678'));
  return filePath;
}

function smallPlan() {
  return { fileSize: 8, chunkSize: 4, totalChunkCount: 2, chunks: [
    { index: 0, start: 0, end: 3, length: 4 },
    { index: 1, start: 4, end: 7, length: 4 }
  ] };
}

function response(status) { return { ok: status >= 200 && status < 300, status }; }
