const state = {
  context: null,
  settings: null,
  jobId: '',
  pollTimer: 0,
  resultPath: '',
  scrubbing: false
};

const elements = Object.fromEntries([
  'projectName', 'sourceName', 'sourcePath', 'videoStage', 'videoPreview', 'watermarkPreview',
  'playButton', 'timeLabel', 'seekSlider', 'trimStartInput', 'trimEndInput', 'trimStartSlider',
  'trimEndSlider', 'trimSummary', 'resetTrimButton', 'videoFadeInInput', 'videoFadeOutInput',
  'audioFadeInInput', 'audioFadeOutInput', 'volumeInput', 'volumeOutput', 'watermarkEnabledInput',
  'watermarkControls', 'watermarkTypeInput', 'watermarkTextField', 'watermarkTextInput',
  'watermarkImageField', 'watermarkImageInput', 'watermarkImagePath', 'watermarkPositionInput',
  'watermarkMarginInput', 'watermarkScaleInput', 'watermarkOpacityInput', 'watermarkVisibilityInput',
  'watermarkLastSecondsField', 'watermarkLastSecondsInput', 'saveSettingsButton', 'exportButton',
  'cancelExportButton', 'exportStatus', 'progressFill', 'exportResult', 'exportPath', 'copyPathButton',
  'openFolderButton', 'publishButton', 'closeButton', 'statusText'
].map((id) => [id, document.getElementById(id)]));

elements.closeButton.addEventListener('click', () => window.close());
elements.playButton.addEventListener('click', togglePlayback);
elements.videoPreview.addEventListener('timeupdate', onTimeUpdate);
elements.videoPreview.addEventListener('play', () => { elements.playButton.textContent = 'Pause'; });
elements.videoPreview.addEventListener('pause', () => { elements.playButton.textContent = 'Play'; });
elements.videoPreview.addEventListener('loadedmetadata', syncVideoMetadata);
elements.seekSlider.addEventListener('input', () => seekPreview(Number(elements.seekSlider.value)));
elements.resetTrimButton.addEventListener('click', resetTrim);
elements.saveSettingsButton.addEventListener('click', saveSettings);
elements.exportButton.addEventListener('click', startExport);
elements.cancelExportButton.addEventListener('click', cancelExport);
elements.copyPathButton.addEventListener('click', copyResultPath);
elements.openFolderButton.addEventListener('click', openResultFolder);
elements.publishButton.addEventListener('click', openPublishWindow);
elements.watermarkImageInput.addEventListener('change', importWatermarkImage);
window.addEventListener('resize', () => {
  fitVideoStage();
  updatePreview();
});

for (const input of [elements.trimStartInput, elements.trimEndInput, elements.trimStartSlider, elements.trimEndSlider]) {
  input.addEventListener('input', () => updateTrim(input));
}
for (const input of [
  elements.videoFadeInInput, elements.videoFadeOutInput, elements.audioFadeInInput, elements.audioFadeOutInput,
  elements.volumeInput, elements.watermarkEnabledInput, elements.watermarkTypeInput, elements.watermarkTextInput,
  elements.watermarkPositionInput, elements.watermarkMarginInput, elements.watermarkScaleInput,
  elements.watermarkOpacityInput, elements.watermarkVisibilityInput, elements.watermarkLastSecondsInput
]) {
  input.addEventListener('input', updateSettingsFromControls);
  input.addEventListener('change', updateSettingsFromControls);
}

await loadContext();

async function loadContext() {
  await refreshPublishAvailability();
  setStatus('Loading latest final export...');
  const response = await fetch('/api/reel/context');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load Reel Mode.');
  if (!payload.available) {
    elements.exportButton.disabled = true;
    elements.saveSettingsButton.disabled = true;
    setStatus('No final MP4 export exists for the current project.');
    return;
  }
  state.context = payload;
  state.settings = payload.settings;
  elements.projectName.textContent = payload.projectName;
  elements.sourceName.textContent = payload.source.relativePath.split('/').at(-1);
  elements.sourcePath.textContent = payload.source.outputPath;
  elements.sourcePath.title = payload.source.outputPath;
  elements.videoPreview.src = payload.source.sourceUrl;
  fitVideoStage();
  applySettingsToControls();
  updatePreview();
  setStatus('Reel Mode ready. Original export is read-only.');
}

