# Kr8 Studio Lyrics Editor MVP

Date: 2026-07-28

## Outcome

Kr8 Studio now includes a full-screen Lyrics Editor opened by the existing **Lyrics** toolbar button. It edits the same timed lyrics data used by the canvas overlay, preview, PNG export, MP4 export, and headless renderer. No new frontend framework, database, audio engine, or renderer was introduced.

The compact lyrics navigator in the main Inspector remains available as a quick seek/read view.

## Preliminary Audit

### Existing lyrics source

TKMusic imports normally register a lyrics asset whose `path` points to `suno_aligned.json`. The existing source structure is:

```json
{
  "provider": "suno-aligned",
  "lines": [
    {
      "index": 1,
      "startSeconds": 2.14,
      "endSeconds": 5.8,
      "text": "Come closer"
    }
  ]
}
```

Provider-specific top-level fields and line fields can also be present. Kr8 previously read this file directly from the TKMusic library.

### Runtime model and rendering

`src/lyrics/timeline.js` and its browser counterpart normalized aligned lines into runtime cues containing `index`, `start`, `end`, `text`, `rawText`, and `kind`.

The same runtime cue list already fed:

- active lyric lookup;
- canvas lyrics overlay;
- lyrics transition/fade logic;
- main timeline and section strip;
- browser PNG/MP4 rendering;
- headless export.

The Lyrics Editor therefore updates this shared list for live preview instead of creating an editor-only renderer.

### Sections and directions

Bracketed lines such as `[Verse 1]` are retained as section cues and are not rendered as sung lyrics. Parenthetical production directions are retained as direction cues and are not rendered. The existing scene derivation still uses metadata lyrics first and timed section cues as its fallback.

### Player and waveform

The existing `Kr8AudioPreview`, decoded waveform peaks, seek handling, and playback state were already reliable. The Lyrics Editor delegates Play/Pause and seek to that engine. It does not create a second audio element or analyzer.

### Stable IDs and undo

Legacy aligned lyrics did not consistently contain stable IDs. The new normalizer derives deterministic legacy IDs from cue position, time, and raw text. IDs are serialized on the first Apply and remain stable afterwards.

There was no central project undo manager. The Lyrics Editor uses a bounded, editor-local history. Batch actions are one undo step and the history is never serialized.

## Data and Migration Strategy

The project schema version remains unchanged.

Opening a legacy project is read-only and does not change its files or visual result. On the first **Apply Changes**:

1. the current source is normalized;
2. validation runs;
3. Kr8 writes `assets/lyrics.kr8.json` inside the `.kr8` project directory;
4. the existing lyrics asset ID is preserved when present;
5. the lyrics asset `path` changes to `assets/lyrics.kr8.json`;
6. the prior path is preserved in `originalPath` and `kr8Source.originalPath`;
7. unknown project, asset, document, and cue fields are preserved;
8. the original TKMusic/Suno file is not moved, modified, or deleted.

**Apply Changes** updates the in-memory project and controlled lyrics asset. **Save Project** applies first when necessary and then writes `project.json`. This preserves the existing distinction between Apply and global Save.

If `end` is absent, rendering and SRT export derive it from the next cue start or use a documented 2.5 second fallback for the final cue.

## Supported Operations

- edit cue text, start, and optional end;
- decimal seconds, `mm:ss.mmm`, and `hh:mm:ss.mmm`;
- Set Start to Playhead and Set End to Playhead;
- add, duplicate, delete, Move Up, and Move Down;
- split at the text cursor, with a safe nearest-word fallback;
- merge with the following cue;
- Ctrl/Cmd selection, Shift range selection, Select All, and Clear;
- shift selected cues, selected plus following cues, or all cues;
- shift earlier/later using a custom precision value;
- search/filter and per-cue seek;
- active cue highlight during playback;
- editor-local undo and redo;
- validation summary and row marking;
- Import SRT and Import LRC with replacement confirmation;
- Export SRT, LRC, and timestamped plain text;
- live preview through the existing lyrics renderer;
- unsaved-change confirmation on Close.

## Validation

Apply is blocked for:

- invalid or negative starts;
- invalid ends or end before start;
- cues beyond audio duration;
- out-of-order cues.

Duplicate timestamps are warnings. The UI reports:

- total cues;
- total audio duration;
- empty cues;
- duplicate timestamps;
- out-of-order cues;
- negative starts;
- invalid ends;
- cues beyond duration;
- detected sections.

Shift operations refuse to create negative timestamps rather than silently clamping them.

## Shortcuts

