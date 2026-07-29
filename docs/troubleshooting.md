# Troubleshooting

## FFmpeg or FFprobe is not found

Verify `ffmpeg -version` and `ffprobe -version`, or set `KR8_FFMPEG_PATH` and `KR8_FFPROBE_PATH` to the executables.

## Port 5174 is occupied

Set `KR8_PORT` in `.env.local` or start with a different port. Do not terminate all Node.js processes.

## Cover Lab has no models

Start Ollama, verify the configured endpoint, and refresh the model list. Kr8 does not download models automatically.

## Cover generation reports a missing workflow

Export a compatible API workflow from ComfyUI and set `KR8_COVER_WORKFLOW_PATH`. The public repository deliberately does not bundle private workflows or models.

## Headless export cannot launch

Set `KR8_BROWSER_PATH` to a Chrome or Chromium executable. Linux service deployments may require a supported sandbox configuration; use `KR8_CHROME_NO_SANDBOX=1` only inside a suitably isolated host.

## An imported font falls back

Refresh the system font list and use the font's internal family name, not only the filename. Restart the browser after installing a font. Project-local font packaging is not yet implemented.

## Audio duration is wrong

Confirm FFprobe reads the expected stream and that the imported asset is the current `role: song` entry. Kr8 uses probed duration rather than filename or provider metadata.