function syncVideoMetadata() {
  const duration = sourceDuration();
  for (const input of [elements.seekSlider, elements.trimStartSlider, elements.trimEndSlider]) input.max = String(duration);
  elements.trimStartInput.max = String(duration);
  elements.trimEndInput.max = String(duration);
  if (!(state.settings.trimEnd > state.settings.trimStart)) state.settings.trimEnd = duration;
  applySettingsToControls();
  fitVideoStage();
  seekPreview(state.settings.trimStart);
}

function fitVideoStage() {
  const width = Math.max(1, Number(state.context?.media?.width || 1920));
  const height = Math.max(1, Number(state.context?.media?.height || 1080));
  const ratio = width / height;
  const maxWidth = Math.max(320, elements.videoStage.parentElement.clientWidth);
  const maxHeight = Math.max(260, window.innerHeight - 330);
  const fittedWidth = Math.min(maxWidth, maxHeight * ratio);
  elements.videoStage.style.width = `${Math.round(fittedWidth)}px`;
  elements.videoStage.style.height = `${Math.round(fittedWidth / ratio)}px`;
  elements.videoStage.style.aspectRatio = `${width} / ${height}`;
}

function applySettingsToControls() {
  const settings = state.settings;
  const wm = settings.watermark;
  elements.trimStartInput.value = formatNumber(settings.trimStart);
  elements.trimStartSlider.value = formatNumber(settings.trimStart);
  elements.trimEndInput.value = formatNumber(settings.trimEnd);
  elements.trimEndSlider.value = formatNumber(settings.trimEnd);
  elements.videoFadeInInput.value = formatNumber(settings.videoFadeIn);
  elements.videoFadeOutInput.value = formatNumber(settings.videoFadeOut);
  elements.audioFadeInInput.value = formatNumber(settings.audioFadeIn);
  elements.audioFadeOutInput.value = formatNumber(settings.audioFadeOut);
  elements.volumeInput.value = formatNumber(settings.volume);
  elements.watermarkEnabledInput.checked = wm.enabled;
  elements.watermarkTypeInput.value = wm.type;
  elements.watermarkTextInput.value = wm.text;
  elements.watermarkImagePath.textContent = wm.imagePath || 'No PNG imported';
  elements.watermarkPositionInput.value = wm.position;
  elements.watermarkMarginInput.value = String(wm.margin);
  elements.watermarkScaleInput.value = formatNumber(wm.scale);
  elements.watermarkOpacityInput.value = formatNumber(wm.opacity);
  elements.watermarkVisibilityInput.value = wm.visibility;
  elements.watermarkLastSecondsInput.value = formatNumber(wm.lastSeconds);
  updateControlVisibility();
  updateTrimSummary();
  updatePreview();
}

function updateSettingsFromControls() {
  const wm = state.settings.watermark;
  state.settings.videoFadeIn = clamp(elements.videoFadeInInput.value, 0, 5);
  state.settings.videoFadeOut = clamp(elements.videoFadeOutInput.value, 0, 5);
  state.settings.audioFadeIn = clamp(elements.audioFadeInInput.value, 0, 5);
  state.settings.audioFadeOut = clamp(elements.audioFadeOutInput.value, 0, 5);
  state.settings.volume = clamp(elements.volumeInput.value, 0, 2);
  wm.enabled = elements.watermarkEnabledInput.checked;
  wm.type = elements.watermarkTypeInput.value === 'image' ? 'image' : 'text';
  wm.text = elements.watermarkTextInput.value;
  wm.position = elements.watermarkPositionInput.value;
  wm.margin = clamp(elements.watermarkMarginInput.value, 0, 500);
  wm.scale = clamp(elements.watermarkScaleInput.value, 0.02, 0.5);
  wm.opacity = clamp(elements.watermarkOpacityInput.value, 0, 1);
  wm.visibility = elements.watermarkVisibilityInput.value;
  wm.lastSeconds = clamp(elements.watermarkLastSecondsInput.value, 0.1, Math.max(0.1, trimmedDuration()));
  updateControlVisibility();
  updatePreview();
}

