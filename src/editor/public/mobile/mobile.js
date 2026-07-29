import { mapFrequencyBinsToBars } from '../frequency-mapping.js';
import { findCurrentLyric, parseAlignedLyrics } from '../lyrics-timeline.js';
import { drawAdvancedTextLayer } from '../advanced-text-renderer.js';

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const PREVIEW_SCALE = 0.5;
const state = {
  context: null,
  cues: [],
  selectedLayerId: '',
  activeView: 'canvas',
  renderJobId: '',
  renderPoll: 0,
  userSeeking: false,
  library: { tracks: [], query: '', sort: 'newest', loading: false, importing: '' },
  images: new Map(),
  videos: new Map(),
  audioEngine: null,
  frequencyData: new Uint8Array(),
  animationFrame: 0
};

const ids = [
  'connectionState', 'libraryButton', 'reloadButton', 'applyVerticalButton', 'verticalBadge', 'stageCanvas',
  'audio', 'playButton', 'backButton', 'forwardButton', 'muteButton', 'seekSlider', 'currentTime', 'duration',
  'volumeSlider', 'sceneStrip', 'projectName', 'layerCount', 'layerList', 'inspectorTitle', 'inspectorType',
  'inspectorForm', 'renderBadge', 'renderStart', 'renderLength', 'renderFps', 'nvencToggle', 'renderProgress',
  'renderMessage', 'useCurrentButton', 'cancelRenderButton', 'startRenderButton', 'refreshPublishButton',
  'providerList', 'statusText', 'libraryDialog', 'libraryCount', 'closeLibraryButton', 'librarySearch',
  'librarySort', 'refreshLibraryButton', 'libraryList'
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const canvasContext = elements.stageCanvas.getContext('2d');

bindEvents();
loadContext();
state.animationFrame = requestAnimationFrame(renderLoop);

function bindEvents() {
  for (const tab of document.querySelectorAll('.workspace-tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
  elements.libraryButton.addEventListener('click', openLibrary);
  elements.closeLibraryButton.addEventListener('click', () => elements.libraryDialog.close());
  elements.refreshLibraryButton.addEventListener('click', () => loadLibrary(true));
  elements.librarySearch.addEventListener('input', () => { state.library.query = elements.librarySearch.value; renderLibrary(); });
  elements.librarySort.addEventListener('change', () => { state.library.sort = elements.librarySort.value; renderLibrary(); });
  elements.reloadButton.addEventListener('click', loadContext);
  elements.applyVerticalButton.addEventListener('click', applyVerticalFormat);
  elements.playButton.addEventListener('click', togglePlayback);
  elements.backButton.addEventListener('click', () => seekTo(elements.audio.currentTime - 10));
  elements.forwardButton.addEventListener('click', () => seekTo(elements.audio.currentTime + 10));
  elements.muteButton.addEventListener('click', toggleMute);
  elements.volumeSlider.addEventListener('input', updateOutputVolume);
  elements.audio.addEventListener('loadedmetadata', handleAudioMetadata);
  elements.audio.addEventListener('timeupdate', updatePlaybackUi);
  elements.audio.addEventListener('play', updateTransportState);
  elements.audio.addEventListener('pause', updateTransportState);
  elements.audio.addEventListener('ended', updateTransportState);
  elements.seekSlider.addEventListener('pointerdown', () => { state.userSeeking = true; });
  elements.seekSlider.addEventListener('input', () => {
    state.userSeeking = true;
    elements.currentTime.textContent = formatTime(elements.seekSlider.value);
  });
  elements.seekSlider.addEventListener('change', () => { seekTo(elements.seekSlider.value); state.userSeeking = false; });
  for (const button of document.querySelectorAll('[data-layer-action]')) {
    button.addEventListener('click', () => runLayerAction(button.dataset.layerAction));
  }
  elements.useCurrentButton.addEventListener('click', () => { elements.renderStart.value = formatNumber(elements.audio.currentTime || 0); });
  elements.startRenderButton.addEventListener('click', startRender);
  elements.cancelRenderButton.addEventListener('click', cancelRender);
  elements.refreshPublishButton.addEventListener('click', loadPublishStatus);
}

async function loadContext() {
  setStatus('Loading project...');
  try {
    const response = await fetch('/api/mobile/context', { cache: 'no-store' });
    const payload = await readJsonResponse(response, 'Mobile context failed');
    applyContext(payload);
    await loadLyrics(payload.media?.lyricsUrl);
    configureAudio(payload.media?.audioUrl);
    state.renderJobId = payload.render?.jobId || '';
    updateRenderStatus(payload.render || { status: 'idle' });
    elements.connectionState.textContent = 'Workstation connected';
    setStatus('Project loaded');
    loadPublishStatus();
    scheduleRenderPoll();
  } catch (error) {
    elements.connectionState.textContent = 'Connection failed';
    setStatus(error.message || String(error));
  }
}

function applyContext(context, selectedLayerId = '') {
  state.context = context;
  const exists = context.layers.some((layer) => layer.id === (selectedLayerId || state.selectedLayerId));
  state.selectedLayerId = exists ? (selectedLayerId || state.selectedLayerId) : context.layers[0]?.id || '';
  elements.projectName.textContent = context.project.name;
  elements.layerCount.textContent = String(context.layers.length);
  elements.verticalBadge.textContent = context.composition.verticalReady ? '1080x1920' : `${context.composition.width}x${context.composition.height}`;
  elements.verticalBadge.className = `status-badge${context.composition.verticalReady ? ' ready' : ''}`;
  elements.applyVerticalButton.hidden = context.composition.verticalReady;
  renderLayers();
  renderInspector();
  renderScenes();
  updateRenderStatus(context.render || { status: elements.renderBadge.textContent || 'idle' });
}

function showView(view) {
  state.activeView = view;
  for (const tab of document.querySelectorAll('.workspace-tab')) tab.classList.toggle('active', tab.dataset.view === view);
  for (const panel of document.querySelectorAll('.workspace-panel')) panel.classList.toggle('active', panel.dataset.panel === view);
  if (view === 'inspector') renderInspector();
}

async function applyVerticalFormat() {
  if (!state.context || state.context.composition.verticalReady) return;
  if (!window.confirm('Convert and save this project as 1080x1920? Layer positions and sizes will be scaled to 9:16.')) return;
  elements.applyVerticalButton.disabled = true;
  try {
    const response = await fetch('/api/mobile/project/vertical', { method: 'POST' });
    const payload = await readJsonResponse(response, 'Vertical conversion failed');
    applyContext(payload);
    setStatus('Project converted and saved as 9:16');
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    elements.applyVerticalButton.disabled = false;
  }
}

function renderLoop() {
  updateAudioFrame();
  renderCanvas();
  state.animationFrame = requestAnimationFrame(renderLoop);
}

function renderCanvas() {
  const context = state.context;
  if (!context) return;
  const width = TARGET_WIDTH;
  const height = TARGET_HEIGHT;
  const pixelWidth = Math.round(width * PREVIEW_SCALE);
  const pixelHeight = Math.round(height * PREVIEW_SCALE);
  if (elements.stageCanvas.width !== pixelWidth) elements.stageCanvas.width = pixelWidth;
  if (elements.stageCanvas.height !== pixelHeight) elements.stageCanvas.height = pixelHeight;
  canvasContext.setTransform(PREVIEW_SCALE, 0, 0, PREVIEW_SCALE, 0, 0);
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.fillStyle = context.composition.backgroundColor || '#050608';
  canvasContext.fillRect(0, 0, width, height);
  const scaleX = width / Math.max(1, context.composition.width);
  const scaleY = height / Math.max(1, context.composition.height);
  for (const layer of [...context.layers].sort((a, b) => a.order - b.order)) {
    if (!layer.visible) continue;
    drawLayer(layer, scaleX, scaleY);
  }
}

function drawLayer(layer, scaleX, scaleY) {
  const original = layer.transform || {};
  const transform = {
    ...original,
    x: Number(original.x || 0) * scaleX,
    y: Number(original.y || 0) * scaleY,
    width: Number(original.width || TARGET_WIDTH) * scaleX,
    height: Number(original.height || TARGET_HEIGHT) * scaleY
  };
  canvasContext.save();
  canvasContext.globalAlpha = clamp(layer.opacity, 0, 1);
  canvasContext.globalCompositeOperation = mapBlendMode(layer.blendMode);
  canvasContext.translate(transform.x, transform.y);
  canvasContext.rotate(Number(transform.rotation || 0) * Math.PI / 180);
  canvasContext.scale(Number(transform.scaleX ?? 1), Number(transform.scaleY ?? 1));
  if (layer.type === 'shape') drawShape(layer, transform);
  else if (layer.type === 'image') drawImage(layer, transform);
  else if (layer.type === 'video') drawVideo(layer, transform);
  else if (layer.type === 'text') {
    drawAdvancedTextLayer(canvasContext, { ...layer, transform }, {
      time: elements.audio.currentTime || 0,
      getTextureImage: () => layer.textureAssetUrl ? getImage(layer.textureAssetUrl) : null
    });
  }
  else if (layer.type === 'lyrics') drawText(layer, transform, currentLyricText(), true);
  else if (layer.type === 'visualizer') drawVisualizer(layer, transform);
  canvasContext.restore();
}

function drawShape(layer, transform) {
  canvasContext.fillStyle = layer.properties.fill || layer.properties.color || '#000000';
  canvasContext.fillRect(-transform.width * (transform.anchorX ?? .5), -transform.height * (transform.anchorY ?? .5), transform.width, transform.height);
}

function drawImage(layer, transform) {
  if (!layer.assetUrl) return drawPlaceholder(transform, 'Image');
  const image = getImage(layer.assetUrl);
  if (!image.complete || !image.naturalWidth) return;
  drawFittedMedia(image, image.naturalWidth, image.naturalHeight, transform, layer.properties.fit || 'cover');
}

function drawVideo(layer, transform) {
  if (!layer.assetUrl) return drawPlaceholder(transform, 'Video');
  const video = getVideo(layer);
  if (video.readyState < 2 || !video.videoWidth) return;
  if (!elements.audio.paused && video.paused) video.play().catch(() => {});
  if (elements.audio.paused && !video.paused) video.pause();
  drawFittedMedia(video, video.videoWidth, video.videoHeight, transform, layer.properties.fit || 'cover');
}

function drawFittedMedia(source, sourceWidth, sourceHeight, transform, fit) {
  const targetRatio = transform.width / transform.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
  if (fit === 'cover') {
    if (sourceRatio > targetRatio) { sw = sourceHeight * targetRatio; sx = (sourceWidth - sw) / 2; }
    else { sh = sourceWidth / targetRatio; sy = (sourceHeight - sh) / 2; }
  }
  canvasContext.drawImage(source, sx, sy, sw, sh, -transform.width * (transform.anchorX ?? .5), -transform.height * (transform.anchorY ?? .5), transform.width, transform.height);
}

function drawText(layer, transform, text, lyrics = false) {
  if (!text) return;
  const props = layer.properties || {};
  const left = -transform.width * (transform.anchorX ?? .5);
  const top = -transform.height * (transform.anchorY ?? .5);
  const backgroundOpacity = clamp(props.backgroundOpacity, 0, 1);
  if (backgroundOpacity > 0) {
    canvasContext.save(); canvasContext.globalAlpha *= backgroundOpacity; canvasContext.fillStyle = props.backgroundColor || '#000';
    canvasContext.fillRect(left, top, transform.width, transform.height); canvasContext.restore();
  }
  const fontSize = Number(props.fontSize || (lyrics ? 54 : 42));
  canvasContext.font = `700 ${fontSize}px ${cssFont(props.fontFamily || 'Arial')}`;
  canvasContext.textAlign = props.align || 'center';
  canvasContext.textBaseline = 'middle';
  canvasContext.fillStyle = props.color || '#fff';
  canvasContext.strokeStyle = props.strokeColor || '#000';
  canvasContext.lineWidth = Number(props.strokeWidth || 0);
  canvasContext.shadowColor = props.shadowColor || 'transparent';
  canvasContext.shadowBlur = Number(props.shadowBlur || 0);
  const x = props.align === 'left' ? left + 18 : props.align === 'right' ? left + transform.width - 18 : 0;
  const lines = wrapText(text, Math.max(40, transform.width - 36), 2);
  const lineHeight = fontSize * 1.14;
  const startY = -(lines.length - 1) * lineHeight / 2;
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    if (canvasContext.lineWidth > 0) canvasContext.strokeText(line, x, y, transform.width - 36);
    canvasContext.fillText(line, x, y, transform.width - 36);
  });
}

function drawVisualizer(layer, transform) {
  const props = layer.properties || {};
  const bars = Math.max(8, Math.min(256, Math.round(Number(props.bars || 64))));
  const bins = state.frequencyData.length ? Array.from(state.frequencyData, (value) => value / 255) : [];
  const values = mapFrequencyBinsToBars(bins, bars, { ...props, sampleRate: state.audioEngine?.context.sampleRate || 44100 });
  const style = props.visualizerType || 'bars';
  if (style === 'radial-spectrum') return drawRadialVisualizer(props, values, transform);
  const gap = Math.max(2, transform.width / bars * .18);
  const barWidth = Math.max(1, (transform.width - gap * (bars - 1)) / bars);
  const left = -transform.width * (transform.anchorX ?? .5);
  const bottom = transform.height * (1 - (transform.anchorY ?? .5));
  values.forEach((value, index) => {
    const barHeight = Math.max(3, transform.height * value);
    canvasContext.fillStyle = index % 8 === 0 ? (props.accentColor || '#d7142e') : (props.color || '#eee');
    canvasContext.fillRect(left + index * (barWidth + gap), bottom - barHeight, barWidth, barHeight);
  });
}

function drawRadialVisualizer(props, values, transform) {
  const radius = Number(props.innerRadius || Math.min(transform.width, transform.height) * .22);
  const maxHeight = Number(props.outerRadius || Math.min(transform.width, transform.height) * .46) - radius;
  values.forEach((value, index) => {
    const angle = index / values.length * Math.PI * 2 - Math.PI / 2;
    canvasContext.save(); canvasContext.rotate(angle); canvasContext.translate(radius, 0);
    canvasContext.fillStyle = index % 8 === 0 ? (props.accentColor || '#d7142e') : (props.color || '#eee');
    canvasContext.fillRect(0, -2, Math.max(2, value * maxHeight), Number(props.barThickness || 4)); canvasContext.restore();
  });
}

function drawPlaceholder(transform, label) {
  canvasContext.strokeStyle = '#d7142e'; canvasContext.lineWidth = 3;
  canvasContext.strokeRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
  canvasContext.fillStyle = '#d7142e'; canvasContext.textAlign = 'center'; canvasContext.font = '28px Arial'; canvasContext.fillText(label, 0, 0);
}

function getImage(url) {
  if (!state.images.has(url)) { const image = new Image(); image.src = url; state.images.set(url, image); }
  return state.images.get(url);
}

function getVideo(layer) {
  if (!state.videos.has(layer.id)) {
    const video = document.createElement('video'); video.src = layer.assetUrl; video.muted = true; video.loop = layer.properties.loop !== false; video.playsInline = true; video.preload = 'auto';
    video.playbackRate = clamp(layer.properties.playbackRate || 1, .25, 4); state.videos.set(layer.id, video);
  }
  return state.videos.get(layer.id);
}

function renderLayers() {
  if (!state.context) return;
  const layers = [...state.context.layers].sort((a, b) => a.order - b.order);
  elements.layerList.replaceChildren(...layers.map((layer) => {
    const row = document.createElement('div'); row.className = `layer-row${layer.id === state.selectedLayerId ? ' selected' : ''}${layer.visible ? '' : ' dimmed'}`;
    row.append(layerToggle(layer, 'visibility', layer.visible ? 'V' : '-'), layerToggle(layer, 'lock', layer.locked ? 'L' : 'U'));
    const select = document.createElement('button'); select.type = 'button'; select.className = 'layer-select';
    const name = document.createElement('strong'); name.textContent = layer.name; const type = document.createElement('span'); type.textContent = layer.type;
    select.append(name, type); select.addEventListener('click', () => { state.selectedLayerId = layer.id; renderLayers(); renderInspector(); showView('inspector'); });
    const order = document.createElement('span'); order.className = 'layer-order'; order.textContent = String(layer.order);
    row.append(select, order); return row;
  }));
}

function layerToggle(layer, action, label) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-toggle'; button.textContent = label;
  button.addEventListener('click', () => mutateLayer(layer.id, action)); return button;
}

