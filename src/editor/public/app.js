import {
  addLayer,
  deleteLayer,
  duplicateLayer,
  normalizeLayerOrder,
  reorderLayer,
  sortLayersForRender,
  toggleLayerLock,
  toggleLayerVisibility,
  updateLayer
} from './layer-operations.js';
import {
  Kr8AudioPreview,
  createAudioFrameFromPeaks,
  createAudioFrameFromSamples,
  createSilentAudioFrame,
  selectAudioDuration,
  smoothAudioFrame
} from './audio-engine.js';
import { resolveProjectAudioBindings } from './audio-bindings.js';
import { mapFrequencyBinsToBars } from './frequency-mapping.js';
import {
  deriveLyricScenes,
  deriveMetadataLyricScenes,
  findCurrentLyric,
  getRenderableLyricCues,
  parseAlignedLyrics
} from './lyrics-timeline.js';
import { createLyricsOverlayLayer } from './lyrics-layer.js';
import {
  LYRICS_STYLE_PRESETS,
  applyLyricsStylePreset,
  calculateLyricsTransitionOpacity,
  createLyricsStylePresetFromLayer,
  ensureProjectLyricsStylePresets,
  isBuiltInLyricsStylePreset,
  removeProjectLyricsStylePreset,
  upsertProjectLyricsStylePreset
} from './lyrics-styles.js';
import {
  buildLyricsRenderCacheKey,
  calculateLyricsEffectPadding,
  createLyricsRenderCache
} from './lyrics-render-cache.js';
import {
  VISUALIZER_STYLE_PRESETS,
  applyVisualizerPresetObject,
  applyVisualizerStylePreset,
  createVisualizerPresetFromLayer,
  ensureProjectVisualizerStylePresets,
  normalizeVisualizerType,
  upsertProjectVisualizerStylePreset
} from './visualizer-styles.js';
import {
  applySceneVisualizerPreset,
  ensureProjectSceneVisualizerPresets
} from './scene-visualizer-presets.js';
import {
  applyCompositionFormat,
  getCompositionFormatId
} from './composition-formats.js';
import {
  TEXT_STYLE_PRESETS,
  applyTextStylePreset,
  ensureProjectTextStylePresets
} from './text-styles.js';
import {
  applyTypographyPreset,
  createTypographyPresetFromLayer,
  ensureProjectTypographyPresets,
  normalizeAdvancedTextProperties,
  reconcileTextLines,
  syncLegacyTextProperties,
  upsertProjectTypographyPreset
} from '/core/advanced-typography.js';
import { evaluateLayerAnimations } from '/core/animation-evaluate.js';
import {
  applyTypographyTransform,
  drawAdvancedTextLayer
} from './advanced-text-renderer.js';
import { renderAdvancedTypographyInspector } from './advanced-typography-ui.js';
import { findMatchingFontFaces } from './font-family-matching.js';
import { createCoverLabController } from './cover-lab/cover-lab.js';
import { createWebCodecsVideoDecoder } from './video-webcodecs.js';
import { createLyricsEditorController } from './lyrics-editor/lyrics-editor.js';
import {
  normalizeLyricsDocument,
  toRenderableLyricsCues
} from '/core/lyrics-editor/schema.js';

const MAX_EXPORT_FRAMES = 900;
const MAX_DIRECT_EXPORT_FRAMES = 18000;
const MAX_WEBCODECS_DECODE_MS = 80;
const AUDIO_FILE_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']);
const FONT_SELECT_REFRESH_VALUE = '__kr8_refresh_system_fonts__';
const FONT_SELECT_LOAD_VALUE = '__kr8_load_system_fonts__';
const FALLBACK_FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Consolas',
  'Georgia',
  'Impact',
  'Inter',
  'Montserrat',
  'Montserrat ExtraBold',
  'Montserrat SemiBold',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
];

const state = {
  project: null,
  projectId: '',
  projectPath: '',
  projectDirectory: '',
  selectedLayerId: '',
  imageCache: new Map(),
  videoCache: new Map(),
  videoSyncKeys: new Map(),
  videoExportContext: null,
  exportVideoBenchmark: null,
  dirty: false,
  renderProject: null,
  renderTimeOverride: null,
  exportOverlay: null,
  exportControl: {
    busy: false,
    cancelRequested: false,
    sessionId: ''
  },
  lastExport: null,
  exportHistory: [],
  visualizerLibrary: {
    presets: [],
    path: ''
  },
  lyricsStyleLibrary: {
    presets: [],
    path: ''
  },
  audio: {
    preview: new Kr8AudioPreview(),
    frame: createSilentAudioFrame(),
    animationId: 0,
    userScrubbing: false,
    status: 'idle',
    waveformPeaks: [],
    decodedSamples: new Float32Array(),
    decodedSampleRate: 44100,
    decodedDuration: 0,
    seekToken: 0,
    pendingSeekTime: null,
    pendingSeekStartedAt: 0
  },
  lyrics: {
    status: 'idle',
    document: { lines: [] },
    sourceCues: [],
    cues: [],
    scenes: [],
    metadataLyrics: '',
    filter: '',
    currentCue: null
  },
  fonts: {
    status: 'idle',
    families: [],
    faces: [],
    error: ''
  },
  typography: {
    selectedLineId: '',
    layouts: new Map(),
    interaction: null,
    guides: [],
    snapping: true
  },
  tkMusicLibrary: {
    status: 'idle',
    tracks: [],
    query: '',
    sort: 'newest',
    readyOnly: false,
    importingId: '',
    error: ''
  },
  audioImport: {
    file: null,
    mode: 'create',
    busy: false,
    complete: false,
    result: null,
    dragDepth: 0
  }
};

const loadedServerFontFaceIds = new Set();

const elements = {
  canvas: document.getElementById('stageCanvas'),
  projectName: document.getElementById('projectName'),
  projectPath: document.getElementById('projectPath'),
  layersList: document.getElementById('layersList'),
  inspectorForm: document.getElementById('inspectorForm'),
  statusText: document.getElementById('statusText'),
  durationLabel: document.getElementById('durationLabel'),
  fpsLabel: document.getElementById('fpsLabel'),
  timelineFill: document.getElementById('timelineFill'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  timelineScrubber: document.getElementById('timelineScrubber'),
  timelineTrack: document.getElementById('timelineTrack'),
  sceneStrip: document.getElementById('sceneStrip'),
  lyricsMeta: document.getElementById('lyricsMeta'),
  lyricsLine: document.getElementById('lyricsLine'),
  lyricsCount: document.getElementById('lyricsCount'),
  lyricsSearch: document.getElementById('lyricsSearch'),
  lyricsList: document.getElementById('lyricsList'),
  timeLabel: document.getElementById('timeLabel'),
  bassMeter: document.getElementById('bassMeter'),
  audioStatus: document.getElementById('audioStatus'),
  playButton: document.getElementById('playButton'),
  seekBackButton: document.getElementById('seekBackButton'),
  seekForwardButton: document.getElementById('seekForwardButton'),
  timeInput: document.getElementById('timeInput'),
  muteButton: document.getElementById('muteButton'),
  volumeSlider: document.getElementById('volumeSlider'),
  addLyricsButton: document.getElementById('addLyricsButton'),
  importTkMusicButton: document.getElementById('importTkMusicButton'),
  importAudioButton: document.getElementById('importAudioButton'),
  audioFileInput: document.getElementById('audioFileInput'),
  audioImportPanel: document.getElementById('audioImportPanel'),
  audioImportCloseButton: document.getElementById('audioImportCloseButton'),
  audioImportCancelButton: document.getElementById('audioImportCancelButton'),
  audioImportChooseButton: document.getElementById('audioImportChooseButton'),
  audioImportRunButton: document.getElementById('audioImportRunButton'),
  audioImportMode: document.getElementById('audioImportMode'),
  audioImportFilename: document.getElementById('audioImportFilename'),
  audioImportCurrent: document.getElementById('audioImportCurrent'),
  audioImportTitleInput: document.getElementById('audioImportTitleInput'),
  audioImportArtistInput: document.getElementById('audioImportArtistInput'),
  audioImportFormatField: document.getElementById('audioImportFormatField'),
  audioImportFormatSelect: document.getElementById('audioImportFormatSelect'),
  audioImportMetadataCheckbox: document.getElementById('audioImportMetadataCheckbox'),
  audioImportNotice: document.getElementById('audioImportNotice'),
  audioImportResult: document.getElementById('audioImportResult'),
  createCoverButton: document.getElementById('createCoverButton'),
  tkMusicLibraryPanel: document.getElementById('tkMusicLibraryPanel'),
  tkMusicLibraryCloseButton: document.getElementById('tkMusicLibraryCloseButton'),
  tkMusicLibraryCancelButton: document.getElementById('tkMusicLibraryCancelButton'),
  tkMusicLibraryRefreshButton: document.getElementById('tkMusicLibraryRefreshButton'),
  tkMusicLibrarySearch: document.getElementById('tkMusicLibrarySearch'),
  tkMusicLibrarySort: document.getElementById('tkMusicLibrarySort'),
  tkMusicLibraryReadyOnly: document.getElementById('tkMusicLibraryReadyOnly'),
  tkMusicLibraryCount: document.getElementById('tkMusicLibraryCount'),
  tkMusicLibraryStatus: document.getElementById('tkMusicLibraryStatus'),
  tkMusicLibraryGrid: document.getElementById('tkMusicLibraryGrid'),
  tkMusicManualIdInput: document.getElementById('tkMusicManualIdInput'),
  tkMusicManualImportButton: document.getElementById('tkMusicManualImportButton'),
  saveTemplateButton: document.getElementById('saveTemplateButton'),
  applyTemplateButton: document.getElementById('applyTemplateButton'),
  compositionFormatSelect: document.getElementById('compositionFormatSelect'),
  exportButton: document.getElementById('exportButton'),
  reelModeButton: document.getElementById('reelModeButton'),
  loadingSplash: document.getElementById('loadingSplash'),
  loadingSplashLine: document.getElementById('loadingSplashLine'),
  stageFrame: document.querySelector('.stage-frame'),
  exportPanel: document.getElementById('exportPanel'),
  exportCloseButton: document.getElementById('exportCloseButton'),
  exportCancelButton: document.getElementById('exportCancelButton'),
  exportRunButton: document.getElementById('exportRunButton'),
  exportHeadlessMp4Button: document.getElementById('exportHeadlessMp4Button'),
  exportDirectMp4Button: document.getElementById('exportDirectMp4Button'),
  exportPresetSelect: document.getElementById('exportPresetSelect'),
  exportStartInput: document.getElementById('exportStartInput'),
  exportEndInput: document.getElementById('exportEndInput'),
  exportFpsInput: document.getElementById('exportFpsInput'),
  exportFpsButtons: [...document.querySelectorAll('.export-fps-buttons button[data-fps]')],
  exportSummary: document.getElementById('exportSummary'),
  exportReview: document.getElementById('exportReview'),
  exportReviewMeta: document.getElementById('exportReviewMeta'),
  exportReviewPath: document.getElementById('exportReviewPath'),
  exportBenchmark: document.getElementById('exportBenchmark'),
  exportReviewPreviews: document.querySelector('.export-review-previews'),
  exportReviewFirst: document.getElementById('exportReviewFirst'),
  exportReviewLast: document.getElementById('exportReviewLast'),
  exportRenderMp4Button: document.getElementById('exportRenderMp4Button'),
  exportCopyPathButton: document.getElementById('exportCopyPathButton'),
  exportOpenFolderButton: document.getElementById('exportOpenFolderButton'),
  exportHistoryRefreshButton: document.getElementById('exportHistoryRefreshButton'),
  exportHistoryList: document.getElementById('exportHistoryList'),
  coverFileInput: document.getElementById('coverFileInput'),
  coverVideoFileInput: document.getElementById('coverVideoFileInput'),
  textTextureFileInput: document.getElementById('textTextureFileInput'),
  openButton: document.getElementById('openButton'),
  saveButton: document.getElementById('saveButton'),
  reloadButton: document.getElementById('reloadButton'),
  moveUpButton: document.getElementById('moveUpButton'),
  moveDownButton: document.getElementById('moveDownButton'),
  duplicateButton: document.getElementById('duplicateButton'),
  deleteButton: document.getElementById('deleteButton')
};

const context = elements.canvas.getContext('2d');
const waveformContext = elements.waveformCanvas.getContext('2d');
const lyricsRenderCache = createLyricsRenderCache({ maxLayers: 4 });
const loadingSplashMessages = [
  'Loading Kr8 Core',
  'Importing visual styles',
  'Indexing layers',
  'Binding audio engine',
  'Preparing render graph',
  'Warming up Kr8 Studio'
];
const MIN_INITIAL_SPLASH_MS = 1800;
const loadingSplashStartedAt = performance.now();
let loadingSplashTimer = startLoadingSplash();
let loadingSplashCompleted = false;
const coverLabController = createCoverLabController({
  getProject: () => state.project,
  getSongContext: getCoverLabSongContext,
  onSettingsChange: updateCoverLabSettings,
  onProjectApplied: applyCoverLabProject,
  onStatus: (message, error) => {
    if (error) setStatus(`Cover Lab: ${message}`);
  }
});
const lyricsEditorController = createLyricsEditorController({
  getLyricsDocument: () => state.lyrics.document,
  getCues: () => state.lyrics.sourceCues,
  getProjectName: () => state.project?.name || 'kr8-lyrics',
  getAudioState: () => ({
    currentTime: state.audio.preview.currentTime,
    duration: getAudioDuration(),
    playing: state.audio.preview.playing,
    waveformPeaks: state.audio.waveformPeaks
  }),
  onPlayPause: togglePlayback,
  onSeek: (time) => seekToTime(time, { status: 'Lyrics Editor seek' }),
  onPreviewChange: previewLyricsEditorCues,
  onApply: applyLyricsEditorDocument,
  onSave: saveProject,
  onStatus: (message, error) => {
    if (error) setStatus(`Lyrics Editor: ${message}`);
  }
});

elements.openButton.addEventListener('click', openProjectWithPicker);

elements.saveButton.addEventListener('click', saveProject);
elements.reloadButton.addEventListener('click', () => loadProject(state.projectId));
elements.playButton.addEventListener('click', togglePlayback);
elements.seekBackButton.addEventListener('click', () => seekRelative(-5));
elements.seekForwardButton.addEventListener('click', () => seekRelative(5));
elements.muteButton.addEventListener('click', toggleMute);
elements.volumeSlider.addEventListener('input', updateVolumeFromSlider);
elements.timeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    seekToTime(parseTimeInput(elements.timeInput.value), { status: 'Jumped to time' });
  } else if (event.key === 'Escape') {
    elements.timeInput.value = formatTime(state.audio.preview.currentTime);
    elements.timeInput.blur();
  }
});
elements.timeInput.addEventListener('change', () => {
  seekToTime(parseTimeInput(elements.timeInput.value), { status: 'Jumped to time' });
});
elements.addLyricsButton.addEventListener('click', openLyricsEditor);
elements.importTkMusicButton.addEventListener('click', openTkMusicLibrary);
elements.importAudioButton.addEventListener('click', chooseAudioFile);
elements.audioImportChooseButton.addEventListener('click', chooseAudioFile);
elements.audioFileInput.addEventListener('change', () => {
  const [file] = elements.audioFileInput.files || [];
  if (file) prepareAudioImport(file);
  elements.audioFileInput.value = '';
});
elements.audioImportCloseButton.addEventListener('click', closeAudioImport);
elements.audioImportCancelButton.addEventListener('click', closeAudioImport);
elements.audioImportRunButton.addEventListener('click', runAudioImport);
elements.audioImportPanel.addEventListener('click', (event) => {
  if (event.target === elements.audioImportPanel) closeAudioImport();
});
elements.stageFrame.addEventListener('dragenter', handleAudioDragEnter);
elements.stageFrame.addEventListener('dragover', handleAudioDragOver);
elements.stageFrame.addEventListener('dragleave', handleAudioDragLeave);
elements.stageFrame.addEventListener('drop', handleAudioDrop);
elements.createCoverButton.addEventListener('click', () => coverLabController.open());
elements.tkMusicLibraryCloseButton.addEventListener('click', closeTkMusicLibrary);
elements.tkMusicLibraryCancelButton.addEventListener('click', closeTkMusicLibrary);
elements.tkMusicLibraryRefreshButton.addEventListener('click', () => loadTkMusicLibrary({ refresh: true }));
elements.tkMusicLibrarySearch.addEventListener('input', () => {
  state.tkMusicLibrary.query = elements.tkMusicLibrarySearch.value;
  renderTkMusicLibrary();
});
elements.tkMusicLibrarySort.addEventListener('change', () => {
  state.tkMusicLibrary.sort = elements.tkMusicLibrarySort.value;
  renderTkMusicLibrary();
});
elements.tkMusicLibraryReadyOnly.addEventListener('change', () => {
  state.tkMusicLibrary.readyOnly = elements.tkMusicLibraryReadyOnly.checked;
  renderTkMusicLibrary();
});
elements.tkMusicManualImportButton.addEventListener('click', importTkMusicManualId);
elements.tkMusicManualIdInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  importTkMusicManualId();
});
elements.tkMusicLibraryPanel.addEventListener('click', (event) => {
  if (event.target === elements.tkMusicLibraryPanel) closeTkMusicLibrary();
});
elements.saveTemplateButton.addEventListener('click', saveProjectTemplateGlobal);
elements.applyTemplateButton.addEventListener('click', applyProjectTemplateGlobal);
elements.compositionFormatSelect.addEventListener('change', updateCompositionFormat);
elements.exportButton.addEventListener('click', openExportPanel);
elements.reelModeButton.addEventListener('click', openReelMode);
elements.exportCloseButton.addEventListener('click', closeExportPanel);
elements.exportCancelButton.addEventListener('click', cancelOrCloseExportPanel);
elements.exportRunButton.addEventListener('click', runExportPanel);
elements.exportHeadlessMp4Button.addEventListener('click', runHeadlessMp4Export);
elements.exportDirectMp4Button.addEventListener('click', runDirectMp4Export);
elements.exportRenderMp4Button.addEventListener('click', renderLastExportMp4Draft);
elements.exportCopyPathButton.addEventListener('click', copyLastExportPath);
elements.exportOpenFolderButton.addEventListener('click', openLastExportFolder);
elements.exportHistoryRefreshButton.addEventListener('click', loadExportHistory);
elements.exportPresetSelect.addEventListener('change', applyExportPreset);
for (const input of [elements.exportStartInput, elements.exportEndInput, elements.exportFpsInput]) {
  input.addEventListener('input', () => {
    elements.exportPresetSelect.value = 'custom-range';
    updateExportSummary();
    syncExportReviewState();
  });
}
for (const button of elements.exportFpsButtons) {
  button.addEventListener('click', () => {
    elements.exportFpsInput.value = button.dataset.fps || '12';
    elements.exportPresetSelect.value = 'custom-range';
    updateExportSummary();
    syncExportReviewState();
  });
}
elements.coverFileInput.addEventListener('change', importSelectedCoverFile);
elements.coverVideoFileInput.addEventListener('change', importSelectedCoverVideoFile);
elements.textTextureFileInput.addEventListener('change', importSelectedTextTextureFile);
elements.lyricsSearch.addEventListener('input', () => {
  state.lyrics.filter = elements.lyricsSearch.value;
  renderLyricsNavigator();
});
elements.moveUpButton.addEventListener('click', () => moveSelected(1));
elements.moveDownButton.addEventListener('click', () => moveSelected(-1));
elements.duplicateButton.addEventListener('click', duplicateSelected);
elements.deleteButton.addEventListener('click', deleteSelected);
elements.timelineScrubber.addEventListener('input', () => {
  state.audio.userScrubbing = true;
  updateTimeline(Number(elements.timelineScrubber.value), getAudioDuration());
});
elements.timelineScrubber.addEventListener('change', () => seekToTime(Number(elements.timelineScrubber.value), { status: 'Seeked' }));
elements.timelineTrack.addEventListener('pointerdown', seekFromTimelinePointer);
elements.waveformCanvas.addEventListener('pointerdown', seekFromTimelinePointer);
elements.canvas.addEventListener('pointerdown', beginTextCanvasInteraction);
elements.canvas.addEventListener('dblclick', focusSelectedTextEditor);
window.addEventListener('pointermove', updateTextCanvasInteraction);
window.addEventListener('pointerup', endTextCanvasInteraction);
window.addEventListener('resize', () => {
  if (state.project) fitStageCanvasToViewport();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && lyricsEditorController.isOpen()) return;
  if (event.key === 'Escape' && !elements.tkMusicLibraryPanel.hidden) closeTkMusicLibrary();
  else if (event.key === 'Escape' && coverLabController.isOpen()) coverLabController.close();
});

await loadSystemFontFamilies();
await loadProject();
await runHeadlessExportFromQuery();

function startLoadingSplash() {
  if (!elements.loadingSplash || !elements.loadingSplashLine) return 0;
  let index = 0;
  elements.loadingSplashLine.textContent = loadingSplashMessages[index];
  return window.setInterval(() => {
    index = (index + 1) % loadingSplashMessages.length;
    elements.loadingSplashLine.textContent = loadingSplashMessages[index];
  }, 520);
}

function setLoadingSplashMessage(message) {
  if (!elements.loadingSplashLine) return;
  elements.loadingSplashLine.textContent = message;
}

async function hideLoadingSplash(options = {}) {
  if (loadingSplashTimer) {
    window.clearInterval(loadingSplashTimer);
    loadingSplashTimer = 0;
  }
  if (!elements.loadingSplash) return;
  setLoadingSplashMessage('Opening workspace');
  const minDuration = options.initial === true ? MIN_INITIAL_SPLASH_MS : 0;
  const remaining = Math.max(0, minDuration - (performance.now() - loadingSplashStartedAt));
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
  elements.loadingSplash.classList.add('is-hidden');
  window.setTimeout(() => {
    elements.loadingSplash.hidden = true;
  }, 480);
}

async function loadSystemFontFamilies(options = {}) {
  state.fonts.status = 'loading';
  setLoadingSplashMessage('Scanning system fonts');
  try {
    const response = await fetch(`/api/system/fonts${options.refresh ? '?refresh=1' : ''}`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.fonts.families = normalizeFontFamilyOptions(payload.fonts);
    state.fonts.faces = Array.isArray(payload.fontFaces) ? payload.fontFaces : [];
    state.fonts.status = 'ready';
    state.fonts.error = '';
  } catch (error) {
    state.fonts.families = normalizeFontFamilyOptions([]);
    state.fonts.faces = [];
    state.fonts.status = 'fallback';
    state.fonts.error = error.message || String(error);
  }
}

async function loadBrowserFontFamilies() {
  if (!('queryLocalFonts' in window)) return;
  try {
    state.fonts.status = 'loading';
    const fonts = await window.queryLocalFonts();
    state.fonts.families = normalizeFontFamilyOptions([
      ...state.fonts.families,
      ...fonts.map((font) => font.family)
    ]);
    state.fonts.status = 'ready';
    state.fonts.error = '';
  } catch (error) {
    state.fonts.status = state.fonts.families.length ? 'ready' : 'fallback';
    state.fonts.error = error.message || String(error);
    setStatus('Browser font access was not granted; using server font list');
  }
}

async function loadServerFontFaceByFamily(fontFamily) {
  const family = String(fontFamily || '').trim();
  if (!family || !('FontFace' in window) || !document.fonts) return false;
  const faces = findMatchingFontFaces(family, state.fonts.faces);
  if (!faces.length) return false;
  let loaded = false;
  for (const face of faces) {
    const loadedFaceId = `${face.id}:${family.toLowerCase()}`;
    if (!face.id || !face.url || loadedServerFontFaceIds.has(loadedFaceId)) continue;
    try {
      const fontFace = new FontFace(family, `url("${face.url}")`);
      await fontFace.load();
      document.fonts.add(fontFace);
      loadedServerFontFaceIds.add(loadedFaceId);
      loaded = true;
    } catch (error) {
      state.fonts.error = `Font "${family}" could not be loaded: ${error.message || error}`;
      console.warn(state.fonts.error);
    }
  }
  if (loaded && document.fonts.ready) {
    await document.fonts.ready;
  }
  return loaded;
}

async function loadProjectFontFaces() {
  if (!state.project?.layers) return;
  const families = state.project.layers
    .flatMap((layer) => [
      layer.properties?.typography?.fontFamily,
      layer.properties?.fontFamily
    ])
    .filter(Boolean);
  await Promise.all([...new Set(families)].map((family) => loadServerFontFaceByFamily(family)));
}

async function loadProject(projectId = '') {
  setStatus('Loading project...');
  setLoadingSplashMessage('Loading project file');
  const response = projectId
    ? await fetch('/api/project/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId })
      })
    : await fetch('/api/project');
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();

  await applyLoadedProject(payload);
}