function updateTrim(sourceInput) {
  const isStart = sourceInput === elements.trimStartInput || sourceInput === elements.trimStartSlider;
  const value = clamp(sourceInput.value, 0, sourceDuration());
  if (isStart) {
    state.settings.trimStart = Math.min(value, Math.max(0, state.settings.trimEnd - 0.05));
    elements.trimStartInput.value = formatNumber(state.settings.trimStart);
    elements.trimStartSlider.value = formatNumber(state.settings.trimStart);
    seekPreview(state.settings.trimStart);
  } else {
    state.settings.trimEnd = Math.max(value, state.settings.trimStart + 0.05);
    state.settings.trimEnd = Math.min(sourceDuration(), state.settings.trimEnd);
    elements.trimEndInput.value = formatNumber(state.settings.trimEnd);
    elements.trimEndSlider.value = formatNumber(state.settings.trimEnd);
    seekPreview(Math.min(state.settings.trimEnd, elements.videoPreview.currentTime));
  }
  clampFadesToTrim();
  updateTrimSummary();
  updatePreview();
}

function resetTrim() {
  state.settings.trimStart = 0;
  state.settings.trimEnd = sourceDuration();
  clampFadesToTrim();
  applySettingsToControls();
  seekPreview(0);
}

function clampFadesToTrim() {
  const maxFade = Math.min(5, trimmedDuration());
  for (const key of ['videoFadeIn', 'videoFadeOut', 'audioFadeIn', 'audioFadeOut']) {
    state.settings[key] = Math.min(maxFade, Math.max(0, Number(state.settings[key] || 0)));
  }
}

function updateControlVisibility() {
  const wm = state.settings.watermark;
  elements.watermarkControls.hidden = !wm.enabled;
  elements.watermarkTextField.hidden = wm.type !== 'text';
  elements.watermarkImageField.hidden = wm.type !== 'image';
  elements.watermarkLastSecondsField.hidden = wm.visibility !== 'last-seconds';
  elements.volumeOutput.textContent = `${Math.round(state.settings.volume * 100)}%`;
}

function updateTrimSummary() {
  elements.trimSummary.textContent = `${formatTime(state.settings.trimStart)} - ${formatTime(state.settings.trimEnd)} · ${formatTime(trimmedDuration())} Reel`;
}

function updatePreview() {
  if (!state.settings) return;
  const wm = state.settings.watermark;
  const current = relativePreviewTime();
  const duration = trimmedDuration();
  const fadeIn = state.settings.videoFadeIn > 0 ? Math.min(1, current / state.settings.videoFadeIn) : 1;
  const fadeOutRemaining = Math.max(0, duration - current);
  const fadeOut = state.settings.videoFadeOut > 0 ? Math.min(1, fadeOutRemaining / state.settings.videoFadeOut) : 1;
  elements.videoPreview.style.opacity = String(Math.max(0, Math.min(fadeIn, fadeOut)));
  const audioFadeIn = state.settings.audioFadeIn > 0 ? Math.min(1, current / state.settings.audioFadeIn) : 1;
  const audioFadeOut = state.settings.audioFadeOut > 0 ? Math.min(1, fadeOutRemaining / state.settings.audioFadeOut) : 1;
  elements.videoPreview.volume = Math.max(0, Math.min(1, state.settings.volume * Math.min(audioFadeIn, audioFadeOut)));

  const visibleByTime = wm.visibility !== 'last-seconds' || current >= Math.max(0, duration - wm.lastSeconds);
  elements.watermarkPreview.hidden = !wm.enabled || !visibleByTime || (wm.type === 'image' && !wm.imagePath);
  elements.watermarkPreview.style.opacity = String(wm.opacity);
  elements.watermarkPreview.style.fontSize = `${Math.max(12, Math.round(elements.videoStage.clientHeight * wm.scale))}px`;
  elements.watermarkPreview.style.height = wm.type === 'image' ? `${Math.max(12, Math.round(elements.videoStage.clientHeight * wm.scale))}px` : 'auto';
  positionWatermark(elements.watermarkPreview, wm.position, wm.margin * previewScale());
  if (wm.type === 'text') {
    elements.watermarkPreview.textContent = wm.text;
  } else if (wm.imagePath) {
    elements.watermarkPreview.innerHTML = `<img src="/api/reel/watermark-image?path=${encodeURIComponent(wm.imagePath)}" alt="Watermark">`;
  }
}

