import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';
import {
  clearTkMusicLibraryCache,
  getTkMusicLibraryCoverPath,
  listTkMusicLibrary
} from '../src/source-providers/tkMusicProvider.js';

test('TKMusic catalog exposes searchable card data without local paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-tkmusic-catalog-'));
  try {
    const valid = await createTrack(root, {
      directory: 'catalog-track',
      id: 'catalog-track-id',
      title: 'Catalog Track',
      tags: 'dubstep, cinematic',
      createdAt: '2026-07-20T10:00:00.000Z'
    });
    const malformed = path.join(root, 'malformed-track');
    await mkdir(malformed, { recursive: true });
    await writeFile(path.join(malformed, 'metadata.json'), '{bad json');

    const catalog = await listTkMusicLibrary({ libraryRoot: root, refresh: true });
    assert.equal(catalog.total, 1);
    assert.equal(catalog.skipped, 1);
    assert.deepEqual(catalog.tracks[0].availability, {
      audio: true,
      cover: true,
      lyrics: true,
      timedLyrics: true
    });
    assert.equal(catalog.tracks[0].duration, 12);
    assert.equal(catalog.tracks[0].tags, 'dubstep, cinematic');
    const serialized = JSON.stringify(catalog);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes('trackDir'), false);
    assert.equal(serialized.includes('coverPath'), false);
    assert.equal(await getTkMusicLibraryCoverPath('catalog-track-id', { libraryRoot: root }), valid.coverPath);
  } finally {
    clearTkMusicLibraryCache(root);
    await rm(root, { recursive: true, force: true });
  }
});

test('editor TKMusic library API serves covers and reopens existing projects without overwriting them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-tkmusic-api-'));
  const libraryRoot = path.join(root, 'library');
  const projectsRoot = path.join(root, 'projects');
  const blankDirectory = path.join(projectsRoot, 'blank.kr8');
  const blankProjectPath = path.join(blankDirectory, 'project.json');
  await mkdir(blankDirectory, { recursive: true });
  await writeFile(blankProjectPath, JSON.stringify(blankProject()));
  await createTrack(libraryRoot, {
    directory: 'api-track',
    id: 'api-track-id',
    title: 'API Track',
    tags: 'r&b, soul',
    createdAt: '2026-07-21T10:00:00.000Z'
  });

  const previousLibraryRoot = process.env.KR8_TKMUSIC_LIBRARY_ROOT;
  const previousProjectsRoot = process.env.KR8_PROJECTS_ROOT;
  process.env.KR8_TKMUSIC_LIBRARY_ROOT = libraryRoot;
  process.env.KR8_PROJECTS_ROOT = projectsRoot;
  clearTkMusicLibraryCache(libraryRoot);
  const server = await createEditorServer({
    projectPath: blankProjectPath,
    host: '127.0.0.1',
    port: 0,
    envPath: path.join(root, 'missing.env')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const listResponse = await fetch(`${origin}/api/source-providers/tkmusic/tracks?refresh=1`);
    const listText = await listResponse.text();
    const list = JSON.parse(listText);
    assert.equal(listResponse.status, 200);
    assert.equal(list.total, 1);
    assert.equal(list.tracks[0].id, 'api-track-id');
    assert.match(list.tracks[0].coverUrl, /^\/api\/source-providers\/tkmusic\/cover\?/);
    assert.equal(listText.includes(root), false);

    const coverResponse = await fetch(`${origin}${list.tracks[0].coverUrl}`);
    assert.equal(coverResponse.status, 200);
    assert.equal(coverResponse.headers.get('content-type'), 'image/jpeg');
    assert.equal(await coverResponse.text(), 'fake cover');

    const firstImport = await fetch(`${origin}/api/projects/import-tkmusic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackId: 'api-track-id' })
    });
    const firstPayload = await firstImport.json();
    assert.equal(firstImport.status, 200);
    assert.equal(firstPayload.imported, true);
    assert.equal(firstPayload.openedExisting, undefined);
    const imported = JSON.parse(await readFile(firstPayload.projectPath, 'utf8'));
    imported.metadata.userMarker = 'keep-me';
    await writeFile(firstPayload.projectPath, JSON.stringify(imported, null, 2));

    const secondImport = await fetch(`${origin}/api/projects/import-tkmusic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackId: 'api-track-id' })
    });
    const secondPayload = await secondImport.json();
    assert.equal(secondImport.status, 200);
    assert.equal(secondPayload.imported, false);
    assert.equal(secondPayload.openedExisting, true);
    assert.equal(secondPayload.project.metadata.userMarker, 'keep-me');
    assert.equal(secondPayload.projectPath, firstPayload.projectPath);

    const missingCover = await fetch(`${origin}/api/source-providers/tkmusic/cover?trackId=missing`);
    assert.equal(missingCover.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv('KR8_TKMUSIC_LIBRARY_ROOT', previousLibraryRoot);
    restoreEnv('KR8_PROJECTS_ROOT', previousProjectsRoot);
    clearTkMusicLibraryCache(libraryRoot);
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop editor exposes the TKMusic library modal and keeps manual ID fallback', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const [html, script, css] = await Promise.all([
    readFile(path.join(root, 'src', 'editor', 'public', 'index.html'), 'utf8'),
    readFile(path.join(root, 'src', 'editor', 'public', 'app.js'), 'utf8'),
    readFile(path.join(root, 'src', 'editor', 'public', 'styles.css'), 'utf8')
  ]);
  assert.match(html, /TKMusic Library/);
  assert.match(html, /id="tkMusicLibrarySearch"/);
  assert.match(html, /id="tkMusicManualIdInput"/);
  assert.match(script, /api\/source-providers\/tkmusic\/tracks/);
  assert.match(script, /openedExisting/);
  assert.match(script, /const rounded = Math\.round\(value\)/);
  assert.equal(script.includes('Math.round(value % 60)'), false);
  assert.match(css, /\.tkmusic-library-grid/);
  assert.equal(script.includes("window.prompt('TKMusic/Suno track ID')"), false);
});

async function createTrack(root, options) {
  const trackDir = path.join(root, options.directory);
  const subtitlesDir = path.join(trackDir, 'postprod', 'subtitles');
  await mkdir(subtitlesDir, { recursive: true });
  const coverPath = path.join(trackDir, 'cover.jpeg');
  await writeFile(path.join(trackDir, 'audio.mp3'), 'fake audio');
  await writeFile(coverPath, 'fake cover');
  await writeFile(path.join(trackDir, 'metadata.json'), JSON.stringify({
    id: options.id,
    title: options.title,
    artist: 'TKMusic',
    tags: options.tags,
    mood: 'energetic',
    model: 'v5',
    createdAt: options.createdAt,
    source: { provider: 'suno', rawId: options.id }
  }, null, 2));
  await writeFile(path.join(subtitlesDir, 'suno_aligned.json'), JSON.stringify({
    lines: [{ startSeconds: 1, endSeconds: 12, text: 'Catalog lyric' }]
  }));
  return { trackDir, coverPath };
}

function blankProject() {
  return {
    schemaVersion: 1,
    id: 'blank-library-test',
    name: 'Blank',
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 10,
      backgroundColor: '#000000',
      pixelAspectRatio: 1
    },
    assets: [],
    layers: [],
    scenes: [],
    presets: [],
    metadata: {},
    migrations: []
  };
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