async function openProjectWithPicker() {
  if (state.dirty && !window.confirm('This project has unsaved changes. Open another project anyway?')) return;
  elements.openButton.disabled = true;
  setStatus('Choose a Kr8 project...');
  try {
    const response = await fetch('/api/project/select', { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 501) {
      const input = window.prompt('Project ID relative to KR8_PROJECTS_ROOT', state.projectId);
      if (input) await loadProject(input);
      else setStatus('Open cancelled');
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Project selection failed.');
    if (payload.cancelled) {
      setStatus('Open cancelled');
      return;
    }
    await applyLoadedProject(payload);
  } catch (error) {
    setStatus(`Open failed: ${error.message || error}`);
  } finally {
    elements.openButton.disabled = false;
  }
}

async function applyLoadedProject(payload) {

  state.project = ensureProjectTypographyPresets(
    ensureProjectTextStylePresets(
      ensureProjectSceneVisualizerPresets(
        ensureProjectVisualizerStylePresets(ensureProjectLyricsStylePresets(payload.project))
      )
    )
  );
  state.projectId = payload.projectId || '';
  state.projectPath = payload.projectPath;
  state.projectDirectory = payload.projectDirectory;
  state.project.layers = normalizeLayerOrder(state.project.layers);
  state.renderProject = state.project;
  state.selectedLayerId = state.project.layers[0]?.id || '';
  state.imageCache.clear();
  state.videoCache.clear();
  state.videoSyncKeys.clear();
  state.dirty = false;
  setLoadingSplashMessage('Binding audio and lyrics');
  await Promise.all([loadProjectAudio(), loadProjectLyrics()]);
  setLoadingSplashMessage('Loading project fonts');
  await loadProjectFontFaces();
  setLoadingSplashMessage('Loading visual presets');
  await Promise.all([
    loadVisualizerPresetLibrary(),
    loadLyricsStylePresetLibrary()
  ]);
  state.renderProject = buildRenderProject();

  setLoadingSplashMessage('Opening workspace');
  renderApp();
  if (!loadingSplashCompleted) {
    loadingSplashCompleted = true;
    await hideLoadingSplash({ initial: true });
  }
  setStatus('Project loaded');
  refreshReelModeAvailability();
}

async function refreshReelModeAvailability() {
  if (!elements.reelModeButton) return;
  elements.reelModeButton.disabled = true;
  elements.reelModeButton.title = 'Checking the latest final MP4 export...';
  try {
    const response = await fetch('/api/reel/context');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Reel Mode unavailable.');
    elements.reelModeButton.disabled = !payload.available;
    elements.reelModeButton.title = payload.available
      ? `Open Reel Mode with ${payload.source.relativePath}`
      : 'Reel Mode requires a final MP4 export';
  } catch (error) {
    elements.reelModeButton.title = `Reel Mode unavailable: ${error.message || error}`;
  }
}

function openReelMode() {
  if (elements.reelModeButton.disabled) return;
  const reelWindow = window.open('/reel/index.html', 'kr8-reel-mode', 'popup,width=1440,height=920,resizable=yes,scrollbars=yes');
  reelWindow?.focus();
}

function chooseAudioFile() {
  if (state.audioImport.busy) return;
  elements.audioFileInput.click();
}

function prepareAudioImport(file) {
  if (!isSupportedAudioFile(file)) {
    setStatus('Import Audio supports MP3, WAV, FLAC, M4A, AAC and OGG files');
    elements.stageFrame.classList.remove('audio-drop-active');
    return;
  }
  const currentAudio = getAudioAsset();
  const createProject = isBlankStartupProject();
  state.audioImport.file = file;
  state.audioImport.mode = createProject ? 'create' : 'replace';
  state.audioImport.complete = false;
  state.audioImport.result = null;

  const filenameTitle = String(file.name || 'Untitled Track').replace(/\.[^.]+$/, '');
  elements.audioImportFilename.textContent = `${file.name} (${formatFileSize(file.size)})`;
  elements.audioImportTitleInput.value = createProject
    ? filenameTitle
    : String(state.project?.metadata?.title || filenameTitle);
  elements.audioImportArtistInput.value = createProject
    ? ''
    : String(state.project?.metadata?.artist || '');
  elements.audioImportFormatSelect.value = getCompositionFormatId(state.project?.composition) === 'custom'
    ? 'landscape-1080p'
    : getCompositionFormatId(state.project?.composition);
  elements.audioImportFormatField.hidden = !createProject;
  elements.audioImportMetadataCheckbox.checked = createProject;
  elements.audioImportMetadataCheckbox.disabled = createProject;
  elements.audioImportCurrent.hidden = !currentAudio;
  elements.audioImportResult.hidden = true;
  elements.audioImportResult.textContent = '';

  if (createProject) {
    elements.audioImportMode.textContent = 'Create Project from Audio';
    elements.audioImportRunButton.textContent = 'Create Project';
    elements.audioImportCurrent.textContent = '';
    elements.audioImportNotice.textContent =
      'A new portable .kr8 project will be created. The blank startup project will remain unchanged.';
  } else if (currentAudio) {
    const cues = state.lyrics.sourceCues.length || state.lyrics.cues.length;
    const sections = (state.project?.scenes || []).length;
    elements.audioImportMode.textContent = 'Replace current project audio';
    elements.audioImportRunButton.textContent = 'Replace Audio and Keep Timings';
    elements.audioImportCurrent.replaceChildren(
      createAudioImportSummary(
        'Current audio',
        `${audioAssetFilename(currentAudio)} - ${formatTime(audioAssetDuration(currentAudio))}`
      ),
      createAudioImportSummary('Timeline data', `${cues} lyric cue(s), ${sections} section(s)`)
    );
    elements.audioImportNotice.textContent =
      'Lyrics and section timings will be preserved. Cues beyond the new duration will be reported as warnings.';
  } else {
    elements.audioImportMode.textContent = 'Add audio to current project';
    elements.audioImportRunButton.textContent = 'Import Audio';
    elements.audioImportCurrent.textContent = '';
    elements.audioImportNotice.textContent =
      'The audio will be copied into this project and used by the existing player, waveform and exporters.';
  }

  elements.audioImportPanel.hidden = false;
  elements.audioImportTitleInput.focus();
}

function closeAudioImport() {
  if (state.audioImport.busy) return;
  elements.audioImportPanel.hidden = true;
  state.audioImport.file = null;
  state.audioImport.result = null;
}

async function runAudioImport() {
  const file = state.audioImport.file;
  if (!file || state.audioImport.busy) return;
  state.audioImport.busy = true;
  setAudioImportBusy(true);
  elements.audioImportResult.hidden = true;
  elements.audioImportNotice.textContent = 'Uploading and validating the audio with FFprobe...';
  setStatus(`Importing ${file.name}...`);

  try {
    const currentAudio = getAudioAsset();
    const params = new URLSearchParams({
      filename: file.name,
      mode: state.audioImport.mode,
      title: elements.audioImportTitleInput.value.trim(),
      artist: elements.audioImportArtistInput.value.trim(),
      formatId: elements.audioImportFormatSelect.value,
      updateMetadata: elements.audioImportMetadataCheckbox.checked ? '1' : '0'
    });
    if (currentAudio && state.audioImport.mode === 'replace') params.set('replace', '1');
    const response = await fetch(`/api/assets/import-audio?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name
      },
      body: file
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Audio import failed.');

    await applyLoadedProject(payload);
    if (!payload.saved) {
      state.dirty = true;
      state.renderProject = buildRenderProject();
      renderApp();
    }
    state.audioImport.result = payload;
    state.audioImport.complete = true;
    renderAudioImportResult(payload);
    elements.audioImportNotice.textContent = payload.createdProject
      ? 'Project created and saved. You can now import a cover or open Lyrics Editor.'
      : 'Audio replaced in memory. Save the project to persist this change.';
    setStatus(payload.createdProject ? 'Local audio project created' : 'Audio imported - save project to persist');
  } catch (error) {
    state.audioImport.complete = false;
    elements.audioImportResult.hidden = false;
    elements.audioImportResult.textContent = `Import failed: ${error.message || error}`;
    elements.audioImportResult.classList.add('error');
    elements.audioImportNotice.textContent = 'The current project and its audio were not changed.';
    setStatus(`Audio import failed: ${error.message || error}`);
  } finally {
    state.audioImport.busy = false;
    setAudioImportBusy(false);
  }
}

function renderAudioImportResult(payload) {
  const audio = payload.audio || {};
  const details = [
    'Audio imported successfully',
    `Title: ${audio.title || elements.audioImportTitleInput.value.trim() || '-'}`,
    `Artist: ${audio.artist || elements.audioImportArtistInput.value.trim() || '-'}`,
    `Duration: ${formatTime(audio.duration || 0)}`,
    `Format: ${[audio.format, audio.codec].filter(Boolean).join(' / ') || '-'}`,
    `Playback: ${audio.proxyGenerated ? 'FFmpeg WAV proxy' : 'original file'}`,
    `Waveform: ${state.audio.waveformPeaks.length ? 'ready' : state.audio.status}`
  ];
  if (audio.embeddedCover) {
    details.push('Embedded cover detected. Automatic extraction is not enabled; use Import Cover.');
  }
  for (const warning of payload.warnings || []) details.push(`Warning: ${warning}`);
  elements.audioImportResult.classList.remove('error');
  elements.audioImportResult.textContent = details.join('\n');
  elements.audioImportResult.hidden = false;
}

function setAudioImportBusy(busy) {
  elements.audioImportRunButton.disabled = busy || state.audioImport.complete;
  elements.audioImportCancelButton.disabled = busy;
  elements.audioImportCloseButton.disabled = busy;
  elements.audioImportChooseButton.disabled = busy;
  elements.audioImportTitleInput.disabled = busy;
  elements.audioImportArtistInput.disabled = busy;
  elements.audioImportFormatSelect.disabled = busy;
  elements.audioImportMetadataCheckbox.disabled = busy || state.audioImport.mode === 'create';
  elements.audioImportCancelButton.textContent = state.audioImport.complete ? 'Close' : 'Cancel';
  elements.audioImportRunButton.textContent = state.audioImport.complete
    ? 'Imported'
    : busy
    ? 'Importing...'
    : state.audioImport.mode === 'create'
      ? 'Create Project'
      : getAudioAsset()
        ? 'Replace Audio and Keep Timings'
        : 'Import Audio';
}

function handleAudioDragEnter(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  state.audioImport.dragDepth += 1;
  elements.stageFrame.classList.add('audio-drop-active');
}

function handleAudioDragOver(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function handleAudioDragLeave(event) {
  if (!hasDraggedFiles(event)) return;
  state.audioImport.dragDepth = Math.max(0, state.audioImport.dragDepth - 1);
  if (!state.audioImport.dragDepth) elements.stageFrame.classList.remove('audio-drop-active');
}

function handleAudioDrop(event) {
  event.preventDefault();
  state.audioImport.dragDepth = 0;
  elements.stageFrame.classList.remove('audio-drop-active');
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length !== 1) {
    setStatus('Drop exactly one supported audio file');
    return;
  }
  prepareAudioImport(files[0]);
}

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

function isSupportedAudioFile(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return AUDIO_FILE_EXTENSIONS.has(extension);
}

function isBlankStartupProject() {
  if (state.project?.id === 'kr8_blank_project') return true;
  return !(state.project?.assets || []).length && !(state.project?.layers || []).length;
}

function createAudioImportSummary(label, value) {
  const line = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = `${label}: `;
  line.append(heading, document.createTextNode(value));
  return line;
}

function audioAssetFilename(asset) {
  return asset?.metadata?.originalFilename || String(asset?.path || '').split('/').pop() || 'Audio';
}

function audioAssetDuration(asset) {
  return Number(asset?.metadata?.duration || state.project?.composition?.duration || 0);
}

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

async function openTkMusicLibrary() {
  elements.tkMusicLibraryPanel.hidden = false;
  elements.tkMusicLibrarySearch.focus();
  if (state.tkMusicLibrary.status === 'idle' || state.tkMusicLibrary.status === 'error') {
    await loadTkMusicLibrary();
  } else {
    renderTkMusicLibrary();
  }
}

function closeTkMusicLibrary() {
  if (state.tkMusicLibrary.importingId) return;
  elements.tkMusicLibraryPanel.hidden = true;
}

async function loadTkMusicLibrary(options = {}) {
  state.tkMusicLibrary.status = 'loading';
  state.tkMusicLibrary.error = '';
  renderTkMusicLibrary();
  try {
    const query = options.refresh ? '?refresh=1' : '';
    const response = await fetch(`/api/source-providers/tkmusic/tracks${query}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'TKMusic library is unavailable.');
    state.tkMusicLibrary.tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
    state.tkMusicLibrary.status = 'ready';
    elements.tkMusicLibraryStatus.textContent = payload.skipped
      ? `${payload.skipped} malformed library entries were skipped.`
      : '';
  } catch (error) {
    state.tkMusicLibrary.status = 'error';
    state.tkMusicLibrary.error = error.message || String(error);
  }
  renderTkMusicLibrary();
}

function renderTkMusicLibrary() {
  const library = state.tkMusicLibrary;
  elements.tkMusicLibraryRefreshButton.disabled = library.status === 'loading' || Boolean(library.importingId);
  elements.tkMusicManualImportButton.disabled = Boolean(library.importingId);
  elements.tkMusicLibraryCloseButton.disabled = Boolean(library.importingId);
  elements.tkMusicLibraryCancelButton.disabled = Boolean(library.importingId);
  elements.tkMusicLibraryGrid.replaceChildren();

  if (library.status === 'loading') {
    elements.tkMusicLibraryCount.textContent = 'Scanning TKMusic...';
    elements.tkMusicLibraryStatus.textContent = 'Reading the local provider library.';
    appendTkMusicLibraryEmptyState('Loading tracks...');
    return;
  }
  if (library.status === 'error') {
    elements.tkMusicLibraryCount.textContent = 'Library unavailable';
    elements.tkMusicLibraryStatus.textContent = library.error;
    appendTkMusicLibraryEmptyState('TKMusic could not be read. Check the configured library path.');
    return;
  }

  const queryTokens = library.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visibleTracks = library.tracks
    .filter((track) => !library.readyOnly || track.availability?.audio)
    .filter((track) => {
      if (!queryTokens.length) return true;
      const haystack = [track.title, track.artist, track.id, track.mood, track.model, track.tags]
        .join(' ')
        .toLocaleLowerCase();
      return queryTokens.every((token) => haystack.includes(token));
    })
    .sort(tkMusicTrackComparator(library.sort));

  elements.tkMusicLibraryCount.textContent = `${visibleTracks.length} of ${library.tracks.length} tracks`;
  if (!visibleTracks.length) {
    appendTkMusicLibraryEmptyState('No tracks match the current search.');
    return;
  }
  for (const track of visibleTracks) {
    elements.tkMusicLibraryGrid.append(createTkMusicTrackCard(track));
  }
}

function appendTkMusicLibraryEmptyState(message) {
  const empty = document.createElement('div');
  empty.className = 'empty-state tkmusic-library-empty';
  empty.textContent = message;
  elements.tkMusicLibraryGrid.append(empty);
}

function createTkMusicTrackCard(track) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'tkmusic-track-card';
  card.disabled = Boolean(state.tkMusicLibrary.importingId);
  card.title = `Import ${track.title}`;
  card.addEventListener('click', () => importTkMusicTrack(track.id));

  const artwork = document.createElement('span');
  artwork.className = 'tkmusic-track-artwork';
  if (track.coverUrl) {
    const image = document.createElement('img');
    image.src = track.coverUrl;
    image.alt = '';
    image.loading = 'lazy';
    artwork.append(image);
  } else {
    artwork.textContent = 'TK';
  }

  const body = document.createElement('span');
  body.className = 'tkmusic-track-body';
  const heading = document.createElement('span');
  heading.className = 'tkmusic-track-heading';
  const title = document.createElement('strong');
  title.textContent = track.title || 'Untitled';
  heading.append(title);
  if (track.isPinned) {
    const pinned = document.createElement('span');
    pinned.className = 'tkmusic-track-badge accent';
    pinned.textContent = 'Pinned';
    heading.append(pinned);
  }

  const meta = document.createElement('span');
  meta.className = 'tkmusic-track-meta';
  meta.textContent = [
    track.artist || 'TKMusic',
    track.duration > 0 ? formatTime(track.duration) : '',
    formatTkMusicDate(track.createdAt)
  ].filter(Boolean).join(' / ');

  const tags = document.createElement('span');
  tags.className = 'tkmusic-track-tags';
  tags.textContent = track.tags || track.mood || 'No tags';
  tags.title = track.tags || track.mood || '';

  const badges = document.createElement('span');
  badges.className = 'tkmusic-track-assets';
  badges.append(
    createTkMusicBadge(track.availability?.audio ? 'Audio' : 'No audio', !track.availability?.audio),
    createTkMusicBadge(track.availability?.lyrics ? 'Lyrics' : 'No lyrics', !track.availability?.lyrics),
    createTkMusicBadge(track.model || track.mood || 'TKMusic', false)
  );

  const id = document.createElement('span');
  id.className = 'tkmusic-track-id';
  id.textContent = track.id;

  body.append(heading, meta, tags, badges, id);
  const action = document.createElement('span');
  action.className = 'tkmusic-track-import';
  action.textContent = state.tkMusicLibrary.importingId === track.id ? 'Importing...' : 'Import';
  card.append(artwork, body, action);
  return card;
}

function createTkMusicBadge(label, missing) {
  const badge = document.createElement('span');
  badge.className = `tkmusic-track-badge${missing ? ' missing' : ''}`;
  badge.textContent = label;
  return badge;
}

function tkMusicTrackComparator(mode) {
  const textCompare = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
  const newest = (left, right) => (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0);
  if (mode === 'title') return (left, right) => textCompare(left.title, right.title);
  if (mode === 'artist') return (left, right) => textCompare(left.artist, right.artist) || textCompare(left.title, right.title);
  if (mode === 'pinned') return (left, right) => Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned)) || newest(left, right);
  return newest;
}

function formatTkMusicDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp));
}

function importTkMusicManualId() {
  const trackId = elements.tkMusicManualIdInput.value.trim();
  if (!trackId) {
    elements.tkMusicLibraryStatus.textContent = 'Enter a TKMusic or Suno track ID.';
    elements.tkMusicManualIdInput.focus();
    return;
  }
  importTkMusicTrack(trackId);
}

