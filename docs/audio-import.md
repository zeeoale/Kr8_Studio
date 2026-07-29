# Audio Import

Kr8 imports MP3, WAV, FLAC, M4A, AAC, and OGG through the Local Files provider.

1. Select a source file.
2. FFprobe validates the real stream, duration, codec, sample rate, and channels.
3. The original is copied into `assets/audio/` with collision-safe naming.
4. A WAV playback proxy is generated only when the codec is not reliably supported by browsers.
5. The project asset registry, composition duration, waveform cache key, and title/artist layers are updated.

The source file is never moved or changed. Replacement audio remains represented as project history rather than silently deleting prior assets.

Set `KR8_FFMPEG_PATH` and `KR8_FFPROBE_PATH` when the tools are not on `PATH`.
