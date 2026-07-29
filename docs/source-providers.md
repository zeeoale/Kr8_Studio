# Source Providers

Kr8 Studio is provider-agnostic at its core. A `.kr8` project should not require TKMusic, Suno, YouTube, ACE-Step, or any other source system to load, preview, render, or export.

## Core Rule

These systems must remain provider-agnostic:

- project engine
- layer engine
- lyrics engine
- audio analyzer
- visualizer
- renderer
- exporter

Provider-specific discovery belongs only in `src/source-providers/`.

## Interface

A `SourceProvider` declares:

- `id`
- `name`
- `capabilities`
- `status`
- `resolve(options)`

Capabilities:

- `audio`
- `cover`
- `lyrics`
- `timedLyrics`
- `sections`
- `metadata`
- `stems`

`resolve()` returns normalized source data:

- title
- artist
- duration
- provider id
- source id
- normalized asset paths
- metadata
- warnings

The generic importer then creates the `.kr8` project.

## Providers

### TKMusicProvider

Implemented. Uses the existing TKMusic import behavior and keeps all TKMusic/Suno knowledge inside the provider.

It also owns the local library catalog used by the desktop `TKMusic Library` browser. Public catalog records contain only normalized card data and availability flags. Source directories and asset paths remain internal to the provider; cover media is exposed through a controlled server endpoint.

### LocalFilesProvider

Implemented foundation. Supports:

- local audio
- optional cover
- optional lyrics

### ACE-StepProvider

Placeholder. Planned for authorized/local generated assets and stems.

### YouTubeProvider

Placeholder. Planned only for authorized user-provided flows. Kr8 must not assume arbitrary download rights.

## Future New Project Flow

- New Project -> From TKMusic
- New Project -> From Local Files
- New Project -> From ACE-Step
- New Project -> From YouTube

No large welcome screen is required yet. The current editor can keep opening existing `.kr8` projects while the provider boundary matures.