async function importTkMusicTrack(trackId) {
  if (!trackId || state.tkMusicLibrary.importingId) return;
  if (state.dirty && !window.confirm('This project has unsaved changes. Import another TKMusic track anyway?')) return;
  state.tkMusicLibrary.importingId = trackId;
  elements.tkMusicLibraryStatus.textContent = 'Creating or opening the Kr8 project...';
  renderTkMusicLibrary();
  setStatus('Importing TKMusic track...');
  try {
    const response = await fetch('/api/projects/import-tkmusic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'TKMusic import failed.');
    await applyLoadedProject(payload);
    elements.tkMusicLibraryPanel.hidden = true;
    elements.tkMusicManualIdInput.value = '';
    if (payload.openedExisting) {
      setStatus('Existing Kr8 project opened');
    } else if (payload.warnings?.length) {
      setStatus(`Imported with warnings: ${payload.warnings.join('; ')}`);
    } else {
      setStatus('TKMusic track imported');
    }
  } catch (error) {
    state.tkMusicLibrary.error = error.message || String(error);
    elements.tkMusicLibraryStatus.textContent = state.tkMusicLibrary.error;
    setStatus(`TKMusic import failed: ${state.tkMusicLibrary.error}`);
  } finally {
    state.tkMusicLibrary.importingId = '';
    renderTkMusicLibrary();
  }
}

function getFontFamilyOptions(currentValue = '') {
  return normalizeFontFamilyOptions([
    ...FALLBACK_FONT_FAMILIES,
    ...state.fonts.families,
    currentValue
  ]);
}

function normalizeFontFamilyOptions(families) {
  const seen = new Map();
  for (const family of families) {
    const name = String(family || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function saveProjectTemplateGlobal() {
  if (!state.project) return;
  const defaultName = state.project.metadata?.appliedProjectTemplateName || state.project.name || 'Kr8 Look';
  const name = window.prompt('Global look template name', defaultName);
  if (!name?.trim()) return;
  setStatus('Saving global look template...');
  const response = await fetch('/api/project-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  const payload = await response.json();
  if (!response.ok) {
    setStatus(payload.error || 'Global look template save failed');
    return;
  }
  setStatus(`Global look template saved: ${payload.template.name}`);
}

async function applyProjectTemplateGlobal() {
  if (!state.project) return;
  const response = await fetch('/api/project-templates');
  const payload = await response.json();
  if (!response.ok) {
    setStatus(payload.error || 'Global look templates failed');
    return;
  }
  const templates = payload.library?.templates || [];
  if (!templates.length) {
    setStatus('No global look templates saved yet');
    return;
  }
  const menu = templates.map((template, index) => `${index + 1}. ${template.name}`).join('\n');
  const input = window.prompt(`Apply global look template:\n${menu}`, '1');
  if (!input) return;
  const index = Math.max(0, Math.min(templates.length - 1, Number(input) - 1));
  const template = templates[index];
  if (!template) return;
  setStatus(`Applying global look template: ${template.name}...`);
  const applyResponse = await fetch('/api/project-templates/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId: template.id })
  });
  const applyPayload = await applyResponse.json();
  if (!applyResponse.ok) {
    setStatus(applyPayload.error || 'Global look template apply failed');
    return;
  }
  state.project = ensureProjectTypographyPresets(
    ensureProjectTextStylePresets(
      ensureProjectSceneVisualizerPresets(
        ensureProjectVisualizerStylePresets(ensureProjectLyricsStylePresets(applyPayload.project))
      )
    )
  );
  state.project.layers = normalizeLayerOrder(state.project.layers);
  state.renderProject = buildRenderProject();
  state.selectedLayerId = state.project.layers.some((layer) => layer.id === state.selectedLayerId)
    ? state.selectedLayerId
    : state.project.layers[0]?.id || '';
  state.imageCache.clear();
  state.videoCache.clear();
  state.videoSyncKeys.clear();
  markDirty();
  setStatus(`Global look template applied: ${template.name}`);
}

function updateCompositionFormat() {
  const formatId = elements.compositionFormatSelect.value;
  if (!state.project || formatId === 'custom') return;
  state.project = applyCompositionFormat(state.project, formatId);
  state.renderProject = buildRenderProject();
  markDirty();
  setStatus(`Composition format set: ${elements.compositionFormatSelect.selectedOptions[0]?.textContent || formatId}`);
}

function openExportPanel() {
  if (!state.project) return;
  elements.exportPanel.hidden = false;
  selectRecommendedExportPreset();
  applyExportPreset();
  loadExportHistory();
}

function closeExportPanel() {
  if (state.exportControl.busy) return;
  elements.exportPanel.hidden = true;
}

async function cancelOrCloseExportPanel() {
  if (!state.exportControl.busy) {
    closeExportPanel();
    return;
  }
  state.exportControl.cancelRequested = true;
  elements.exportCancelButton.disabled = true;
  elements.exportCancelButton.textContent = 'Cancelling...';
  setStatus('Cancelling export...');
  if (state.exportControl.mode === 'headless' && state.exportControl.sessionId) {
    try {
      await cancelHeadlessMp4Job(state.exportControl.sessionId);
    } catch (error) {
      setStatus(`Headless cancel failed: ${error.message || error}`);
    }
  }
}

function applyExportPreset() {
  const duration = getAudioDuration();
  const currentTime = Math.min(state.audio.preview.currentTime, Math.max(0, duration));
  const activeScene = getActivePreviewScene();
  const preset = elements.exportPresetSelect.value;

  if (preset === 'current-frame') {
    setExportRange(currentTime, currentTime, 1);
  } else if (preset === 'png-debug-2s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 2), 6);
  } else if (preset === 'direct-mp4-raw-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-raw-nvenc-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-composite-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-composite-nvenc-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-fast-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-30s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 30), 30);
  } else if (preset === 'direct-mp4-full') {
    setExportRange(0, duration, 30);
  } else if (preset === 'direct-mp4-raw-nvenc-full') {
    setExportRange(0, duration, 30);
  } else if (preset === 'direct-mp4-composite-full') {
    setExportRange(0, duration, 30);
  } else if (preset === 'direct-mp4-composite-nvenc-full') {
    setExportRange(0, duration, 30);
  } else if (preset === 'preview-2s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 2), 6);
  } else if (preset === 'preview-5s') {
    setExportRange(currentTime, Math.min(duration, currentTime + 5), 12);
  } else if (preset === 'current-scene' && activeScene) {
    setExportRange(activeScene.start || 0, Math.min(duration, activeScene.end || duration), 6);
  } else if (preset === 'current-scene-draft' && activeScene) {
    setExportRange(activeScene.start || 0, Math.min(duration, activeScene.end || duration), 12);
  } else if (preset === 'current-scene') {
    setExportRange(currentTime, Math.min(duration, currentTime + 2), 6);
  } else if (preset === 'current-scene-draft') {
    setExportRange(currentTime, Math.min(duration, currentTime + 5), 12);
  }

  updateExportSummary();
  syncExportReviewState();
}

function setExportRange(start, end, fps) {
  elements.exportStartInput.value = formatNumber(start);
  elements.exportEndInput.value = formatNumber(end);
  elements.exportFpsInput.value = String(Math.max(1, Math.round(fps || 6)));
}

function updateExportSummary() {
  const options = readExportOptions();
  if (options.mode === 'frame') {
    elements.exportSummary.textContent = `Frame at ${formatTime(options.start)}. Output: PNG.`;
    return;
  }
  const capLabel = options.capped ? `, capped from ${options.requestedFrameCount}` : '';
  const spaceLabel = estimateExportStorageLabel(options.frameCount);
  const directFrames = Math.min(MAX_DIRECT_EXPORT_FRAMES, options.requestedFrameCount);
  const directCapLabel = directFrames < options.requestedFrameCount ? `, capped from ${options.requestedFrameCount}` : '';
  const warning = getExportPresetWarning(options.preset);
  const warningLabel = warning ? ` ${warning}` : '';
  elements.exportSummary.textContent = `Range ${formatTime(options.start)} - ${formatTime(options.end)}, ${options.fps} fps. PNG Debug: ${options.frameCount} frames${capLabel}, estimated ${spaceLabel}. Direct MP4: ${directFrames} frames${directCapLabel}.${warningLabel}`;
}

function selectRecommendedExportPreset() {
  if (!hasVisibleVideoLayer()) return;
  if (isCompositeDirectMp4Preset(elements.exportPresetSelect.value)) return;
  elements.exportPresetSelect.value = 'direct-mp4-composite-nvenc-30s';
}

function getExportPresetWarning(preset) {
  if (!hasVisibleVideoLayer() || isCompositeDirectMp4Preset(preset)) return '';
  if (preset.startsWith('direct-mp4')) {
    return 'Cover Video detected: Composite export is recommended.';
  }
  return '';
}

function updateExportReview(result) {
  state.lastExport = {
    ...result,
    optionsKey: result.optionsKey || exportOptionsKey(readExportOptions())
  };
  elements.exportReview.hidden = false;
  elements.exportReview.classList.remove('stale');
  elements.exportReviewMeta.textContent = result.type === 'frame'
    ? `1 frame at ${formatTime(result.start)}`
    : `${result.frameCount} frames, ${result.fps} fps, ${formatTime(result.start)} - ${formatTime(result.end)}`;
  elements.exportReviewPath.textContent = result.absolutePath || result.relativePath || '';
  const firstPreview = result.firstFrameDataUrl || '';
  const lastPreview = result.lastFrameDataUrl || result.firstFrameDataUrl || '';
  if (elements.exportReviewPreviews) {
    elements.exportReviewPreviews.hidden = !(firstPreview || lastPreview);
  }
  elements.exportReviewFirst.removeAttribute('src');
  elements.exportReviewLast.removeAttribute('src');
  if (firstPreview) elements.exportReviewFirst.src = firstPreview;
  if (lastPreview) elements.exportReviewLast.src = lastPreview;
  elements.exportRenderMp4Button.disabled = result.type !== 'clip';
  renderExportBenchmark(result.benchmark || null);
  if (result.metadataRelativePath) {
    elements.exportReviewPath.textContent = `${result.absolutePath || result.relativePath || ''} | metadata: ${result.metadataRelativePath}`;
  }
}

function syncExportReviewState() {
  if (!state.lastExport || elements.exportReview.hidden) return;
  const stale = state.lastExport.type === 'clip' && state.lastExport.optionsKey !== exportOptionsKey(readExportOptions());
  elements.exportReview.classList.toggle('stale', stale);
  if (stale) {
    elements.exportRenderMp4Button.disabled = true;
    elements.exportReviewMeta.textContent = 'Last clip uses different export settings';
  } else {
    elements.exportRenderMp4Button.disabled = state.lastExport.type !== 'clip';
    if (state.lastExport.type === 'clip') {
      elements.exportReviewMeta.textContent = `${state.lastExport.frameCount} frames, ${state.lastExport.fps} fps, ${formatTime(state.lastExport.start)} - ${formatTime(state.lastExport.end)}`;
    }
  }
}

async function copyLastExportPath() {
  const value = state.lastExport?.absolutePath || state.lastExport?.relativePath || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus('Export path copied');
  } catch {
    window.prompt('Export path', value);
  }
}

async function openLastExportFolder() {
  const value = state.lastExport?.absolutePath || '';
  if (!value) return;
  const response = await fetch('/api/exports/open-folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: value })
  });
  if (!response.ok) {
    setStatus(`Open folder failed: ${await response.text()}`);
    return;
  }
  setStatus('Export folder opened');
}

async function renderLastExportMp4Draft() {
  if (!state.lastExport || state.lastExport.type !== 'clip') return;
  if (state.lastExport.optionsKey !== exportOptionsKey(readExportOptions())) {
    syncExportReviewState();
    setStatus('Export the clip again before rendering MP4 for the current range.');
    return;
  }
  setExportButtonsDisabled(true);
  setStatus('Rendering MP4 draft...');
  try {
    const response = await fetch('/api/exports/mp4-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clipPath: state.lastExport.absolutePath })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || 'MP4 draft render failed');
      return;
    }
    updateExportReview({
      ...state.lastExport,
      type: 'video',
      absolutePath: payload.outputPath,
      relativePath: payload.relativePath,
      frameCount: payload.frameCount,
      fps: payload.fps,
      hasAudio: payload.hasAudio,
      metadataPath: payload.metadataPath,
      metadataRelativePath: payload.metadataRelativePath
    });
    elements.exportReviewMeta.textContent = `MP4 draft, ${payload.frameCount} frames, ${payload.fps} fps${payload.hasAudio ? ', audio' : ', no audio'}${payload.metadataRelativePath ? ', render log' : ''}`;
    setStatus(`MP4 draft rendered: ${payload.relativePath}`);
    await loadExportHistory();
  } catch (error) {
    setStatus(`MP4 draft render failed: ${error.message || error}`);
  } finally {
    setExportButtonsDisabled(false);
  }
}

function readExportOptions() {
  const duration = getAudioDuration();
  const preset = elements.exportPresetSelect.value;
  const start = clamp(Number(elements.exportStartInput.value || 0), 0, Math.max(0, duration));
  const end = clamp(Number(elements.exportEndInput.value || start), start, Math.max(start, duration));
  const fps = Math.max(1, Math.min(30, Math.round(Number(elements.exportFpsInput.value || 6))));
  const requestedFrameCount = Math.max(1, Math.ceil(Math.max(0, end - start) * fps));
  const frameCount = Math.min(MAX_EXPORT_FRAMES, requestedFrameCount);
  return {
    preset,
    mode: preset === 'current-frame' || end <= start ? 'frame' : 'clip',
    start,
    end,
    fps,
    frameCount,
    requestedFrameCount,
    capped: frameCount < requestedFrameCount
  };
}

function exportOptionsKey(options) {
  return [
    options.mode,
    formatNumber(options.start),
    formatNumber(options.end),
    options.fps,
    options.frameCount
  ].join('|');
}

function estimateExportStorageLabel(frameCount) {
  const estimatedBytes = Math.max(1, Number(frameCount || 1)) * 3 * 1024 * 1024;
  if (estimatedBytes >= 1024 * 1024 * 1024) {
    return `~${formatNumber(estimatedBytes / (1024 * 1024 * 1024))} GB`;
  }
  return `~${Math.round(estimatedBytes / (1024 * 1024))} MB`;
}

async function runExportPanel() {
  const options = readExportOptions();
  if (options.mode === 'frame') {
    await exportCurrentFrame(options.start);
  } else {
    await exportFrameSequence(options);
  }
}

async function runDirectMp4Export() {
  const options = readExportOptions();
  if (options.mode === 'frame') {
    setStatus('Direct MP4 requires a time range.');
    return;
  }
  const warning = getExportPresetWarning(options.preset);
  if (warning) setStatus(warning);
  await exportDirectMp4(buildDirectMp4Options(options));
}

async function runHeadlessMp4Export() {
  const options = readExportOptions();
  if (options.mode === 'frame') {
    setStatus('Headless MP4 requires a time range.');
    return;
  }
  const headlessOptions = buildDirectMp4Options(options);
  setExportButtonsDisabled(true);
  setStatus('Starting headless MP4 worker...');
  try {
    const response = await fetch('/api/exports/headless-mp4/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        options: {
          preset: options.preset,
          start: headlessOptions.start,
          end: headlessOptions.end,
          fps: headlessOptions.fps,
          frameCount: headlessOptions.frameCount,
          raw: headlessOptions.raw,
          composite: headlessOptions.composite,
          hardwareEncoder: headlessOptions.hardwareEncoder || '',
          fast: headlessOptions.fast === true,
          width: state.project.composition.width,
          height: state.project.composition.height
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Headless MP4 start failed');
    }
    state.exportControl = {
      busy: true,
      cancelRequested: false,
      sessionId: payload.jobId || '',
      mode: 'headless'
    };
    const result = await pollHeadlessMp4Job(payload.jobId);
    const exportResult = result.result?.export || result.result;
    if (!exportResult?.absolutePath && !exportResult?.outputPath) {
      throw new Error('Headless MP4 completed without an output path.');
    }
    updateExportReview({
      ...exportResult,
      type: 'video',
      absolutePath: exportResult.absolutePath || exportResult.outputPath,
      relativePath: exportResult.relativePath,
      start: headlessOptions.start,
      end: Math.min(headlessOptions.end, headlessOptions.start + (exportResult.frameCount || headlessOptions.frameCount) / headlessOptions.fps),
      fps: exportResult.fps || headlessOptions.fps,
      frameCount: exportResult.frameCount || headlessOptions.frameCount,
      firstFrameDataUrl: '',
      lastFrameDataUrl: '',
      optionsKey: exportOptionsKey(options)
    });
    elements.exportReviewMeta.textContent = `Headless MP4${formatDirectMp4ModeLabel(headlessOptions)}, ${exportResult.frameCount || headlessOptions.frameCount} frames, ${exportResult.fps || headlessOptions.fps} fps${exportResult.hasAudio ? ', audio' : ', no audio'}${exportResult.metadataRelativePath ? ', render log' : ''}${exportResult.benchmark ? `, ${formatNumber(exportResult.benchmark.client?.averageFps || 0)} fps avg` : ''}`;
    setStatus(`Headless MP4 rendered: ${exportResult.relativePath || exportResult.outputPath}`);
    await loadExportHistory();
  } catch (error) {
    if (isExportCancelledError(error)) {
      setStatus('Headless MP4 cancelled');
    } else {
      setStatus(`Headless MP4 failed: ${error.message || error}`);
    }
  } finally {
    state.exportControl = {
      busy: false,
      cancelRequested: false,
      sessionId: '',
      mode: ''
    };
    setExportButtonsDisabled(false);
    updateExportSummary();
  }
}

function buildDirectMp4Options(options) {
  return {
    ...options,
    fast: options.preset === 'direct-mp4-fast-30s',
    raw: isRawDirectMp4Preset(options.preset),
    composite: isCompositeDirectMp4Preset(options.preset) || (options.preset === 'custom-range' && hasVisibleVideoLayer()),
    hardwareEncoder: isNvencDirectMp4Preset(options.preset) ? 'h264_nvenc' : '',
    frameCount: Math.min(MAX_DIRECT_EXPORT_FRAMES, options.requestedFrameCount)
  };
}

async function pollHeadlessMp4Job(jobId) {
  if (!jobId) throw new Error('Headless job id is missing.');
  while (true) {
    const response = await fetch(`/api/exports/headless-mp4/status?jobId=${encodeURIComponent(jobId)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Headless MP4 status failed');
    }
    if (payload.status === 'done') return payload;
    if (payload.status === 'cancelled') throw new Error('EXPORT_CANCELLED');
    if (payload.status === 'failed') throw new Error(payload.error || 'Headless MP4 failed');
    const progress = payload.progress || {};
    const completed = Number(progress.completedFrames || 0);
    const total = Number(progress.totalFrames || payload.options?.frameCount || 0);
    const fps = Number(progress.averageFps || 0);
    setStatus(`Headless MP4: ${completed}/${total || '?'}${fps ? ` · ${formatNumber(fps)} fps` : ''}`);
    if (elements.exportSummary) {
      elements.exportSummary.textContent = `Headless MP4 running in separate browser process: ${completed}/${total || '?'} frames${fps ? ` · ${formatNumber(fps)} fps` : ''}`;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

async function cancelHeadlessMp4Job(jobId) {
  const response = await fetch('/api/exports/headless-mp4/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Headless MP4 cancel failed');
  }
  return payload;
}

async function runHeadlessExportFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('headlessExport');
  if (!jobId) return;
  const options = {
    preset: params.get('preset') || 'custom-range',
    mode: 'clip',
    start: Number(params.get('start') || 0),
    end: Number(params.get('end') || 0),
    fps: Math.max(1, Math.min(30, Math.round(Number(params.get('fps') || 30)))),
    frameCount: Math.max(1, Math.round(Number(params.get('frameCount') || 1))),
    requestedFrameCount: Math.max(1, Math.round(Number(params.get('frameCount') || 1))),
    raw: params.get('raw') !== '0',
    composite: params.get('composite') === '1',
    hardwareEncoder: params.get('hardwareEncoder') || '',
    fast: params.get('fast') === '1',
    headlessJobId: jobId
  };
  document.body.classList.add('headless-export');
  setStatus('Headless export worker ready');
  try {
    await exportDirectMp4(options);
    const exportResult = state.lastExport;
    await completeHeadlessExport(jobId, {
      ok: Boolean(exportResult?.absolutePath),
      result: { export: exportResult },
      error: exportResult?.absolutePath ? '' : 'Headless export produced no output.'
    });
  } catch (error) {
    await completeHeadlessExport(jobId, {
      ok: false,
      error: error.message || String(error)
    });
  } finally {
    window.setTimeout(() => window.close(), 500);
  }
}

async function completeHeadlessExport(jobId, payload) {
  await fetch('/api/exports/headless-mp4/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId,
      ...payload
    })
  });
}

function reportHeadlessExportStage(options, stage, detail = '') {
  if (!options?.headlessJobId) return;
  const now = performance.now();
  if (now - Number(options._lastHeadlessStageMs || 0) < 250 && options._lastHeadlessStage === stage) return;
  options._lastHeadlessStageMs = now;
  options._lastHeadlessStage = stage;
  fetch('/api/exports/headless-mp4/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: options.headlessJobId,
      progress: {
        stage,
        detail,
        completedFrames: 0,
        totalFrames: Math.max(1, Number(options.frameCount || 1)),
        averageFps: 0
      }
    })
  }).catch(() => {});
}

function isRawDirectMp4Preset(preset) {
  return preset === 'direct-mp4-raw-30s'
    || preset === 'direct-mp4-full'
    || preset === 'direct-mp4-raw-nvenc-30s'
    || preset === 'direct-mp4-raw-nvenc-full'
    || preset === 'custom-range'
    || isCompositeDirectMp4Preset(preset);
}

function isNvencDirectMp4Preset(preset) {
  return preset === 'direct-mp4-raw-nvenc-30s'
    || preset === 'direct-mp4-raw-nvenc-full'
    || preset === 'direct-mp4-composite-nvenc-30s'
    || preset === 'direct-mp4-composite-nvenc-full';
}

function isCompositeDirectMp4Preset(preset) {
  return preset === 'direct-mp4-composite-30s'
    || preset === 'direct-mp4-composite-nvenc-30s'
    || preset === 'direct-mp4-composite-full'
    || preset === 'direct-mp4-composite-nvenc-full';
}

async function exportCurrentFrame(timestamp = state.audio.preview.currentTime) {
  if (!state.project) return;
  setStatus('Exporting frame...');
  const originalTime = state.audio.preview.currentTime;
  try {
    state.renderTimeOverride = timestamp;
    state.audio.preview.seek(timestamp);
    await waitForMediaSeek();
    state.audio.frame = createExportAudioFrame(timestamp);
    state.renderProject = buildRenderProject();
    renderLyrics();
    renderScenes();
    await prepareVideoLayersForExport(timestamp);
    renderCanvas();
    const dataUrl = elements.canvas.toDataURL('image/png');
    const response = await fetch('/api/exports/frame', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataUrl,
        timestamp
      })
    });
    if (!response.ok) {
      setStatus(`Frame export failed: ${await response.text()}`);
      return;
    }
    const payload = await response.json();
    updateExportReview({
      type: 'frame',
      absolutePath: payload.outputPath,
      relativePath: payload.relativePath,
      frameCount: 1,
      fps: 1,
      start: timestamp,
      end: timestamp,
      optionsKey: exportOptionsKey(readExportOptions()),
      firstFrameDataUrl: dataUrl,
      lastFrameDataUrl: dataUrl
    });
    setStatus(`Frame exported: ${payload.relativePath}`);
  } finally {
    state.renderTimeOverride = null;
    state.audio.preview.seek(originalTime);
    await waitForMediaSeek();
    renderDynamicFrame();
  }
}

async function exportFrameSequence(options) {
  if (!state.project) return;
  const duration = getAudioDuration();
  const startTimestamp = Math.min(options.start, Math.max(0, duration));
  const fps = options.fps;
  const frameCount = options.frameCount;
  const batchSize = options.raw ? 2 : 8;
  const pendingFrames = [];
  let firstFrameDataUrl = '';
  let lastFrameDataUrl = '';
  let uploadedFrameCount = 0;
  let previousExportAudioFrame = null;
  let finalPayload = null;
  const wasPlaying = state.audio.preview.playing;
  const originalTime = state.audio.preview.currentTime;
  const originalMuted = state.audio.preview.outputMuted;

  setExportButtonsDisabled(true);
  setStatus(`Exporting clip: 0/${frameCount} frames...`);
  stopRenderLoop();

  try {
    const sessionResponse = await fetch('/api/exports/clip/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startTimestamp,
        fps,
        expectedFrameCount: frameCount
      })
    });
    if (!sessionResponse.ok) {
      setStatus(`Clip export failed: ${await sessionResponse.text()}`);
      return;
    }
    const session = await sessionResponse.json();

    state.audio.preview.setOutputMuted(true);
    await state.audio.preview.play();
    previousExportAudioFrame = createExportAudioPrerollFrame(startTimestamp, fps);
    for (let index = 0; index < frameCount; index += 1) {
      const frameStartedAt = performance.now();
      const timestamp = Math.min(options.end, startTimestamp + index / fps);
      state.renderTimeOverride = timestamp;
      state.audio.preview.seek(timestamp);
      await waitForMediaSeek();
      await waitForExportFrameTick();
      state.audio.frame = createExportAudioFrame(timestamp, previousExportAudioFrame);
      previousExportAudioFrame = state.audio.frame;
      state.renderProject = buildRenderProject();
      if (!options.headlessJobId) updateTimeline(timestamp, duration);
      renderLyrics();
      renderScenes();
      if (!options.headlessJobId) renderLyricsNavigator();
      await prepareVideoLayersForExport(timestamp);
      renderCanvas();
      const dataUrl = elements.canvas.toDataURL('image/png');
      if (!firstFrameDataUrl) firstFrameDataUrl = dataUrl;
      lastFrameDataUrl = dataUrl;
      pendingFrames.push({
        timestamp,
        dataUrl
      });
      setStatus(`Exporting clip: ${index + 1}/${frameCount} frames...`);
      if (pendingFrames.length >= batchSize) {
        await uploadClipFrameBatch(session.sessionId, pendingFrames.splice(0), uploadedFrameCount, false);
        uploadedFrameCount = index + 1;
      }
    }

    finalPayload = await uploadClipFrameBatch(session.sessionId, pendingFrames.splice(0), uploadedFrameCount, true);
    const payload = finalPayload;
    updateExportReview({
      type: 'clip',
      absolutePath: payload.outputPath,
      relativePath: payload.relativePath,
      frameCount: payload.frameCount,
      fps: payload.fps,
      start: startTimestamp,
      end: Math.min(options.end, startTimestamp + payload.frameCount / fps),
      optionsKey: exportOptionsKey(options),
      firstFrameDataUrl,
      lastFrameDataUrl
    });
    setStatus(`Clip exported: ${payload.relativePath} (${payload.frameCount} frames)`);
    updateExportSummary();
  } catch (error) {
    setStatus(`Clip export failed: ${error.message || error}`);
  } finally {
    state.renderTimeOverride = null;
    state.audio.preview.setOutputMuted(originalMuted);
    state.audio.preview.seek(originalTime);
    if (!wasPlaying) {
      state.audio.preview.pause();
      state.audio.status = 'ready';
    } else {
      state.audio.status = 'playing';
      startRenderLoop();
    }
    setExportButtonsDisabled(false);
    renderDynamicFrame();
  }
}

async function exportDirectMp4(options) {
  if (!state.project) return;
  const duration = getAudioDuration();
  const startTimestamp = Math.min(options.start, Math.max(0, duration));
  const fps = options.fps;
  const frameCount = options.frameCount;
  const batchSize = options.raw ? 2 : 8;
  const pendingFrames = [];
  let firstFrameDataUrl = '';
  let lastFrameDataUrl = '';
  let uploadedFrameCount = 0;
  let previousExportAudioFrame = null;
  let finalPayload = null;
  let sessionId = '';
  const benchmark = createDirectMp4Benchmark(options);
  const compositeLayer = options.composite ? getCompositeVideoLayer() : null;
  const wasPlaying = state.audio.preview.playing;
  const originalTime = state.audio.preview.currentTime;
  const originalMuted = state.audio.preview.outputMuted;

  if (options.composite && !compositeLayer) {
    setStatus('Composite export requires one visible Cover Video layer.');
    return;
  }

  setExportButtonsDisabled(true);
    state.exportControl = {
      busy: true,
      cancelRequested: false,
      sessionId: '',
      mode: options.headlessJobId ? 'headless-worker' : 'direct'
    };
  const progressStartedAt = performance.now();
  updateDirectMp4Progress(options, 0, frameCount, progressStartedAt);
  stopRenderLoop();

  try {
    reportHeadlessExportStage(options, 'starting-direct-session');
    const sessionResponse = await fetch('/api/exports/direct-mp4/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startTimestamp,
        duration: Math.min(options.end, startTimestamp + frameCount / fps) - startTimestamp,
        fps,
        frameCount,
        fast: options.fast === true || options.raw === true,
        raw: options.raw === true,
        hardwareEncoder: options.hardwareEncoder || '',
        headlessJobId: options.headlessJobId || '',
        compositeVideoLayerId: compositeLayer?.id || '',
        compositeVideoStartTime: compositeLayer ? getCompositeVideoStartTime(compositeLayer, startTimestamp) : 0,
        width: state.project.composition.width,
        height: state.project.composition.height
      })
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) {
      throw new Error(session.error || 'Direct MP4 start failed');
    }
    sessionId = session.sessionId;
    state.exportControl.sessionId = sessionId;

    reportHeadlessExportStage(options, 'preparing-render');
    state.audio.preview.setOutputMuted(true);
    state.exportVideoBenchmark = benchmark;
    state.exportOverlay = compositeLayer ? {
      enabled: true,
      baseOrder: Number(compositeLayer.order || 0)
    } : null;
    if (compositeLayer) {
      benchmark.videoMode = 'ffmpeg-composite';
      benchmark.videoFallbackReason = '';
    }
    if (options.headlessJobId) {
      state.audio.preview.pause();
      state.audio.status = 'ready';
    } else {
      await state.audio.preview.play();
    }
    reportHeadlessExportStage(options, compositeLayer ? 'using-ffmpeg-composite' : 'preparing-video-layers');
    state.videoExportContext = compositeLayer ? null : await createSequentialVideoExportContext(startTimestamp, benchmark);
    previousExportAudioFrame = createExportAudioPrerollFrame(startTimestamp, fps);
    reportHeadlessExportStage(options, 'rendering-frames');
    for (let index = 0; index < frameCount; index += 1) {
      throwIfExportCancelled();
      const frameStartedAt = performance.now();
      const timestamp = Math.min(options.end, startTimestamp + index / fps);
      state.renderTimeOverride = timestamp;
      if (!options.headlessJobId) {
        state.audio.preview.seek(timestamp);
        await waitForMediaSeek();
      }
      await (options.headlessJobId ? waitForExportFrameTick() : waitForAnimationFrame());
      state.audio.frame = createExportAudioFrame(timestamp, previousExportAudioFrame);
      previousExportAudioFrame = state.audio.frame;
      state.renderProject = buildRenderProject();
      updateTimeline(timestamp, duration);
      renderLyrics();
      renderScenes();
      renderLyricsNavigator();
      if (!compositeLayer) {
        await prepareVideoLayersForExport(timestamp, benchmark, state.videoExportContext);
      }
      renderCanvas();
      benchmark.frameRenderMs += performance.now() - frameStartedAt;
      if (options.raw) {
        const captureStartedAt = performance.now();
        if (index === 0 || index === frameCount - 1) {
          const previewBlob = await canvasToPngBlob(elements.canvas);
          const previewUrl = URL.createObjectURL(previewBlob);
          if (!firstFrameDataUrl) firstFrameDataUrl = previewUrl;
          lastFrameDataUrl = previewUrl;
        }
        const imageData = context.getImageData(0, 0, elements.canvas.width, elements.canvas.height);
        benchmark.getImageDataMs += performance.now() - captureStartedAt;
        pendingFrames.push({ timestamp, rawBuffer: imageData.data });
      } else {
        const captureStartedAt = performance.now();
        const blob = await canvasToPngBlob(elements.canvas);
        benchmark.pngCaptureMs += performance.now() - captureStartedAt;
        const previewUrl = URL.createObjectURL(blob);
        if (!firstFrameDataUrl) firstFrameDataUrl = previewUrl;
        lastFrameDataUrl = previewUrl;
        pendingFrames.push({ timestamp, blob });
      }
      updateDirectMp4Progress(options, index + 1, frameCount, progressStartedAt);
      if (pendingFrames.length >= batchSize) {
        throwIfExportCancelled();
        await uploadDirectMp4FrameBatch(sessionId, pendingFrames.splice(0), false, null, benchmark);
        uploadedFrameCount = index + 1;
      }
    }

    throwIfExportCancelled();
    finalPayload = await uploadDirectMp4FrameBatch(sessionId, pendingFrames.splice(0), true, finalizeDirectMp4Benchmark(benchmark), benchmark);
    updateExportReview({
      type: 'video',
      absolutePath: finalPayload.outputPath,
      relativePath: finalPayload.relativePath,
      frameCount: finalPayload.frameCount,
      fps: finalPayload.fps,
      start: startTimestamp,
      end: Math.min(options.end, startTimestamp + finalPayload.frameCount / fps),
      optionsKey: exportOptionsKey(options),
      firstFrameDataUrl,
      lastFrameDataUrl,
      hasAudio: finalPayload.hasAudio,
      metadataPath: finalPayload.metadataPath,
      metadataRelativePath: finalPayload.metadataRelativePath,
      benchmark: finalPayload.benchmark
    });
    elements.exportReviewMeta.textContent = `Direct MP4${formatDirectMp4ModeLabel(options)}, ${finalPayload.frameCount} frames, ${finalPayload.fps} fps${finalPayload.hasAudio ? ', audio' : ', no audio'}${finalPayload.metadataRelativePath ? ', render log' : ''}${finalPayload.benchmark ? `, ${formatNumber(finalPayload.benchmark.client?.averageFps || 0)} fps avg` : ''}`;
    setStatus(`Direct MP4 rendered: ${finalPayload.relativePath}`);
    updateExportSummary();
    await loadExportHistory();
  } catch (error) {
    if (isExportCancelledError(error)) {
      if (sessionId) await cancelDirectMp4Session(sessionId);
      setStatus('Direct MP4 cancelled');
    } else {
      setStatus(`Direct MP4 failed: ${error.message || error}`);
    }
  } finally {
    state.exportControl = {
      busy: false,
      cancelRequested: false,
      sessionId: '',
      mode: ''
    };
    state.renderTimeOverride = null;
    state.exportVideoBenchmark = null;
    state.exportOverlay = null;
    closeSequentialVideoExportContext(state.videoExportContext);
    state.videoExportContext = null;
    state.audio.preview.setOutputMuted(originalMuted);
    state.audio.preview.seek(originalTime);
    if (!wasPlaying) {
      state.audio.preview.pause();
      state.audio.status = 'ready';
    } else {
      state.audio.status = 'playing';
      startRenderLoop();
    }
    setExportButtonsDisabled(false);
    updateExportSummary();
    renderDynamicFrame();
  }
}

async function loadExportHistory() {
  if (!state.project || !elements.exportHistoryList) return;
  try {
    const response = await fetch('/api/exports/history?limit=20');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Export history failed');
    }
    state.exportHistory = payload.history || [];
    renderExportHistory();
    refreshReelModeAvailability();
  } catch (error) {
    elements.exportHistoryList.innerHTML = `<div class="empty-state">History failed: ${escapeHtml(error.message || error)}</div>`;
  }
}

function renderExportHistory() {
  elements.exportHistoryList.innerHTML = '';
  if (!state.exportHistory.length) {
    elements.exportHistoryList.innerHTML = '<div class="empty-state">No render history yet</div>';
    return;
  }

  for (const item of state.exportHistory) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'export-history-row';
    button.title = item.outputPath || item.relativePath || '';
    button.addEventListener('click', () => selectExportHistoryItem(item));

    const text = document.createElement('div');
    const main = document.createElement('div');
    main.className = 'export-history-main';
    main.textContent = item.relativePath || item.outputPath || 'MP4 render';
    const meta = document.createElement('div');
    meta.className = 'export-history-meta';
    meta.textContent = `${item.rendererMode || 'render'} · ${formatTime(item.startTimestamp)} - ${formatTime(item.startTimestamp + item.duration)} · ${item.frameCount}f @ ${item.fps} fps${item.hasAudio ? ' · audio' : ''}`;
    text.append(main, meta);

    const size = document.createElement('div');
    size.className = 'export-history-size';
    size.textContent = formatBytes(item.sizeBytes);
    button.append(text, size);
    elements.exportHistoryList.append(button);
  }
}

function selectExportHistoryItem(item) {
  updateExportReview({
    type: 'video',
    absolutePath: item.outputPath,
    relativePath: item.relativePath,
    frameCount: item.frameCount,
    fps: item.fps,
    start: item.startTimestamp,
    end: item.startTimestamp + item.duration,
    hasAudio: item.hasAudio,
    metadataPath: item.metadataPath,
    metadataRelativePath: item.metadataRelativePath,
    benchmark: item.benchmark
  });
  elements.exportReviewMeta.textContent = `${item.rendererMode || 'MP4'}, ${item.frameCount} frames, ${item.fps} fps${item.hasAudio ? ', audio' : ', no audio'}`;
  setStatus(`Selected export: ${item.relativePath}`);
}

function renderExportBenchmark(benchmark) {
  if (!elements.exportBenchmark) return;
  const client = benchmark?.client || null;
  const server = benchmark?.server || null;
  if (!client && !server) {
    elements.exportBenchmark.hidden = true;
    elements.exportBenchmark.replaceChildren();
    return;
  }

  const summaryRows = [];
  if (client) {
    summaryRows.push(['Avg FPS', formatNumber(client.averageFps || 0)]);
    summaryRows.push(['Mode', client.videoMode || client.mode || 'direct']);
    summaryRows.push(['Frame', `${formatNumber(client.averageFrameRenderMs || 0)} ms`]);
    summaryRows.push(['Capture', `${formatNumber(client.averageGetImageDataMs || client.averagePngCaptureMs || 0)} ms`]);
  }
  if (server) {
    summaryRows.push(['FFmpeg', `${formatNumber(server.ffmpegEncodeMs || 0)} ms`]);
  }
  if (client) {
    summaryRows.push(['Upload', `${formatNumber(client.averageUploadMs || 0)} ms`]);
  }

  const detailRows = buildBenchmarkDetailRows(client, server);
  const header = document.createElement('div');
  header.className = 'export-benchmark-header';
  const title = document.createElement('strong');
  title.textContent = 'Performance Summary';
  const detailsToggle = document.createElement('button');
  detailsToggle.type = 'button';
  detailsToggle.textContent = 'Details';
  header.append(title, detailsToggle);

  const summary = document.createElement('div');
  summary.className = 'export-benchmark-summary';
  summary.replaceChildren(...summaryRows.map(createBenchmarkCard));

  const details = document.createElement('div');
  details.className = 'export-benchmark-details';
  details.hidden = true;
  details.replaceChildren(...detailRows.map(createBenchmarkCard));
  detailsToggle.addEventListener('click', () => {
    details.hidden = !details.hidden;
    detailsToggle.textContent = details.hidden ? 'Details' : 'Hide Details';
  });

  elements.exportBenchmark.hidden = false;
  elements.exportBenchmark.replaceChildren(header, summary, details);
}

function createBenchmarkCard([label, value]) {
  const item = document.createElement('div');
  const labelEl = document.createElement('span');
  const valueEl = document.createElement('strong');
  labelEl.textContent = label;
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  return item;
}

function buildBenchmarkDetailRows(client, server) {
  const rows = [];
  if (client) {
    rows.push(['Frame format', client.mode || 'direct']);
    rows.push(['Encoder', client.encoder || 'libx264']);
    rows.push(['Video mode', client.videoMode || 'seek']);
    rows.push(['Frame render', `${formatNumber(client.averageFrameRenderMs || 0)} ms`]);
    rows.push(['getImageData', `${formatNumber(client.averageGetImageDataMs || 0)} ms`]);
    rows.push(['Upload/backpressure', `${formatNumber(client.averageUploadMs || 0)} ms`]);
    rows.push(['Video seek', `${formatNumber(client.averageVideoSeekMs || 0)} ms`]);
    rows.push(['Video decode wait', `${formatNumber(client.averageVideoDecodeWaitMs || 0)} ms`]);
    rows.push(['Video seq wait', `${formatNumber(client.averageVideoSequentialWaitMs || 0)} ms`]);
    rows.push(['WebCodecs decode', `${formatNumber(client.averageVideoWebCodecsDecodeMs || 0)} ms`]);
    rows.push(['Video draw', `${formatNumber(client.averageVideoDrawMs || 0)} ms`]);
    rows.push(['Video missed', String(client.videoFramesMissed || 0)]);
    rows.push(['WebCodecs missed', String(client.videoWebCodecsFrameMisses || 0)]);
    rows.push(['WebCodecs disabled', String(client.videoWebCodecsDisabled || 0)]);
    rows.push(['Video corrections', String(client.videoCorrectiveSeeks || 0)]);
    if (client.videoFallbackReason) rows.push(['Video fallback', client.videoFallbackReason]);
  }
  if (server) {
    rows.push(['FFmpeg encode', `${formatNumber(server.ffmpegEncodeMs || 0)} ms`]);
    rows.push(['stdin write', `${formatNumber(server.averageStdinWriteMs || 0)} ms/frame`]);
  }
  return rows;
}

function formatDirectMp4ModeLabel(options) {
  if (options.composite && options.hardwareEncoder === 'h264_nvenc') return ' Composite NVENC';
  if (options.composite) return ' Composite';
  if (options.hardwareEncoder === 'h264_nvenc') return ' Raw NVENC';
  if (options.raw) return ' Raw';
  if (options.fast) return ' Fast';
  return '';
}

function updateDirectMp4Progress(options, completedFrames, totalFrames, startedAt) {
  const completed = Math.max(0, Math.min(Number(completedFrames || 0), Number(totalFrames || 0)));
  const total = Math.max(1, Number(totalFrames || 1));
  const elapsedMs = Math.max(0, performance.now() - Number(startedAt || performance.now()));
  const percent = Math.min(100, (completed / total) * 100);
  const averageFps = elapsedMs > 0 && completed > 0 ? completed / (elapsedMs / 1000) : 0;
  const remainingFrames = Math.max(0, total - completed);
  const etaMs = averageFps > 0 ? (remainingFrames / averageFps) * 1000 : 0;
  const modeLabel = formatDirectMp4ModeLabel(options);
  const message = `Rendering Direct MP4${modeLabel}: ${completed}/${total} (${formatNumber(percent)}%) · ${formatDurationCompact(elapsedMs)} elapsed · ETA ${etaMs ? formatDurationCompact(etaMs) : '--'} · ${formatNumber(averageFps)} fps`;
  setStatus(message);
  if (elements.exportSummary && state.exportControl.busy) {
    elements.exportSummary.textContent = message;
  }
  if (options.headlessJobId) {
    const now = performance.now();
    if (completed >= total || now - Number(options._lastHeadlessProgressMs || 0) > 1000) {
      options._lastHeadlessProgressMs = now;
      fetch('/api/exports/headless-mp4/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: options.headlessJobId,
          progress: {
            stage: completed >= total ? 'finalizing' : 'rendering-frames',
            completedFrames: completed,
            totalFrames: total,
            percent,
            averageFps,
            elapsedMs,
            etaMs
          }
        })
      }).catch(() => {});
    }
  }
}

function throwIfExportCancelled() {
  if (!state.exportControl.cancelRequested) return;
  throw new Error('EXPORT_CANCELLED');
}

function isExportCancelledError(error) {
  return String(error?.message || error) === 'EXPORT_CANCELLED';
}

async function cancelDirectMp4Session(sessionId) {
  if (!sessionId) return;
  try {
    await fetch('/api/exports/direct-mp4/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
  } catch {}
}

function formatDurationCompact(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

async function uploadClipFrameBatch(sessionId, frames, offset, final) {
  const response = await fetch('/api/exports/clip/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      frames,
      offset,
      final
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Clip batch export failed');
  }
  return payload;
}

async function uploadDirectMp4FrameBatch(sessionId, frames, final, finalBenchmark = null, benchmark = null) {
  if (frames.some((frame) => frame.rawBuffer)) {
    const body = await buildDirectMp4BinaryBatch(sessionId, frames, final, finalBenchmark);
    const startedAt = performance.now();
    const response = await fetch('/api/exports/direct-mp4/batch-raw', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body
    });
    if (benchmark) benchmark.uploadMs += performance.now() - startedAt;
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Direct MP4 raw batch failed');
    }
    return payload;
  }

  if (frames.some((frame) => frame.blob)) {
    const body = await buildDirectMp4BinaryBatch(sessionId, frames, final, finalBenchmark);
    const startedAt = performance.now();
    const response = await fetch('/api/exports/direct-mp4/batch-binary', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body
    });
    if (benchmark) benchmark.uploadMs += performance.now() - startedAt;
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Direct MP4 binary batch failed');
    }
    return payload;
  }

  const startedAt = performance.now();
  const response = await fetch('/api/exports/direct-mp4/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      frames,
      final,
      benchmark: finalBenchmark
    })
  });
  if (benchmark) benchmark.uploadMs += performance.now() - startedAt;
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Direct MP4 batch failed');
  }
  return payload;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Canvas PNG capture failed.'));
    }, 'image/png');
  });
}

async function buildDirectMp4BinaryBatch(sessionId, frames, final, benchmark = null) {
  const buffers = [];
  const headerFrames = [];
  for (const frame of frames) {
    const arrayBuffer = frame.rawBuffer
      ? exactArrayBuffer(frame.rawBuffer)
      : await frame.blob.arrayBuffer();
    buffers.push(arrayBuffer);
    headerFrames.push({
      timestamp: frame.timestamp,
      size: arrayBuffer.byteLength
    });
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify({
    sessionId,
    final,
    benchmark,
    frames: headerFrames
  }));
  const prefix = new ArrayBuffer(4);
  new DataView(prefix).setUint32(0, headerBytes.byteLength, false);
  return new Blob([prefix, headerBytes, ...buffers], { type: 'application/octet-stream' });
}

function exactArrayBuffer(view) {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view.buffer;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function createDirectMp4Benchmark(options) {
  return {
    mode: options.raw ? 'raw-rgba' : 'png-blob',
    encoder: options.hardwareEncoder || 'libx264',
    startedAt: performance.now(),
    frameCount: Math.max(1, Number(options.frameCount || 1)),
    fps: Math.max(1, Number(options.fps || 30)),
    duration: Math.max(0, Number(options.end || 0) - Number(options.start || 0)),
    frameRenderMs: 0,
    getImageDataMs: 0,
    pngCaptureMs: 0,
    uploadMs: 0,
    videoSeekMs: 0,
    videoDecodeWaitMs: 0,
    videoDrawMs: 0,
    videoFramesMissed: 0,
    videoSequentialWaitMs: 0,
    videoCorrectiveSeeks: 0,
    videoWebCodecsFrameMisses: 0,
    videoWebCodecsDisabled: 0,
    videoWebCodecsDecodeMs: 0,
    videoMode: 'seek',
    videoFallbackReason: ''
  };
}

function finalizeDirectMp4Benchmark(benchmark) {
  const totalMs = Math.max(0, performance.now() - benchmark.startedAt);
  const frames = Math.max(1, Number(benchmark.frameCount || 1));
  return {
    mode: benchmark.mode,
    frameCount: frames,
    fps: benchmark.fps,
    duration: benchmark.duration,
    totalMs,
    frameRenderMs: benchmark.frameRenderMs,
    averageFrameRenderMs: benchmark.frameRenderMs / frames,
    getImageDataMs: benchmark.getImageDataMs,
    averageGetImageDataMs: benchmark.getImageDataMs / frames,
    pngCaptureMs: benchmark.pngCaptureMs,
    averagePngCaptureMs: benchmark.pngCaptureMs / frames,
    uploadMs: benchmark.uploadMs,
    averageUploadMs: benchmark.uploadMs / frames,
    videoSeekMs: benchmark.videoSeekMs,
    averageVideoSeekMs: benchmark.videoSeekMs / frames,
    videoDecodeWaitMs: benchmark.videoDecodeWaitMs,
    averageVideoDecodeWaitMs: benchmark.videoDecodeWaitMs / frames,
    videoSequentialWaitMs: benchmark.videoSequentialWaitMs,
    averageVideoSequentialWaitMs: benchmark.videoSequentialWaitMs / frames,
    videoWebCodecsDecodeMs: benchmark.videoWebCodecsDecodeMs,
    averageVideoWebCodecsDecodeMs: benchmark.videoWebCodecsDecodeMs / frames,
    videoDrawMs: benchmark.videoDrawMs,
    averageVideoDrawMs: benchmark.videoDrawMs / frames,
    videoFramesMissed: benchmark.videoFramesMissed,
    videoCorrectiveSeeks: benchmark.videoCorrectiveSeeks,
    videoWebCodecsFrameMisses: benchmark.videoWebCodecsFrameMisses,
    videoWebCodecsDisabled: benchmark.videoWebCodecsDisabled,
    videoMode: benchmark.videoMode,
    videoFallbackReason: benchmark.videoFallbackReason,
    averageFps: totalMs > 0 ? frames / (totalMs / 1000) : 0
  };
}

async function saveProject() {
  setStatus('Saving project...');
  stripEditorOnlyPlaceholders(state.project);
  const response = await fetch('/api/project', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: state.project })
  });
  if (!response.ok) throw new Error(await response.text());
  state.dirty = false;
  renderApp();
  setStatus('Project saved');
}

function getCoverLabSongContext() {
  const titleLayer = state.project?.layers?.find((layer) =>
    layer.type === 'text' && /song title|title/i.test(String(layer.name || ''))
  );
  const artistLayer = state.project?.layers?.find((layer) =>
    layer.type === 'text' && /artist/i.test(String(layer.name || ''))
  );
  const timedLyrics = state.lyrics.cues
    .map((cue) => String(cue.text || '').trim())
    .filter(Boolean)
    .join('\n');
  return {
    title: String(state.project?.metadata?.title || titleLayer?.properties?.text || state.project?.name || ''),
    artist: String(state.project?.metadata?.artist || artistLayer?.properties?.text || ''),
    lyrics: String(state.lyrics.metadataLyrics || timedLyrics || '')
  };
}

function updateCoverLabSettings(settings) {
  if (!state.project) return;
  state.project = {
    ...state.project,
    metadata: {
      ...(state.project.metadata || {}),
      coverLab: settings
    }
  };
  state.dirty = true;
  elements.projectName.textContent = `${state.project.name} *`;
  elements.saveButton.disabled = false;
}

function applyCoverLabProject(project, layer, asset) {
  state.project = project;
  state.selectedLayerId = layer?.id || state.selectedLayerId;
  state.imageCache.delete(asset?.id);
  markDirty();
  setStatus('Cover Lab result applied to Cover layer');
}

function renderApp() {
  if (!state.project) return;
  elements.projectName.textContent = `${state.project.name}${state.dirty ? ' *' : ''}`;
  elements.projectPath.textContent = state.projectPath;
  elements.durationLabel.textContent = `Duration: ${formatTime(getAudioDuration())}`;
  elements.fpsLabel.textContent = `${state.project.composition.width}x${state.project.composition.height}, ${state.project.composition.fps} fps`;
  elements.compositionFormatSelect.value = getCompositionFormatId(state.project.composition);
  updateTransportControls();
  elements.audioStatus.textContent = getAudioStatusLabel();
  elements.saveButton.disabled = !state.dirty;
  renderLayers();
  renderInspector();
  renderScenes();
  renderLyrics();
  renderLyricsNavigator();
  renderWaveform();
  renderCanvas();
  requestAnimationFrame(() => fitStageCanvasToViewport());
}

async function loadProjectAudio() {
  const audioAsset = getAudioAsset();
  state.audio.waveformPeaks = [];
  state.audio.decodedSamples = new Float32Array();
  state.audio.decodedSampleRate = 44100;
  state.audio.decodedDuration = 0;
  if (!audioAsset) {
    state.audio.status = 'missing';
    return;
  }
  state.audio.preview.pause();
  state.audio.status = 'loading';
  const audioUrl = `/api/assets/${encodeURIComponent(audioAsset.id)}`;
  state.audio.preview.load(audioUrl);
  state.audio.preview.audio.onloadedmetadata = () => {
    const duration = getAudioDuration();
    elements.timelineScrubber.max = String(duration);
    updateTimeline(state.audio.preview.currentTime, duration);
    renderDynamicFrame();
    if (state.audio.status === 'loading') {
      state.audio.status = 'ready';
      renderApp();
    }
  };
  state.audio.preview.audio.onerror = () => {
    state.audio.status = 'error';
    setStatus('Audio failed to load');
    renderApp();
  };
  state.audio.preview.audio.onended = () => {
    state.audio.status = 'ready';
    stopRenderLoop();
    renderApp();
  };

  try {
    const waveform = await state.audio.preview.analyzeWaveform(audioUrl, 1200);
    state.audio.waveformPeaks = waveform.peaks;
    state.audio.decodedSamples = waveform.samples || new Float32Array();
    state.audio.decodedSampleRate = waveform.sampleRate || 44100;
    state.audio.decodedDuration = waveform.duration || 0;
    if (state.lyrics.cues.length) {
      state.lyrics.scenes = buildPreviewScenes();
    }
    if (state.audio.status === 'loading') state.audio.status = 'ready';
    renderApp();
  } catch (error) {
    state.audio.status = 'error';
    setStatus(`Waveform failed: ${error.message || error}`);
    renderApp();
  }
}

async function loadVisualizerPresetLibrary() {
  try {
    const response = await fetch('/api/visualizer-presets');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.visualizerLibrary = {
      presets: payload.library?.presets || [],
      path: payload.libraryPath || ''
    };
  } catch {
    state.visualizerLibrary = { presets: [], path: '' };
  }
}

async function loadLyricsStylePresetLibrary() {
  try {
    const response = await fetch('/api/lyrics-style-presets');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.lyricsStyleLibrary = {
      presets: payload.library?.presets || [],
      path: payload.libraryPath || ''
    };
  } catch {
    state.lyricsStyleLibrary = { presets: [], path: '' };
  }
}

async function loadProjectLyrics() {
  const lyricsAsset = getLyricsAsset();
  state.lyrics.status = 'idle';
  state.lyrics.document = { lines: [] };
  state.lyrics.sourceCues = [];
  state.lyrics.cues = [];
  state.lyrics.scenes = [];
  state.lyrics.metadataLyrics = '';
  state.lyrics.filter = '';
  state.lyrics.currentCue = null;
  elements.lyricsSearch.value = '';

  if (!lyricsAsset) {
    state.lyrics.status = 'missing';
    return;
  }

  state.lyrics.status = 'loading';
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(lyricsAsset.id)}`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const normalized = normalizeLyricsDocument(payload);
    state.lyrics.document = normalized.document;
    state.lyrics.sourceCues = normalized.cues;
    state.lyrics.cues = parseAlignedLyrics(payload);
    state.lyrics.metadataLyrics = await loadMetadataLyrics();
    state.lyrics.scenes = buildPreviewScenes();
    state.lyrics.status = state.lyrics.cues.length ? 'ready' : 'empty';
  } catch (error) {
    state.lyrics.status = 'error';
    setStatus(`Lyrics failed: ${error.message || error}`);
  }
}

async function loadMetadataLyrics() {
  const metadataAsset = getMetadataAsset();
  if (!metadataAsset) return '';

  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(metadataAsset.id)}`);
    if (!response.ok) return '';
    const payload = await response.json();
    return payload.lyrics || '';
  } catch {
    return '';
  }
}

async function togglePlayback() {
  if (state.audio.preview.playing) {
    state.audio.preview.pause();
    state.audio.status = 'ready';
    stopRenderLoop();
    renderApp();
    return;
  }

  try {
    await state.audio.preview.play();
    state.audio.status = 'playing';
    startRenderLoop();
    renderApp();
  } catch (error) {
    state.audio.status = 'error';
    setStatus(`Audio playback failed: ${error.message || error}`);
    renderApp();
  }
}

function toggleMute() {
  state.audio.preview.setOutputMuted(!state.audio.preview.outputMuted);
  updateTransportControls();
}

function updateVolumeFromSlider() {
  const volume = clamp(Number(elements.volumeSlider.value || 0), 0, 1);
  state.audio.preview.setOutputVolume(volume);
  if (volume > 0 && state.audio.preview.outputMuted) {
    state.audio.preview.setOutputMuted(false);
  }
  updateTransportControls();
}

async function seekRelative(deltaSeconds) {
  await seekToTime(state.audio.preview.currentTime + Number(deltaSeconds || 0), { status: 'Seeked' });
}

async function seekFromTimelinePointer(event) {
  const duration = getAudioDuration();
  if (!(duration > 0)) return;
  const rect = elements.waveformCanvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  await seekToTime(ratio * duration, { status: 'Seeked' });
}

async function seekToTime(time, options = {}) {
  const duration = getAudioDuration();
  const safeTime = clamp(Number(time || 0), 0, Math.max(0, duration));
  const seekToken = state.audio.seekToken + 1;
  state.audio.seekToken = seekToken;
  const wasPlaying = state.audio.preview.playing;

  state.renderTimeOverride = safeTime;
  state.audio.pendingSeekTime = safeTime;
  state.audio.pendingSeekStartedAt = performance.now();
  state.audio.userScrubbing = false;
  state.audio.preview.seek(safeTime);
  updateTimeline(safeTime, duration);
  renderFrameAtTime(safeTime);
  if (options.status) setStatus(`${options.status}: ${formatTime(safeTime)}`);

  const seekCompleted = await waitForMediaSeekTo(safeTime);
  if (state.audio.seekToken !== seekToken) return;

  state.audio.pendingSeekTime = null;
  state.audio.pendingSeekStartedAt = 0;
  state.renderTimeOverride = null;
  state.audio.userScrubbing = false;
  if (wasPlaying && !state.audio.preview.playing) {
    await state.audio.preview.play().catch(() => {});
  }
  if (!seekCompleted) {
    setStatus(`Seek could not be confirmed: ${formatTime(safeTime)}`);
  }
  renderDynamicFrame();
}

function startRenderLoop() {
  if (state.audio.animationId) return;
  const tick = () => {
    renderDynamicFrame();
    if (state.audio.preview.playing) {
      state.audio.animationId = requestAnimationFrame(tick);
    } else {
      state.audio.animationId = 0;
    }
  };
  state.audio.animationId = requestAnimationFrame(tick);
}

function stopRenderLoop() {
  if (state.audio.animationId) {
    cancelAnimationFrame(state.audio.animationId);
    state.audio.animationId = 0;
  }
}

function renderDynamicFrame() {
  if (state.audio.pendingSeekTime !== null) {
    const target = state.audio.pendingSeekTime;
    const elapsed = performance.now() - state.audio.pendingSeekStartedAt;
    if (Math.abs(state.audio.preview.currentTime - target) > 0.18 && elapsed < 1500) {
      renderFrameAtTime(target);
      return;
    }
    state.audio.pendingSeekTime = null;
    state.audio.pendingSeekStartedAt = 0;
  }
  state.renderTimeOverride = null;
  state.audio.frame = state.audio.preview.updateFrame();
  state.renderProject = buildRenderProject();
  updateTimeline(state.audio.preview.currentTime, getAudioDuration());
  elements.bassMeter.style.width = `${Math.round((state.audio.frame.bass || 0) * 100)}%`;
  elements.audioStatus.textContent = getAudioStatusLabel();
  updateTransportControls();
  renderLyrics();
  renderScenes();
  renderLyricsNavigator();
  renderCanvas();
}

function renderFrameAtTime(time) {
  state.renderTimeOverride = time;
  state.audio.frame = state.audio.preview.updateFrame();
  state.renderProject = buildRenderProject();
  updateTimeline(time, getAudioDuration());
  elements.bassMeter.style.width = `${Math.round((state.audio.frame.bass || 0) * 100)}%`;
  elements.audioStatus.textContent = getAudioStatusLabel();
  updateTransportControls();
  renderLyrics();
  renderScenes();
  renderLyricsNavigator();
  renderCanvas();
}

function updateTransportControls() {
  elements.playButton.textContent = state.audio.preview.playing ? 'Pause' : 'Play';
  elements.muteButton.textContent = state.audio.preview.outputMuted || state.audio.preview.outputVolume === 0 ? 'Unmute' : 'Mute';
  elements.volumeSlider.value = String(state.audio.preview.outputVolume);
}

function createExportAudioFrame(timestamp, previousFrame = null) {
  const rawFrame = createRawExportAudioFrame(timestamp);
  return previousFrame ? smoothAudioFrame(rawFrame, previousFrame, 0.72) : rawFrame;
}

function createRawExportAudioFrame(timestamp) {
  if (state.audio.decodedSamples.length && state.audio.decodedSampleRate > 0) {
    return createAudioFrameFromSamples(state.audio.decodedSamples, timestamp, state.audio.decodedSampleRate, {
      binCount: 64,
      waveformSize: 1024,
      windowSize: 1024
    });
  }
  if (state.audio.waveformPeaks.length && getAudioDuration() > 0) {
    return createAudioFrameFromPeaks(state.audio.waveformPeaks, timestamp, getAudioDuration(), {
      binCount: 128,
      waveformSize: 1024,
      sampleRate: state.audio.preview.context?.sampleRate || 44100
    });
  }
  return state.audio.preview.updateFrame();
}

function createExportAudioPrerollFrame(startTimestamp, fps) {
  if (!(startTimestamp > 0) || !(fps > 0)) return null;
  const frameStep = 1 / fps;
  const prerollFrames = Math.min(24, Math.max(0, Math.floor(Math.min(startTimestamp, 0.8) * fps)));
  let frame = null;
  for (let index = prerollFrames; index > 0; index -= 1) {
    const timestamp = Math.max(0, startTimestamp - index * frameStep);
    frame = createExportAudioFrame(timestamp, frame);
  }
  return frame;
}

function buildRenderProject() {
  const audioResolved = resolveProjectAudioBindings(state.project, state.audio.frame);
  const scene = getActivePreviewScene();
  return applySceneVisualizerPreset(audioResolved, scene);
}

function renderLayers() {
  const layers = [...state.project.layers].sort((a, b) => Number(b.order) - Number(a.order));
  elements.layersList.innerHTML = '';

  for (const layer of layers) {
    const row = document.createElement('div');
    row.className = `layer-row${layer.id === state.selectedLayerId ? ' selected' : ''}`;
    row.addEventListener('click', () => selectLayer(layer.id));

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'icon-button';
    visibility.title = 'Toggle visibility';
    visibility.textContent = layer.visible ? 'V' : '-';
    visibility.addEventListener('click', (event) => {
      event.stopPropagation();
      state.project = toggleLayerVisibility(state.project, layer.id);
      markDirty();
    });

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'icon-button';
    lock.title = 'Toggle lock';
    lock.textContent = layer.locked ? 'L' : 'U';
    lock.addEventListener('click', (event) => {
      event.stopPropagation();
      state.project = toggleLayerLock(state.project, layer.id);
      markDirty();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.value = layer.name;
    name.addEventListener('click', (event) => event.stopPropagation());
    name.addEventListener('change', () => {
      state.project = updateLayer(state.project, layer.id, { name: name.value || layer.name });
      markDirty();
    });

    const type = document.createElement('div');
    type.className = 'layer-type';
    type.textContent = layer.type;

    row.append(visibility, lock, name, type);
    elements.layersList.append(row);
  }
}

function renderInspector() {
  const layer = getSelectedLayer();
  elements.inspectorForm.innerHTML = '';

  if (!layer) {
    elements.inspectorForm.innerHTML = '<div class="empty-state">Select a layer.</div>';
    return;
  }

  addSection('Layer');
  addTextField('Name', layer.name, (value) => updateSelected({ name: value || layer.name }));
  addCheckboxField('Visible', layer.visible, (value) => updateSelected({ visible: value }));
  addCheckboxField('Locked', layer.locked, (value) => updateSelected({ locked: value }));
  addNumberField('Start', layer.start, (value) => updateSelected({ start: value }));
  addNumberField('End', layer.end ?? '', (value) => updateSelected({ end: value }));
  addNumberField('Opacity', layer.opacity, (value) => updateSelected({ opacity: clamp(value, 0, 1) }), { step: 0.01 });
  addSelectField('Blend Mode', layer.blendMode, ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'add', 'subtract'], (value) => updateSelected({ blendMode: value }));

  addSection('Transform');
  for (const key of ['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation']) {
    addNumberField(key, layer.transform?.[key] ?? '', (value) => updateTransform(key, value), { step: key.startsWith('scale') ? 0.01 : 1 });
  }

  if (layer.type === 'text') {
    addSection('Text Style');
    addSelectField(
      'Style',
      layer.properties.textStyleId || 'bright-on-dark',
      getProjectTextStylePresets().map((preset) => preset.id),
      (value) => applySelectedTextStyle(value),
      (value) => getProjectTextStylePresets().find((preset) => preset.id === value)?.name || value
    );
    renderAdvancedTypographyInspector(layer, createTypographyInspectorApi(layer));
  }

  if (layer.type === 'lyrics') {
    addSection('Lyrics');
    addSelectField(
      'Style',
      layer.properties.styleId || 'noir-card',
      getProjectLyricsStylePresets().map((preset) => preset.id),
      (value) => applySelectedLyricsStyle(value),
      (value) => getProjectLyricsStylePresets().find((preset) => preset.id === value)?.name || value
    );
    addButtonRow([
      ['Save New', saveSelectedLyricsStylePreset],
      ['Update', updateSelectedLyricsStylePreset],
      ['Delete', deleteSelectedLyricsStylePreset],
      ['Reset', resetSelectedLyricsStylePreset]
    ]);
    addFontFamilyField('Font', layer.properties.fontFamily || '', (value) => updateProperties({ fontFamily: value }));
    addNumberField('Font Size', layer.properties.fontSize || 48, (value) => updateProperties({ fontSize: value }));
    addColorField('Color', layer.properties.color || '#ffffff', (value) => updateProperties({ color: value }));
    addSelectField('Align', layer.properties.align || 'center', ['left', 'center', 'right'], (value) => updateProperties({ align: value }));
    addNumberField('Line Height', layer.properties.lineHeight ?? 1.18, (value) => updateProperties({ lineHeight: Math.max(0.5, value) }), { step: 0.01 });
    addNumberField('Max Lines', layer.properties.maxLines || 2, (value) => updateProperties({ maxLines: Math.max(1, Math.round(value)) }));

    addSection('Backdrop');
    addColorField('Background', layer.properties.backgroundColor || '#000000', (value) => updateProperties({ backgroundColor: value }));
    addNumberField('Bg Opacity', layer.properties.backgroundOpacity ?? 0.55, (value) => updateProperties({ backgroundOpacity: clamp(value, 0, 1) }), { step: 0.01 });
    addNumberField('Padding', layer.properties.padding || 0, (value) => updateProperties({ padding: Math.max(0, value) }));
    addNumberField('Radius', layer.properties.radius || 0, (value) => updateProperties({ radius: Math.max(0, value) }));

    addSection('Outline & Glow');
    addColorField('Outline Color', layer.properties.strokeColor || '#000000', (value) => updateProperties({ strokeColor: value }));
    addNumberField('Outline Width', layer.properties.strokeWidth || 0, (value) => updateProperties({ strokeWidth: Math.max(0, value) }), { step: 0.5 });
    addColorField('Glow Color', getLyricsGlowSettings(layer.properties).color, (value) => updateLegacyAwareLyricsGlow({ glowColor: value }));
    addNumberField('Glow Blur', getLyricsGlowSettings(layer.properties).blur, (value) => updateLegacyAwareLyricsGlow({ glowBlur: Math.max(0, value) }));
    addNumberField('Glow Intensity', getLyricsGlowSettings(layer.properties).intensity, (value) => updateLegacyAwareLyricsGlow({ glowIntensity: clamp(value, 0, 2) }), { step: 0.05 });

    addSection('Shadow');
    addColorField('Shadow Color', getLyricsShadowSettings(layer.properties).color, (value) => updateLegacyAwareLyricsShadow({ shadowColor: value }));
    addNumberField('Shadow Blur', getLyricsShadowSettings(layer.properties).blur, (value) => updateLegacyAwareLyricsShadow({ shadowBlur: Math.max(0, value) }));
    addNumberField('Shadow X', getLyricsShadowSettings(layer.properties).offsetX, (value) => updateLegacyAwareLyricsShadow({ shadowOffsetX: value }));
    addNumberField('Shadow Y', getLyricsShadowSettings(layer.properties).offsetY, (value) => updateLegacyAwareLyricsShadow({ shadowOffsetY: value }));

    addSection('Transition');
    addSelectField('Transition', layer.properties.transition?.type || 'fade', ['fade', 'none'], (value) => updateLyricsTransition({ type: value, enabled: value !== 'none' }));
    addNumberField('Fade In', layer.properties.transition?.fadeIn ?? 0.14, (value) => updateLyricsTransition({ fadeIn: Math.max(0, value) }), { step: 0.01 });
    addNumberField('Fade Out', layer.properties.transition?.fadeOut ?? 0.18, (value) => updateLyricsTransition({ fadeOut: Math.max(0, value) }), { step: 0.01 });
  }

  if (layer.type === 'shape') {
    addSection('Shape');
    addColorField('Fill', layer.properties.fill || '#000000', (value) => updateProperties({ fill: value }));
  }

  if (layer.type === 'image') {
    addSection('Image');
    addTextField('Asset ID', layer.properties.assetId || '', (value) => updateProperties({ assetId: value }));
    addSelectField('Fit', layer.properties.fit || 'cover', ['cover', 'contain', 'stretch'], (value) => updateProperties({ fit: value }));
    addNumberField('Radius', layer.properties.radius || 0, (value) => updateProperties({ radius: value }));
    if (layer.name.toLowerCase().includes('cover') || getAssetById(layer.properties.assetId)?.role === 'cover') {
      addButtonRow([
        ['Import Cover', () => elements.coverFileInput.click()],
        ['Import Cover Video', () => elements.coverVideoFileInput.click()],
        ['Revert to Source Cover', revertCoverLayer]
      ]);
    }
  }

  if (layer.type === 'video') {
    addSection('Cover Video');
    addTextField('Asset ID', layer.properties.assetId || '', (value) => updateProperties({ assetId: value }));
    addSelectField('Fit', layer.properties.fit || 'cover', ['cover', 'contain', 'stretch'], (value) => updateProperties({ fit: value }));
    addCheckboxField('Loop', layer.properties.loop !== false, (value) => updateProperties({ loop: value }));
    addSelectField('Sync Mode', layer.properties.syncMode || 'project-time', ['project-time', 'free-loop'], (value) => updateProperties({ syncMode: value }));
    addNumberField('Start Offset', layer.properties.startOffset ?? 0, (value) => updateProperties({ startOffset: Math.max(0, value) }), { step: 0.01 });
    addNumberField('Playback Rate', layer.properties.playbackRate ?? 1, (value) => updateProperties({ playbackRate: Math.max(0.05, value) }), { step: 0.05 });
    addNumberField('Trim Start', layer.properties.trimStart ?? 0, (value) => updateProperties({ trimStart: Math.max(0, value) }), { step: 0.01 });
    addNumberField('Trim End', layer.properties.trimEnd ?? 0, (value) => updateProperties({ trimEnd: Math.max(0, value) }), { step: 0.01 });
    addNumberField('Loop Crossfade', layer.properties.loopCrossfade ?? 0, (value) => updateProperties({ loopCrossfade: Math.max(0, value) }), { step: 0.01 });
    addNumberField('Radius', layer.properties.radius || 0, (value) => updateProperties({ radius: Math.max(0, value) }));
    addButtonRow([
      ['Import Cover Video', () => elements.coverVideoFileInput.click()]
    ]);
  }

  if (layer.type === 'visualizer') {
    addSection('Visualizer');
    addSelectField('Preset', layer.properties.visualizerStyleId || '', ['', ...getProjectVisualizerStylePresets().map((preset) => preset.id)], applySelectedVisualizerStyle, (option) => {
      if (!option) return 'Custom';
      return getProjectVisualizerStylePresets().find((preset) => preset.id === option)?.name || option;
    });
    addSelectField('Style', normalizeVisualizerType(layer.properties.visualizerType), ['bars', 'waveform', 'center-bars', 'radial-spectrum'], (value) => updateProperties({ visualizerType: value, visualizerStyleId: 'custom' }));
    addNumberField('Bars', layer.properties.bars || 64, (value) => updateProperties({ bars: Math.max(1, Math.round(value)) }));
    addNumberField('Min Hz', layer.properties.minFrequency ?? 40, (value) => updateProperties({ minFrequency: Math.max(1, value) }));
    addNumberField('Max Hz', layer.properties.maxFrequency ?? 16000, (value) => updateProperties({ maxFrequency: Math.max(1, value) }));
    addNumberField('Gain', layer.properties.gain ?? 1, (value) => updateProperties({ gain: Math.max(0, value) }), { step: 0.05 });
    addNumberField('Sensitivity', layer.properties.sensitivity ?? 1.08, (value) => updateProperties({ sensitivity: Math.max(0.01, value) }), { step: 0.01 });
    addNumberField('Floor', layer.properties.floor ?? 0.04, (value) => updateProperties({ floor: clamp(value, 0, 1) }), { step: 0.01 });
    addNumberField('Hi Boost', layer.properties.highFrequencyBoost ?? 0.75, (value) => updateProperties({ highFrequencyBoost: Math.max(0, value) }), { step: 0.05 });
    addNumberField('Low Damp', layer.properties.lowFrequencyDamping ?? 0.42, (value) => updateProperties({ lowFrequencyDamping: clamp(value, 0, 1) }), { step: 0.01 });
    addNumberField('Mid Damp', layer.properties.midFrequencyDamping ?? 0.18, (value) => updateProperties({ midFrequencyDamping: clamp(value, 0, 1) }), { step: 0.01 });
    addNumberField('Gate', layer.properties.noiseGate ?? 0.025, (value) => updateProperties({ noiseGate: clamp(value, 0, 1) }), { step: 0.005 });
    addColorField('Color', layer.properties.color || '#ffffff', (value) => updateProperties({ color: value }));
    addColorField('Accent', layer.properties.accentColor || '#b50f1d', (value) => updateProperties({ accentColor: value }));
    addCheckboxField('Scene Presets', layer.properties.sceneVisualizerEnabled === true, (value) => updateProperties({ sceneVisualizerEnabled: value }));
    addButtonRow([
      ['Save Preset', saveSelectedVisualizerPreset],
      ['Save Global', saveSelectedVisualizerPresetGlobal],
      ['Reload Preset', () => applySelectedVisualizerStyle(layer.properties.visualizerStyleId || '')]
    ]);
    if (normalizeVisualizerType(layer.properties.visualizerType) === 'radial-spectrum') {
      addNumberField('Inner Radius', layer.properties.innerRadius ?? 92, (value) => updateProperties({ innerRadius: Math.max(0, value) }));
      addNumberField('Outer Radius', layer.properties.outerRadius ?? 260, (value) => updateProperties({ outerRadius: Math.max(1, value) }));
      addNumberField('Thickness', layer.properties.barThickness ?? 4, (value) => updateProperties({ barThickness: Math.max(1, value) }));
      addNumberField('Start Angle', layer.properties.startAngle ?? -90, (value) => updateProperties({ startAngle: value }));
      addNumberField('Arc', layer.properties.arc ?? 360, (value) => updateProperties({ arc: Math.max(1, Math.min(360, value)) }));
      addNumberField('Rotation Speed', layer.properties.rotationSpeed ?? 0, (value) => updateProperties({ rotationSpeed: value }), { step: 0.005 });
      addCheckboxField('Mirror', layer.properties.mirror ?? true, (value) => updateProperties({ mirror: value }));
      addNumberField('Shadow', layer.properties.shadowLength ?? 0.35, (value) => updateProperties({ shadowLength: clamp(value, 0, 1) }), { step: 0.05 });
      addColorField('Shadow Color', layer.properties.shadowColor || '#3d1117', (value) => updateProperties({ shadowColor: value }));
    }
  }
}

function renderScenes() {
  elements.sceneStrip.innerHTML = '';
  const duration = getAudioDuration();
  const scenes = getPreviewScenes();
  const currentTime = getRenderTime();
  for (const scene of scenes) {
    const button = document.createElement('button');
    button.type = 'button';
    const active = currentTime >= scene.start && currentTime < scene.end;
    button.className = `scene-chip${active ? ' active' : ''}`;
    const sceneDuration = Math.max(0.1, (scene.end || 0) - (scene.start || 0));
    button.textContent = truncateSceneLabel(scene.name);
    button.title = `${scene.name}: ${formatTime(scene.start)} - ${formatTime(scene.end)}`;
    button.style.flex = `${sceneDuration} 1 0`;
    button.addEventListener('click', () => {
      state.audio.preview.seek(scene.start || 0);
      renderDynamicFrame();
    });
    elements.sceneStrip.append(button);
  }
}

function truncateSceneLabel(value, maxLength = 34) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function renderLyrics() {
  state.lyrics.currentCue = findCurrentLyric(state.lyrics.cues, getRenderTime());

  if (state.lyrics.status === 'loading') {
    elements.lyricsMeta.textContent = 'Lyrics';
    elements.lyricsLine.textContent = 'Loading timed lyrics...';
    return;
  }
  if (state.lyrics.status === 'missing') {
    elements.lyricsMeta.textContent = 'Lyrics';
    elements.lyricsLine.textContent = 'No lyrics asset in this project';
    return;
  }
  if (state.lyrics.status === 'error') {
    elements.lyricsMeta.textContent = 'Lyrics';
    elements.lyricsLine.textContent = 'Lyrics unavailable';
    return;
  }
  if (!state.lyrics.currentCue) {
    elements.lyricsMeta.textContent = `${state.lyrics.cues.length} cues`;
    elements.lyricsLine.textContent = '...';
    return;
  }

  elements.lyricsMeta.textContent = formatTime(state.lyrics.currentCue.start);
  elements.lyricsLine.textContent = state.lyrics.currentCue.text;
}

function renderLyricsNavigator() {
  const cues = getRenderableLyricCues(state.lyrics.cues);
  const filter = String(state.lyrics.filter || '').trim().toLowerCase();
  const filtered = filter ? cues.filter((cue) => cue.text.toLowerCase().includes(filter)) : cues;
  elements.lyricsCount.textContent = `${filtered.length}/${cues.length} lines`;
  elements.lyricsList.innerHTML = '';

  if (!cues.length) {
    elements.lyricsList.innerHTML = '<div class="empty-state">No sung lyrics.</div>';
    return;
  }

  for (const cue of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lyrics-cue${state.lyrics.currentCue?.index === cue.index ? ' active' : ''}`;
    button.title = `${formatTime(cue.start)} - ${formatTime(cue.end)}`;
    button.addEventListener('click', () => {
      state.audio.preview.seek(cue.start);
      renderDynamicFrame();
    });

    const time = document.createElement('time');
    time.textContent = formatTime(cue.start);
    const text = document.createElement('span');
    text.textContent = cue.text;
    button.append(time, text);
    elements.lyricsList.append(button);
  }
}

function addSection(title) {
  const item = document.createElement('div');
  item.className = 'section-title';
  item.textContent = title;
  elements.inspectorForm.append(item);
}

function addField(label, input) {
  const row = document.createElement('div');
  row.className = 'field';
  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  row.append(labelElement, input);
  elements.inspectorForm.append(row);
}

function addTextField(label, value, onChange) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  addField(label, input);
  return input;
}

