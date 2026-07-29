# Ollama Integration

Ollama is an optional Cover Lab prompt assistant.

- Default endpoint: `http://127.0.0.1:11434`
- Environment override: `KR8_OLLAMA_URL`
- Models are discovered from the local Ollama API and shown in a selector.
- Generation uses `think: false`.
- Requests use `keep_alive: 0`, releasing the model after completion so ComfyUI can reclaim VRAM.

No Ollama model is included. If Ollama is offline, model refresh and prompt generation show a clear error while manual prompt editing, project editing, and export remain available.