- `Space`: Play/Pause when a text control is not focused.
- `Enter`: Set selected cue start to the playhead.
- `Shift+Enter`: Set selected cue end to the playhead.
- `Arrow Up` / `Arrow Down`: select previous/next cue.
- `Shift+Arrow Up` / `Shift+Arrow Down`: extend selection.
- `Ctrl+S`: Apply and save the project.
- `Ctrl+Z`: Undo.
- `Ctrl+Y` or `Ctrl+Shift+Z`: Redo.
- `Escape`: close with confirmation when unapplied changes exist.

## Files Created

- `src/lyrics-editor/timecode.js`
- `src/lyrics-editor/schema.js`
- `src/lyrics-editor/operations.js`
- `src/lyrics-editor/validation.js`
- `src/lyrics-editor/importExport.js`
- `src/lyrics-editor/editorState.js`
- `src/lyrics-editor/storage.js`
- `src/editor/public/lyrics-editor/lyrics-editor.js`
- `src/editor/public/lyrics-editor/lyrics-editor.css`
- `tests/lyrics-editor.test.js`
- `tests/lyrics-editor-storage.test.js`
- `tests/lyrics-editor-server.test.js`
- `tests/lyrics-editor-ui.test.js`
- `docs/lyrics-editor.md`

## Files Modified

- `src/lyrics/timeline.js`
- `src/editor/public/lyrics-timeline.js`
- `src/editor/public/app.js`
- `src/editor/public/index.html`
- `src/editor/server.js`
- `package.json`

## Verification

Automated:

- `npm.cmd run check`: passed.
- `npm.cmd test`: 282 passed, 0 failed.
- Focused Lyrics Editor coverage includes parsing, formatting, legacy normalization, stable IDs, add/delete/reorder, split, merge, selected/following shift, selection, undo/redo, validation, SRT/LRC import and export, unknown fields, controlled storage, API Apply, Save/Reload, UI wiring, and shared overlay parsing.

Manual QA used a copy:

`examples/lyrics-editor-qa.kr8/project.json`

The source project was not modified. The test completed:

1. opened the full-screen editor with 127 real cues;
2. edited a sung line;
3. set its start from the playhead;
4. shifted selected and following cues by `+0.250s`;
5. split and merged the cue;
6. duplicated, deleted, undid, and redid the deletion;
7. triggered SRT export;
8. applied changes;
9. saved the project;
10. reloaded the project;
11. confirmed stable ID, edited text, and `24.500s` timing;
12. confirmed the existing canvas overlay displayed the edited line;
13. confirmed no browser console warnings or errors.

The dedicated QA server ran on port 5199 and only its specific PID was stopped.
The temporary QA project and its dedicated logs were removed after verification.

## Suno Invisible Marker Compatibility

Some `suno_aligned.json` files split a section marker across two timed cues and
prefix the opening bracket with an invisible Unicode zero-width space. For
example, the visible `[` may actually be stored as `U+200B` followed by `[`.
That prevented the split-tag merger from recognizing `[Pre-Chorus]` and left
both fragments visible in the editor.

Kr8 now removes only non-semantic layout markers (`U+200B`, `U+200E`,
`U+200F`, `U+2060`, and `U+FEFF`) before section/direction classification.
Language-significant joiners are not removed. The original TKMusic subtitle
files remain untouched; normalization happens at the Kr8 ingestion boundary.

Regression verification used the real `Soult Silk & Iron (TK Edit)` aligned
subtitle document. Its seven `U+200B` occurrences now normalize into six
detected sections, 21 non-rendered direction cues, and 53 renderable lyric
cues. The focused Lyrics Editor/timeline suite passes 28 of 28 tests.

## Remaining Limits

- No word-by-word karaoke, syllable editing, AI synchronization, transcription, beat snapping, or translation.
- No automatic transient detection.
- No multi-track lyrics.
- Imported SRT/LRC replaces the working timeline after explicit confirmation; it does not merge timelines.
- Search is filter-and-seek only; bulk replace is not included.
- End time remains optional by design.
- Project-local lyrics are written at Apply time, while `project.json` is written only by Save. Closing the whole application after Apply but before Save leaves an unreferenced controlled file, which is harmless and will be reused/overwritten on the next Apply.
- A dedicated full video render was not run during the copied-project QA. Export code paths and renderer behavior were unchanged, the shared overlay parser integration is tested, and the complete existing PNG/MP4/headless regression suite passed.

## Recommended Next Increment

Add optional waveform zoom plus draggable cue edge handles. The timing core already supports precise start/end updates, so this can remain a UI increment without changing the project format or renderer.