function addFontFamilyField(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'font-field-control';
  const select = document.createElement('select');
  const custom = document.createElement('input');
  custom.type = 'text';
  custom.value = value;
  custom.placeholder = 'Custom font name';

  const options = getFontFamilyOptions(value);
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    select.append(item);
  }
  const refreshItem = document.createElement('option');
  refreshItem.value = FONT_SELECT_REFRESH_VALUE;
  refreshItem.textContent = 'Refresh system font list...';
  select.append(refreshItem);
  if ('queryLocalFonts' in window) {
    const item = document.createElement('option');
    item.value = FONT_SELECT_LOAD_VALUE;
    item.textContent = state.fonts.status === 'ready'
      ? 'Refresh from browser font list...'
      : 'Load browser font list...';
    select.append(item);
  }
  select.value = options.includes(value) ? value : (options[0] || '');
  select.addEventListener('change', async () => {
    if (select.value === FONT_SELECT_REFRESH_VALUE) {
      await loadSystemFontFamilies({ refresh: true });
      await loadProjectFontFaces();
      renderInspector();
      setStatus(`System font list refreshed: ${state.fonts.families.length} fonts`);
      return;
    }
    if (select.value === FONT_SELECT_LOAD_VALUE) {
      await loadBrowserFontFamilies();
      renderInspector();
      return;
    }
    custom.value = select.value;
    await loadServerFontFaceByFamily(select.value);
    onChange(select.value);
  });
  custom.addEventListener('change', async () => {
    const nextValue = custom.value.trim();
    if (!nextValue) return;
    await loadServerFontFaceByFamily(nextValue);
    onChange(nextValue);
  });
  wrapper.append(select, custom);
  addField(label, wrapper);
  return wrapper;
}

