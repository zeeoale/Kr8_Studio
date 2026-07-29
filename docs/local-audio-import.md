# Local Audio Import

## Scope

Local audio is an alternative source path, not a second audio engine. Imported
files use the same `type: "audio"` / `role: "song"` asset contract already used
by TKMusic projects. The existing player, Web Audio analyzer, waveform, timeline,
visualizer, direct exporter, FFmpeg pipeline, and headless worker all resolve the
same active song asset.

No TKMusic files or configuration are modified.

## Audit Conclusions

The current audio flow is:

1. The project asset registry identifies the active song with
   `type: "audio"` and `role: "song"`.
2. `/api/assets/:assetId` resolves its relative path from the current `.kr8`
   directory and supports byte ranges.
3. `Kr8AudioPreview` owns the single HTML audio element and Web Audio graph.
4. The browser decodes the same asset for waveform and frequency analysis.
5. Composition duration drives the player, timeline, scenes, and layer bounds.
6. Direct MP4, FFmpeg draft, composite export, and the headless worker resolve
   the same active song path.
7. TKMusic remains a `SourceProvider`; local upload now converges on the same
   project schema.

The runtime is Node.js 26 plus Chromium and the configured FFmpeg/FFprobe
binaries. No native Node dependency or database was added.

## Files

New:

- `src/assets/audioImport.js`
- `src/project/createFromAudio.js`
- `tests/audio-import.test.js`
- `tests/audio-import-server.test.js`
- `tests/audio-import-ui.test.js`
- `docs/local-audio-import.md`

Updated:

- `src/editor/server.js`
- `src/editor/public/index.html`
- `src/editor/public/app.js`
- `src/editor/public/styles.css`
- `src/server/config.js`
- `src/source-providers/localFilesProvider.js`
- `package.json`
- `.env.example`
- `.env.server.example`
- `docs/architecture.md`

## Project Schema

The schema remains backward compatible. The active asset keeps the established
shape:

```json
{
  "id": "kr8_stable_hash_id",
  "type": "audio",
  "role": "song",
  "path": "assets/audio/song.mp3",
  "missing": false,
  "metadata": {
    "sourceProvider": "local-files",
    "originalFilename": "song.mp3",
    "sourcePath": "assets/audio/song.mp3",
    "playbackPath": "assets/audio/song.mp3",
    "proxyGenerated": false,
    "waveformCacheKey": "sha256",
    "sha256": "sha256",
    "bytes": 123456,
    "duration": 253.42,
    "format": "mp3",
    "codec": "mp3",
    "sampleRate": 48000,
    "channels": 2,
    "title": "",
    "artist": "",
    "album": "",
    "embeddedCover": false
  }
}
```

When a proxy is required, `sourcePath` points to the preserved original and
`path`/`playbackPath` point to the relative WAV proxy. Unknown project and asset
fields are preserved by the existing serializer.

Asset IDs are content-derived from SHA-256 and are stable for identical audio.
Filenames are sanitized without discarding Unicode, and collisions receive a
suffix instead of silently overwriting a file.

## Format Matrix

FFprobe validates the actual stream; the extension is only an initial allowlist.

| Input | Direct use | Proxy |
| --- | --- | --- |
| MP3 | MP3 stream | Only on invalid/unsupported stream |
| WAV | PCM WAV | Non-PCM/unsupported stream |
| FLAC | FLAC | Only on invalid/unsupported stream |
| M4A | AAC in M4A | Non-AAC/unsupported stream |
| AAC | No | WAV PCM 16-bit, 48 kHz, stereo |
| OGG | Vorbis, Opus, or FLAC | Other/unsupported stream |

The original is always preserved. Proxy generation uses `execFile` with an
argument array; user input is never concatenated into a shell command.

## Import Workflow

`Import Audio` accepts the supported formats through the file picker or by
dropping a file on the stage.

For a blank startup project:

1. Select the audio.
2. Edit title and artist.
3. Choose landscape, vertical, or square.
4. Create a new `.kr8` project below `KR8_PROJECTS_ROOT`, or `examples` when
   that setting is absent.
5. Optionally import cover and lyrics with the existing tools.

The blank project is never overwritten. A browser cannot safely choose an
arbitrary destination directory in this architecture, so the application uses
the configured projects root and reports the created path.

For an existing project, the modal shows current/new audio, durations, lyric cue
count, and scene count. Replacement requires explicit confirmation. Existing
lyrics and scenes remain unchanged; automatic timing scaling is intentionally
not implemented.

The previous song asset is retained as `role: "song-previous"` and its file is
not deleted. The new asset becomes the only active `role: "song"` entry.

Title and artist are overwritten only when the user explicitly enables metadata
updates.

## Duration And Cache

After import:

- composition duration becomes the probed audio duration;
- layers and scenes that ended exactly at the old project duration follow the
  new duration;
- custom end times remain untouched;
- cues and scenes beyond the new duration produce warnings;
- the existing audio element, analyzer, waveform, and visualizer are reloaded;
- `waveformCacheKey` uses the audio SHA-256, invalidating stale waveform data.

Waveform data remains an in-memory browser result; no second waveform file or
format was introduced.

## Validation And Safety

The server streams uploads to a temporary file, enforces
`KR8_MAX_AUDIO_UPLOAD_MB` (default 1024 MB), probes the real stream, and removes
temporary files after success or failure. Empty, corrupt, unsupported, or
zero-duration files fail with a readable error.

All project paths are relative. The original source path outside Kr8 is never
serialized. Copying or replacing audio never modifies the selected source file.

## Automated Verification

Dedicated tests cover:

- MP3, WAV, FLAC, M4A, OGG, and AAC proxy behavior;
- FFprobe validation and corrupt/unsupported input;
- metadata and explicit title/artist overwrite;
- spaces, Unicode, stable IDs, hashes, and filename collisions;
- duration propagation and preservation of custom timing;
- replacement with lyrics, scenes, and TKMusic source metadata preserved;
- serialization, reload, relative paths, and moved project directories;
- HTTP streaming import, byte-range playback, confirmation, and blank-project
  protection;
- toolbar, modal, drag-and-drop, raw upload body, and supported file types.

`npm run check` passes.

The full suite result during implementation was 297 passing tests out of 298.
The only failure is an unrelated pre-existing Cover Lab prompt assertion about
the exact wording of "Do not include readable text"; all audio, TKMusic,
waveform, export, lyrics, project, provider, and headless tests pass.

## Manual Verification

The mandatory test used a synthetic eight-second local MP3 without TKMusic:

- created a new vertical project from the blank startup project;
- imported a local cover and a three-cue SRT;
- edited and persisted the first lyric cue;
- played the audio to completion with the existing player;
- generated the waveform and exercised the existing visualizer;
- rendered a two-second Direct MP4 with H.264 video and AAC audio;
- copied the entire `.kr8` directory to another location and reopened it;
- applied the global `TK - DnB` look while preserving audio, lyrics, scene, and
  visualizer;
- rendered again through the headless worker from the moved directory;
- verified the moved MP4 with FFprobe: 1920x1080 H.264, AAC audio, exactly two
  seconds;
- confirmed that audio, image, and lyrics asset paths remained relative.

Only the test server PID created for this verification was stopped.

## Remaining Limits

- Embedded cover art is detected but not extracted automatically. Use the
  existing `Import Cover` action.
- Raw AAC is proxied conservatively; other supported containers are not
  converted unless their codec is outside the direct-play matrix.
- Old replaced audio assets are retained intentionally and can accumulate until
  a future project-level unused-asset cleanup is implemented.
- A project modification must be saved before opening a separate workspace if
  that workspace reloads server state; this is existing Kr8 persistence
  behavior, not specific to local audio.
- There is no automatic lyric or section time scaling after audio replacement.
