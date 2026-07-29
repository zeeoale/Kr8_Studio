# Project Format

A Kr8 project is a directory ending in `.kr8` with a versioned `project.json`.

## Core Fields

- `schemaVersion`: integer schema version used by future migrations.
- `id`: stable project identifier.
- `name`, `createdAt`, `updatedAt`.
- `source`: optional provider provenance, not renderer behavior.
- `composition`: width, height, frame rate, duration, and output target.
- `assets`: registry of audio, image, video, lyrics, and texture files.
- `layers`: ordered provider-independent visual model.
- `scenes`: named timeline sections.
- `presets`, `migrations`, and `metadata`.

Layer records include stable IDs, type, name, visibility, lock state, parent, order, temporal bounds, transform, opacity, blend mode, properties, effects, audio bindings, and animation tracks.

## Paths

Asset paths are project-relative and serialized with `/`. Absolute paths and traversal outside the project are rejected at import or server boundaries. Media is stored as files, never Base64 inside JSON.

## Compatibility

The editor preserves existing IDs, scenes, metadata, audio bindings, and unknown fields during ordinary save/load operations. Schema validation catches malformed core fields without destructively normalizing unsupported properties.

## Controlled Lyrics

Edited lyrics are written to `assets/lyrics.kr8.json`. If the project originated from another lyrics file, the original relative path can be retained as provenance while rendering uses the controlled document.
