# Export

Kr8 supports PNG frame capture and H.264 MP4 export.

## Paths

- Browser capture: useful for short diagnostics.
- Raw RGBA: streams canvas pixels directly to FFmpeg without storing every PNG.
- Headless: runs the editor in a controlled Chromium process, independent of foreground-tab throttling.
- FFmpeg composite: lets FFmpeg decode and loop cover video while Kr8 streams transparent overlays.

## Media

FFmpeg muxes the selected song asset and trims it to the requested range. SDR output is explicitly converted and tagged as BT.709 limited range with 8-bit `yuv420p`. NVENC can be selected when available; libx264 remains the portable fallback.

## Safety

Export warns when the project contains unsaved changes. Cancel targets only the current render job and its owned child processes. Exported files live under the project and are ignored by Git.
