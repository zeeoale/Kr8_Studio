import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONTROLLED_LYRICS_PATH,
  applyLyricsDocument
} from '../src/lyrics-editor/storage.js';

function projectFixture() {
  return {
    schemaVersion: 1,
    id: 'project_fixture',
    name: 'Fixture',
    composition: { duration: 30 },
    assets: [{
      id: 'lyrics_existing',
      type: 'lyrics',
      role: 'lyrics',
      path: '../../../TKMusic/song/suno_aligned.json',
      customAssetField: 'keep'
    }],
    customProjectField: { keep: true }
  };
}

test('apply creates a controlled project-local lyrics asset without touching source fields', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-lyrics-'));
  try {
    const result = await applyLyricsDocument(projectFixture(), directory, {
      providerField: 'keep',
      lines: [{
        id: 'cue_existing',
        startSeconds: 1,
        endSeconds: 3,
        text: 'Hello',
        confidence: 0.99
      }]
    }, { now: '2026-07-28T12:00:00.000Z' });

    assert.equal(result.asset.id, 'lyrics_existing');
    assert.equal(result.asset.path, CONTROLLED_LYRICS_PATH);
    assert.equal(result.asset.originalPath, '../../../TKMusic/song/suno_aligned.json');
    assert.equal(result.asset.customAssetField, 'keep');
    assert.equal(result.project.customProjectField.keep, true);
    assert.equal(projectFixture().assets[0].path, '../../../TKMusic/song/suno_aligned.json');

    const saved = JSON.parse(await readFile(path.join(directory, 'assets', 'lyrics.kr8.json'), 'utf8'));
    assert.equal(saved.providerField, 'keep');
    assert.equal(saved.lines[0].id, 'cue_existing');
    assert.equal(saved.lines[0].confidence, 0.99);
    assert.equal(saved.kr8Source.originalPath, '../../../TKMusic/song/suno_aligned.json');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('apply creates one stable lyrics asset when a project has none', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-lyrics-'));
  try {
    const base = { ...projectFixture(), assets: [] };
    const first = await applyLyricsDocument(base, directory, {
      lines: [{ startSeconds: 0, endSeconds: 2, text: 'First' }]
    });
    const second = await applyLyricsDocument(base, directory, {
      lines: [{ startSeconds: 0, endSeconds: 2, text: 'Second' }]
    });
    assert.equal(first.asset.id, second.asset.id);
    assert.equal(first.project.assets.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('apply refuses blocking timing errors before writing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-lyrics-'));
  try {
    await assert.rejects(
      applyLyricsDocument(projectFixture(), directory, {
        lines: [{ startSeconds: 4, endSeconds: 2, text: 'Broken' }]
      }),
      /blocking validation errors/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
