import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  importAudioAsset,
  isDirectPlaybackReliable,
  sanitizeAudioFilename
} from '../src/assets/audioImport.js';
import { loadProject, saveProject } from '../src/project/io.js';

const probePayload = (overrides = {}) => JSON.stringify({
  format: {
    format_name: overrides.format || 'mp3',
    duration: String(overrides.duration || 12.5),
    size: '10',
    tags: {
      title: overrides.title || 'Imported Song',
      artist: overrides.artist || 'Imported Artist',
      album: 'Imported Album'
    }
  },
  streams: [
    {
      index: 0,
      codec_type: 'audio',
      codec_name: overrides.codec || 'mp3',
      sample_rate: '48000',
      channels: 2,
      disposition: { attached_pic: 0 }
    }
  ]
});

function project(overrides = {}) {
  const layer = (id, end) => ({
    id,
    type: 'shape',
    name: id,
    visible: true,
    locked: false,
    order: id === 'auto' ? 0 : 1,
    start: 0,
    end,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    opacity: 1,
    blendMode: 'normal',
    properties: {},
    effects: [],
    audioBindings: [],
    animations: []
  });
  return {
    schemaVersion: 1,
    id: 'audio-import-project',
    name: 'Audio Import',
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 10,
      backgroundColor: '#000000'
    },
    assets: [],
    layers: [layer('auto', 10), layer('custom', 7.5)],
    scenes: [{ id: 'scene', name: 'Scene', start: 0, end: 10, overrides: [] }],
    presets: [],
    migrations: [],
    metadata: { title: 'Existing', artist: 'Existing Artist', custom: true },
    ...overrides
  };
}

async function importFixture(extension, codec, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `kr8-audio-${extension.slice(1)}-`));
  const source = path.join(root, `source${extension}`);
  const projectDirectory = path.join(root, 'project.kr8');
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(source, Buffer.from(`fixture-${extension}`));
  const execFileImpl = async (command, args) => {
    if (/ffprobe/i.test(command)) return probePayload({ codec, format: extension.slice(1), ...options });
    await writeFile(args.at(-1), Buffer.from('proxy-wave'));
    return '';
  };
  return importAudioAsset(project(), projectDirectory, {
    sourcePath: source,
    originalFilename: options.filename || path.basename(source),
    updateProjectMetadata: options.updateProjectMetadata === true
  }, { execFileImpl });
}

for (const [extension, codec] of [
  ['.mp3', 'mp3'],
  ['.wav', 'pcm_s16le'],
  ['.flac', 'flac'],
  ['.m4a', 'aac'],
  ['.ogg', 'vorbis']
]) {
  test(`import ${extension.slice(1).toUpperCase()} copies a directly playable project-local asset`, async () => {
    const result = await importFixture(extension, codec);
    assert.equal(result.asset.metadata.proxyGenerated, false);
    assert.match(result.asset.path, /^assets\/audio\//);
    assert.equal(path.isAbsolute(result.asset.path), false);
    assert.match(result.asset.metadata.waveformCacheKey, /^[a-f0-9]{64}$/);
    assert.match(result.asset.id, /^kr8_[a-f0-9]{16}$/);
    assert.equal(result.project.composition.duration, 12.5);
    assert.equal(result.project.layers[0].end, 12.5);
    assert.equal(result.project.layers[1].end, 7.5);
  });
}

test('audio metadata is preserved and project title/artist change only with explicit confirmation', async () => {
  const untouched = await importFixture('.mp3', 'mp3');
  assert.equal(untouched.project.metadata.title, 'Existing');
  assert.equal(untouched.asset.metadata.title, 'Imported Song');

  const updated = await importFixture('.mp3', 'mp3', { updateProjectMetadata: true });
  assert.equal(updated.project.metadata.title, 'Imported Song');
  assert.equal(updated.project.metadata.artist, 'Imported Artist');
  assert.equal(updated.project.metadata.custom, true);
});

test('Unicode names, spaces and collisions remain portable without silent overwrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-unicode-'));
  const source = path.join(root, '내 안의 음악 final.mp3');
  const projectDirectory = path.join(root, 'portable.kr8');
  await mkdir(path.join(projectDirectory, 'assets', 'audio'), { recursive: true });
  await writeFile(source, 'audio');
  await writeFile(path.join(projectDirectory, 'assets', 'audio', '내-안의-음악-final.mp3'), 'existing');
  const result = await importAudioAsset(project(), projectDirectory, {
    sourcePath: source,
    originalFilename: path.basename(source)
  }, { execFileImpl: async () => probePayload() });
  assert.equal(result.asset.path, 'assets/audio/내-안의-음악-final-1.mp3');
  assert.equal(result.asset.metadata.originalFilename, '내 안의 음악 final.mp3');
  assert.equal(sanitizeAudioFilename('../bad:name?.mp3'), 'bad-name.mp3');
});

