import assert from 'node:assert/strict';
import test from 'node:test';

import { LyricsEditorSession } from '../src/lyrics-editor/editorState.js';
import {
  exportLrc,
  exportSrt,
  exportTimestampedText,
  importLrc,
  importSrt
} from '../src/lyrics-editor/importExport.js';
import {
  addCue,
  deleteCues,
  mergeCueWithNext,
  moveCues,
  shiftCues,
  splitCue,
  updateCue
} from '../src/lyrics-editor/operations.js';
import {
  normalizeLyricsDocument,
  serializeLyricsDocument
} from '../src/lyrics-editor/schema.js';
import {
  formatLrcTimecode,
  formatSrtTimecode,
  formatTimecode,
  parseTimecode
} from '../src/lyrics-editor/timecode.js';
import { validateLyricsCues } from '../src/lyrics-editor/validation.js';
import { findCurrentLyric, parseAlignedLyrics } from '../src/lyrics/timeline.js';

const legacyDocument = {
  provider: 'suno-aligned',
  customTopLevel: { keep: true },
  lines: [
    { index: 1, startSeconds: 2.14, endSeconds: 5.8, text: 'Come closer', providerScore: 0.91 },
    { index: 2, startSeconds: 8, endSeconds: 10, text: '[Verse 1]' },
    { index: 3, startSeconds: 10, endSeconds: 13, text: 'Not too close' }
  ]
};

test('timecode parser accepts decimal, mm:ss and hh:mm:ss forms', () => {
  assert.equal(parseTimecode('2.140'), 2.14);
  assert.equal(parseTimecode('01:02.500'), 62.5);
  assert.equal(parseTimecode('01:02:03.250'), 3723.25);
  assert.equal(parseTimecode('00:02,140'), 2.14);
  assert.throws(() => parseTimecode('00:90.000'), /Invalid timecode/);
});

test('timecode formatting preserves SRT and LRC precision', () => {
  assert.equal(formatTimecode(62.5), '01:02.500');
  assert.equal(formatSrtTimecode(2.14), '00:00:02,140');
  assert.equal(formatLrcTimecode(2.14), '00:02.14');
});

test('legacy lyrics normalize with stable IDs and unknown fields', () => {
  const first = normalizeLyricsDocument(legacyDocument);
  const second = normalizeLyricsDocument(legacyDocument);
  assert.equal(first.cues[0].id, second.cues[0].id);
  assert.match(first.cues[0].id, /^lyric_/);
  assert.equal(first.cues[0].source.providerScore, 0.91);
  assert.equal(first.document.customTopLevel.keep, true);
  assert.equal(first.cues[1].kind, 'section');
});

test('zero-width Suno markers are removed before split section tags are combined', () => {
  const normalized = normalizeLyricsDocument({
    lines: [
      { index: 10, startSeconds: 38.71675, endSeconds: 40.0135, text: '\u200B[' },
      { index: 11, startSeconds: 40.10667, endSeconds: 46.84981, text: 'Pre-Chorus]' },
      { index: 12, startSeconds: 46.9, endSeconds: 49, text: 'Actual lyric' }
    ]
  });

  assert.equal(normalized.cues.length, 2);
  assert.equal(normalized.cues[0].rawText, '[Pre-Chorus]');
  assert.equal(normalized.cues[0].text, '[Pre-Chorus]');
  assert.equal(normalized.cues[0].kind, 'section');
  assert.equal(normalized.cues[0].section, 'Pre-Chorus');
  assert.equal(normalized.cues[1].kind, 'line');
});

test('serialization persists cue IDs and provider fields', () => {
  const normalized = normalizeLyricsDocument(legacyDocument);
  const serialized = serializeLyricsDocument(normalized.document, normalized.cues);
  assert.equal(serialized.lines[0].id, normalized.cues[0].id);
  assert.equal(serialized.lines[0].providerScore, 0.91);
  assert.equal(serialized.customTopLevel.keep, true);
});

test('edited lyrics flow through the existing overlay timeline parser', () => {
  const normalized = normalizeLyricsDocument(legacyDocument);
  const edited = updateCue(normalized.cues, normalized.cues[0].id, { text: 'Overlay updated' });
  const serialized = serializeLyricsDocument(normalized.document, edited);
  const rendered = parseAlignedLyrics(serialized);
  assert.equal(findCurrentLyric(rendered, 3)?.text, 'Overlay updated');
  assert.equal(rendered[0].id, normalized.cues[0].id);
});

test('add, update and delete preserve unrelated cue data', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const added = addCue(cues, { afterIndex: 0, id: 'lyric_added', start: 6, text: 'New line' });
  assert.equal(added[1].id, 'lyric_added');
  const updated = updateCue(added, 'lyric_added', { text: 'Edited line', start: 6.25 });
  assert.equal(updated[1].rawText, 'Edited line');
  assert.equal(updated[0].source.providerScore, 0.91);
  assert.equal(deleteCues(updated, ['lyric_added']).length, cues.length);
});

