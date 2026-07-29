import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';

test('audio import endpoint streams, probes and serves project-local audio without implicit save', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-server-'));
  const projectPath = path.join(directory, 'project.json');
  const blank = JSON.parse(await readFile(path.resolve('examples', 'blank.kr8', 'project.json'), 'utf8'));
  blank.id = 'audio_server_fixture';
  blank.name = 'Audio Server Fixture';
  await writeFile(projectPath, `${JSON.stringify(blank, null, 2)}\n`, 'utf8');
  const wav = createPcmWav({ duration: 0.3, frequency: 220 });
  const server = await createEditorServer({
    projectPath,
    host: '127.0.0.1',
    port: 0,
    envPath: path.join(directory, 'missing.env')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  try {
    const firstResponse = await fetch(
      `${origin}/api/assets/import-audio?filename=${encodeURIComponent('Local Audio.wav')}&mode=replace`,
      {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav
      }
    );
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200, first.error);
    assert.equal(first.createdProject, false);
    assert.equal(first.saved, false);
    assert.equal(first.audio.format, 'wav');
    assert.equal(first.audio.codec, 'pcm_s16le');
    assert.equal(first.audio.proxyGenerated, false);
    assert.match(first.project.assets.at(-1).path, /^assets\/audio\/Local-Audio\.wav$/);
    assert.equal(path.isAbsolute(first.project.assets.at(-1).path), false);
    assert.ok(first.project.composition.duration > 0.25);

    const unchanged = JSON.parse(await readFile(projectPath, 'utf8'));
    assert.deepEqual(unchanged.assets, blank.assets);

    const assetResponse = await fetch(`${origin}/api/assets/${encodeURIComponent(first.audio.id)}`, {
      headers: { range: 'bytes=0-31' }
    });
    assert.equal(assetResponse.status, 206);
    assert.equal((await assetResponse.arrayBuffer()).byteLength, 32);

    const confirmationResponse = await fetch(
      `${origin}/api/assets/import-audio?filename=second.wav&mode=replace`,
      {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav
      }
    );
    assert.equal(confirmationResponse.status, 409);
    const confirmation = await confirmationResponse.json();
    assert.match(confirmation.error, /confirmation/i);

    const replaceResponse = await fetch(
      `${origin}/api/assets/import-audio?filename=second.wav&mode=replace&replace=1`,
      {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav
      }
    );
    assert.equal(replaceResponse.status, 200);
    const replacement = await replaceResponse.json();
    assert.equal(replacement.previousAudio.id, first.audio.id);
    assert.equal(
      replacement.project.assets.filter((asset) => asset.type === 'audio' && asset.role === 'song').length,
      1
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Create Project from Audio leaves the startup blank untouched and creates a portable project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-create-'));
  const blankDirectory = path.join(root, 'blank.kr8');
  const blankProjectPath = path.join(blankDirectory, 'project.json');
  await mkdir(blankDirectory, { recursive: true });
  const blankText = await readFile(path.resolve('examples', 'blank.kr8', 'project.json'), 'utf8');
  await writeFile(blankProjectPath, blankText, 'utf8');
  const wav = createPcmWav({ duration: 0.2, frequency: 330 });
  const server = await createEditorServer({
    projectPath: blankProjectPath,
    projectsRoot: root,
    host: '127.0.0.1',
    port: 0,
    envPath: path.join(root, 'missing.env')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/assets/import-audio?filename=${encodeURIComponent('내 안의 괴물.wav')}`
        + `&mode=create&title=${encodeURIComponent('내 안의 괴물')}&artist=Local&formatId=vertical-1080p`,
      {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav
      }
    );
    const payload = await response.json();
    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.createdProject, true);
    assert.equal(payload.saved, true);
    assert.notEqual(payload.projectPath, blankProjectPath);
    assert.match(payload.projectPath, /내-안의-괴물\.kr8[\\/]project\.json$/u);
    assert.equal(payload.project.composition.width, 1080);
    assert.equal(payload.project.composition.height, 1920);
    assert.equal(payload.project.source.provider, 'local-files');
    assert.equal(payload.project.assets.find((asset) => asset.role === 'song').path.includes('\\'), false);
    assert.equal(await readFile(blankProjectPath, 'utf8'), blankText);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

function createPcmWav(options = {}) {
  const sampleRate = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const duration = Number(options.duration || 0.25);
  const sampleCount = Math.max(1, Math.round(sampleRate * duration));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  const frequency = Number(options.frequency || 220);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * frequency) * 8_000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}