function addTextareaField(label, value, onChange, options = {}) {
  const input = document.createElement('textarea');
  input.value = value;
  input.addEventListener(options.live ? 'input' : 'change', () => onChange(input.value));
  addField(label, input);
  return input;
}

function addColorField(label, value, onChange) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = normalizeColor(value);
  input.addEventListener('input', () => onChange(input.value));
  addField(label, input);
  return input;
}

function addNumberField(label, value, onChange, options = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = options.step || 1;
  input.value = value;
  input.addEventListener('change', () => {
    if (input.value === '') return onChange(undefined);
    onChange(Number(input.value));
  });
  addField(label, input);
  return input;
}

function addCheckboxField(label, value, onChange) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(value);
  input.addEventListener('change', () => onChange(input.checked));
  addField(label, input);
  return input;
}

function addSelectField(label, value, options, onChange, getLabel = (option) => option) {
  const input = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = getLabel(option);
    input.append(item);
  }
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  addField(label, input);
  return input;
}

function addButtonRow(items) {
  const row = document.createElement('div');
  row.className = 'field button-field';
  const spacer = document.createElement('label');
  spacer.textContent = '';
  const actions = document.createElement('div');
  actions.className = 'field-actions';
  for (const [label, handler] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    actions.append(button);
  }
  row.append(spacer, actions);
  elements.inspectorForm.append(row);
}

function createTypographyInspectorApi(layer) {
  return {
    layer,
    form: elements.inspectorForm,
    presets: getProjectTypographyPresets(),
    selectedLineId: state.typography.selectedLineId,
    snapping: state.typography.snapping,
    addSection,
    addTextField,
    addFontFamilyField,
    addTextareaField,
    addColorField,
    addNumberField,
    addCheckboxField,
    addSelectField,
    addButtonRow,
    updateText: updateSelectedTextContent,
    updateProperties,
    updateTypography: updateSelectedTypography,
    updateLineEditing: updateSelectedLineEditing,
    updateLine: updateSelectedTextLine,
    updateEffect: updateSelectedTextEffect,
    updateTexture: updateSelectedTextureMask,
    selectPreset: selectTypographyPreset,
    applyPreset: applySelectedTypographyPreset,
    savePreset: saveSelectedTypographyPreset,
    selectLine: selectTextLine,
    updateSnapping: (value) => {
      state.typography.snapping = value;
      renderCanvas();
    },
    importTexture: () => elements.textTextureFileInput.click()
  };
}

function updateSelectedTextContent(value) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  const nextProperties = syncLegacyTextProperties({
    ...properties,
    text: value,
    lineEditing: reconcileTextLines(value, properties.lineEditing)
  });
  updateLayerPropertiesLightweight(layer, nextProperties);
}