test('moveCues reorders selected cues without changing IDs', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const moved = moveCues(cues, [cues[2].id], -1);
  assert.deepEqual(moved.map((cue) => cue.id), [cues[0].id, cues[2].id, cues[1].id]);
});

test('split preserves the original ID and creates one new stable cue ID', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const split = splitCue(cues, cues[0].id, { position: 4, time: 3.5, id: 'lyric_split' });
  assert.equal(split[0].id, cues[0].id);
  assert.equal(split[1].id, 'lyric_split');
  assert.equal(split[0].text, 'Come');
  assert.equal(split[1].text, 'closer');
  assert.equal(split[0].end, 3.5);
  assert.equal(split[1].start, 3.5);
});

test('merge with next keeps first ID, last end and punctuation', () => {
  const { cues } = normalizeLyricsDocument({
    lines: [
      { start: 1, end: 2, text: 'Hello,' },
      { start: 2, end: 3, text: 'world!' }
    ]
  });
  const merged = mergeCueWithNext(cues, cues[0].id);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, cues[0].id);
  assert.equal(merged[0].text, 'Hello, world!');
  assert.equal(merged[0].end, 3);
});

test('shift selected and following operate as one deterministic transformation', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const selected = shiftCues(cues, { mode: 'selected', ids: [cues[1].id], amount: 0.25 });
  assert.equal(selected[0].start, 2.14);
  assert.equal(selected[1].start, 8.25);
  const following = shiftCues(cues, { mode: 'following', ids: [cues[1].id], amount: -0.25 });
  assert.equal(following[0].start, 2.14);
  assert.equal(following[1].start, 7.75);
  assert.equal(following[2].start, 9.75);
  assert.throws(() => shiftCues(cues, { mode: 'all', amount: -10 }), /negative timestamp/);
});

test('multi-selection supports toggle, range, select all and clear', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const session = new LyricsEditorSession(cues);
  session.select(cues[0].id);
  session.select(cues[2].id, { range: true });
  assert.equal(session.selectedIds.size, 3);
  session.select(cues[1].id, { toggle: true });
  assert.equal(session.selectedIds.has(cues[1].id), false);
  session.selectAll();
  assert.equal(session.selectedIds.size, 3);
  session.clearSelection();
  assert.equal(session.selectedIds.size, 0);
});

test('undo and redo treat batch operations as a single step', () => {
  const { cues } = normalizeLyricsDocument(legacyDocument);
  const session = new LyricsEditorSession(cues);
  session.commit(shiftCues(cues, { mode: 'all', amount: 0.25 }));
  assert.equal(session.cues[0].start, 2.39);
  assert.equal(session.undo(), true);
  assert.equal(session.cues[0].start, 2.14);
  assert.equal(session.redo(), true);
  assert.equal(session.cues[0].start, 2.39);
});

test('validation reports blocking timestamp errors and useful warnings', () => {
  const report = validateLyricsCues([
    { id: 'a', start: 4, end: 3, text: '' },
    { id: 'b', start: 4, end: 12, text: 'Late' },
    { id: 'c', start: 2, text: '[Chorus]', kind: 'section' }
  ], { duration: 10 });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === 'end-before-start'));
  assert.ok(report.errors.some((error) => error.code === 'out-of-order'));
  assert.ok(report.errors.some((error) => error.code === 'beyond-duration'));
  assert.ok(report.warnings.some((warning) => warning.code === 'duplicate-start'));
  assert.equal(report.summary.emptyText, 1);
  assert.equal(report.summary.sections, 1);
});

test('SRT export derives a missing end from the next cue', () => {
  const cues = [
    { id: 'a', start: 2.14, text: 'Come closer' },
    { id: 'b', start: 5.8, end: 8, text: 'Stay here' }
  ];
  const srt = exportSrt(cues);
  assert.match(srt, /00:00:02,140 --> 00:00:05,800/);
  assert.match(srt, /Come closer/);
});

test('LRC and timestamped text export preserve useful precision', () => {
  const cues = [{ id: 'a', start: 2.14, end: 5.8, text: 'Come closer' }];
  assert.equal(exportLrc(cues), '[00:02.14]Come closer\n');
  assert.equal(exportTimestampedText(cues), '00:02.140 --> 00:05.800 | Come closer\n');
});

test('SRT import validates timings and preserves text', () => {
  const cues = importSrt(`1
00:00:02,140 --> 00:00:05,800
Come closer`);
  assert.equal(cues[0].start, 2.14);
  assert.equal(cues[0].end, 5.8);
  assert.equal(cues[0].text, 'Come closer');
});

test('LRC import supports repeated timestamps and sorts cues', () => {
  const cues = importLrc('[00:08.00]Later\n[00:02.14][00:04.00]Come closer\n');
  assert.deepEqual(cues.map((cue) => cue.start), [2.14, 4, 8]);
  assert.equal(cues[0].text, 'Come closer');
});