async function runLayerAction(action) {
  if (!state.selectedLayerId) return;
  if (action === 'delete' && !window.confirm('Delete the selected layer?')) return;
  await mutateLayer(state.selectedLayerId, action);
}

async function mutateLayer(layerId, action) {
  try {
    const response = await fetch(`/api/mobile/layers/${encodeURIComponent(layerId)}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    const payload = await readJsonResponse(response, 'Layer update failed'); applyContext(payload, payload.selectedLayerId); setStatus('Project saved');
  } catch (error) { setStatus(error.message || String(error)); }
}

async function patchLayer(layerId, patch) {
  try {
    const response = await fetch(`/api/mobile/layers/${encodeURIComponent(layerId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) });
    const payload = await readJsonResponse(response, 'Inspector update failed'); applyContext(payload, layerId); setStatus('Project saved');
  } catch (error) { setStatus(error.message || String(error)); renderInspector(); }
}

function renderInspector() {
  const layer = state.context?.layers.find((entry) => entry.id === state.selectedLayerId);
  elements.inspectorForm.replaceChildren();
  if (!layer) { elements.inspectorTitle.textContent = 'Inspector'; elements.inspectorType.textContent = '-'; const empty = document.createElement('p'); empty.className = 'inspector-empty'; empty.textContent = 'Select a layer.'; elements.inspectorForm.append(empty); return; }
  elements.inspectorTitle.textContent = layer.name; elements.inspectorType.textContent = layer.type;
  addInspectorHeading('Layer');
  addInspectorField('Name', layer.name, 'text', (value) => patchLayer(layer.id, { name: value }), true, layer.locked);
  addInspectorSelect('Blend', layer.blendMode, ['normal','multiply','screen','overlay','soft-light','hard-light','difference','exclusion','add'], (value) => patchLayer(layer.id, { blendMode: value }), layer.locked);
  addInspectorField('Opacity', layer.opacity, 'number', (value) => patchLayer(layer.id, { opacity: Number(value) }), false, layer.locked, '0.01');
  addInspectorHeading('Transform');
  for (const key of ['x','y','width','height','scaleX','scaleY','rotation']) addInspectorField(key, layer.transform[key] ?? (key.startsWith('scale') ? 1 : 0), 'number', (value) => patchLayer(layer.id, { transform: { [key]: Number(value) } }), false, layer.locked, key.startsWith('scale') ? '0.05' : '1');
  const props = layer.properties || {};
  if (['text','lyrics'].includes(layer.type)) {
    addInspectorHeading('Text');
    if (layer.type === 'text') addInspectorField('Text', props.text || '', 'text', (value) => patchLayer(layer.id, { properties: { text: value } }), true, layer.locked);
    addInspectorField('Font', props.fontFamily || 'Arial', 'text', (value) => patchLayer(layer.id, { properties: { fontFamily: value } }), true, layer.locked);
    addInspectorField('Font size', props.fontSize || 48, 'number', (value) => patchLayer(layer.id, { properties: { fontSize: Number(value) } }), false, layer.locked);
    addInspectorField('Color', props.color || '#ffffff', 'color', (value) => patchLayer(layer.id, { properties: { color: value } }), false, layer.locked);
    addInspectorField('Background', props.backgroundColor || '#000000', 'color', (value) => patchLayer(layer.id, { properties: { backgroundColor: value } }), false, layer.locked);
  } else if (layer.type === 'shape') {
    addInspectorHeading('Shape'); addInspectorField('Fill', props.fill || '#000000', 'color', (value) => patchLayer(layer.id, { properties: { fill: value } }), false, layer.locked);
  } else if (['image','video'].includes(layer.type)) {
    addInspectorHeading('Media'); addInspectorSelect('Fit', props.fit || 'cover', ['cover','contain','stretch'], (value) => patchLayer(layer.id, { properties: { fit: value } }), layer.locked);
  } else if (layer.type === 'visualizer') {
    addInspectorHeading('Visualizer');
    addInspectorSelect('Style', props.visualizerType || 'bars', ['bars','center-bars','radial-spectrum'], (value) => patchLayer(layer.id, { properties: { visualizerType: value } }), layer.locked);
    addInspectorField('Bars', props.bars || 64, 'number', (value) => patchLayer(layer.id, { properties: { bars: Number(value) } }), false, layer.locked);
    addInspectorField('Color', props.color || '#eeeeee', 'color', (value) => patchLayer(layer.id, { properties: { color: value } }), false, layer.locked);
    addInspectorField('Accent', props.accentColor || '#d7142e', 'color', (value) => patchLayer(layer.id, { properties: { accentColor: value } }), false, layer.locked);
    for (const key of ['minFrequency','maxFrequency','gain','sensitivity']) if (props[key] !== undefined) addInspectorField(key, props[key], 'number', (value) => patchLayer(layer.id, { properties: { [key]: Number(value) } }), false, layer.locked, '0.05');
  }
}