function updateSelectedTypography(patch) {
  updateAdvancedTextProperties((properties) => ({
    ...properties,
    typography: {
      ...properties.typography,
      ...patch
    },
    typographyPresetId: 'custom'
  }));
}

function updateSelectedLineEditing(patch) {
  updateAdvancedTextProperties((properties) => ({
    ...properties,
    lineEditing: reconcileTextLines(properties.text || '', {
      ...properties.lineEditing,
      ...patch
    }),
    typographyPresetId: 'custom'
  }));
}

function updateSelectedTextLine(lineId, patch) {
  updateAdvancedTextProperties((properties) => ({
    ...properties,
    lineEditing: {
      ...reconcileTextLines(properties.text || '', properties.lineEditing),
      lines: reconcileTextLines(properties.text || '', properties.lineEditing).lines.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line
      )
    },
    typographyPresetId: 'custom'
  }));
}

function updateSelectedTextEffect(effectName, patch) {
  updateAdvancedTextProperties((properties) => ({
    ...properties,
    textEffects: {
      ...properties.textEffects,
      [effectName]: {
        ...properties.textEffects[effectName],
        ...patch
      }
    },
    typographyPresetId: 'custom'
  }));
}

function updateSelectedTextureMask(patch) {
  updateAdvancedTextProperties((properties) => ({
    ...properties,
    textureMask: {
      ...properties.textureMask,
      ...patch
    },
    typographyPresetId: 'custom'
  }));
}

function updateAdvancedTextProperties(updater) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  const current = normalizeAdvancedTextProperties(layer.properties || {});
  const next = syncLegacyTextProperties(updater(current));
  state.project = updateLayer(state.project, layer.id, { properties: next });
  markDirty();
}

function updateLayerPropertiesLightweight(layer, properties) {
  state.project = updateLayer(state.project, layer.id, { properties });
  state.dirty = true;
  state.renderProject = buildRenderProject();
  elements.projectName.textContent = `${state.project.name} *`;
  elements.saveButton.disabled = false;
  renderLayers();
  renderCanvas();
}

function selectTypographyPreset(presetId) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  updateProperties({ typographyPresetId: presetId });
}

function applySelectedTypographyPreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  const preset = getProjectTypographyPresets().find((item) => item.id === properties.typographyPresetId);
  if (!preset) {
    setStatus('Choose a typography preset first');
    return;
  }
  state.project = updateLayer(state.project, layer.id, applyTypographyPreset(layer, preset));
  markDirty();
  setStatus(`Typography preset applied: ${preset.name}`);
}

function saveSelectedTypographyPreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  const name = window.prompt('Typography preset name', `${layer.name} Typography`);
  if (name === null || !name.trim()) return;
  const preset = createTypographyPresetFromLayer(layer, { name: name.trim() });
  state.project = upsertProjectTypographyPreset(state.project, preset);
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...(layer.properties || {}),
      typographyPresetId: preset.id
    }
  });
  markDirty();
  setStatus(`Typography preset saved: ${preset.name}`);
}

function selectTextLine(lineId) {
  state.typography.selectedLineId = lineId;
  renderInspector();
  renderCanvas();
}

function renderCanvas() {
  const project = state.renderProject || state.project;
  const { width, height, backgroundColor } = project.composition;
  if (elements.canvas.width !== width) elements.canvas.width = width;
  if (elements.canvas.height !== height) elements.canvas.height = height;
  elements.canvas.style.aspectRatio = `${width} / ${height}`;
  fitStageCanvasToViewport(width, height);

  context.clearRect(0, 0, width, height);
  if (!state.exportOverlay?.enabled) {
    context.fillStyle = backgroundColor || '#05070a';
    context.fillRect(0, 0, width, height);
  }

  state.typography.layouts.clear();
  for (const sourceLayer of sortLayersForRender(project.layers)) {
    const layer = evaluateLayerAnimations(sourceLayer, getRenderTime());
    if (!layer.visible) continue;
    if (shouldSkipLayerForExportOverlay(layer)) continue;
    context.save();
    context.globalAlpha = clamp(layer.opacity ?? 1, 0, 1);
    context.globalCompositeOperation = mapBlendMode(layer.blendMode);
    applyTransform(layer);

    if (layer.type === 'shape') drawShapeLayer(layer);
    if (layer.type === 'image') drawImageLayer(layer);
    if (layer.type === 'video') drawVideoLayer(layer);
    if (layer.type === 'text') {
      const layout = drawTextLayer(layer);
      state.typography.layouts.set(layer.id, layout);
    }
    if (layer.type === 'lyrics') drawLyricsLayer(layer);
    if (layer.type === 'visualizer') drawVisualizerLayer(layer);

    context.restore();
  }

  if (shouldDrawTextSelectionOverlay()) {
    drawTextSelectionOverlay();
  }
}

function fitStageCanvasToViewport(width = elements.canvas.width, height = elements.canvas.height) {
  if (!elements.stageFrame || !width || !height) return;
  const rect = elements.stageFrame.getBoundingClientRect();
  const style = getComputedStyle(elements.stageFrame);
  const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
  const paddingY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
  const availableWidth = Math.max(1, rect.width - paddingX);
  const availableHeight = Math.max(1, rect.height - paddingY);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  elements.canvas.style.width = `${Math.max(1, Math.floor(width * scale))}px`;
  elements.canvas.style.height = `${Math.max(1, Math.floor(height * scale))}px`;
}

function shouldSkipLayerForExportOverlay(layer) {
  if (!state.exportOverlay?.enabled) return false;
  if (layer.type === 'video') return true;
  return Number(layer.order || 0) <= Number(state.exportOverlay.baseOrder || 0);
}

function applyTransform(layer) {
  const transform = layer.transform || {};
  context.translate(transform.x || 0, transform.y || 0);
  context.rotate(((transform.rotation || 0) * Math.PI) / 180);
  context.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
}

function drawShapeLayer(layer) {
  const transform = layer.transform || {};
  const width = transform.width || (state.renderProject || state.project).composition.width;
  const height = transform.height || (state.renderProject || state.project).composition.height;
  const anchorX = transform.anchorX ?? 0.5;
  const anchorY = transform.anchorY ?? 0.5;
  context.fillStyle = layer.properties.fill || '#000000';
  context.fillRect(-width * anchorX, -height * anchorY, width, height);
}

function drawImageLayer(layer) {
  const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
  if (!asset || asset.missing) {
    drawMissingMedia(layer);
    return;
  }

  const image = getImage(asset.id);
  if (!image.complete || !image.naturalWidth) {
    image.onload = renderCanvas;
    drawMissingMedia(layer, 'Loading image');
    return;
  }

  const transform = layer.transform || {};
  const width = transform.width || image.naturalWidth;
  const height = transform.height || image.naturalHeight;
  const box = fitImage(image, width, height, layer.properties.fit || 'cover');
  context.drawImage(image, box.sx, box.sy, box.sw, box.sh, -width * (transform.anchorX ?? 0.5), -height * (transform.anchorY ?? 0.5), width, height);
}

function drawVideoLayer(layer) {
  const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
  if (!asset || asset.missing) {
    drawMissingMedia(layer, 'Missing video');
    return;
  }

  const exportEntry = state.videoExportContext?.entries?.get(layer.id);
  if (exportEntry?.currentFrame) {
    const drawStartedAt = performance.now();
    drawVideoSource(layer, exportEntry.currentFrame, exportEntry.currentFrame.displayWidth || exportEntry.currentFrame.codedWidth, exportEntry.currentFrame.displayHeight || exportEntry.currentFrame.codedHeight);
    if (state.exportVideoBenchmark) {
      state.exportVideoBenchmark.videoDrawMs += performance.now() - drawStartedAt;
    }
    return;
  }

  const video = getVideo(asset.id, layer.properties);
  if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawMissingMedia(layer, 'Loading video');
    return;
  }

  if (!Number.isFinite(state.renderTimeOverride) && layer.properties.syncMode !== 'free-loop') {
    syncVideoLayerPreview(layer.id);
  }
  if (!Number.isFinite(state.renderTimeOverride) && state.audio.preview.playing && video.paused) {
    video.play().catch(() => {});
  }
  if (!state.audio.preview.playing && !video.paused && layer.properties.syncMode !== 'free-loop') {
    video.pause();
  }

  const drawStartedAt = performance.now();
  drawVideoSource(layer, video, video.videoWidth, video.videoHeight);
  if (state.exportVideoBenchmark) {
    state.exportVideoBenchmark.videoDrawMs += performance.now() - drawStartedAt;
  }
}

function drawVideoSource(layer, source, sourceWidth, sourceHeight) {
  const transform = layer.transform || {};
  const width = transform.width || sourceWidth;
  const height = transform.height || sourceHeight;
  const box = fitMedia(sourceWidth, sourceHeight, width, height, layer.properties.fit || 'cover');
  context.drawImage(source, box.sx, box.sy, box.sw, box.sh, -width * (transform.anchorX ?? 0.5), -height * (transform.anchorY ?? 0.5), width, height);
}

function drawTextLayer(layer) {
  return drawAdvancedTextLayer(context, layer, {
    time: getRenderTime(),
    getTextureImage: (assetId) => {
      const asset = getAssetById(assetId);
      if (!asset || asset.missing || asset.type !== 'image') return null;
      const image = getImage(asset.id);
      if (!image.complete || !image.naturalWidth) image.onload = renderCanvas;
      return image;
    }
  });
}

function shouldDrawTextSelectionOverlay() {
  const layer = getSelectedLayer();
  return layer?.type === 'text' &&
    layer.visible &&
    !state.exportControl.busy &&
    !Number.isFinite(state.renderTimeOverride) &&
    !document.body.classList.contains('headless-export');
}

function drawTextSelectionOverlay() {
  const layer = getSelectedLayer();
  const layout = state.typography.layouts.get(layer?.id);
  if (!layer || !layout) return;
  const properties = normalizeAdvancedTextProperties(layer.properties || {});

  context.save();
  applyTransform(layer);
  applyTypographyTransform(context, layout, properties.typography);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.shadowColor = 'transparent';
  context.setLineDash([10, 7]);
  context.lineWidth = Math.max(1, 2 / Math.max(0.1, Math.abs(layer.transform?.scaleX || 1)));
  context.strokeStyle = '#4fb3ff';
  context.strokeRect(layout.left, layout.top, layout.width, layout.height);
  context.setLineDash([]);

  const handles = getTextOverlayHandles(layout);
  for (const handle of Object.values(handles)) {
    context.beginPath();
    context.fillStyle = handle.type === 'rotate' ? '#ffcf4f' : '#f5f7fb';
    context.strokeStyle = '#0a1018';
    context.lineWidth = 2;
    context.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  const selectedLine = layout.lines.find((line) => line.id === state.typography.selectedLineId);
  if (properties.lineEditing.enabled && selectedLine) {
    context.save();
    context.strokeStyle = '#ff4f67';
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect(
      selectedLine.bounds.left,
      selectedLine.bounds.top,
      Math.max(1, selectedLine.bounds.width),
      Math.max(1, selectedLine.bounds.height)
    );
    context.restore();
  }
  context.restore();

  drawTextAlignmentGuides();
  drawTextOverlayReadout(layer, layout);
}

function drawTextOverlayReadout(layer, layout) {
  const topLeft = textLocalToProjectPoint(layer, layout, { x: layout.left, y: layout.top });
  context.save();
  context.font = '16px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'bottom';
  context.fillStyle = 'rgba(8, 13, 20, 0.86)';
  const label = `${Math.round(layout.width)} x ${Math.round(layout.height)}  @ ${Math.round(layer.transform?.x || 0)}, ${Math.round(layer.transform?.y || 0)}`;
  const width = context.measureText(label).width + 16;
  context.fillRect(topLeft.x, topLeft.y - 29, width, 24);
  context.fillStyle = '#e9f4ff';
  context.fillText(label, topLeft.x + 8, topLeft.y - 7);
  context.restore();
}

function drawTextAlignmentGuides() {
  if (!state.typography.guides.length) return;
  context.save();
  context.strokeStyle = '#ff4f67';
  context.lineWidth = 1;
  context.setLineDash([8, 6]);
  for (const guide of state.typography.guides) {
    context.beginPath();
    if (guide.axis === 'x') {
      context.moveTo(guide.value, 0);
      context.lineTo(guide.value, elements.canvas.height);
    } else {
      context.moveTo(0, guide.value);
      context.lineTo(elements.canvas.width, guide.value);
    }
    context.stroke();
  }
  context.restore();
}

function getTextOverlayHandles(layout) {
  return {
    nw: { type: 'resize', corner: 'nw', x: layout.left, y: layout.top },
    ne: { type: 'resize', corner: 'ne', x: layout.right, y: layout.top },
    sw: { type: 'resize', corner: 'sw', x: layout.left, y: layout.bottom },
    se: { type: 'resize', corner: 'se', x: layout.right, y: layout.bottom },
    rotate: { type: 'rotate', x: layout.left + layout.width / 2, y: layout.top - 36 }
  };
}

function beginTextCanvasInteraction(event) {
  if (event.button !== 0 || state.exportControl.busy) return;
  const layer = getSelectedLayer();
  const layout = state.typography.layouts.get(layer?.id);
  if (!layer || layer.type !== 'text' || layer.locked || !layout) return;
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  const projectPoint = canvasEventToProjectPoint(event);
  const localPoint = projectToTextLocalPoint(layer, layout, properties.typography, projectPoint);
  const handle = findTextHandle(layout, localPoint);
  const selectedLine = findTextLineAtPoint(layout, localPoint);
  let mode = '';
  if (handle?.type === 'rotate') mode = 'rotate';
  else if (handle?.type === 'resize') mode = 'resize';
  else if (properties.lineEditing.enabled && selectedLine) mode = 'line';
  else if (pointInside(localPoint, layout)) mode = 'move';
  if (!mode) return;

  if (selectedLine) state.typography.selectedLineId = selectedLine.id;
  state.typography.interaction = {
    mode,
    pointerId: event.pointerId,
    handle,
    lineId: selectedLine?.id || '',
    startProject: projectPoint,
    startLocal: localPoint,
    originalLayer: structuredClone(layer),
    originalProperties: properties
  };
  elements.canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  renderInspector();
  renderCanvas();
}

function updateTextCanvasInteraction(event) {
  const interaction = state.typography.interaction;
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const projectPoint = canvasEventToProjectPoint(event);
  const layer = state.project.layers.find((item) => item.id === interaction.originalLayer.id);
  const layout = state.typography.layouts.get(layer?.id);
  if (!layer || !layout) return;
  const localPoint = projectToTextLocalPoint(
    interaction.originalLayer,
    layout,
    interaction.originalProperties.typography,
    projectPoint
  );
  state.typography.guides = [];

  if (interaction.mode === 'move') {
    const transform = interaction.originalLayer.transform || {};
    const deltaX = projectPoint.x - interaction.startProject.x;
    const deltaY = projectPoint.y - interaction.startProject.y;
    const snapped = snapTextLayerPosition(
      Number(transform.x || 0) + deltaX,
      Number(transform.y || 0) + deltaY,
      layout,
      transform
    );
    applyInteractiveTextLayerPatch(layer.id, {
      transform: {
        ...layer.transform,
        x: snapped.x,
        y: snapped.y
      }
    });
  } else if (interaction.mode === 'resize') {
    const transform = interaction.originalLayer.transform || {};
    const anchorX = Number(transform.anchorX ?? 0.5);
    const anchorY = Number(transform.anchorY ?? 0.5);
    const corner = interaction.handle.corner;
    const widthDivisor = corner.endsWith('e') ? Math.max(0.01, 1 - anchorX) : Math.max(0.01, anchorX);
    const heightDivisor = corner.startsWith('s') ? Math.max(0.01, 1 - anchorY) : Math.max(0.01, anchorY);
    applyInteractiveTextLayerPatch(layer.id, {
      transform: {
        ...layer.transform,
        width: Math.max(20, Math.abs(localPoint.x) / widthDivisor),
        height: Math.max(20, Math.abs(localPoint.y) / heightDivisor)
      }
    });
  } else if (interaction.mode === 'rotate') {
    const angle = Math.atan2(
      projectPoint.y - Number(interaction.originalLayer.transform?.y || 0),
      projectPoint.x - Number(interaction.originalLayer.transform?.x || 0)
    ) * 180 / Math.PI + 90;
    applyInteractiveTextLayerPatch(layer.id, {
      transform: {
        ...layer.transform,
        rotation: event.shiftKey ? Math.round(angle / 15) * 15 : angle
      }
    });
  } else if (interaction.mode === 'line') {
    const deltaX = localPoint.x - interaction.startLocal.x;
    const deltaY = localPoint.y - interaction.startLocal.y;
    const lines = interaction.originalProperties.lineEditing.lines.map((line) =>
      line.id === interaction.lineId
        ? { ...line, offsetX: line.offsetX + deltaX, offsetY: line.offsetY + deltaY }
        : line
    );
    const nextProperties = syncLegacyTextProperties({
      ...interaction.originalProperties,
      typographyPresetId: 'custom',
      lineEditing: {
        ...interaction.originalProperties.lineEditing,
        lines
      }
    });
    applyInteractiveTextLayerPatch(layer.id, { properties: nextProperties });
  }
  event.preventDefault();
}

function endTextCanvasInteraction(event) {
  const interaction = state.typography.interaction;
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  elements.canvas.releasePointerCapture?.(event.pointerId);
  state.typography.interaction = null;
  state.typography.guides = [];
  renderApp();
}

function focusSelectedTextEditor(event) {
  const layer = getSelectedLayer();
  const layout = state.typography.layouts.get(layer?.id);
  if (!layer || layer.type !== 'text' || !layout) return;
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  const point = projectToTextLocalPoint(layer, layout, properties.typography, canvasEventToProjectPoint(event));
  const line = findTextLineAtPoint(layout, point);
  if (line) state.typography.selectedLineId = line.id;
  renderInspector();
  requestAnimationFrame(() => {
    const textarea = elements.inspectorForm.querySelector('.advanced-text-content');
    textarea?.focus();
    textarea?.select();
  });
}

function applyInteractiveTextLayerPatch(layerId, patch) {
  state.project = updateLayer(state.project, layerId, patch);
  state.dirty = true;
  state.renderProject = buildRenderProject();
  elements.projectName.textContent = `${state.project.name} *`;
  elements.saveButton.disabled = false;
  renderCanvas();
}

function findTextHandle(layout, point) {
  const threshold = 18;
  return Object.values(getTextOverlayHandles(layout)).find((handle) =>
    Math.hypot(point.x - handle.x, point.y - handle.y) <= threshold
  ) || null;
}

function findTextLineAtPoint(layout, point) {
  return [...layout.lines].reverse().find((line) => pointInside(point, {
    left: line.bounds.left - 8,
    top: line.bounds.top - 6,
    right: line.bounds.left + line.bounds.width + 8,
    bottom: line.bounds.top + line.bounds.height + 6
  })) || null;
}

function pointInside(point, box) {
  const right = box.right ?? box.left + box.width;
  const bottom = box.bottom ?? box.top + box.height;
  return point.x >= box.left && point.x <= right && point.y >= box.top && point.y <= bottom;
}

function canvasEventToProjectPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * elements.canvas.width / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * elements.canvas.height / Math.max(1, rect.height)
  };
}

function projectToTextLocalPoint(layer, layout, typography, point) {
  const layerMatrix = new DOMMatrix()
    .translate(Number(layer.transform?.x || 0), Number(layer.transform?.y || 0))
    .rotate(Number(layer.transform?.rotation || 0))
    .scale(Number(layer.transform?.scaleX ?? 1), Number(layer.transform?.scaleY ?? 1));
  const pivotX = layout.left + layout.width * Number(typography.anchorX ?? 0.5);
  const pivotY = layout.top + layout.height * Number(typography.anchorY ?? 0.5);
  const typographyMatrix = new DOMMatrix()
    .translate(Number(typography.offsetX || 0), Number(typography.offsetY || 0))
    .translate(pivotX, pivotY)
    .rotate(Number(typography.rotation || 0))
    .multiply(new DOMMatrix([
      1,
      Math.tan(Number(typography.skewY || 0) * Math.PI / 180),
      Math.tan(Number(typography.skewX || 0) * Math.PI / 180),
      1,
      0,
      0
    ]))
    .scale(
      Number(typography.scaleX ?? 1) * Number(typography.stretchX ?? 1),
      Number(typography.scaleY ?? 1) * Number(typography.stretchY ?? 1)
    )
    .translate(-pivotX, -pivotY);
  return new DOMPoint(point.x, point.y).matrixTransform(layerMatrix.multiply(typographyMatrix).inverse());
}

function textLocalToProjectPoint(layer, layout, point) {
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  const typography = properties.typography;
  const pivotX = layout.left + layout.width * Number(typography.anchorX ?? 0.5);
  const pivotY = layout.top + layout.height * Number(typography.anchorY ?? 0.5);
  const matrix = new DOMMatrix()
    .translate(Number(layer.transform?.x || 0), Number(layer.transform?.y || 0))
    .rotate(Number(layer.transform?.rotation || 0))
    .scale(Number(layer.transform?.scaleX ?? 1), Number(layer.transform?.scaleY ?? 1))
    .translate(Number(typography.offsetX || 0), Number(typography.offsetY || 0))
    .translate(pivotX, pivotY)
    .rotate(Number(typography.rotation || 0))
    .multiply(new DOMMatrix([
      1,
      Math.tan(Number(typography.skewY || 0) * Math.PI / 180),
      Math.tan(Number(typography.skewX || 0) * Math.PI / 180),
      1,
      0,
      0
    ]))
    .scale(
      Number(typography.scaleX ?? 1) * Number(typography.stretchX ?? 1),
      Number(typography.scaleY ?? 1) * Number(typography.stretchY ?? 1)
    )
    .translate(-pivotX, -pivotY);
  return new DOMPoint(point.x, point.y).matrixTransform(matrix);
}

function snapTextLayerPosition(x, y, layout, transform) {
  if (!state.typography.snapping) return { x, y };
  const threshold = 14;
  const composition = state.project.composition;
  const width = layout.width * Math.abs(Number(transform.scaleX ?? 1));
  const height = layout.height * Math.abs(Number(transform.scaleY ?? 1));
  const anchorX = Number(transform.anchorX ?? 0.5);
  const anchorY = Number(transform.anchorY ?? 0.5);
  const candidatesX = [
    { current: x, target: composition.width / 2 },
    { current: x - width * anchorX, target: 0, position: width * anchorX },
    { current: x + width * (1 - anchorX), target: composition.width, position: composition.width - width * (1 - anchorX) }
  ];
  const candidatesY = [
    { current: y, target: composition.height / 2 },
    { current: y - height * anchorY, target: 0, position: height * anchorY },
    { current: y + height * (1 - anchorY), target: composition.height, position: composition.height - height * (1 - anchorY) }
  ];
  let nextX = x;
  let nextY = y;
  const matchX = candidatesX.find((candidate) => Math.abs(candidate.current - candidate.target) <= threshold);
  const matchY = candidatesY.find((candidate) => Math.abs(candidate.current - candidate.target) <= threshold);
  if (matchX) {
    nextX = matchX.position ?? matchX.target;
    state.typography.guides.push({ axis: 'x', value: matchX.target });
  }
  if (matchY) {
    nextY = matchY.position ?? matchY.target;
    state.typography.guides.push({ axis: 'y', value: matchY.target });
  }
  return { x: nextX, y: nextY };
}

function getLyricsGlowSettings(properties = {}) {
  const hasExplicitGlow = ['glowColor', 'glowBlur', 'glowIntensity']
    .some((key) => Object.prototype.hasOwnProperty.call(properties, key));
  const hasLegacyShadowOffset = Number(properties.shadowOffsetX || 0) !== 0 ||
    Number(properties.shadowOffsetY || 0) !== 0;
  const legacyBlur = hasLegacyShadowOffset ? 0 : Number(properties.shadowBlur || 0);
  return {
    color: properties.glowColor || properties.shadowColor || '#000000',
    blur: Math.max(0, Number(hasExplicitGlow ? properties.glowBlur || 0 : legacyBlur)),
    intensity: clamp(hasExplicitGlow ? properties.glowIntensity ?? 1 : legacyBlur > 0 ? 1 : 0, 0, 2)
  };
}

function getLyricsShadowSettings(properties = {}) {
  const hasExplicitGlow = ['glowColor', 'glowBlur', 'glowIntensity']
    .some((key) => Object.prototype.hasOwnProperty.call(properties, key));
  const offsetX = Number(properties.shadowOffsetX || 0);
  const offsetY = Number(properties.shadowOffsetY || 0);
  const legacyActsAsGlow = !hasExplicitGlow && offsetX === 0 && offsetY === 0;
  return {
    color: properties.shadowColor || '#000000',
    blur: Math.max(0, Number(legacyActsAsGlow ? 0 : properties.shadowBlur || 0)),
    offsetX,
    offsetY
  };
}

function drawLyricsGlyphs(targetContext, text, x, y, maxWidth) {
  if (targetContext.lineWidth > 0) targetContext.strokeText(text, x, y, maxWidth);
  targetContext.fillText(text, x, y, maxWidth);
}

function drawLyricsGlow(targetContext, text, x, y, maxWidth, glow) {
  if (glow.blur <= 0 || glow.intensity <= 0) return;
  const passes = Math.ceil(glow.intensity);
  for (let pass = 0; pass < passes; pass += 1) {
    const passOpacity = Math.min(1, glow.intensity - pass);
    if (passOpacity <= 0) continue;
    targetContext.save();
    targetContext.globalAlpha *= passOpacity;
    targetContext.shadowColor = glow.color;
    targetContext.shadowBlur = glow.blur;
    targetContext.shadowOffsetX = 0;
    targetContext.shadowOffsetY = 0;
    drawLyricsGlyphs(targetContext, text, x, y, maxWidth);
    targetContext.restore();
  }
}

