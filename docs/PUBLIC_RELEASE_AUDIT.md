# Kr8 Studio Public Release Audit

Audit date: 2026-07-29  
Public candidate: `C:\NodeApp\Kr8_Studio_Public`  
Development source: an external private development working tree

## Result

The public candidate is an autonomous, sanitized, documented Git repository on
branch `main`. It installs, passes lint and all automated tests, builds a
production distribution, starts from that distribution, opens the public demo,
and exports a real 1920x1080 RGBA PNG frame.

The provided GitHub repository was configured as `origin`; nothing was pushed
online. The development source was not edited, cleaned, reset, or copied
wholesale.

Kr8 Studio source code is licensed under `AGPL-3.0-or-later`, with separate
commercial licensing potentially available. Branding and media assets are
governed separately.

## Preliminary Architecture Audit

- Runtime: Node.js ESM, tested with Node.js 26.4.0 and npm 11.17.0.
- Main language: JavaScript, with TypeScript model declarations where useful.
- Package manager: npm with `package-lock.json`.
- Local editor: browser UI served by `src/editor/server.js`.
- Media tools: external FFmpeg and FFprobe; tested with version 8.1.2.
- Runtime npm dependencies: `mp4box` and `undici`.
- Project format: versioned `.kr8/project.json` with relative asset paths.
- Optional services: Ollama and ComfyUI for Cover Lab.
- Optional source integration: TKMusic through a provider boundary.
- Optional publishing: TikTok, YouTube, and Instagram providers.
- Optional Instagram media bridge: included under
  `bridge/instagram-media-bridge/`, accepts MP4 uploads only, and has sanitized
  deployment examples.
- No SQLite, Tauri, native npm addon, Python runtime, AI model, or bundled
  ComfyUI installation is required.

## Excluded From the Public Copy

The public directory was assembled selectively. The following source content
was not copied:

- `node_modules`, `dist`, build output, coverage, caches, and temporary files;
- `.env.local`, downloaded OAuth client files such as `google.json`, token
  stores, credential stores, cookies, sessions, certificates, and private keys;
- runtime logs, PID files, service state, publisher state, and bridge media;
- personal `.kr8` projects and their audio, covers, videos, frames, and exports;
- `cover_creation` output and generated Cover Lab images;
- local TKMusic libraries, Suno metadata, databases, and post-production files;
- AI models, LoRAs, checkpoints, VAEs, Ollama data, and ComfyUI output;
- private deployment site files and machine-specific remote-access material;
- archives, backups, database dumps, and unrelated technical assessments;
- the real local ComfyUI workflow whose redistribution rights were not known.

A small synthetic workflow fixture is present only under `tests/fixtures/` so
Cover Lab behavior can be tested without redistributing a private workflow.

## Secret and Privacy Audit

The development repository contained local configuration and credentials for
optional publisher integrations. Their values were never copied or printed.

The public candidate was scanned for:

- credential filenames and populated environment files;
- API keys, access tokens, bearer tokens, client secrets, private keys, and
  common provider token formats;
- private Windows user paths and development paths;
- personal account names and email-like deployment identifiers;
- private domains, VPS addresses, local network addresses, and absolute paths;
- unexpected media, generated output, archives, models, and large files.

Final result:

```text
Public release audit passed: no private paths, known credentials,
or unexpected large files found.
```

`npm run audit:public` is included so the same checks run locally and in CI.

## Configuration Changes

Created:

- `.env.example`
- `.env.server.example`

Configuration now covers safe loopback defaults and optional values for:

- host, port, project root, and server mode;
- FFmpeg, FFprobe, and Chromium paths;
- optional TKMusic library root;
- optional Ollama and ComfyUI endpoints;
- optional Cover Lab workflow path;
- optional publisher credentials and data directory;
- optional Instagram media bridge URL and authentication token.

Private bridge domains and machine paths were removed. The Instagram bridge no
longer has a private deployment URL as a code default.

The application starts without TKMusic, Ollama, ComfyUI, publisher credentials,
or a GPU. Missing Cover Lab workflow configuration is reported as unavailable
instead of crashing the server.

## Public Demo

Public demo fixtures supplied specifically for this repository are stored under
`demo/` and governed by `ASSET-LICENSE.md`:

- `16_9_Demo_Cover.png`
- `9_16_Demo_Cover.png`
- `Demo_Sample_Audio.flac`
- `demo_lyrics.srt`

`npm run demo:prepare` creates:

- `examples/blank.kr8/project.json`
- `examples/kr8-demo-landscape.kr8/project.json`
- `examples/kr8-demo-vertical.kr8/project.json`

Both full demos are self-contained. They use local relative assets, a 30-second
FLAC file, original demo lyrics, cover art for the matching aspect ratio, text
layers, a lyrics layer, waveform-compatible audio, and a visualizer.

No TKMusic track, Suno ID, personal cover, private lyric, or generated music
video is present.

## Screenshots

Twelve sanitized WebP screenshots are present in `docs/screenshots/`:

1. `editor-main.webp`
2. `project-landscape.webp`
3. `project-vertical.webp`
4. `lyrics-editor.webp`
5. `cover-lab.webp`
6. `visualizer.webp`
7. `text-editor-advanced.webp`
8. `import-audio.webp`
9. `import-srt-lrc.webp`
10. `export.webp`
11. `layer-system.webp`
12. `timeline-waveform.webp`

They use only the public demos. Temporary PNG captures were removed after WebP
conversion.

## Documentation Created or Reworked

- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `LICENSE-DECISION.md`
- `LICENSE`
- `COMMERCIAL-LICENSE.md`
- `TRADEMARKS.md`
- `ASSET-LICENSE.md`
- `NOTICE`
- `CONTRIBUTOR-LICENSE-AGREEMENT-DECISION.md`
- `docs/architecture.md`
- `docs/project-format.md`
- `docs/audio-import.md`
- `docs/lyrics-editor.md`
- `docs/cover-lab.md`
- `docs/comfyui.md`
- `docs/ollama.md`
- `docs/export.md`
- `docs/troubleshooting.md`
- `docs/privacy.md`
- `docs/PUBLIC_RELEASE_AUDIT.md`
- `docs/screenshots/README.md`

