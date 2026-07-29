# Reel Mode 0.1

Reel Mode is a non-destructive finishing editor for the latest final MP4 produced by the currently open Kr8 project. It does not read layers, scenes, audio bindings, or the main composition timeline, and it never overwrites the source video.

## Boundary

The integration flow is deliberately narrow:

```text
current project
  -> exports/videos/*.render.json
  -> latest existing MP4
  -> Reel Mode window
  -> FFmpeg finishing pass
  -> exports/reels/<project>_reel[_N].mp4
```

`src/exports/history.js` remains the source of truth for completed Kr8 renders. `findLatestValidRenderExport()` ignores orphan metadata and returns only an existing non-empty video.

`src/reel/core.js` owns settings normalization, trim/fade calculations, safe project-relative paths, PNG watermark import, and persistence. Settings are stored at `exports/reel/reel-mode.json`; `project.json` is not changed.

`src/reel/export.js` owns probing and the final FFmpeg pass. It builds argument arrays for `spawn()` rather than shell command strings, so Windows paths containing spaces and special characters remain individual arguments. The module uses NVENC when available and falls back to `libx264`.

`src/editor/public/reel/` is a separate page opened from the main toolbar. The browser preview uses the final MP4 through a byte-range endpoint, while the export is performed by server-side FFmpeg and continues when the Reel window is not focused.

## Supported finishing operations

- one source: the latest valid final Kr8 MP4;
- start/end trim;
- video fade-in and fade-out from 0 to 5 seconds;
- audio fade-in and fade-out from 0 to 5 seconds;
- final audio volume from 0 to 200%;
- text watermark or copied transparent PNG;
- four corner positions, margin, size, opacity, full-duration or last-seconds visibility;
- cancellable export with progress;
- collision-safe output naming.

The source resolution, aspect ratio, and frame rate are preserved. Reel Mode does not crop, reframe, split, reverse, add transitions, manage multiple clips, or publish to external platforms.

## Video contract

The final filter always ends with the existing Kr8 SDR conversion:

```text
scale=out_color_matrix=bt709:out_range=tv,
setparams=range=tv:colorspace=bt709:color_trc=bt709:color_primaries=bt709,
format=yuv420p
```

Output arguments preserve H.264, `yuv420p`, TV/limited range, BT.709 primaries/transfer/matrix, `write_colr`, and AAC audio when the source contains audio. Sources without audio produce a valid video-only Reel.

## Files and safety

- Source: read-only under `exports/videos/`.
- Settings: `exports/reel/reel-mode.json`.
- Imported watermark PNG: `exports/reel/assets/` with collision-safe names.
- Final result: `exports/reels/` with `_2`, `_3`, and later suffixes when needed.
- Reel metadata: adjacent `.reel.json`, intentionally excluded from the main render history so a Reel never becomes the next Reel source.

## Remaining limits

Preview fade rendering is intentionally lightweight and approximates the FFmpeg result. Text watermark export uses FFmpeg's available default font; selecting a project font for Reel watermark text is not part of 0.1. The source selector is intentionally absent because Reel Mode only accepts the latest final export.
