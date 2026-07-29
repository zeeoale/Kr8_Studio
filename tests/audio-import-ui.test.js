import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('desktop editor exposes local audio import, replace confirmation and drag and drop', async () => {
  const [html, script, css] = await Promise.all([
    readFile(path.join(root, 'src', 'editor', 'public', 'index.html'), 'utf8'),
    readFile(path.join(root, 'src', 'editor', 'public', 'app.js'), 'utf8'),
    readFile(path.join(root, 'src', 'editor', 'public', 'styles.css'), 'utf8')
  ]);
  for (const id of [
    'importAudioButton',
    'audioFileInput',
    'audioImportPanel',
    'audioImportTitleInput',
    'audioImportArtistInput',
    'audioImportFormatSelect',
    'audioImportMetadataCheckbox',
    'audioImportRunButton',
    'audioImportResult'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /\.mp3,.wav,.flac,.m4a,.aac,.ogg/);
  assert.match(script, /Replace Audio and Keep Timings/);
  assert.match(script, /api\/assets\/import-audio/);
  assert.match(script, /body: file/);
  assert.match(script, /handleAudioDrop/);
  assert.match(script, /The blank startup project will remain unchanged/);
  assert.match(css, /\.stage-frame\.audio-drop-active/);
  assert.match(css, /\.audio-import-panel/);
});