function addInspectorHeading(text) { const heading = document.createElement('strong'); heading.className = 'inspector-group'; heading.textContent = text; elements.inspectorForm.append(heading); }
function addInspectorField(label, value, type, onChange, wide = false, disabled = false, step = '') {
  const field = document.createElement('label'); if (wide) field.className = 'wide'; const caption = document.createElement('span'); caption.textContent = label;
  const input = document.createElement('input'); input.type = type; input.value = value; input.disabled = disabled; if (step) input.step = step; input.addEventListener('change', () => onChange(input.value)); field.append(caption, input); elements.inspectorForm.append(field);
}
function addInspectorSelect(label, value, options, onChange, disabled = false) {
  const field = document.createElement('label'); const caption = document.createElement('span'); caption.textContent = label; const select = document.createElement('select'); select.disabled = disabled;
  for (const optionValue of options) { const option = document.createElement('option'); option.value = optionValue; option.textContent = optionValue; option.selected = optionValue === value; select.append(option); }
  select.addEventListener('change', () => onChange(select.value)); field.append(caption, select); elements.inspectorForm.append(field);
}

async function openLibrary() { elements.libraryDialog.showModal(); if (!state.library.tracks.length) await loadLibrary(); else renderLibrary(); }
async function loadLibrary(refresh = false) {
  state.library.loading = true; renderLibrary();
  try { const response = await fetch(`/api/source-providers/tkmusic/tracks${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' }); const payload = await readJsonResponse(response, 'TKMusic library failed'); state.library.tracks = payload.tracks || []; }
  catch (error) { setStatus(error.message || String(error)); } finally { state.library.loading = false; renderLibrary(); }
}
function renderLibrary() {
  elements.libraryList.replaceChildren();
  if (state.library.loading) { elements.libraryCount.textContent = 'Scanning'; return; }
  const tokens = state.library.query.toLowerCase().split(/\s+/).filter(Boolean);
  const tracks = state.library.tracks.filter((track) => tokens.every((token) => [track.title,track.artist,track.id,track.mood,track.tags].join(' ').toLowerCase().includes(token))).sort(libraryComparator());
  elements.libraryCount.textContent = `${tracks.length} of ${state.library.tracks.length}`;
  for (const track of tracks) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'track-card'; card.disabled = Boolean(state.library.importing); card.addEventListener('click', () => importTrack(track));
    const image = document.createElement('img'); image.alt = ''; if (track.coverUrl) image.src = track.coverUrl;
    const body = document.createElement('span'); body.className = 'track-card-body'; const title = document.createElement('strong'); title.textContent = track.title || 'Untitled';
    if (track.isPinned) { const pin = document.createElement('span'); pin.className = 'track-pin'; pin.textContent = 'Pinned'; title.append(pin); }
    const meta = document.createElement('span'); meta.className = 'track-meta'; meta.textContent = `${track.artist || 'TKMusic'} / ${formatTime(track.duration || 0)}`;
    const tags = document.createElement('span'); tags.className = 'track-tags'; tags.textContent = track.tags || track.mood || 'No tags'; body.append(title, meta, tags);
    const action = document.createElement('span'); action.className = 'track-action'; action.textContent = state.library.importing === track.id ? 'Wait' : 'Import'; card.append(image, body, action); elements.libraryList.append(card);
  }
}
function libraryComparator() {
  if (state.library.sort === 'title') return (a,b) => String(a.title).localeCompare(String(b.title));
  if (state.library.sort === 'pinned') return (a,b) => Number(Boolean(b.isPinned))-Number(Boolean(a.isPinned)) || (Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0);
  return (a,b) => (Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0);
}
async function importTrack(track) {
  state.library.importing = track.id; renderLibrary(); setStatus(`Importing ${track.title}...`);
  try {
    const response = await fetch('/api/projects/import-tkmusic', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({trackId:track.id}) });
    const payload = await readJsonResponse(response, 'TKMusic import failed');
    if (payload.imported && !(payload.project?.composition?.width === 1080 && payload.project?.composition?.height === 1920)) {
      const verticalResponse = await fetch('/api/mobile/project/vertical', { method:'POST' }); await readJsonResponse(verticalResponse, 'Vertical conversion failed');
    }
    elements.libraryDialog.close(); await loadContext();
    setStatus(payload.openedExisting ? 'Existing project opened' : 'Vertical project imported');
  } catch (error) { setStatus(error.message || String(error)); } finally { state.library.importing = ''; renderLibrary(); }
}

function configureAudio(url) {
  const enabled = Boolean(url); const absolute = url ? new URL(url, location.href).href : '';
  if (enabled && elements.audio.src !== absolute) { elements.audio.src = url; elements.audio.load(); }
  if (!enabled) { elements.audio.removeAttribute('src'); elements.audio.load(); }
  for (const control of [elements.playButton,elements.backButton,elements.forwardButton,elements.muteButton,elements.seekSlider,elements.useCurrentButton]) control.disabled = !enabled;
  elements.startRenderButton.disabled = !enabled || !state.context?.composition.verticalReady;
}
async function ensureAudioEngine() {
  if (state.audioEngine) { await state.audioEngine.context.resume(); return; }
  const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return;
  const context = new AudioContext(); const source = context.createMediaElementSource(elements.audio); const analyser = context.createAnalyser(); const gain = context.createGain(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = .78;
  source.connect(analyser); analyser.connect(gain); gain.connect(context.destination); gain.gain.value = Number(elements.volumeSlider.value); state.frequencyData = new Uint8Array(analyser.frequencyBinCount); state.audioEngine = { context, source, analyser, gain, muted:false };
}
async function togglePlayback() { await ensureAudioEngine(); if (elements.audio.paused) await elements.audio.play().catch((error) => setStatus(error.message || 'Playback failed')); else elements.audio.pause(); }
function toggleMute() { if (!state.audioEngine) ensureAudioEngine().then(toggleMute); else { state.audioEngine.muted = !state.audioEngine.muted; updateOutputVolume(); elements.muteButton.textContent = state.audioEngine.muted ? 'Unmute' : 'Mute'; } }
function updateOutputVolume() { if (state.audioEngine) state.audioEngine.gain.gain.value = state.audioEngine.muted ? 0 : Number(elements.volumeSlider.value); }
function updateAudioFrame() { if (state.audioEngine) state.audioEngine.analyser.getByteFrequencyData(state.frequencyData); }
function handleAudioMetadata() { const value = safeDuration(); elements.seekSlider.max = String(value); elements.duration.textContent = formatTime(value); elements.renderStart.max = String(value); updatePlaybackUi(); }
function updatePlaybackUi() { const time = Number(elements.audio.currentTime || 0); if (!state.userSeeking) elements.seekSlider.value = String(time); elements.currentTime.textContent = formatTime(time); updateTransportState(); }
function updateTransportState() { elements.playButton.textContent = elements.audio.paused ? 'Play' : 'Pause'; }
function seekTo(value) { const target = clamp(value,0,safeDuration() || Number.MAX_SAFE_INTEGER); elements.audio.currentTime = target; elements.seekSlider.value = String(target); updatePlaybackUi(); }
function currentLyricText() { return findCurrentLyric(state.cues, Number(elements.audio.currentTime || 0))?.text || ''; }
async function loadLyrics(url) { state.cues=[]; if (!url) return; try { const response=await fetch(url,{cache:'no-store'}); state.cues=parseAlignedLyrics(await readJsonResponse(response,'Lyrics failed')); } catch {} }
function renderScenes() { elements.sceneStrip.replaceChildren(...(state.context?.scenes || []).map((scene) => { const button=document.createElement('button'); button.type='button'; button.className='button button-quiet'; button.textContent=truncate(scene.name,20); button.addEventListener('click',()=>seekTo(scene.start)); return button; })); }

async function startRender() {
  if (!state.context?.composition.verticalReady) { showView('canvas'); setStatus('Apply 9:16 before rendering'); return; }
  const duration=safeDuration()||Number(state.context.composition.duration||0); const start=clamp(elements.renderStart.value,0,duration); const length=elements.renderLength.value==='full'?duration-start:Number(elements.renderLength.value); const end=Math.min(duration,start+length); const fps=Number(elements.renderFps.value||30); if (!(end>start)) return setStatus('Choose a valid render range');
  elements.startRenderButton.disabled=true;
  try { const response=await fetch('/api/exports/headless-mp4/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({options:{preset:'mobile-headless',start,end,fps,frameCount:Math.ceil((end-start)*fps),raw:true,composite:state.context.media.hasVisibleVideoLayer,hardwareEncoder:elements.nvencToggle.checked?'h264_nvenc':'',width:1080,height:1920}})}); const payload=await readJsonResponse(response,'Render start failed'); state.renderJobId=payload.jobId; updateRenderStatus({status:payload.status,jobId:payload.jobId,progress:{completedFrames:0,totalFrames:Math.ceil((end-start)*fps)}}); scheduleRenderPoll(250); } catch(error){setStatus(error.message||String(error));elements.startRenderButton.disabled=false;}
}
async function cancelRender(){if(!state.renderJobId)return;try{const response=await fetch('/api/exports/headless-mp4/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:state.renderJobId})});await readJsonResponse(response,'Cancel failed');await loadRenderStatus();}catch(error){setStatus(error.message||String(error));}}
async function loadRenderStatus(){try{const response=await fetch(`/api/mobile/render/status${state.renderJobId?`?jobId=${encodeURIComponent(state.renderJobId)}`:''}`,{cache:'no-store'});const payload=await readJsonResponse(response,'Render status failed');if(payload.jobId)state.renderJobId=payload.jobId;updateRenderStatus(payload);}catch(error){setStatus(error.message||String(error));}finally{scheduleRenderPoll();}}
function updateRenderStatus(render){const status=render?.status||'idle';const progress=render?.progress||{};const completed=Number(progress.completedFrames||0);const total=Number(progress.totalFrames||0);const percent=total?Math.min(100,completed/total*100):status==='done'?100:0;elements.renderBadge.textContent=status;elements.renderBadge.className=`status-badge ${status}`;elements.renderProgress.style.width=`${percent}%`;const active=status==='running';elements.cancelRenderButton.hidden=!active;elements.startRenderButton.disabled=active||!state.context?.media?.audioUrl||!state.context?.composition.verticalReady;if(active)elements.renderMessage.textContent=`${completed} / ${total||'?'} frames${progress.averageFps?` at ${formatNumber(progress.averageFps)} fps`:''}`;else if(status==='done')elements.renderMessage.textContent=render.output?.filename?`Completed: ${render.output.filename}`:'Render completed';else if(status==='failed'||status==='cancelled')elements.renderMessage.textContent=render.error||`Render ${status}`;else elements.renderMessage.textContent=state.context?.composition.verticalReady?'No render running.':'Apply 9:16 before rendering.';}
function scheduleRenderPoll(delay){clearTimeout(state.renderPoll);const active=elements.renderBadge.textContent==='running';state.renderPoll=setTimeout(loadRenderStatus,delay??(active?1000:5000));}
async function loadPublishStatus(){elements.refreshPublishButton.disabled=true;try{const response=await fetch('/api/mobile/publish/status',{cache:'no-store'});const payload=await readJsonResponse(response,'Publisher status failed');elements.providerList.replaceChildren(...payload.providers.map(renderProvider));}catch(error){setStatus(error.message||String(error));}finally{elements.refreshPublishButton.disabled=false;}}
function renderProvider(provider){const row=document.createElement('div');row.className='provider-row';const name=document.createElement('strong');name.textContent=provider.provider;const detail=document.createElement('span');detail.textContent=provider.upload?`${provider.upload.status} / ${formatNumber(provider.upload.progress)}%`:provider.account||'No upload job';const status=document.createElement('span');status.className=`provider-state${provider.connected?' connected':''}`;status.textContent=provider.connected?'Connected':provider.state.replaceAll('_',' ');row.append(name,detail,status);return row;}

async function readJsonResponse(response,fallback){const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`${fallback} (HTTP ${response.status})`);return payload;}
function setStatus(message){elements.statusText.textContent=message;}
function safeDuration(){return Number.isFinite(elements.audio.duration)?elements.audio.duration:0;}
function formatTime(value){const total=Math.max(0,Math.round(Number(value||0)));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
function formatNumber(value){return Math.round(Number(value||0)*100)/100;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value||0)));}
function truncate(value,length){const text=String(value||'');return text.length>length?`${text.slice(0,length-1)}...`:text;}
function cssFont(value){return String(value||'Arial').includes(' ')?`"${String(value).replaceAll('"','')}"`:String(value||'Arial');}
function mapBlendMode(mode){return({normal:'source-over',add:'lighter',subtract:'difference'}[mode]||mode||'source-over');}
function wrapText(text,maxWidth,maxLines){const words=String(text||'').split(/\s+/);const lines=[];let line='';for(const word of words){const candidate=line?`${line} ${word}`:word;if(canvasContext.measureText(candidate).width<=maxWidth||!line)line=candidate;else{lines.push(line);line=word;if(lines.length>=maxLines-1)break;}}if(line&&lines.length<maxLines)lines.push(line);return lines;}
