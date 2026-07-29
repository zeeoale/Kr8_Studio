import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('desktop UI exposes the full Lyrics Editor workspace and controlled actions', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'index.html'), 'utf8');
  const source = await readFile(path.join(root, 'src', 'editor', 'public', 'lyrics-editor', 'lyrics-editor.js'), 'utf8');
  for (const id of [
    'lyricsEditorPanel',
    'lyricsEditorWaveform',
    'lyricsEditorCueList',
    'lyricsEditorSetStart',
    'lyricsEditorSetEnd',
    'lyricsEditorShiftScope',
    'lyricsEditorApply',
    'lyricsEditorSave'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /LyricsEditorSession/);
  assert.match(source, /exportSrt/);
  assert.match(source, /Discard unapplied Lyrics Editor changes/);
});

test('Lyrics toolbar opens the editor while the compact navigator remains available', async () => {
  const html = await readFile(path.join(root, 'src', 'editor', 'public', 'index.html'), 'utf8');
  const app = await readFile(path.join(root, 'src', 'editor', 'public', 'app.js'), 'utf8');
  assert.match(html, /id="addLyricsButton"/);
  assert.match(html, /id="lyricsList"/);
  assert.match(app, /addLyricsButton\.addEventListener\('click', openLyricsEditor\)/);
});
