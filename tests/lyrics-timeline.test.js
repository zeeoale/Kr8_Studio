import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveMetadataLyricScenes,
  deriveLyricScenes,
  extractLyricSections,
  findCurrentLyric,
  getRenderableLyricCues,
  normalizeLyricText,
  parseAlignedLyrics
} from '../src/lyrics/timeline.js';

test('parseAlignedLyrics reads timed lines and combined section labels', () => {
  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 0, endSeconds: 1, text: 'Yeah...' },
      { startSeconds: 1, endSeconds: 1.1, text: '[' },
      { startSeconds: 1.1, endSeconds: 1.2, text: 'Verse 1]' },
      { startSeconds: 1.3, endSeconds: 3, text: 'Black boots on the wet concrete' }
    ]
  });

  assert.equal(cues.length, 3);
  assert.equal(cues[1].text, '[Verse 1]');
  assert.equal(cues[1].kind, 'section');
});

test('findCurrentLyric returns active lyric line and ignores section labels', () => {
  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 0, endSeconds: 0.5, text: '[Intro]' },
      { startSeconds: 1, endSeconds: 2, text: 'You canâ€™t stop me' }
    ]
  });

  const current = findCurrentLyric(cues, 1.4);
  assert.equal(current.text, "You can't stop me");
});

test('parseAlignedLyrics excludes bracket and parenthetical direction cues from rendered lyrics', () => {
  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 0, endSeconds: 1, text: '[Intro]' },
      { startSeconds: 1, endSeconds: 2, text: '( Melancholic ambient synth pads and distant' },
      { startSeconds: 2, endSeconds: 3, text: 'cinematic textures begin quietly)' },
      { startSeconds: 4, endSeconds: 5, text: 'Actual sung lyric' }
    ]
  });

  assert.deepEqual(cues.map((cue) => cue.kind), ['section', 'direction', 'direction', 'line']);
  assert.deepEqual(getRenderableLyricCues(cues).map((cue) => cue.text), ['Actual sung lyric']);
  assert.equal(findCurrentLyric(cues, 1.5), null);
  assert.equal(findCurrentLyric(cues, 4.5).text, 'Actual sung lyric');
});

test('findCurrentLyric returns null after final lyric and for projects without lyrics', () => {
  const cues = parseAlignedLyrics({
    lines: [{ startSeconds: 1, endSeconds: 2, text: 'Last line' }]
  });

  assert.equal(findCurrentLyric([], 0), null);
  assert.equal(findCurrentLyric(cues, 4.6), null);
  assert.equal(findCurrentLyric(cues, 99), null);
});

test('deriveLyricScenes creates preview scenes from timed section labels', () => {
  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 0.5, endSeconds: 0.7, text: '[Intro]' },
      { startSeconds: 16, endSeconds: 16.2, text: '[Verse 1]' },
      { startSeconds: 40, endSeconds: 40.2, text: '[Chorus]' },
      { startSeconds: 41, endSeconds: 42, text: 'Hook line' }
    ]
  });

  const scenes = deriveLyricScenes(cues, 60);
  assert.deepEqual(scenes.map((scene) => scene.name), ['Intro', 'Verse 1', 'Chorus']);
  assert.equal(scenes.at(-1).end, 60);
});

test('deriveMetadataLyricScenes recovers sections missing from aligned lyrics', () => {
  const rawLyrics = `[Intro]
(cinematic direction)
Yeah.

[Verse 1]
I see you lay there all snuggled up in the sheets

[Chorus]
You are the most beautiful woman to ever lay eyes on

[Bridge]
I know that I love you`;

  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 12, endSeconds: 13, text: 'Yeah.' },
      { startSeconds: 54, endSeconds: 57, text: 'you lay there all snuggled up in the sheets' },
      { startSeconds: 90, endSeconds: 94, text: 'You are the most beautiful woman to ever lay eyes on' },
      { startSeconds: 190, endSeconds: 194, text: 'I know that I love you' }
    ]
  });

  const scenes = deriveMetadataLyricScenes(rawLyrics, cues, 240);
  assert.deepEqual(scenes.map((scene) => scene.name), ['Intro', 'Verse 1', 'Chorus', 'Bridge']);
  assert.equal(scenes[1].start, 54);
  assert.equal(scenes.at(-1).end, 240);
});

test('deriveMetadataLyricScenes keeps repeated chorus sections in timeline order', () => {
  const rawLyrics = `[Chorus]
Same hook line

[Verse 2]
Different verse

[Chorus]
Same hook line`;

  const cues = parseAlignedLyrics({
    lines: [
      { startSeconds: 10, endSeconds: 12, text: 'Same hook line' },
      { startSeconds: 40, endSeconds: 42, text: 'Different verse' },
      { startSeconds: 70, endSeconds: 72, text: 'Same hook line' }
    ]
  });

  const scenes = deriveMetadataLyricScenes(rawLyrics, cues, 90);
  assert.deepEqual(scenes.map((scene) => scene.name), ['Chorus', 'Verse 2', 'Chorus']);
  assert.deepEqual(scenes.map((scene) => scene.start), [10, 40, 70]);
});

test('extractLyricSections reads metadata lyrics without duplicate labels', () => {
  const sections = extractLyricSections('[Intro]\nHello\n[Chorus]\nAgain\n[Chorus]\nAgain');
  assert.deepEqual(sections, ['Intro', 'Chorus']);
});

test('normalizeLyricText fixes common imported apostrophe mojibake', () => {
  assert.equal(normalizeLyricText('Canâ€™t stop me'), "Can't stop me");
});

test('normalizeLyricText removes invisible layout markers without changing visible text', () => {
  assert.equal(normalizeLyricText('\u200B[\u2060Pre-Chorus]\uFEFF'), '[Pre-Chorus]');
});
