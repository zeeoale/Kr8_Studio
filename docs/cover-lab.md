# Kr8 Cover Lab MVP

## Scope

Cover Lab creates cover concepts from the current Kr8 project without adding a
second application or changing the project format. The feature is available
from `Create Cover` in the desktop toolbar.

The MVP:

- reads song context from the active project;
- uses a local Ollama server to build editable positive and negative prompts;
- discovers installed Ollama models through `GET /api/tags`;
- patches the existing ComfyUI workflow;
- queues and monitors ComfyUI jobs;
- previews native and optional upscaled results;
- imports the selected image through the existing Kr8 asset registry.

Ollama and ComfyUI remain optional local services. Kr8 starts normally when
either service is offline and reports the failure inside Cover Lab.

## Project State

Cover Lab settings are stored under `project.metadata.coverLab`.

```json
{
  "version": 1,
  "context": {
    "title": "",
    "artist": "",
    "lyrics": "",
    "sunoPrompt": "",
    "mood": "",
    "visualDirection": ""
  },
  "ollama": {
    "endpoint": "http://127.0.0.1:11434",
    "model": ""
  },
  "prompts": {
    "positive": "",
    "negative": ""
  },
  "identity": {
    "presetId": "takara",
    "preserve": true,
    "useLora": true,
    "loraStrength": 1.2,
    "notes": "",
    "customDna": ""
  },
  "generation": {
    "ratio": "square",
    "width": 1024,
    "height": 1024,
    "seed": 1,
    "randomizeSeed": true,
    "batchSize": 1,
    "generateUpscaled": true
  },
  "comfy": {
    "endpoint": "http://127.0.0.1:8188"
  },
  "loras": [],
  "selectedAssetId": ""
}
```

The schema is optional, validated when present, and independent from the
renderer. Generated image bytes and temporary ComfyUI paths are never embedded
in `project.json`.

Projects created before Character Identity remain valid. When the `identity`
object is absent, Cover Lab supplies the Takara defaults in memory and writes
them only when the user saves the project.

## Character Identity

Section `02 Character Identity` keeps the recurring subject stable while the
song changes clothing, location, lighting, pose, camera, atmosphere, and
symbolism. The available modes are:

- `Takara`: the built-in canonical TKMusic identity;
- `None`: no identity constraints and no identity LoRA;
- `Custom`: a project-specific editable DNA description.

Takara has one canonical definition in `src/cover-lab/identities.js`. It starts
every generated prompt with `Takara` and describes an East Asian woman in her
mid twenties with a heart-shaped face, high cheekbones, narrow jaw, icy gray
almond eyes, blackened burgundy smoky eye makeup, heavy lashes, a straight
nose, defined cupid's bow, burgundy lips, perfectly straight soft-black hair
with a sharp center part, porcelain skin, Japanese/Korean facial features, and
a calm observational gaze.

When `Preserve identity` is active, Create Prompt and Generate both enforce the
canonical DNA server-side. The deterministic `Insert / Update Identity` action
can repair an edited prompt without calling Ollama and does not duplicate an
existing Takara prefix.

Identity drift terms are merged into the negative prompt without duplicates.
They exclude a different woman, identity or face-shape changes, a round face,
wide jaw, brown or blue eyes, blonde, curly, wavy or short hair, a side part,
warm tan skin, smiling expression, generic fashion models, Western facial
features, and inconsistent characters.

The optional Takara LoRA is managed by identity rather than by a numbered UI
slot. Kr8 searches every input in workflow node `70` for the filename
`Takara_LoRa_800_Step.safetensors`; it therefore remains valid if the model is
moved to another slot. The default strength is `1.20`. Generation stops with a
clear error when the LoRA is requested but the filename is absent.

## Aspect Ratios

| ID | Output |
| --- | --- |
| `square` | 1024 x 1024 |
| `portrait` | 1024 x 1280 |
| `vertical` | 720 x 1280 |
| `landscape` | 1280 x 720 |
| `tk-wide` | 1152 x 1024 |

## Ollama

Kr8 reads the installed model list from the configured Ollama endpoint and
renders the model field as a select menu. `Refresh` performs a new discovery.
No model name is hardcoded.

Prompt generation uses `POST /api/chat`. The system instruction asks for one
cinematic cover concept, appropriate negative space, no readable text, no
logos, and no watermarks. Both returned prompts remain editable before image
generation. Requests disable model reasoning with `think: false`, cap the
response at 450 tokens, and send at most 6,000 lyrics characters. `keep_alive`
is set to `0`, so Ollama unloads the text model immediately after the response
and releases VRAM before ComfyUI generation starts.