function onTimeUpdate() {
  if (!state.settings) return;
  if (elements.videoPreview.currentTime >= state.settings.trimEnd) {
    elements.videoPreview.pause();
    elements.videoPreview.currentTime = state.settings.trimEnd;
  }
  elements.seekSlider.value = String(elements.videoPreview.currentTime);
  elements.timeLabel.textContent = `${formatTime(elements.videoPreview.currentTime)} / ${formatTime(sourceDuration())}`;
  updatePreview();
}

async function togglePlayback() {
  if (elements.videoPreview.currentTime < state.settings.trimStart || elements.videoPreview.currentTime >= state.settings.trimEnd) {
    seekPreview(state.settings.trimStart);
  }
  if (elements.videoPreview.paused) await elements.videoPreview.play();
  else elements.videoPreview.pause();
}

function seekPreview(time) {
  elements.videoPreview.currentTime = clamp(time, state.settings.trimStart, state.settings.trimEnd);
  elements.seekSlider.value = String(elements.videoPreview.currentTime);
  onTimeUpdate();
}

async function saveSettings() {
  updateSettingsFromControls();
  const response = await fetch('/api/reel/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: state.settings })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to save Reel settings.');
  state.settings = payload.settings;
  applySettingsToControls();
  setStatus('Reel settings saved separately from project.json.');
}

async function importWatermarkImage() {
  const file = elements.watermarkImageInput.files?.[0];
  if (!file) return;
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
    setStatus('Watermark must be a transparent PNG.');
    return;
  }
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch('/api/reel/watermark-image', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, dataUrl })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Watermark import failed.');
  state.settings.watermark.imagePath = payload.relativePath;
  state.settings.watermark.type = 'image';
  elements.watermarkTypeInput.value = 'image';
  applySettingsToControls();
  setStatus('Watermark PNG copied into the project Reel workspace.');
}

async function startExport() {
  updateSettingsFromControls();
  setExportBusy(true);
  state.resultPath = '';
  elements.exportResult.hidden = true;
  elements.progressFill.style.width = '0%';
  elements.exportStatus.textContent = 'Starting FFmpeg Reel export...';
  try {
    const response = await fetch('/api/reel/export/start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: state.settings })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Reel export failed to start.');
    state.jobId = payload.jobId;
    elements.exportStatus.textContent = `Rendering with ${payload.videoEncoder}...`;
    pollExportStatus();
  } catch (error) {
    setExportBusy(false);
    elements.exportStatus.textContent = shortError(error.message || error);
    setStatus(`Reel export failed: ${shortError(error.message || error)}`);
  }
}