function drawLyricsShadow(targetContext, text, x, y, maxWidth, shadow) {
  if (shadow.blur <= 0 && shadow.offsetX === 0 && shadow.offsetY === 0) return;
  targetContext.save();
  targetContext.shadowColor = shadow.color;
  targetContext.shadowBlur = shadow.blur;
  targetContext.shadowOffsetX = shadow.offsetX;
  targetContext.shadowOffsetY = shadow.offsetY;
  drawLyricsGlyphs(targetContext, text, x, y, maxWidth);
  targetContext.restore();
}

function drawLyricsLayer(layer) {
  const transform = layer.transform || {};
  const width = transform.width || 1100;
  const height = transform.height || 160;
  const anchorX = transform.anchorX ?? 0.5;
  const anchorY = transform.anchorY ?? 0.5;
  const left = -width * anchorX;
  const top = -height * anchorY;
  const props = layer.properties || {};
  const text = getLyricsLayerText(layer);
  const transitionOpacity = calculateLyricsTransitionOpacity(state.lyrics.currentCue, getRenderTime(), props.transition);
  const glow = getLyricsGlowSettings(props);
  const shadow = getLyricsShadowSettings(props);
  const cacheKey = buildLyricsRenderCacheKey({
    text,
    width,
    height,
    originX: -left,
    properties: props,
    glow,
    shadow
  });
  const bitmap = lyricsRenderCache.getOrCreate(layer.id, cacheKey, () => createLyricsLayerBitmap({
    text,
    width,
    height,
    left,
    props,
    glow,
    shadow
  }));

  context.globalAlpha *= transitionOpacity;
  context.drawImage(bitmap.canvas, left - bitmap.effectPadding, top - bitmap.effectPadding);
}

function createLyricsLayerBitmap({ text, width, height, left, props, glow, shadow }) {
  const effectPadding = calculateLyricsEffectPadding({
    strokeWidth: props.strokeWidth,
    glow,
    shadow
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width + effectPadding * 2));
  canvas.height = Math.max(1, Math.ceil(height + effectPadding * 2));
  const bitmapContext = canvas.getContext('2d');
  if (!bitmapContext) throw new Error('Lyrics bitmap context is unavailable.');

  const fontSize = Number(props.fontSize || 48);
  const padding = Number(props.padding ?? 24);
  const radius = Number(props.radius ?? 8);
  const backgroundOpacity = clamp(props.backgroundOpacity ?? 0, 0, 1);
  const lineHeight = fontSize * Number(props.lineHeight || 1.18);
  const maxLines = Math.max(1, Math.round(Number(props.maxLines || 2)));
  const innerWidth = Math.max(10, width - padding * 2);
  const font = `${fontSize}px ${cssFont(props.fontFamily || 'Arial')}`;
  const lines = wrapText(text, innerWidth, font, maxLines, bitmapContext);

  if (backgroundOpacity > 0) {
    bitmapContext.save();
    bitmapContext.globalAlpha = backgroundOpacity;
    bitmapContext.fillStyle = props.backgroundColor || '#000000';
    drawRoundedRect(bitmapContext, effectPadding, effectPadding, width, height, radius);
    bitmapContext.fill();
    bitmapContext.restore();
  }

  bitmapContext.font = font;
  bitmapContext.textAlign = props.align || 'center';
  bitmapContext.textBaseline = 'middle';
  bitmapContext.lineJoin = 'round';
  bitmapContext.fillStyle = props.color || '#ffffff';
  bitmapContext.strokeStyle = props.strokeColor || '#000000';
  bitmapContext.lineWidth = Number(props.strokeWidth || 0);

  const textHeight = (lines.length - 1) * lineHeight;
  const startY = effectPadding + height / 2 - textHeight / 2;
  const x = props.align === 'left'
    ? effectPadding + padding
    : props.align === 'right'
      ? effectPadding + width - padding
      : effectPadding - left;

  for (let index = 0; index < lines.length; index += 1) {
    const y = startY + index * lineHeight;
    drawLyricsGlow(bitmapContext, lines[index], x, y, innerWidth, glow);
    drawLyricsShadow(bitmapContext, lines[index], x, y, innerWidth, shadow);
    drawLyricsGlyphs(bitmapContext, lines[index], x, y, innerWidth);
  }
  return { canvas, effectPadding };
}

function drawVisualizerLayer(layer) {
  const transform = layer.transform || {};
  const width = transform.width || 600;
  const height = transform.height || 120;
  const bars = Math.max(1, Number(layer.properties.bars || 64));
  const style = normalizeVisualizerType(layer.properties.visualizerType);
  if (style === 'waveform') {
    drawWaveformVisualizer(layer, width, height);
    return;
  }
  if (style === 'radial-spectrum') {
    drawRadialSpectrumVisualizer(layer, width, height, bars);
    return;
  }

  const gap = Math.max(2, width / bars * 0.18);
  const barWidth = (width - gap * (bars - 1)) / bars;
  const left = -width * (transform.anchorX ?? 0.5);
  const top = -height * (transform.anchorY ?? 0.5);
  const bottom = top + height;
  const center = top + height / 2;

  const bins = mapFrequencyBinsToBars(state.audio.frame.frequencyBins || [], bars, {
    minFrequency: layer.properties.minFrequency,
    maxFrequency: layer.properties.maxFrequency,
    gain: layer.properties.gain ?? 1,
    sensitivity: layer.properties.sensitivity ?? 1.08,
    floor: layer.properties.floor ?? 0.04,
    highFrequencyBoost: layer.properties.highFrequencyBoost ?? 0.75,
    lowFrequencyDamping: layer.properties.lowFrequencyDamping,
    midFrequencyDamping: layer.properties.midFrequencyDamping,
    noiseGate: layer.properties.noiseGate,
    sampleRate: state.audio.frame.sampleRate || 44100
  });
  for (let i = 0; i < bars; i += 1) {
    const t = i / Math.max(1, bars - 1);
    const binValue = bins.length ? bins[i] || 0 : Math.abs(Math.sin(t * Math.PI * 3.5));
    const wave = 0.08 + 0.9 * binValue;
    const barHeight = Math.max(4, height * wave);
    context.fillStyle = i % 8 === 0 ? (layer.properties.accentColor || '#b50f1d') : (layer.properties.color || '#ededed');
    if (style === 'center-bars') {
      context.fillRect(left + i * (barWidth + gap), center - barHeight / 2, barWidth, barHeight);
    } else {
      context.fillRect(left + i * (barWidth + gap), bottom - barHeight, barWidth, barHeight);
    }
  }
}

function drawWaveformVisualizer(layer, width, height) {
  const transform = layer.transform || {};
  const left = -width * (transform.anchorX ?? 0.5);
  const top = -height * (transform.anchorY ?? 0.5);
  const center = top + height / 2;
  const bins = state.audio.frame.waveform || [];
  context.strokeStyle = layer.properties.color || '#ededed';
  context.lineWidth = 3;
  context.beginPath();
  const points = Math.min(width, bins.length || 0);
  for (let i = 0; i < points; i += 1) {
    const x = left + (i / Math.max(1, points - 1)) * width;
    const y = center + (bins[i] || 0) * height * 0.42;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function drawRadialSpectrumVisualizer(layer, width, height, bars) {
  const props = layer.properties || {};
  const maxAutoRadius = Math.max(1, Math.min(width, height) / 2);
  const innerRadius = Math.max(0, Number(props.innerRadius ?? maxAutoRadius * 0.36));
  const outerRadius = Math.max(innerRadius + 1, Number(props.outerRadius ?? maxAutoRadius * 0.92));
  const maxBarHeight = Math.max(1, outerRadius - innerRadius);
  const mirror = props.mirror !== false;
  const totalSlots = mirror ? bars * 2 : bars;
  const arc = Math.max(1, Math.min(360, Number(props.arc ?? 360)));
  const startAngle = Number(props.startAngle ?? -90) + Number(props.rotationSpeed ?? 0) * getRenderTime() * 360;
  const angleStep = (arc * Math.PI / 180) / Math.max(1, totalSlots);
  const baseAngle = startAngle * Math.PI / 180;
  const barThickness = Math.max(1, Number(props.barThickness ?? 4));
  const shadowLength = clamp(Number(props.shadowLength ?? 0.35), 0, 1);
  const bins = mapFrequencyBinsToBars(state.audio.frame.frequencyBins || [], bars, {
    minFrequency: props.minFrequency,
    maxFrequency: props.maxFrequency,
    gain: props.gain ?? 1,
    sensitivity: props.sensitivity ?? 1.08,
    floor: props.floor ?? 0.04,
    highFrequencyBoost: props.highFrequencyBoost ?? 0.75,
    lowFrequencyDamping: props.lowFrequencyDamping,
    midFrequencyDamping: props.midFrequencyDamping,
    noiseGate: props.noiseGate,
    sampleRate: state.audio.frame.sampleRate || 44100
  });

  context.save();
  context.globalCompositeOperation = layer.blendMode === 'screen' ? 'screen' : 'source-over';
  for (let i = 0; i < totalSlots; i += 1) {
    const sourceIndex = mirror ? (i < bars ? i : totalSlots - 1 - i) : i;
    const value = bins.length ? bins[sourceIndex] || 0 : 0.18;
    const angle = baseAngle + angleStep * (i + 0.5);
    const barHeight = Math.max(1, value * maxBarHeight);
    const x = Math.cos(angle) * innerRadius;
    const y = Math.sin(angle) * innerRadius;
    context.save();
    context.translate(x, y);
    context.rotate(angle + Math.PI / 2);
    context.fillStyle = i % 8 === 0 ? (props.accentColor || '#b50f1d') : (props.color || '#ededed');
    context.fillRect(-barThickness / 2, -barHeight, barThickness, barHeight);
    if (shadowLength > 0) {
      context.fillStyle = props.shadowColor || '#3d1117';
      context.fillRect(-barThickness / 2, 0, barThickness, barHeight * shadowLength);
    }
    context.restore();
  }
  context.strokeStyle = props.accentColor || '#b50f1d';
  context.globalAlpha = Math.min(context.globalAlpha, 0.45);
  context.lineWidth = 2;
  context.beginPath();
  if (arc >= 359.5) {
    context.arc(0, 0, innerRadius, 0, Math.PI * 2);
  } else {
    context.arc(0, 0, innerRadius, baseAngle, baseAngle + arc * Math.PI / 180);
  }
  context.stroke();
  context.restore();
}

function drawMissingMedia(layer, label = 'Missing media') {
  const transform = layer.transform || {};
  const width = transform.width || 320;
  const height = transform.height || 200;
  context.strokeStyle = '#b50f1d';
  context.lineWidth = 4;
  context.strokeRect(-width / 2, -height / 2, width, height);
  context.fillStyle = '#b50f1d';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '32px Arial';
  context.fillText(label, 0, 0, width - 24);
}

function getImage(assetId) {
  if (!state.imageCache.has(assetId)) {
    const image = new Image();
    image.src = `/api/assets/${encodeURIComponent(assetId)}?v=${Date.now()}`;
    state.imageCache.set(assetId, image);
  }
  return state.imageCache.get(assetId);
}

function getVideo(assetId, properties = {}) {
  if (!state.videoCache.has(assetId)) {
    const video = document.createElement('video');
    video.src = `/api/assets/${encodeURIComponent(assetId)}?v=${Date.now()}`;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = properties.loop !== false;
    video.crossOrigin = 'anonymous';
    video.addEventListener('loadeddata', renderCanvas);
    video.addEventListener('seeked', renderCanvas);
    state.videoCache.set(assetId, video);
  }
  const video = state.videoCache.get(assetId);
  video.muted = true;
  video.defaultMuted = true;
  video.loop = properties.loop !== false;
  video.playbackRate = Math.max(0.05, Number(properties.playbackRate || 1));
  return video;
}

async function importSelectedCoverFile() {
  const file = elements.coverFileInput.files?.[0];
  elements.coverFileInput.value = '';
  if (!file) return;

  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const extAllowed = /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!allowed.has(file.type) && !extAllowed) {
    setStatus('Cover import supports PNG, JPG, JPEG, WEBP');
    return;
  }

  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'image') return;

  setStatus('Importing cover...');
  const response = await fetch(`/api/assets/import-cover?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    setStatus(`Cover import failed: ${await response.text()}`);
    return;
  }

  const payload = await response.json();
  state.project.assets = payload.project.assets;
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...layer.properties,
      assetId: payload.asset.id
    }
  });
  state.imageCache.delete(payload.asset.id);
  markDirty();
  setStatus('Cover imported');
}

async function importSelectedCoverVideoFile() {
  const file = elements.coverVideoFileInput.files?.[0];
  elements.coverVideoFileInput.value = '';
  if (!file) return;

  const extAllowed = /\.(mp4|webm|mov)$/i.test(file.name);
  const typeAllowed = new Set(['video/mp4', 'video/webm', 'video/quicktime']).has(file.type);
  if (!typeAllowed && !extAllowed) {
    setStatus('Cover Video import supports MP4, WEBM, MOV');
    return;
  }

  const selectedLayer = getSelectedLayer();
  if (!selectedLayer || !['image', 'video'].includes(selectedLayer.type)) {
    setStatus('Select Cover or Cover Video before importing');
    return;
  }

  setStatus('Importing cover video...');
  const response = await fetch(`/api/assets/import-cover-video?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    setStatus(`Cover Video import failed: ${await response.text()}`);
    return;
  }

  const payload = await response.json();
  state.project.assets = payload.project.assets;
  state.videoCache.delete(payload.asset.id);

  if (selectedLayer.type === 'video') {
    state.project = updateLayer(state.project, selectedLayer.id, {
      properties: {
        ...selectedLayer.properties,
        assetId: payload.asset.id
      }
    });
    markDirty();
    setStatus('Cover Video imported');
    return;
  }

  const videoLayer = createCoverVideoLayerFrom(selectedLayer, payload.asset.id);
  const result = addLayer(state.project, videoLayer);
  state.project = result.project;
  state.selectedLayerId = result.addedLayerId;
  markDirty();
  setStatus('Cover Video layer added');
}

