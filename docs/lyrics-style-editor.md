# Lyrics Style Editor

Kr8 Studio exposes a compact Lyrics appearance editor in the layer Inspector.
It intentionally remains smaller than the advanced typography workspace used by
Song Title and Artist.

## Controls

- font family, size, color, alignment, line height and maximum lines;
- backdrop color, opacity, padding and corner radius;
- outline color and width;
- glow color, blur and intensity;
- shadow color, blur and X/Y offsets;
- lyric transition and fade timing.

All controls update the canvas preview immediately and use the same layer
properties consumed by the deterministic export renderer. The mobile preview
receives the same appearance fields.

## Preset scopes

The built-in presets live in `src/lyrics/styles.js` and are mirrored by
`src/editor/public/lyrics-styles.js`. They are protected in the UI.

Custom presets are stored globally in:

`presets/lyrics/library.json`

When a custom preset is used, a sanitized copy is also embedded in
`project.metadata.lyricsStylePresets`. This keeps saved `.kr8` projects portable
when moved to another Kr8 Studio installation.

The Inspector actions are:

- **Save New**: creates a new global custom preset;
- **Update**: replaces the selected custom preset;
- **Delete**: removes a custom preset and restores Noir Card on the layer;
- **Reset**: reapplies the stored values of the selected preset.

## Backward compatibility

Older projects used `shadowColor` and `shadowBlur` without offsets to create a
glow. When explicit `glowColor`, `glowBlur` and `glowIntensity` fields are
missing, the renderer preserves that legacy interpretation. Editing either glow
or shadow writes the new explicit representation.