test('corrupt and unsupported files fail before changing the project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-bad-'));
  const projectDirectory = path.join(root, 'project.kr8');
  const corrupt = path.join(root, 'corrupt.mp3');
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(corrupt, 'not audio');
  await assert.rejects(
    () => importAudioAsset(project(), projectDirectory, {
      sourcePath: corrupt,
      originalFilename: 'corrupt.mp3'
    }, { execFileImpl: async () => { throw new Error('Invalid data found'); } }),
    /Invalid data found/
  );
  await assert.rejects(
    () => importAudioAsset(project(), projectDirectory, {
      sourcePath: corrupt,
      originalFilename: 'corrupt.wma'
    }),
    /MP3, WAV, FLAC, M4A, AAC, or OGG/
  );
});

test('raw AAC generates a WAV playback proxy while preserving the original', async () => {
  const result = await importFixture('.aac', 'aac');
  assert.equal(isDirectPlaybackReliable('.aac', 'aac'), false);
  assert.equal(result.asset.metadata.proxyGenerated, true);
  assert.match(result.asset.metadata.sourcePath, /\.aac$/);
  assert.match(result.asset.path, /-playback\.wav$/);
});

test('replace audio preserves lyrics, scenes and legacy TKMusic source fields', async () => {
  const legacy = project({
    source: { provider: 'tkmusic', trackId: 'legacy-track', custom: 'keep' },
    assets: [
      { id: 'old-song', type: 'audio', role: 'song', path: '../TKMusic/audio.mp3', missing: false },
      { id: 'lyrics', type: 'lyrics', role: 'lyrics', path: 'assets/lyrics.json', missing: false }
    ],
    scenes: [{ id: 'custom-scene', name: 'Custom', start: 1, end: 7, overrides: [{ keep: true }] }]
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-replace-'));
  const source = path.join(root, 'new.mp3');
  const projectDirectory = path.join(root, 'project.kr8');
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(source, 'new audio');
  const result = await importAudioAsset(legacy, projectDirectory, {
    sourcePath: source,
    originalFilename: 'new.mp3'
  }, { execFileImpl: async () => probePayload({ duration: 6 }) });
  assert.deepEqual(result.project.source, legacy.source);
  assert.equal(result.project.assets.find((asset) => asset.id === 'lyrics').path, 'assets/lyrics.json');
  assert.equal(result.project.assets.find((asset) => asset.id === 'old-song').role, 'song-previous');
  assert.deepEqual(result.project.scenes[0].overrides, [{ keep: true }]);
});

test('save, reload and moved project directory keep relative audio references valid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-move-'));
  const source = path.join(root, 'portable.mp3');
  const originalDirectory = path.join(root, 'original.kr8');
  const movedDirectory = path.join(root, 'moved.kr8');
  await mkdir(originalDirectory, { recursive: true });
  await writeFile(source, 'portable audio');
  const result = await importAudioAsset(project(), originalDirectory, {
    sourcePath: source,
    originalFilename: 'portable.mp3'
  }, { execFileImpl: async () => probePayload() });
  await saveProject(originalDirectory, result.project);
  await cp(originalDirectory, movedDirectory, { recursive: true });
  const moved = await loadProject(movedDirectory);
  const asset = moved.assets.find((item) => item.role === 'song');
  assert.equal(path.isAbsolute(asset.path), false);
  assert.equal(await readFile(path.resolve(movedDirectory, asset.path), 'utf8'), 'portable audio');
});
