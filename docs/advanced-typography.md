# Advanced Typography

Kr8 text layers support an optional advanced typography extension while preserving the original flat text properties and `schemaVersion: 1`.

The implementation is renderer-independent at the project-model boundary. Preview, PNG export, Direct MP4, and headless export all call the same browser Canvas renderer.

## Design Decisions

- Existing text layers continue to render without migration.
- Advanced properties are optional nested objects under `layer.properties`.
- Unknown project and layer fields are preserved.
- Manual newlines are authoritative and empty lines are retained.
- Typography presets never need to store the current text content.
- Per-line settings remain inside one text layer.
- Distressed, glitch, scanlines, and texture masks are optional effects.
- Decorative lines, cuts, and irregular contours native to a font are rendered as native glyph geometry. Kr8 does not synthesize a distressed effect unless it is explicitly enabled.

## Data Shape

```json
{
  "properties": {
    "text": "THE SPACE\nBETWEEN\nNOTES",
    "typographyPresetId": "custom",
    "typography": {
      "version": 1,
      "fontFamily": "Problem in Wisconsin",
      "fontSize": 148,
      "fontWeight": 400,
      "fontStyle": "normal",
      "lineHeight": 0.68,
      "letterSpacing": 0,
      "wordSpacing": 0,
      "align": "left",
      "verticalAlign": "top",
      "textTransform": "uppercase",
      "color": "#f8f8f6",
      "textOpacity": 1,
      "autoWrap": false,
      "boxMode": "fixed-box",
      "scaleX": 1,
      "scaleY": 1,
      "skewX": 0,
      "skewY": 0,
      "rotation": 0,
      "stretchX": 1,
      "stretchY": 1,
      "anchorX": 0,
      "anchorY": 0,
      "offsetX": 0,
      "offsetY": 0
    },
    "lineEditing": {
      "enabled": true,
      "lines": [
        {
          "id": "text_line_stable_id",
          "textSnapshot": "THE SPACE",
          "offsetX": 0,
          "offsetY": 0,
          "fontSize": 148,
          "letterSpacing": 0,
          "scaleX": 0.92,
          "scaleY": 1,
          "rotation": 0,
          "opacity": 1
        }
      ]
    },
    "textEffects": {
      "stroke": {},
      "shadow": {},
      "glow": {},
      "distressed": {},
      "glitch": {},
      "scanlines": {}
    },
    "textureMask": {
      "enabled": false,
      "assetId": "",
      "blendMode": "source-in",
      "scale": 1,
      "offsetX": 0,
      "offsetY": 0,
      "rotation": 0,
      "invertMask": false,
      "contrast": 1,
      "threshold": 0
    }
  }
}
```

The canonical TypeScript definitions are in `src/shared/models.ts`. Runtime validation is in `src/project/schema.js`. Legacy fields such as `fontFamily`, `fontSize`, `color`, `align`, `strokeWidth`, and `shadowBlur` remain synchronized for old clients and projects.

## Glyph Metrics

Kr8 measures each rendered line with:

- `actualBoundingBoxLeft`
- `actualBoundingBoxRight`
- `actualBoundingBoxAscent`
- `actualBoundingBoxDescent`

When a browser does not expose one of these values, the renderer falls back to the measured advance width and conservative `fontSize` ratios.

The renderer:

- uses an alphabetic baseline;
- tracks advance width separately from visual glyph bounds;
- does not pass a `maxWidth` argument to `fillText` or `strokeText`;
- does not clip text to the text box;
- allows line height below `1` and negative per-line offsets;
- allocates effect bitmaps from actual visual ascent, descent, and horizontal bounds;
- keeps decorative glyph overflow visible.

`fontSize` is therefore an input to layout, not an assumption about the final visual height.

## Font Name Resolution

Windows registry display names may differ from the family stored inside a TTF or OTF file. Kr8 serves installed font files through a local endpoint and registers a `FontFace` using the name saved in the project.

Exact family matches are preferred. A conservative similarity fallback handles small registry/internal-name discrepancies such as:

- `Problem in Wisconsin`
- `Problems in Winsconsin`

Unrelated family names are never matched.

## Rendering Path

```text
project.json
  -> normalizeAdvancedTextProperties
  -> evaluateLayerAnimations
  -> createAdvancedTextLayout
  -> drawAdvancedTextLayer
  -> Canvas
     -> editor preview
     -> PNG frame
     -> Direct MP4 frame stream
     -> headless frame stream
```

FFmpeg remains downstream of the Canvas frame for ordinary text. It does not re-typeset the layer, so preview and export use the same glyph measurements and effects.

The mobile preview also calls `drawAdvancedTextLayer` for regular text layers.

## Per-Line Identity

`reconcileTextLines()` preserves line IDs and overrides in two passes:

1. match existing lines by exact text;
2. use position only for still-unmatched lines.

This retains adjustments when a new line is inserted before an existing line. Duplicate line text is handled in source order.

## Effects

All effects default to disabled.

- Stroke, shadow, and glow render directly with Canvas.
- Distressed applies a seeded destructive alpha mask to the glyph bitmap.
- Static and animated glitch use seeded horizontal slices.
- Scanlines and scratches use a saved seed.
- Texture masks reference a relative image asset copied into the project's `assets/` directory.

Stroke position is stored as `inside`, `center`, or `outside`. Canvas currently renders the centered stroke fallback for all three values.

## Presets

The built-in presets are:

- Clean Editorial
- Stacked Title
- Condensed Poster
- Distressed Horror
- Static Glitch
- Noir Jazz
- Wide Cinematic

Presets are stored in `project.metadata.typographyPresets`, separate from Looks. They include typography, per-line data, effects, and texture settings, but omit text content.

## Animation Targets

The existing layer animation tracks can target nested properties with dot paths. Supported examples include:

```text
transform.x
transform.scaleX
transform.rotation
opacity
properties.typography.letterSpacing
properties.typography.lineHeight
properties.textEffects.glitch.amount
properties.textEffects.glow.intensity
properties.lineEditing.lines.0.offsetX
properties.lineEditing.lines.0.offsetY
```

No second animation system was introduced.

## Files

Core and schema:

- `src/text/advancedTypography.js`
- `src/animation/evaluate.js`
- `src/shared/models.ts`
- `src/project/schema.js`
- `src/presets/tk-noir-pulse.js`

Renderer and editor:

- `src/editor/public/advanced-text-renderer.js`
- `src/editor/public/advanced-typography-ui.js`
- `src/editor/public/font-family-matching.js`
- `src/editor/public/app.js`
- `src/editor/public/mobile/mobile.js`
- `src/editor/public/styles.css`
- `src/editor/public/index.html`

Assets and server:

- `src/assets/textTextureImport.js`
- `src/editor/server.js`
- `src/mobile/context.js`
- `src/mobile/project.js`

Tests and acceptance fixture:

- `tests/advanced-typography.test.js`
- `tests/animation-evaluate.test.js`
- `tests/font-family-matching.test.js`
- `tests/text-texture-import.test.js`
- `examples/typography-lab.kr8/project.json`

## Acceptance Fixture

`examples/typography-lab.kr8/project.json` is a source-free 1920x1080 project that exercises:

- three manual lines;
- a decorative installed font;
- tight line height;
- independent line scale and offsets;
- no synthetic distressed or glitch effect.

It is intentionally separate from `examples/blank.kr8`.

