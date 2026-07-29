const elementIds = {
  panel: 'coverLabPanel',
  closeButton: 'coverLabCloseButton',
  cancelButton: 'coverLabCancelButton',
  title: 'coverLabSongTitle',
  artist: 'coverLabArtist',
  lyrics: 'coverLabLyrics',
  sunoPrompt: 'coverLabSunoPrompt',
  mood: 'coverLabMood',
  visualDirection: 'coverLabVisualDirection',
  identityPreset: 'coverLabIdentityPreset',
  preserveIdentity: 'coverLabPreserveIdentity',
  identityDna: 'coverLabIdentityDna',
  identityNotes: 'coverLabIdentityNotes',
  identitySummary: 'coverLabIdentitySummary',
  useIdentityLora: 'coverLabUseIdentityLora',
  identityLoraStrength: 'coverLabIdentityLoraStrength',
  insertIdentity: 'coverLabInsertIdentityButton',
  ollamaEndpoint: 'coverLabOllamaEndpoint',
  ollamaModel: 'coverLabOllamaModel',
  refreshModels: 'coverLabRefreshModelsButton',
  modelStatus: 'coverLabModelStatus',
  positive: 'coverLabPositivePrompt',
  negative: 'coverLabNegativePrompt',
  createPrompt: 'coverLabCreatePromptButton',
  ratio: 'coverLabRatio',
  width: 'coverLabWidth',
  height: 'coverLabHeight',
  seed: 'coverLabSeed',
  randomizeSeed: 'coverLabRandomizeSeed',
  batchSize: 'coverLabBatchSize',
  generateUpscaled: 'coverLabGenerateUpscaled',
  comfyEndpoint: 'coverLabComfyEndpoint',
  loras: 'coverLabLoras',
  generate: 'coverLabGenerateButton',
  status: 'coverLabStatus',
  gallery: 'coverLabGallery'
};

