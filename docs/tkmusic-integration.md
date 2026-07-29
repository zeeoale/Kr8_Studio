# TKMusic Integration

[TKMusic](https://github.com/zeeoale/TKMusic) is the first official Kr8 source provider, but it is optional. Kr8 core, local-file projects, editing, preview, and export do not depend on TKMusic.

Configure `KR8_TKMUSIC_LIBRARY_ROOT` to the local TKMusic library root. The editor can then list tracks, search metadata, display available audio/cover/lyrics capabilities, and import a selected track into a new self-contained `.kr8` project.

The provider owns TKMusic-specific folders, naming, metadata, aligned lyrics, IDs, pin state, and search behavior. Imported projects use the common Kr8 asset and layer model. Original TKMusic files are never moved, deleted, or modified.

The CLI remains available for controlled imports:

```bash
npm run kr8:import -- \
  --track-dir "../TKMusic/data/library/provider/example-track" \
  --out "./examples/imported-track.kr8"
```

Add `--copy-assets` when a fully self-contained copy is required. Do not commit imported personal projects or music.