async function pollExportStatus() {
  window.clearTimeout(state.pollTimer);
  if (!state.jobId) return;
  try {
    const response = await fetch(`/api/reel/export/status?jobId=${encodeURIComponent(state.jobId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Reel status unavailable.');
    const percent = Math.round(Number(payload.progress || 0) * 1000) / 10;
    elements.progressFill.style.width = `${percent}%`;
    elements.exportStatus.textContent = payload.status === 'running'
      ? `Rendering ${percent}% · ${formatTime(payload.outTime)} / ${formatTime(payload.duration)}`
      : payload.status;
    if (payload.status === 'running') {
      state.pollTimer = window.setTimeout(pollExportStatus, 500);
      return;
    }
    setExportBusy(false);
    if (payload.status === 'done') {
      state.resultPath = payload.result.outputPath;
      elements.exportResult.hidden = false;
      elements.exportPath.textContent = payload.result.outputPath;
      elements.copyPathButton.disabled = false;
      elements.openFolderButton.disabled = false;
      elements.exportStatus.textContent = `Completed · ${formatTime(payload.result.duration)} · ${formatBytes(payload.result.bytes)}`;
      setStatus('Reel export completed without modifying the source video.');
      await refreshPublishAvailability();
    } else {
      elements.exportStatus.textContent = shortError(payload.error || `Reel export ${payload.status}.`);
      setStatus(elements.exportStatus.textContent);
    }
  } catch (error) {
    setExportBusy(false);
    elements.exportStatus.textContent = shortError(error.message || error);
  }
}

async function cancelExport() {
  if (!state.jobId) return;
  const response = await fetch('/api/reel/export/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: state.jobId })
  });
  const payload = await response.json();
  setExportBusy(false);
  elements.exportStatus.textContent = response.ok ? 'Reel export cancelled.' : (payload.error || 'Cancel failed.');
}

function setExportBusy(busy) {
  elements.exportButton.disabled = busy;
  elements.saveSettingsButton.disabled = busy;
  elements.cancelExportButton.disabled = !busy;
}

async function copyResultPath() {
  if (!state.resultPath) return;
  await navigator.clipboard.writeText(state.resultPath);
  setStatus('Reel output path copied.');
}

async function openResultFolder() {
  if (!state.resultPath) return;
  await fetch('/api/exports/open-folder', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: state.resultPath })
  });
}

async function refreshPublishAvailability() {
  try {
    const response = await fetch('/api/publish/context');
    const payload = await response.json();
    elements.publishButton.disabled = !response.ok || !payload.available || !payload.valid;
    elements.publishButton.title = elements.publishButton.disabled
      ? (payload.validationErrors?.[0] || 'Export a valid Reel before publishing.')
      : 'Upload the latest Reel as a TikTok draft';
  } catch {
    elements.publishButton.disabled = true;
    elements.publishButton.title = 'TikTok publisher is unavailable.';
  }
}

function openPublishWindow() {
  window.open('/publish/index.html', 'kr8-publish', 'popup=yes,width=1040,height=820,resizable=yes,scrollbars=yes');
}

function positionWatermark(element, position, margin) {
  element.style.inset = 'auto';
  const value = `${Math.max(0, Math.round(margin))}px`;
  if (position.startsWith('top')) element.style.top = value;
  else element.style.bottom = value;
  if (position.endsWith('left')) element.style.left = value;
  else element.style.right = value;
}

function previewScale() {
  return elements.videoStage.clientHeight / Math.max(1, state.context?.media?.height || 1080);
}
function sourceDuration() { return Math.max(0, Number(state.context?.media?.duration || elements.videoPreview.duration || 0)); }
function trimmedDuration() { return Math.max(0, Number(state.settings?.trimEnd || 0) - Number(state.settings?.trimStart || 0)); }
function relativePreviewTime() { return Math.max(0, elements.videoPreview.currentTime - Number(state.settings?.trimStart || 0)); }
function clamp(value, min, max) { const number = Number(value); return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min)); }
function formatNumber(value) { return Number(value || 0).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0'; }
function formatTime(seconds) { const value = Math.max(0, Number(seconds || 0)); const minutes = Math.floor(value / 60); return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`; }
function formatBytes(bytes) { const value = Math.max(0, Number(bytes || 0)); return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.round(value / 1000)} KB`; }
function setStatus(message) { elements.statusText.textContent = message; }
function shortError(value) { const text = String(value || 'Unknown error').replace(/\s+/g, ' ').trim(); return text.length > 420 ? `${text.slice(0, 417)}...` : text; }
function readFileAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