async function importSelectedTextTextureFile() {
  const file = elements.textTextureFileInput.files?.[0];
  elements.textTextureFileInput.value = '';
  if (!file) return;
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') {
    setStatus('Select a text layer before importing a texture');
    return;
  }
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) &&
    !new Set(['image/png', 'image/jpeg', 'image/webp']).has(file.type)) {
    setStatus('Text texture import supports PNG, JPG, JPEG, WEBP');
    return;
  }

  setStatus('Importing text texture...');
  const response = await fetch(`/api/assets/import-text-texture?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    setStatus(`Text texture import failed: ${await response.text()}`);
    return;
  }
  const payload = await response.json();
  state.project.assets = payload.project.assets;
  state.imageCache.delete(payload.asset.id);
  updateSelectedTextureMask({
    enabled: true,
    assetId: payload.asset.id
  });
  setStatus('Text texture imported');
}

function revertCoverLayer() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'image') return;
  const original = state.project.assets.find((asset) => asset.type === 'image' && asset.role === 'cover' && !asset.missing && !asset.metadata?.imported);
  if (!original) {
    setStatus('Original source cover not available');
    return;
  }
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...layer.properties,
      assetId: original.id
    }
  });
  markDirty();
  setStatus('Reverted to source cover');
}

function fitImage(image, width, height, fit) {
  return fitMedia(image.naturalWidth, image.naturalHeight, width, height, fit);
}

function fitMedia(sourceWidth, sourceHeight, width, height, fit) {
  if (fit === 'stretch') {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
  }
  const imageRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  if ((fit === 'cover' && imageRatio > targetRatio) || (fit === 'contain' && imageRatio < targetRatio)) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

function createCoverVideoLayerFrom(sourceLayer, assetId) {
  return {
    ...structuredClone(sourceLayer),
    id: createBrowserId('layer'),
    type: 'video',
    name: 'Cover Video',
    locked: false,
    order: Number(sourceLayer.order || 0) + 1,
    properties: {
      assetId,
      fit: sourceLayer.properties?.fit || 'cover',
      loop: true,
      syncMode: 'project-time',
      startOffset: 0,
      playbackRate: 1,
      trimStart: 0,
      trimEnd: 0,
      loopCrossfade: 0,
      radius: sourceLayer.properties?.radius || 0
    },
    audioBindings: [],
    effects: [],
    animations: []
  };
}

function createBrowserId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function selectLayer(layerId) {
  state.selectedLayerId = layerId;
  renderApp();
}

function moveSelected(direction) {
  state.project = reorderLayer(state.project, state.selectedLayerId, direction);
  markDirty();
}

function duplicateSelected() {
  const result = duplicateLayer(state.project, state.selectedLayerId);
  state.project = result.project;
  if (result.duplicatedLayerId) state.selectedLayerId = result.duplicatedLayerId;
  markDirty();
}

function deleteSelected() {
  const selected = getSelectedLayer();
  if (!selected) return;
  if (!window.confirm(`Delete layer "${selected.name}"?`)) return;
  state.project = deleteLayer(state.project, selected.id);
  state.selectedLayerId = state.project.layers[0]?.id || '';
  markDirty();
}

function addLyricsOverlay() {
  const existing = state.project.layers.find((layer) => layer.type === 'lyrics');
  if (existing) {
    state.selectedLayerId = existing.id;
    renderApp();
    setStatus('Lyrics overlay already exists');
    return;
  }

  const layer = createLyricsOverlayLayer({
    composition: state.project.composition,
    end: getAudioDuration(),
    order: Math.max(...state.project.layers.map((item) => Number(item.order || 0)), 0) + 10
  });
  const result = addLayer(state.project, layer);
  state.project = result.project;
  state.selectedLayerId = result.addedLayerId;
  markDirty();
  setStatus('Lyrics overlay added');
}

function openLyricsEditor() {
  if (!state.project.layers.some((layer) => layer.type === 'lyrics')) {
    addLyricsOverlay();
  }
  lyricsEditorController.open();
}

function previewLyricsEditorCues(cues) {
  state.lyrics.sourceCues = structuredClone(cues || []);
  state.lyrics.cues = toRenderableLyricsCues(state.lyrics.sourceCues);
  state.lyrics.status = state.lyrics.cues.length ? 'ready' : 'empty';
  state.lyrics.scenes = buildPreviewScenes();
  state.renderProject = buildRenderProject();
  renderDynamicFrame();
}

async function applyLyricsEditorDocument(documentValue) {
  const response = await fetch('/api/lyrics-editor/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document: documentValue,
      duration: getAudioDuration()
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Lyrics apply failed.');

  state.project = payload.project;
  const normalized = normalizeLyricsDocument(payload.document);
  state.lyrics.document = normalized.document;
  state.lyrics.sourceCues = normalized.cues;
  state.lyrics.cues = toRenderableLyricsCues(normalized.cues);
  state.lyrics.status = state.lyrics.cues.length ? 'ready' : 'empty';
  state.lyrics.scenes = buildPreviewScenes();
  markDirty();
  setStatus('Lyrics applied to project-local asset');
  return payload;
}

function updateSelected(patch) {
  const layer = getSelectedLayer();
  if (!layer) return;
  state.project = updateLayer(state.project, layer.id, patch);
  markDirty();
}

function updateTransform(key, value) {
  const layer = getSelectedLayer();
  if (!layer) return;
  state.project = updateLayer(state.project, layer.id, {
    transform: {
      ...layer.transform,
      [key]: value
    }
  });
  markDirty();
}

function updateProperties(patch) {
  const layer = getSelectedLayer();
  if (!layer) return;
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...layer.properties,
      ...patch
    }
  });
  if (layer.type === 'video') {
    syncVideoLayerPreview(layer.id, { force: true });
  }
  markDirty();
}

function applySelectedLyricsStyle(styleId) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const preset = getProjectLyricsStylePresets().find((item) => item.id === styleId);
  const nextLayer = preset
    ? { ...layer, properties: { ...(layer.properties || {}), styleId: preset.id, ...preset.properties } }
    : applyLyricsStylePreset(layer, styleId);
  state.project = updateLayer(state.project, layer.id, nextLayer);
  markDirty();
}

async function saveSelectedLyricsStylePreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const name = window.prompt('Lyrics style name', `${layer.name || 'Lyrics'} Style`);
  if (name === null) return;
  const presetName = name.trim();
  if (!presetName) {
    setStatus('Lyrics style name is required');
    return;
  }

  let preset = createLyricsStylePresetFromLayer(layer, { name: presetName, scope: 'global' });
  if (getProjectLyricsStylePresets().some((item) => item.id === preset.id)) {
    preset = createLyricsStylePresetFromLayer(layer, {
      id: `${preset.id}-${Date.now().toString(36)}`,
      name: presetName,
      scope: 'global'
    });
  }
  await persistLyricsStylePreset(layer, preset, `Lyrics style saved: ${preset.name}`);
}

async function updateSelectedLyricsStylePreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const presetId = layer.properties.styleId || '';
  if (!presetId || isBuiltInLyricsStylePreset(presetId)) {
    setStatus('Built-in lyrics styles are protected. Use Save New.');
    return;
  }
  const existing = getProjectLyricsStylePresets().find((preset) => preset.id === presetId);
  if (!existing?.custom) {
    setStatus('Only custom lyrics styles can be updated.');
    return;
  }
  const preset = createLyricsStylePresetFromLayer(layer, {
    id: presetId,
    name: existing.name,
    scope: 'global',
    createdAt: existing.createdAt
  });
  await persistLyricsStylePreset(layer, preset, `Lyrics style updated: ${preset.name}`);
}

async function deleteSelectedLyricsStylePreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const presetId = layer.properties.styleId || '';
  const preset = getProjectLyricsStylePresets().find((item) => item.id === presetId);
  if (!preset || isBuiltInLyricsStylePreset(presetId) || !preset.custom) {
    setStatus('Built-in lyrics styles cannot be deleted.');
    return;
  }
  if (!window.confirm(`Delete the global lyrics style "${preset.name}"?`)) return;

  try {
    const response = await fetch('/api/lyrics-style-presets', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: presetId })
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.lyricsStyleLibrary = {
      presets: payload.library?.presets || [],
      path: payload.libraryPath || ''
    };
    state.project = removeProjectLyricsStylePreset(state.project, presetId);
    state.project = updateLayer(state.project, layer.id, applyLyricsStylePreset(layer, 'noir-card'));
    markDirty();
    setStatus(`Lyrics style deleted: ${preset.name}`);
  } catch (error) {
    setStatus(`Lyrics style delete failed: ${error.message || error}`);
  }
}

function resetSelectedLyricsStylePreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  applySelectedLyricsStyle(layer.properties.styleId || 'noir-card');
  setStatus('Lyrics style values restored from preset');
}

async function persistLyricsStylePreset(layer, preset, successMessage) {
  try {
    const response = await fetch('/api/lyrics-style-presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.lyricsStyleLibrary = {
      presets: payload.library?.presets || [],
      path: payload.libraryPath || ''
    };
    state.project = upsertProjectLyricsStylePreset(state.project, preset);
    state.project = updateLayer(state.project, layer.id, {
      properties: {
        ...(layer.properties || {}),
        styleId: preset.id
      }
    });
    markDirty();
    setStatus(successMessage);
  } catch (error) {
    setStatus(`Lyrics style save failed: ${error.message || error}`);
  }
}

function updateLegacyAwareLyricsGlow(patch) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const glow = getLyricsGlowSettings(layer.properties || {});
  const shadow = getLyricsShadowSettings(layer.properties || {});
  updateProperties({
    glowColor: glow.color,
    glowBlur: glow.blur,
    glowIntensity: glow.intensity,
    shadowColor: shadow.color,
    shadowBlur: shadow.blur,
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    ...patch
  });
}

function updateLegacyAwareLyricsShadow(patch) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  const glow = getLyricsGlowSettings(layer.properties || {});
  const shadow = getLyricsShadowSettings(layer.properties || {});
  updateProperties({
    glowColor: glow.color,
    glowBlur: glow.blur,
    glowIntensity: glow.intensity,
    shadowColor: shadow.color,
    shadowBlur: shadow.blur,
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    ...patch
  });
}

function applySelectedTextStyle(styleId) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'text') return;
  const preset = getProjectTextStylePresets().find((item) => item.id === styleId);
  const styledLayer = preset
    ? { ...layer, properties: { ...(layer.properties || {}), textStyleId: preset.id, ...preset.properties } }
    : applyTextStylePreset(layer, styleId);
  const styleProperties = styledLayer.properties || {};
  const normalized = normalizeAdvancedTextProperties(layer.properties || {});
  const nextLayer = {
    ...styledLayer,
    properties: syncLegacyTextProperties({
      ...styleProperties,
      typography: {
        ...normalized.typography,
        fontFamily: styleProperties.fontFamily || normalized.typography.fontFamily,
        color: styleProperties.color || normalized.typography.color
      },
      textEffects: {
        ...normalized.textEffects,
        stroke: {
          ...normalized.textEffects.stroke,
          enabled: Number(styleProperties.strokeWidth || 0) > 0,
          color: styleProperties.strokeColor || normalized.textEffects.stroke.color,
          width: Number(styleProperties.strokeWidth || 0)
        },
        shadow: {
          ...normalized.textEffects.shadow,
          enabled: Number(styleProperties.shadowBlur || 0) > 0 ||
            Number(styleProperties.shadowOffsetX || 0) !== 0 ||
            Number(styleProperties.shadowOffsetY || 0) !== 0,
          color: styleProperties.shadowColor || normalized.textEffects.shadow.color,
          blur: Number(styleProperties.shadowBlur || 0),
          offsetX: Number(styleProperties.shadowOffsetX || 0),
          offsetY: Number(styleProperties.shadowOffsetY || 0)
        }
      }
    })
  };
  state.project = updateLayer(state.project, layer.id, nextLayer);
  markDirty();
}

function applySelectedVisualizerStyle(styleId) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'visualizer') return;
  if (!styleId) {
    updateProperties({ visualizerStyleId: 'custom' });
    return;
  }
  const preset = getProjectVisualizerStylePresets().find((item) => item.id === styleId);
  const nextLayer = preset ? applyVisualizerPresetObject(layer, preset) : applyVisualizerStylePreset(layer, styleId);
  state.project = updateLayer(state.project, layer.id, nextLayer);
  markDirty();
}

function saveSelectedVisualizerPreset() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'visualizer') return;
  const defaultName = layer.properties.visualizerStyleId && layer.properties.visualizerStyleId !== 'custom'
    ? `${layer.name} Custom`
    : layer.name || 'Visualizer Preset';
  const name = window.prompt('Preset name', defaultName);
  if (name === null) return;
  const presetName = name.trim();
  if (!presetName) {
    setStatus('Preset name is required');
    return;
  }
  const preset = createVisualizerPresetFromLayer(layer, { name: presetName });
  state.project = upsertProjectVisualizerStylePreset(state.project, preset);
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...(layer.properties || {}),
      visualizerStyleId: preset.id
    }
  });
  markDirty();
  setStatus(`Visualizer preset saved: ${preset.name}`);
}

async function saveSelectedVisualizerPresetGlobal() {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'visualizer') return;
  const defaultName = layer.properties.visualizerStyleId && layer.properties.visualizerStyleId !== 'custom'
    ? `${layer.name} Global`
    : layer.name || 'Visualizer Preset';
  const name = window.prompt('Global preset name', defaultName);
  if (name === null) return;
  const presetName = name.trim();
  if (!presetName) {
    setStatus('Preset name is required');
    return;
  }
  const preset = createVisualizerPresetFromLayer(layer, { name: presetName });
  const response = await fetch('/api/visualizer-presets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset: { ...preset, scope: 'global' } })
  });
  if (!response.ok) {
    setStatus(`Global preset save failed: ${await response.text()}`);
    return;
  }
  const payload = await response.json();
  state.visualizerLibrary = {
    presets: payload.library?.presets || [],
    path: payload.libraryPath || ''
  };
  state.project = upsertProjectVisualizerStylePreset(state.project, { ...preset, scope: 'global' });
  state.project = updateLayer(state.project, layer.id, {
    properties: {
      ...(layer.properties || {}),
      visualizerStyleId: preset.id
    }
  });
  markDirty();
  setStatus(`Global visualizer preset saved: ${preset.name}`);
}

function updateLyricsTransition(patch) {
  const layer = getSelectedLayer();
  if (!layer || layer.type !== 'lyrics') return;
  updateProperties({
    transition: {
      ...(layer.properties.transition || {}),
      ...patch
    }
  });
}

function getSelectedLayer() {
  return state.project?.layers.find((layer) => layer.id === state.selectedLayerId) || null;
}

function getAssetById(assetId) {
  return state.project?.assets.find((asset) => asset.id === assetId) || null;
}

function markDirty() {
  state.dirty = true;
  state.renderProject = buildRenderProject();
  renderApp();
}

function getAudioAsset() {
  return state.project?.assets.find((asset) => asset.type === 'audio' && asset.role === 'song' && !asset.missing) || null;
}

function getLyricsAsset() {
  return state.project?.assets.find((asset) => asset.type === 'lyrics' && asset.role === 'lyrics' && !asset.missing) || null;
}

function getMetadataAsset() {
  return state.project?.assets.find((asset) => asset.type === 'json' && asset.role === 'metadata' && !asset.missing) || null;
}

function getPreviewScenes() {
  return state.lyrics.scenes.length ? state.lyrics.scenes : (state.project.scenes || []);
}

function getActivePreviewScene() {
  const currentTime = getRenderTime();
  return getPreviewScenes().find((scene) => currentTime >= scene.start && currentTime < scene.end) || null;
}

function getRenderTime() {
  return Number.isFinite(state.renderTimeOverride)
    ? state.renderTimeOverride
    : state.audio.preview.currentTime;
}

function buildPreviewScenes() {
  const duration = getAudioDuration();
  const metadataScenes = deriveMetadataLyricScenes(state.lyrics.metadataLyrics, state.lyrics.cues, duration);
  return metadataScenes.length ? metadataScenes : deriveLyricScenes(state.lyrics.cues, duration);
}

function getProjectLyricsStylePresets() {
  const projectPresets = Array.isArray(state.project?.metadata?.lyricsStylePresets)
    ? state.project.metadata.lyricsStylePresets
    : LYRICS_STYLE_PRESETS;
  const byId = new Map(projectPresets.map((preset) => [preset.id, preset]));
  for (const preset of state.lyricsStyleLibrary.presets || []) {
    byId.set(preset.id, preset);
  }
  return [...byId.values()];
}

function getProjectTextStylePresets() {
  return Array.isArray(state.project?.metadata?.textStylePresets)
    ? state.project.metadata.textStylePresets
    : TEXT_STYLE_PRESETS;
}

function getProjectTypographyPresets() {
  return Array.isArray(state.project?.metadata?.typographyPresets)
    ? state.project.metadata.typographyPresets
    : [];
}

function getProjectVisualizerStylePresets() {
  const projectPresets = Array.isArray(state.project?.metadata?.visualizerStylePresets)
    ? state.project.metadata.visualizerStylePresets
    : VISUALIZER_STYLE_PRESETS;
  const byId = new Map(projectPresets.map((preset) => [preset.id, preset]));
  for (const preset of state.visualizerLibrary.presets || []) {
    if (!byId.has(preset.id)) byId.set(preset.id, preset);
  }
  return [...byId.values()];
}

function getLyricsLayerText(layer) {
  const source = layer.properties?.source || 'currentCue';
  if (source === 'currentCue' && state.lyrics.currentCue?.text) return state.lyrics.currentCue.text;
  return '';
}

function stripEditorOnlyPlaceholders(project) {
  for (const layer of project?.layers || []) {
    if (layer.type !== 'lyrics' || !layer.properties) continue;
    delete layer.properties.previewText;
  }
}

function getAudioDuration() {
  return selectAudioDuration({
    decodedDuration: state.audio.decodedDuration,
    projectDuration: state.project?.composition?.duration,
    mediaDuration: state.audio.preview.duration
  });
}

function updateTimeline(currentTime, duration) {
  const safeDuration = Math.max(0, Number(duration || 0));
  const safeTime = Math.max(0, Math.min(Number(currentTime || 0), safeDuration || Number(currentTime || 0)));
  elements.timeLabel.textContent = `${formatTime(safeTime)} / ${formatTime(safeDuration)}`;
  if (document.activeElement !== elements.timeInput) {
    elements.timeInput.value = formatTime(safeTime);
  }
  elements.timelineFill.style.width = `${safeDuration ? (safeTime / safeDuration) * 100 : 0}%`;
  elements.timelineScrubber.max = String(safeDuration);
  if (!state.audio.userScrubbing) {
    elements.timelineScrubber.value = String(safeTime);
  }
}

function renderWaveform() {
  const canvas = elements.waveformCanvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || canvas.width));
  const height = Math.max(1, Math.floor(rect.height || canvas.height));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  waveformContext.clearRect(0, 0, width, height);
  waveformContext.fillStyle = '#10141b';
  waveformContext.fillRect(0, 0, width, height);

  const peaks = state.audio.waveformPeaks || [];
  const center = height / 2;
  waveformContext.strokeStyle = '#343a45';
  waveformContext.beginPath();
  waveformContext.moveTo(0, center);
  waveformContext.lineTo(width, center);
  waveformContext.stroke();

  if (!peaks.length) {
    waveformContext.fillStyle = '#5d6675';
    waveformContext.font = '12px Segoe UI, Arial';
    waveformContext.textAlign = 'center';
    waveformContext.textBaseline = 'middle';
    waveformContext.fillText(state.audio.status === 'loading' ? 'Loading waveform...' : 'Waveform unavailable', width / 2, center);
    return;
  }

  waveformContext.strokeStyle = '#e7d7b8';
  waveformContext.lineWidth = 1;
  waveformContext.beginPath();
  for (let x = 0; x < width; x += 1) {
    const peak = peaks[Math.floor((x / width) * peaks.length)] || 0;
    waveformContext.moveTo(x + 0.5, center - peak * center * 0.86);
    waveformContext.lineTo(x + 0.5, center + peak * center * 0.86);
  }
  waveformContext.stroke();
}

function getAudioStatusLabel() {
  const audioAsset = getAudioAsset();
  if (!audioAsset) return 'No audio';
  const filename = audioAssetFilename(audioAsset);
  const proxy = audioAsset.metadata?.proxyGenerated ? ' (proxy)' : '';
  if (state.audio.status === 'loading') return `Loading ${filename}${proxy}`;
  if (state.audio.status === 'error') return `Audio error - ${filename}`;
  if (state.audio.preview.playing) return `Playing - ${filename}${proxy}`;
  if (state.audio.status === 'ready') return `Ready - ${filename}${proxy}`;
  return `Paused - ${filename}${proxy}`;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setExportButtonsDisabled(disabled) {
  elements.exportButton.disabled = disabled;
  elements.exportRunButton.disabled = disabled;
  elements.exportHeadlessMp4Button.disabled = disabled;
  elements.exportDirectMp4Button.disabled = disabled;
  elements.exportCloseButton.disabled = disabled;
  elements.exportCancelButton.disabled = false;
  elements.exportCancelButton.textContent = disabled ? 'Cancel Render' : 'Cancel';
  elements.exportRenderMp4Button.disabled = disabled || state.lastExport?.type !== 'clip';
}

function waitForAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForExportFrameTick() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function waitForMediaSeek() {
  const audio = state.audio.preview.audio;
  if (!audio.seeking) {
    return new Promise((resolve) => setTimeout(resolve, 80));
  }
  return new Promise((resolve) => {
    const finish = () => {
      audio.removeEventListener('seeked', finish);
      resolve();
    };
    audio.addEventListener('seeked', finish, { once: true });
    setTimeout(finish, 350);
  });
}

function waitForMediaSeekTo(targetTime) {
  const audio = state.audio.preview.audio;
  const target = Number(targetTime || 0);
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const check = () => {
      if (Math.abs((audio.currentTime || 0) - target) < 0.18) {
        resolve(true);
        return;
      }
      if (performance.now() - startedAt > 1500) {
        resolve(false);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

async function prepareVideoLayersForExport(timestamp, benchmark = null, exportContext = null) {
  const project = state.renderProject || state.project;
  const videoLayers = sortLayersForRender(project.layers).filter((layer) => layer.visible && layer.type === 'video');
  if (exportContext?.sequential) {
    await prepareVideoLayersForSequentialExport(videoLayers, timestamp, benchmark, exportContext);
    return;
  }
  for (const layer of videoLayers) {
    const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
    if (!asset || asset.missing) {
      if (benchmark) benchmark.videoFramesMissed += 1;
      continue;
    }
    const video = getVideo(asset.id, layer.properties);
    video.pause();
    await waitForVideoMetadata(video, benchmark);
    if (!video.duration || !Number.isFinite(video.duration)) {
      if (benchmark) benchmark.videoFramesMissed += 1;
      continue;
    }

    const target = getVideoLayerFrameTime(layer, timestamp, video.duration);
    const seekStartedAt = performance.now();
    if (Math.abs((video.currentTime || 0) - target) > 0.035) {
      video.currentTime = target;
      await waitForVideoSeek(video, target, benchmark);
    }
    if (benchmark) benchmark.videoSeekMs += performance.now() - seekStartedAt;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && benchmark) {
      benchmark.videoFramesMissed += 1;
    }
  }
}

async function createSequentialVideoExportContext(startTimestamp, benchmark = null) {
  const project = state.renderProject || state.project;
  const videoLayers = sortLayersForRender(project.layers).filter((layer) => layer.visible && layer.type === 'video');
  const entries = new Map();
  let webCodecsEntries = 0;
  let sequentialEntries = 0;
  for (const layer of videoLayers) {
    const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
    if (!asset || asset.missing) continue;

    const webCodecsDecoder = await createWebCodecsVideoDecoder(asset.id, layer.properties);
    if (webCodecsDecoder.supported) {
      try {
        const result = await webCodecsDecoder.prepare(startTimestamp, benchmark);
        if (result.decodeMs > MAX_WEBCODECS_DECODE_MS) {
          throw new Error(`WebCodecs disabled: slow initial decode ${formatNumber(result.decodeMs)}ms`);
        }
        entries.set(layer.id, {
          mode: 'webcodecs',
          decoder: webCodecsDecoder,
          get currentFrame() {
            return webCodecsDecoder.state.currentFrame;
          },
          lastTarget: getVideoLayerFrameTime(layer, startTimestamp, webCodecsDecoder.state.duration),
          lastProjectTimestamp: startTimestamp
        });
        webCodecsEntries += 1;
        continue;
      } catch (error) {
        webCodecsDecoder.close();
        if (benchmark && !benchmark.videoFallbackReason) {
          benchmark.videoFallbackReason = error?.message || String(error);
        }
        if (benchmark) benchmark.videoWebCodecsDisabled += 1;
      }
    }
    if (benchmark && !benchmark.videoFallbackReason) {
      benchmark.videoFallbackReason = webCodecsDecoder.reason || 'WebCodecs unavailable';
    }

    const video = getVideo(asset.id, layer.properties);
    video.pause();
    await waitForVideoMetadata(video, benchmark);
    if (!video.duration || !Number.isFinite(video.duration)) continue;
    video.loop = false;
    video.muted = true;
    video.playbackRate = Math.max(0.05, Number(layer.properties.playbackRate || 1));
    const target = getVideoLayerFrameTime(layer, startTimestamp, video.duration);
    await seekVideoForExport(video, target, benchmark, { corrective: false });
    entries.set(layer.id, {
      video,
      lastTarget: target,
      lastProjectTimestamp: startTimestamp
    });
    sequentialEntries += 1;
  }
  if (benchmark && entries.size > 0) {
    benchmark.videoMode = webCodecsEntries && sequentialEntries
      ? 'hybrid'
      : webCodecsEntries
        ? 'webcodecs'
        : 'sequential';
  }
  return {
    sequential: entries.size > 0,
    entries
  };
}

function closeSequentialVideoExportContext(exportContext) {
  for (const entry of exportContext?.entries?.values?.() || []) {
    if (entry.mode === 'webcodecs') {
      entry.decoder.close();
    } else {
      entry.video.pause();
    }
  }
}

async function prepareVideoLayersForSequentialExport(videoLayers, timestamp, benchmark, exportContext) {
  for (const layer of videoLayers) {
    const entry = exportContext.entries.get(layer.id);
    if (!entry) {
      if (benchmark) benchmark.videoFramesMissed += 1;
      continue;
    }
    if (entry.mode === 'webcodecs') {
      try {
        const result = await entry.decoder.prepare(timestamp, benchmark);
        if (result.decodeMs > MAX_WEBCODECS_DECODE_MS) {
          await switchWebCodecsEntryToSequential(exportContext, layer, entry, timestamp, benchmark, `slow decode ${formatNumber(result.decodeMs)}ms`);
        }
      } catch (error) {
        if (benchmark) {
          benchmark.videoFramesMissed += 1;
          benchmark.videoWebCodecsFrameMisses += 1;
        }
      }
      entry.lastProjectTimestamp = timestamp;
      continue;
    }
    const video = entry.video;
    const target = getVideoLayerFrameTime(layer, timestamp, video.duration);
    const wrapped = target + 0.025 < entry.lastTarget;
    const drift = video.currentTime - target;
    if (wrapped || drift > 0.16 || drift < -0.75) {
      await seekVideoForExport(video, target, benchmark, { corrective: true });
    } else if (video.currentTime < target - 0.018) {
      await waitForSequentialVideoTime(video, target, benchmark);
    }
    video.pause();
    entry.lastTarget = target;
    entry.lastProjectTimestamp = timestamp;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && benchmark) {
      benchmark.videoFramesMissed += 1;
    }
  }
}

async function switchWebCodecsEntryToSequential(exportContext, layer, entry, timestamp, benchmark = null, reason = '') {
  entry.decoder.close();
  const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
  const video = getVideo(asset.id, layer.properties);
  video.pause();
  await waitForVideoMetadata(video, benchmark);
  if (!video.duration || !Number.isFinite(video.duration)) {
    if (benchmark) benchmark.videoFramesMissed += 1;
    return;
  }
  video.loop = false;
  video.muted = true;
  video.playbackRate = Math.max(0.05, Number(layer.properties.playbackRate || 1));
  const target = getVideoLayerFrameTime(layer, timestamp, video.duration);
  await seekVideoForExport(video, target, benchmark, { corrective: false });
  exportContext.entries.set(layer.id, {
    mode: 'sequential',
    video,
    lastTarget: target,
    lastProjectTimestamp: timestamp
  });
  if (benchmark) {
    benchmark.videoWebCodecsDisabled += 1;
    benchmark.videoMode = 'hybrid';
    if (!benchmark.videoFallbackReason) {
      benchmark.videoFallbackReason = `WebCodecs disabled: ${reason}`;
    }
  }
}

async function seekVideoForExport(video, target, benchmark = null, options = {}) {
  const seekStartedAt = performance.now();
  if (Math.abs((video.currentTime || 0) - target) > 0.035) {
    video.currentTime = target;
    await waitForVideoSeek(video, target, benchmark);
    if (options.corrective && benchmark) benchmark.videoCorrectiveSeeks += 1;
  }
  if (benchmark) benchmark.videoSeekMs += performance.now() - seekStartedAt;
}

function waitForSequentialVideoTime(video, targetTime, benchmark = null) {
  const startedAt = performance.now();
  video.muted = true;
  const playPromise = video.play();
  if (playPromise?.catch) playPromise.catch(() => {});
  return new Promise((resolve) => {
    let done = false;
    const finish = (missed = false) => {
      if (done) return;
      done = true;
      if (callbackId && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(callbackId);
      }
      if (timer) clearTimeout(timer);
      video.pause();
      if (benchmark) {
        benchmark.videoSequentialWaitMs += performance.now() - startedAt;
        if (missed) benchmark.videoFramesMissed += 1;
      }
      resolve();
    };
    const check = () => {
      if ((video.currentTime || 0) >= targetTime - 0.018) {
        finish(false);
        return;
      }
      if (video.requestVideoFrameCallback) {
        callbackId = video.requestVideoFrameCallback(check);
      } else {
        requestAnimationFrame(check);
      }
    };
    let callbackId = 0;
    const timer = setTimeout(() => finish(true), 180);
    check();
  });
}

async function syncVideoLayerPreview(layerId, options = {}) {
  const layer = state.project?.layers.find((item) => item.id === layerId);
  if (!layer || layer.type !== 'video' || layer.properties?.syncMode === 'free-loop') return;
  const asset = state.project.assets.find((item) => item.id === layer.properties.assetId);
  if (!asset || asset.missing) return;
  const video = getVideo(asset.id, layer.properties);
  if (!video.duration || !Number.isFinite(video.duration)) {
    await waitForVideoMetadata(video);
  }
  if (!video.duration || !Number.isFinite(video.duration)) return;

  const syncKey = buildVideoPreviewSyncKey(layer, state.audio.preview.currentTime);
  if (!options.force && state.videoSyncKeys.get(layer.id) === syncKey) return;
  state.videoSyncKeys.set(layer.id, syncKey);

  const target = getVideoLayerFrameTime(layer, state.audio.preview.currentTime, video.duration);
  if (Math.abs((video.currentTime || 0) - target) > 0.08) {
    video.currentTime = target;
  }
  video.playbackRate = Math.max(0.05, Number(layer.properties.playbackRate || 1));
  video.loop = layer.properties.loop !== false;
  video.muted = true;
  if (state.audio.preview.playing && video.paused) {
    video.play().catch(() => {});
  }
  renderCanvas();
}

function buildVideoPreviewSyncKey(layer) {
  const props = layer.properties || {};
  return [
    props.assetId || '',
    props.loop !== false ? 'loop' : 'once',
    props.syncMode || 'project-time',
    Number(props.startOffset || 0).toFixed(3),
    Number(props.playbackRate || 1).toFixed(3),
    Number(props.trimStart || 0).toFixed(3),
    Number(props.trimEnd || 0).toFixed(3)
  ].join('|');
}

function getCompositeVideoLayer() {
  const project = state.renderProject || state.project;
  return sortLayersForRender(project?.layers || [])
    .filter((layer) => layer.visible && layer.type === 'video')
    .at(-1) || null;
}

function hasVisibleVideoLayer() {
  return Boolean(getCompositeVideoLayer());
}

function getCompositeVideoStartTime(layer, projectTimestamp) {
  const props = layer?.properties || {};
  const playbackRate = Math.max(0.05, Number(props.playbackRate || 1));
  const trimStart = Math.max(0, Number(props.trimStart || 0));
  const offset = Math.max(0, Number(props.startOffset || 0));
  return trimStart + Math.max(0, Number(projectTimestamp || 0)) * playbackRate + offset;
}

function getVideoLayerFrameTime(layer, projectTimestamp, videoDuration) {
  const props = layer.properties || {};
  const playbackRate = Math.max(0.05, Number(props.playbackRate || 1));
  const trimStart = clamp(Number(props.trimStart || 0), 0, Math.max(0, videoDuration));
  const rawTrimEnd = Number(props.trimEnd || 0);
  const trimEnd = rawTrimEnd > trimStart ? Math.min(rawTrimEnd, videoDuration) : videoDuration;
  const segment = Math.max(0.001, trimEnd - trimStart);
  const offset = Math.max(0, Number(props.startOffset || 0));
  const local = Math.max(0, (Number(projectTimestamp || 0) * playbackRate) + offset);
  if (props.loop === false) {
    return clamp(trimStart + local, trimStart, Math.max(trimStart, trimEnd - 0.001));
  }
  return trimStart + (local % segment);
}

function waitForVideoMetadata(video, benchmark = null) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) {
    return Promise.resolve();
  }
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('loadedmetadata', finish);
      if (benchmark) benchmark.videoDecodeWaitMs += performance.now() - startedAt;
      resolve();
    };
    video.addEventListener('loadedmetadata', finish, { once: true });
    setTimeout(finish, 700);
    video.load();
  });
}

function waitForVideoSeek(video, targetTime, benchmark = null) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      if (benchmark) benchmark.videoDecodeWaitMs += performance.now() - startedAt;
      resolve();
    };
    if (!video.seeking && Math.abs((video.currentTime || 0) - targetTime) <= 0.05) {
      finish();
      return;
    }
    video.addEventListener('seeked', finish, { once: true });
    setTimeout(() => {
      if (benchmark) benchmark.videoFramesMissed += 1;
      finish();
    }, 700);
  });
}

function mapBlendMode(mode) {
  const modes = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    'soft-light': 'soft-light',
    'hard-light': 'hard-light',
    difference: 'difference',
    exclusion: 'exclusion',
    add: 'lighter',
    subtract: 'difference'
  };
  return modes[mode] || 'source-over';
}

function cssFont(fontFamily) {
  const family = String(fontFamily || 'Arial').replaceAll('"', '').trim() || 'Arial';
  const quoted = family.includes(' ') ? `"${family}"` : family;
  return `${quoted}, Arial, sans-serif`;
}

function normalizeColor(value) {
  const text = String(value || '#ffffff');
  return /^#[0-9a-f]{6}$/i.test(text) ? text : '#ffffff';
}

function wrapText(text, maxWidth, font, maxLines, measureContext = context) {
  measureContext.save();
  measureContext.font = font;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureContext.measureText(next).width <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length) {
    const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (consumed < words.length) {
      lines[lines.length - 1] = trimToWidth(`${lines[lines.length - 1]}...`, maxWidth, measureContext);
    }
  }

  measureContext.restore();
  return lines.length ? lines : [''];
}

function trimToWidth(text, maxWidth, measureContext = context) {
  let next = String(text || '');
  while (next.length > 1 && measureContext.measureText(next).width > maxWidth) {
    next = `${next.slice(0, -4)}...`;
  }
  return next;
}

function drawRoundedRect(targetContext, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  targetContext.beginPath();
  targetContext.moveTo(x + safeRadius, y);
  targetContext.lineTo(x + width - safeRadius, y);
  targetContext.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  targetContext.lineTo(x + width, y + height - safeRadius);
  targetContext.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  targetContext.lineTo(x + safeRadius, y + height);
  targetContext.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  targetContext.lineTo(x, y + safeRadius);
  targetContext.quadraticCurveTo(x, y, x + safeRadius, y);
  targetContext.closePath();
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function formatNumber(value) {
  return String(Math.round(Number(value || 0) * 100) / 100);
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value >= 1024 * 1024 * 1024) return `${formatNumber(value / (1024 * 1024 * 1024))} GB`;
  if (value >= 1024 * 1024) return `${formatNumber(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${formatNumber(value / 1024)} KB`;
  return `${Math.round(value)} B`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseTimeInput(value) {
  const text = String(value || '').trim().replace(',', '.');
  if (!text) return 0;
  if (!text.includes(':')) return Number(text);
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