export function createCoverLabController(options = {}) {
  const elements = Object.fromEntries(
    Object.entries(elementIds).map(([key, id]) => [key, document.getElementById(id)])
  );
  let config = null;
  let settings = null;
  let results = [];
  let currentJobId = '';
  let persistTimer = 0;
  let busy = false;

  elements.closeButton.addEventListener('click', close);
  elements.cancelButton.addEventListener('click', close);
  elements.panel.addEventListener('click', (event) => {
    if (event.target === elements.panel && !busy) close();
  });
  elements.refreshModels.addEventListener('click', loadModels);
  elements.createPrompt.addEventListener('click', createPrompt);
  elements.insertIdentity.addEventListener('click', insertIdentity);
  elements.generate.addEventListener('click', generate);
  elements.ratio.addEventListener('change', applyRatio);
  elements.identityPreset.addEventListener('change', handleIdentityChange);
  elements.identityDna.addEventListener('input', () => {
    readSettings();
    updateIdentityUi();
    queuePersist();
  });
  elements.useIdentityLora.addEventListener('change', () => {
    readSettings();
    updateIdentityUi();
    renderLoras();
    queuePersist();
  });
  elements.identityLoraStrength.addEventListener('change', () => {
    readSettings();
    renderLoras();
    queuePersist();
  });
  for (const input of editableInputs()) {
    input.addEventListener('input', queuePersist);
    input.addEventListener('change', queuePersist);
  }

  return { open, close, isOpen: () => !elements.panel.hidden };

  async function open() {
    elements.panel.hidden = false;
    setStatus('Loading Cover Lab...');
    try {
      config = await fetchJson('/api/cover-lab/config');
      const project = options.getProject?.() || {};
      const context = options.getSongContext?.() || {};
      settings = mergeSettings(config.defaults, project.metadata?.coverLab, context);
      populateRatios();
      writeSettings();
      renderLoras();
      renderGallery();
      setStatus('Ready');
      await loadModels();
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  function close() {
    if (busy) return;
    persistNow();
    elements.panel.hidden = true;
  }

  function populateRatios() {
    elements.ratio.replaceChildren();
    for (const ratio of config?.ratios || []) {
      const option = document.createElement('option');
      option.value = ratio.id;
      option.textContent = `${ratio.name} - ${ratio.width} x ${ratio.height}`;
      elements.ratio.append(option);
    }
  }

  async function loadModels() {
    if (!settings) return;
    readSettings();
    elements.refreshModels.disabled = true;
    elements.ollamaModel.disabled = true;
    setModelStatus('Reading installed Ollama models...');
    try {
      const endpoint = encodeURIComponent(settings.ollama.endpoint);
      const payload = await fetchJson(`/api/cover-lab/ollama/models?endpoint=${endpoint}`);
      const previous = settings.ollama.model;
      const models = Array.isArray(payload.models) ? payload.models : [];
      elements.ollamaModel.replaceChildren();
      if (!models.length) {
        addModelOption('', 'No installed models found');
      } else {
        for (const model of models) addModelOption(model, model);
        if (previous && !models.includes(previous)) {
          addModelOption(previous, `${previous} (saved, unavailable)`);
        }
        elements.ollamaModel.value = models.includes(previous) ? previous : models[0];
        settings.ollama.model = elements.ollamaModel.value;
      }
      elements.ollamaModel.disabled = !models.length;
      setModelStatus(models.length ? `${models.length} installed model${models.length === 1 ? '' : 's'}` : 'No Ollama models are installed.');
      persistNow();
    } catch (error) {
      const previous = settings.ollama.model;
      elements.ollamaModel.replaceChildren();
      if (previous) addModelOption(previous, `${previous} (saved)`);
      else addModelOption('', 'Ollama unavailable');
      elements.ollamaModel.value = previous;
      setModelStatus(error.message || String(error), true);
    } finally {
      elements.refreshModels.disabled = false;
      if (elements.ollamaModel.options.length && elements.ollamaModel.value) {
        elements.ollamaModel.disabled = false;
      }
    }
  }

  async function createPrompt() {
    readSettings();
    persistNow();
    if (!settings.ollama.model) {
      setModelStatus('Choose an installed Ollama model.', true);
      return;
    }
    setBusy(true, 'Creating prompt with Ollama...');
    try {
      const payload = await fetchJson('/api/cover-lab/ollama/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      elements.positive.value = payload.prompt || '';
      if (payload.negative) elements.negative.value = payload.negative;
      readSettings();
      persistNow();
      setStatus('Prompt created. Review or edit it before generation.');
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function insertIdentity() {
    readSettings();
    persistNow();
    setBusy(true, 'Updating the prompt with Character Identity...');
    try {
      const payload = await fetchJson('/api/cover-lab/identity/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      elements.positive.value = payload.prompt || '';
      if (payload.negative) elements.negative.value = payload.negative;
      readSettings();
      persistNow();
      setStatus('Character Identity inserted into the prompt.');
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    readSettings();
    persistNow();
    if (!settings.prompts.positive) {
      setStatus('Positive Prompt is required.', true);
      elements.positive.focus();
      return;
    }
    setBusy(true, 'ComfyUI is generating the cover. Waiting for confirmed outputs...');
    try {
      const payload = await fetchJson('/api/cover-lab/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      currentJobId = payload.jobId;
      results = payload.results || [];
      if (payload.prompt) elements.positive.value = payload.prompt;
      if (payload.negative) elements.negative.value = payload.negative;
      settings.generation.seed = Number(payload.seed ?? settings.generation.seed);
      elements.seed.value = String(settings.generation.seed);
      persistNow();
      renderGallery();
      setStatus(`${results.length} Cover Lab result${results.length === 1 ? '' : 's'} ready.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  function renderGallery() {
    elements.gallery.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Generate a cover to review native and upscaled results.';
      elements.gallery.append(empty);
      return;
    }
    results.forEach((result, index) => {
      const card = document.createElement('article');
      card.className = 'cover-lab-result';
      const image = document.createElement('img');
      image.src = result.previewUrl;
      image.alt = `${result.variant} Cover Lab result`;
      const meta = document.createElement('div');
      meta.className = 'cover-lab-result-meta';
      const variant = document.createElement('strong');
      variant.textContent = result.variant;
      const dimensions = document.createElement('span');
      dimensions.textContent = `${result.width} x ${result.height} | Seed ${result.seed}`;
      meta.append(variant, dimensions);
      const actions = document.createElement('div');
      actions.className = 'cover-lab-result-actions';
      const useButton = document.createElement('button');
      useButton.type = 'button';
      useButton.textContent = 'Use as Cover';
      useButton.addEventListener('click', () => useAsCover(index, useButton));
      const download = document.createElement('a');
      download.href = result.downloadUrl;
      download.textContent = 'Download';
      download.download = result.filename || 'cover.webp';
      actions.append(useButton, download);
      card.append(image, meta, actions);
      elements.gallery.append(card);
    });
  }

  async function useAsCover(index, button) {
    readSettings();
    persistNow();
    button.disabled = true;
    setStatus('Importing generated image into the Kr8 project...');
    try {
      const payload = await fetchJson(`/api/cover-lab/results/${encodeURIComponent(currentJobId)}/${index}/use`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      settings.selectedAssetId = payload.asset.id;
      options.onProjectApplied?.(payload.project, payload.layer, payload.asset);
      persistNow();
      setStatus(`${results[index].variant} result is now the project Cover.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function applyRatio() {
    const ratio = (config?.ratios || []).find((item) => item.id === elements.ratio.value);
    if (!ratio) return;
    elements.width.value = String(ratio.width);
    elements.height.value = String(ratio.height);
    queuePersist();
  }

  function writeSettings() {
    elements.title.value = settings.context.title;
    elements.artist.value = settings.context.artist;
    elements.lyrics.value = settings.context.lyrics;
    elements.sunoPrompt.value = settings.context.sunoPrompt;
    elements.mood.value = settings.context.mood;
    elements.visualDirection.value = settings.context.visualDirection;
    elements.identityPreset.value = settings.identity.presetId;
    elements.preserveIdentity.checked = settings.identity.preserve;
    elements.identityNotes.value = settings.identity.notes;
    elements.useIdentityLora.checked = settings.identity.useLora;
    elements.identityLoraStrength.value = String(settings.identity.loraStrength);
    elements.ollamaEndpoint.value = settings.ollama.endpoint;
    elements.positive.value = settings.prompts.positive;
    elements.negative.value = settings.prompts.negative;
    elements.ratio.value = settings.generation.ratio;
    elements.width.value = String(settings.generation.width);
    elements.height.value = String(settings.generation.height);
    elements.seed.value = String(settings.generation.seed);
    elements.randomizeSeed.checked = settings.generation.randomizeSeed;
    elements.batchSize.value = String(settings.generation.batchSize);
    elements.generateUpscaled.checked = settings.generation.generateUpscaled;
    elements.comfyEndpoint.value = settings.comfy.endpoint;
    updateIdentityUi();
  }

  function readSettings() {
    if (!settings) return;
    settings.context = {
      title: elements.title.value.trim(),
      artist: elements.artist.value.trim(),
      lyrics: elements.lyrics.value.trim(),
      sunoPrompt: elements.sunoPrompt.value.trim(),
      mood: elements.mood.value.trim(),
      visualDirection: elements.visualDirection.value.trim()
    };
    settings.ollama = {
      endpoint: elements.ollamaEndpoint.value.trim(),
      model: elements.ollamaModel.value
    };
    settings.prompts = {
      positive: elements.positive.value.trim(),
      negative: elements.negative.value.trim()
    };
    settings.identity = {
      presetId: elements.identityPreset.value,
      preserve: elements.preserveIdentity.checked,
      useLora: elements.identityPreset.value === 'takara' && elements.useIdentityLora.checked,
      loraStrength: Number(elements.identityLoraStrength.value),
      notes: elements.identityNotes.value.trim(),
      customDna: elements.identityPreset.value === 'custom'
        ? elements.identityDna.value.trim()
        : String(settings.identity?.customDna || '')
    };
    settings.generation = {
      ratio: elements.ratio.value,
      width: Number(elements.width.value),
      height: Number(elements.height.value),
      seed: Number(elements.seed.value),
      randomizeSeed: elements.randomizeSeed.checked,
      batchSize: Number(elements.batchSize.value),
      generateUpscaled: elements.generateUpscaled.checked
    };
    settings.comfy = { endpoint: elements.comfyEndpoint.value.trim() };
    settings.loras = readLoras();
  }

  function renderLoras() {
    elements.loras.replaceChildren();
    const takaraLora = identityConfig('takara')?.loraFilename || '';
    for (const lora of settings.loras) {
      const row = document.createElement('div');
      row.className = 'cover-lab-lora';
      row.dataset.slot = lora.slot;
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      const identityManaged = Boolean(takaraLora) && lora.filename.toLocaleLowerCase() === takaraLora.toLocaleLowerCase();
      enabled.checked = identityManaged ? settings.identity.useLora : lora.enabled;
      enabled.className = 'cover-lab-lora-enabled';
      enabled.setAttribute('aria-label', `Enable ${lora.filename}`);
      enabled.disabled = identityManaged;
      const name = document.createElement('span');
      name.className = 'cover-lab-lora-name';
      name.textContent = `${lora.filename || lora.slot}${identityManaged ? ' (managed by Character Identity)' : ''}`;
      name.title = lora.filename || lora.slot;
      const strength = document.createElement('input');
      strength.type = 'number';
      strength.min = '-4';
      strength.max = '4';
      strength.step = '0.05';
      strength.value = String(identityManaged ? settings.identity.loraStrength : lora.strength);
      strength.className = 'cover-lab-lora-strength';
      strength.setAttribute('aria-label', `${lora.filename} strength`);
      strength.disabled = identityManaged;
      enabled.addEventListener('change', queuePersist);
      strength.addEventListener('input', queuePersist);
      row.append(enabled, name, strength);
      elements.loras.append(row);
    }
  }

  function readLoras() {
    return [...elements.loras.querySelectorAll('.cover-lab-lora')].map((row) => ({
      slot: row.dataset.slot,
      enabled: row.querySelector('.cover-lab-lora-enabled').checked,
      filename: settings.loras.find((item) => item.slot === row.dataset.slot)?.filename || '',
      strength: Number(row.querySelector('.cover-lab-lora-strength').value)
    }));
  }

  function editableInputs() {
    return [
      elements.title, elements.artist, elements.lyrics, elements.sunoPrompt, elements.mood,
      elements.visualDirection, elements.identityPreset, elements.preserveIdentity, elements.identityDna,
      elements.identityNotes, elements.useIdentityLora, elements.identityLoraStrength,
      elements.ollamaEndpoint, elements.ollamaModel, elements.positive,
      elements.negative, elements.width, elements.height, elements.seed, elements.randomizeSeed,
      elements.batchSize, elements.generateUpscaled, elements.comfyEndpoint
    ];
  }

  function queuePersist() {
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persistNow, 240);
  }

  function persistNow() {
    clearTimeout(persistTimer);
    if (!settings) return;
    readSettings();
    options.onSettingsChange?.(structuredClone(settings));
  }

  function setBusy(value, message = '') {
    busy = value;
    elements.createPrompt.disabled = value;
    elements.insertIdentity.disabled = value || elements.identityPreset.value === 'none';
    elements.generate.disabled = value;
    elements.closeButton.disabled = value;
    elements.cancelButton.disabled = value;
    if (!value) updateIdentityUi();
    if (message) setStatus(message);
  }

  function handleIdentityChange() {
    const previousId = settings.identity.presetId;
    readSettings();
    if (settings.identity.presetId === 'takara' && previousId !== 'takara') {
      settings.identity.useLora = true;
      elements.useIdentityLora.checked = true;
    }
    updateIdentityUi();
    renderLoras();
    queuePersist();
  }

  function updateIdentityUi() {
    const presetId = elements.identityPreset.value || 'takara';
    const preset = identityConfig(presetId);
    const isNone = presetId === 'none';
    const isCustom = presetId === 'custom';
    elements.identityDna.readOnly = !isCustom;
    elements.identityDna.value = isCustom
      ? String(settings.identity.customDna || '')
      : String(preset?.dna || '');
    elements.preserveIdentity.disabled = isNone;
    elements.useIdentityLora.disabled = presetId !== 'takara';
    elements.identityLoraStrength.disabled = presetId !== 'takara' || !elements.useIdentityLora.checked;
    elements.insertIdentity.disabled = busy || isNone || (isCustom && !elements.identityDna.value.trim());
    renderIdentitySummary(preset, presetId);
  }

  function renderIdentitySummary(preset, presetId) {
    elements.identitySummary.replaceChildren();
    if (presetId === 'none') {
      elements.identitySummary.textContent = 'No canonical character will be added to the prompt.';
      return;
    }
    const strong = document.createElement('strong');
    strong.textContent = preset?.name || 'Custom';
    elements.identitySummary.append(strong);
    for (const item of preset?.summary || []) {
      const detail = document.createElement('span');
      detail.textContent = item;
      elements.identitySummary.append(detail);
    }
  }

  function identityConfig(id) {
    return (config?.identities || []).find((identity) => identity.id === id) || null;
  }

  function setStatus(message, error = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('is-error', error);
    options.onStatus?.(message, error);
  }

  function setModelStatus(message, error = false) {
    elements.modelStatus.textContent = message;
    elements.modelStatus.classList.toggle('is-error', error);
  }

  function addModelOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    elements.ollamaModel.append(option);
  }
}

function mergeSettings(defaults, persisted, context) {
  const saved = persisted && persisted.version === 1 ? persisted : {};
  const merged = structuredClone(defaults);
  merged.context = {
    ...merged.context,
    ...(saved.context || {})
  };
  merged.context.title ||= String(context.title || '');
  merged.context.artist ||= String(context.artist || '');
  merged.context.lyrics ||= String(context.lyrics || '');
  merged.ollama = { ...merged.ollama, ...(saved.ollama || {}) };
  merged.prompts = { ...merged.prompts, ...(saved.prompts || {}) };
  merged.identity = { ...merged.identity, ...(saved.identity || {}) };
  merged.generation = { ...merged.generation, ...(saved.generation || {}) };
  merged.comfy = { ...merged.comfy, ...(saved.comfy || {}) };
  const savedLoras = new Map((saved.loras || []).map((lora) => [lora.slot, lora]));
  merged.loras = (defaults.loras || []).map((lora) => ({
    ...lora,
    ...(savedLoras.get(lora.slot) || {}),
    filename: lora.filename
  }));
  merged.selectedAssetId = String(saved.selectedAssetId || '');
  return merged;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}
