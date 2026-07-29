import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importResolvedSource } from '../src/source-providers/importProject.js';
import { LOCAL_FILES_PROVIDER } from '../src/source-providers/localFilesProvider.js';
import { listSourceProviders } from '../src/source-providers/registry.js';
import { TK_MUSIC_PROVIDER, findTkMusicTrackDirById } from '../src/source-providers/tkMusicProvider.js';
import { ACE_STEP_PROVIDER } from '../src/source-providers/aceStepProvider.js';
import { YOUTUBE_PROVIDER } from '../src/source-providers/youtubeProvider.js';
import { validateProject } from '../src/project/schema.js';

test('source provider registry exposes official provider boundaries and capabilities', () => {
  const providers = listSourceProviders();
  const tkMusic = providers.find((provider) => provider.id === 'tkmusic');
  const localFiles = providers.find((provider) => provider.id === 'local-files');
  const aceStep = providers.find((provider) => provider.id === 'ace-step');
  const youtube = providers.find((provider) => provider.id === 'youtube');

  assert.ok(tkMusic.capabilities.includes('timedLyrics'));
  assert.ok(localFiles.capabilities.includes('audio'));
  assert.equal(aceStep.status, 'planned');
  assert.equal(youtube.status, 'planned-authorized-only');
});

test('planned providers are documented placeholders', async () => {
  await assert.rejects(() => ACE_STEP_PROVIDER.resolve(), /placeholder/);
  await assert.rejects(() => YOUTUBE_PROVIDER.resolve(), /authorized/);
});

test('LocalFilesProvider imports audio with optional cover and lyrics without TKMusic metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-local-files-'));
  const outputDir = path.join(root, 'local.kr8');
  const audioPath = path.join(root, 'song.mp3');
  const coverPath = path.join(root, 'cover.webp');
  const lyricsPath = path.join(root, 'lyrics.lrc');
  await writeFile(audioPath, 'fake audio');
  await writeFile(coverPath, 'fake cover');
  await writeFile(lyricsPath, '[00:01.00]Hello');

  const result = await importResolvedSource(LOCAL_FILES_PROVIDER, {
    audioPath,
    coverPath,
    lyricsPath,
    title: 'Local Song',
    artist: 'Local Artist',
    outputDir
  });

  assert.equal(result.providerId, 'local-files');
  assert.equal(result.project.source.provider, 'local-files');
  assert.equal(result.project.source.trackDir, undefined);
  assert.equal(validateProject(result.project).valid, true);
  assert.ok(result.project.assets.every((asset) => !path.isAbsolute(asset.path)));
});

test('TKMusicProvider confines Suno/TKMusic discovery details to provider output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-provider-tkmusic-'));
  const trackDir = path.join(root, 'track');
  const subtitleDir = path.join(trackDir, 'postprod', 'subtitles');
  await mkdir(subtitleDir, { recursive: true });
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(path.join(trackDir, 'cover.jpeg'), 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: 'tkmusic-track-id',
    title: 'Provider Track',
    artist: 'TKMusic',
    source: { provider: 'suno', profile: 'fixture' }
  }, null, 2));
  await writeFile(path.join(subtitleDir, 'suno_aligned.json'), JSON.stringify({
    lines: [{ startSeconds: 0, endSeconds: 12, text: 'Hello' }]
  }));

  const resolved = await TK_MUSIC_PROVIDER.resolve({ trackDir });

  assert.equal(resolved.providerId, 'tkmusic');
  assert.equal(resolved.sourceId, 'tkmusic-track-id');
  assert.equal(path.basename(resolved.assets.lyrics), 'suno_aligned.json');
  assert.equal(resolved.providerMetadata.tkMusicSourceProvider, 'suno');
});

test('TKMusicProvider resolves local track directory by track id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-provider-tkmusic-id-'));
  const trackDir = path.join(root, 'id-track');
  await mkdir(trackDir, { recursive: true });
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(path.join(trackDir, 'cover.jpeg'), 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: 'track-id-search',
    title: 'ID Track',
    artist: 'TKMusic'
  }, null, 2));

  const resolvedDir = await findTkMusicTrackDirById('track-id-search', root);
  const resolved = await TK_MUSIC_PROVIDER.resolve({ trackId: 'track-id-search', libraryRoot: root });

  assert.equal(resolvedDir, trackDir);
  assert.equal(resolved.title, 'ID Track');
  assert.equal(resolved.providerMetadata.trackDir, trackDir);
});

test('generic importer preserves legacy TKMusic project.source compatibility fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-provider-import-'));
  const trackDir = path.join(root, 'track');
  const outputDir = path.join(root, 'track.kr8');
  await mkdir(trackDir, { recursive: true });
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(path.join(trackDir, 'cover.jpeg'), 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: 'legacy-track-id',
    title: 'Legacy Track',
    artist: 'TKMusic'
  }, null, 2));

  const result = await importResolvedSource(TK_MUSIC_PROVIDER, { trackDir, outputDir });
  const project = JSON.parse(await readFile(path.join(outputDir, 'project.json'), 'utf8'));

  assert.equal(result.status, 'created');
  assert.equal(project.source.provider, 'tkmusic');
  assert.equal(project.source.trackId, 'legacy-track-id');
  assert.ok(project.source.trackDir.includes('..'));
});