## ComfyUI Workflow Mapping

The template is loaded from:

`workflow/Z-Image Turbo + Hires fix + 6 LoRA.json`

Only these documented inputs are patched:

| Node | Purpose | Patched fields |
| --- | --- | --- |
| `3` | Negative CLIP text | `text` |
| `5` | Latent image | `width`, `height`, `batch_size` |
| `8` | Positive CLIP text | `text` |
| `58` | Seed source | `seed` |
| `70` | Six-slot LoRA loader | slot `on` and `strength` only |
| `38` | Native image saver | output path and filename prefix |
| `67` | Upscaled image saver | output path and filename prefix |

KSampler node `10` keeps its existing link to node `58`. LoRA filenames come
from the workflow and cannot be replaced by user input. Disabling upscaled
output removes only saver node `67`; the rest of the workflow is left intact.
The Takara slot is still visible in the general LoRA list for transparency, but
its on/off state and strength are controlled by Character Identity.

## Output Handling

ComfyUI receives relative output paths under:

`Kr8_CoverLab/<sanitized-song-name>/`

This is intentionally relative to the ComfyUI output directory. Kr8 does not
depend on a workstation-specific absolute path such as `cover_creation`.

Results are retrieved from ComfyUI through `/view`. The selected result is then
copied into the active `.kr8/assets/` directory with collision-safe naming,
registered as a Kr8 image asset, and assigned to the existing Cover layer. If a
Cover layer does not exist, one is created. The original source library and the
ComfyUI result are not modified.

Kr8 reads the actual dimensions from the returned PNG, JPEG, or WEBP bytes.
Gallery cards and imported asset metadata therefore report the real upscaled
size instead of repeating the latent dimensions. A real vertical workflow check
reported 720 x 1280 for the native image and 1440 x 2560 for its upscaled image.

## Local API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/cover-lab/config` | ratios, defaults, identities, and workflow LoRA slots |
| `GET` | `/api/cover-lab/ollama/models` | installed Ollama models |
| `POST` | `/api/cover-lab/ollama/prompt` | generate editable prompts |
| `POST` | `/api/cover-lab/identity/prompt` | insert or update identity deterministically |
| `POST` | `/api/cover-lab/generate` | patch, queue, and monitor a workflow |
| `GET` | `/api/cover-lab/results/:jobId/:index` | proxy or download a result |
| `POST` | `/api/cover-lab/results/:jobId/:index/use` | import and use as Cover |

Endpoints are restricted to HTTP(S), reject credentials in URLs, validate
request values, and use bounded timeouts. No route executes a shell command or
constructs a filesystem command from user input.

## Limits

- Job progress is phase based because ComfyUI history does not expose a stable
  per-node percentage through the current polling API.
- Cover Lab keeps only a small in-memory list of completed jobs; selected
  images must be imported before the Kr8 server restarts.
- LoRA selection is intentionally fixed to the six models already defined by
  the workflow.
- Generated text is not trusted as project data until the user explicitly
  saves the Kr8 project.
- The MVP does not manage ComfyUI installation, custom nodes, checkpoints, or
  Ollama models.

## Verification

Automated coverage includes settings round trips, endpoint and seed validation,
real workflow patching, six-slot LoRA preservation, optional upscale behavior,
Ollama discovery and prompt errors, ComfyUI queue/history/result handling,
missing results, image retrieval, Cover asset import, and the model select UI.
Character Identity coverage includes canonical defaults, legacy projects,
required Takara DNA, drift-negative de-duplication, deterministic prompt
insertion, filename-based LoRA relocation, LoRA on/off behavior, missing-LoRA
errors, Ollama identity constraints, and project save/reload persistence.

Manual local verification on 2026-07-27:

- Ollama discovery returned 11 installed models;
- `qwen3:4b` generated a valid editable cinematic prompt;
- ComfyUI `0.27.0` completed a native 1024 x 1024 job;
- the confirmed output appeared in the Cover Lab gallery with `Use as Cover`
  and `Download`;
- Character Identity opened on Takara with preserve enabled, the filename-based
  LoRA enabled at 1.20, a read-only canonical DNA preview, and all six summary
  traits fitting the modal without overflow;
- deterministic identity insertion produced one Takara prefix and merged all
  requested drift terms into the negative prompt;
- the browser console contained no errors;
- the full Kr8 test suite passed: 258 tests, 0 failures;
- the temporary QA server was stopped by its specific PID and the primary Kr8
  service was not restarted or terminated.
