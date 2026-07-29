# ComfyUI Integration

ComfyUI is optional and used only by Cover Lab.

- Default endpoint: `http://127.0.0.1:8188`
- Environment override: `KR8_COMFYUI_URL`
- Workflow path: `KR8_COVER_WORKFLOW_PATH`

Kr8 expects an API-format workflow whose node mapping is compatible with the Cover Lab patcher. It inserts prompt, negative prompt, dimensions, seed, batch size, optional LoRAs, and output prefix, then polls the ComfyUI history endpoint and imports selected results as ordinary project assets.

No ComfyUI installation, checkpoint, LoRA, VAE, custom node, output, or workflow is bundled. Supply only workflows and models whose licenses permit your use. When the endpoint or workflow is unavailable, the rest of Kr8 continues to work and Cover Lab reports the missing dependency.