The README identifies
[`zeeoale/TKMusic`](https://github.com/zeeoale/TKMusic) as the first official,
optional source provider. Kr8 core behavior is documented as provider-agnostic
and usable with local audio, covers, and lyrics.

GitHub issue templates, a pull request template, and a conservative Node 26.4.0
CI workflow were added. CI does not require a GPU, Ollama, ComfyUI, TKMusic, or
publisher credentials.

## Build Correction Found During Audit

The first production build revealed that a broad `exports` exclusion also
removed the source module `src/exports/`. The builder was corrected to exclude
only generated `exports/` directories inside public example projects.

After the correction:

- `npm run build` completed;
- `dist` includes `LICENSE`, `NOTICE`, commercial terms, trademark terms, and
  asset terms;
- `npm ci --omit=dev` completed inside `dist`;
- the server started from `dist` on a controlled test port;
- `/api/health` returned `ok`;
- the landscape demo loaded with 3 assets and 6 layers;
- Cover Lab reported `workflowAvailable: false` without breaking startup;
- a real canvas frame was exported from the production build;
- FFprobe reported `1920x1080`, `rgba`.

Only the exact PIDs started for public tests were terminated.

## Automated Verification

Commands and results:

| Check | Result |
| --- | --- |
| `npm install` / clean runtime install | Passed |
| `npm run demo:prepare` | Passed |
| `npm run lint` | Passed |
| `npm test` | 293 passed, 0 failed |
| `npm run build` | Passed |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run audit:public` | Passed |
| Production server health | Passed |
| Public landscape demo load | Passed |
| Real canvas PNG export | Passed, 1920x1080 RGBA |
| Cover Lab without workflow | Passed, graceful unavailable state |
| Cover Lab mock workflow/services | Passed in automated tests |
| Ollama/ComfyUI offline errors | Passed in automated tests |

The test suite covers local MP3/WAV/FLAC/M4A/OGG import, audio replacement,
relative paths, cover import, SRT/LRC import and export, lyrics editing,
save/reload behavior, visualizer frequency mapping, Cover Lab mocks, renderer
operations, export planning, publisher isolation, server mode, and TKMusic
provider compatibility.

## Dependency and License Audit

Runtime packages:

| Package | Version | License | Usage |
| --- | --- | --- | --- |
| `mp4box` | 2.4.1 | BSD-3-Clause | MP4 parsing for WebCodecs paths |
| `undici` | 8.7.0 | MIT | controlled Node HTTP transport |

Both dependencies are used. npm reported no known vulnerabilities and no
deprecated package warning. No incompatible runtime license was identified.

The approved public code license is AGPL-3.0-or-later. The official GNU license
text is stored unmodified in `LICENSE`. Separate commercial licensing is
documented without inventing prices, rights, or contract terms. Branding and
demo media remain outside the automatic scope of the source-code license.

`LICENSE` was compared byte-for-byte with the official GNU download. SHA-256:
`0D96A4FF68AD6D4B6F1F30F713B18D5184912BA8DD389F86AA7710DB079ABCB0`.

Dual licensing requires sufficient permission from contributors. No binding
CLA was created; the contributor decision document records what must be resolved
before substantial outside contributions are accepted.

## Large File Audit

The public working tree, excluding `node_modules` and `dist`, contains about
254 files and 11.61 MiB.

The only files above the normal source size are the explicitly allowed
30-second demo FLAC and its two self-contained project copies, each about
3.11 MiB. No AI model, personal audio, video export, archive, cache, or private
project was found.

## Source Independence

The public source and production build were started with their own working
directories, package files, dependencies, demos, and relative assets. A complete
text scan found no reference to the development repository, private TKMusic
library, personal Windows path, or private deployment domain.

The requested literal rename of the private development working tree was
attempted, but Windows rejected it because the existing unattended Kr8 service,
running as `SYSTEM` on port 5174, holds the directory open. That service was
deliberately not terminated or reconfigured during this public-copy audit.

This is the only acceptance check not completed literally. Functional
independence is otherwise demonstrated by:

- a clean build assembled solely from the public directory;
- an install inside `dist`;
- successful public source and `dist` server startup;
- public demo load and real export;
- no absolute source references in the candidate.

For a strict rename proof, stop the installed Kr8 scheduled task from an
elevated console, rename the development directory, run the public smoke test,
restore the directory, and restart the task. This should be done in a planned
maintenance window rather than silently disrupting the active service.

## Git Preparation

- Git was initialized only in `C:\NodeApp\Kr8_Studio_Public`.
- Current branch: `main`.
- No commit was created.
- Remote `origin`: `https://github.com/zeeoale/Kr8_Studio.git`.
- No push was performed.
- `.env.local`, `google.json`, `node_modules`, `dist`, logs, output, exports,
  models, private examples, and media are ignored.
- The three approved demo FLAC paths are explicitly unignored.

## Remaining Decisions Before Publication

1. Confirm the copyright-holder name to use in future commercial agreements if
   it should differ from the repository owner handle in `NOTICE`.
2. Confirm any additional redistribution permission for the two demo
   covers, demo FLAC, demo lyrics, and Kr8 logo.
3. Decide whether publisher providers and the optional Instagram bridge should
   ship in the first public release or remain documented experimental modules.
4. Decide whether public releases should include generated demo projects or
   regenerate them in CI from `demo/`.
5. Select and legally review an inbound contributor-permission model before
   accepting substantial external contributions.
6. Run the strict source-directory rename smoke test during a maintenance
   window if literal proof is required.

## Recommended GitHub Publication Steps

1. Review the AGPL, commercial, trademark, asset, and contributor documents.
2. Record final demo asset provenance and any additional permissions.
3. Run:

   ```bash
   npm ci
   npm run demo:prepare
   npm run lint
   npm test
   npm run build
   npm run audit:public
   ```

4. Review `git status --short --untracked-files=all`.
5. Confirm `.env.local`, OAuth downloads, logs, media exports, models, and
   private projects are absent.
6. Create the initial commit.
7. Push `main` to the configured `origin`.
8. Verify GitHub Actions and inspect the rendered README and screenshot links.

## Final Conclusion

`C:\NodeApp\Kr8_Studio_Public` is technically ready for a local review and an
initial Git commit. Publication should wait only for final demo-asset
provenance, contributor-permission review, and the owner's decision on which
optional publisher modules belong in the first public release.
