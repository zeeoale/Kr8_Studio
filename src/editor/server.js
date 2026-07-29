import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deserializeProject, serializeProject } from '../project/io.js';
import { selectKr8ProjectFile } from '../project/selectProjectFile.js';
import { createProjectFoundationFromAudio } from '../project/createFromAudio.js';
import { applyLyricsDocument } from '../lyrics-editor/storage.js';
import { importAudioAsset, probeAudioFile, sanitizeAudioFilename } from '../assets/audioImport.js';
import { importCoverAsset } from '../assets/coverImport.js';
import { importCoverVideoAsset } from '../assets/videoImport.js';
import { importTextTextureAsset } from '../assets/textTextureImport.js';
import { applyCoverAssetToProject } from '../cover-lab/applyCover.js';
import { fetchComfyImage, generateComfyCover } from '../cover-lab/comfyClient.js';
import {
  applyIdentityNegativePrompt,
  insertIdentityIntoPrompt,
  listIdentityPresets,
  resolveIdentity
} from '../cover-lab/identities.js';
import { readImageDimensions } from '../cover-lab/imageDimensions.js';
import { createOllamaCoverPrompt, listOllamaModels } from '../cover-lab/ollamaClient.js';
import {
  COVER_LAB_RATIOS,
  createDefaultCoverLabSettings,
  createRandomSeed,
  findRatio,
  normalizeCoverLabSettings
} from '../cover-lab/schema.js';
import {
  extractWorkflowLoras,
  loadCoverWorkflowTemplate,
  patchCoverWorkflow
} from '../cover-lab/workflow.js';
import {
  appendFrameSequenceExportBatch,
  createFrameSequenceExportSession,
  finalizeFrameSequenceExportSession,
  saveFrameExport,
  saveFrameSequenceExport
} from '../exports/frameExport.js';
import {
  appendDirectVideoFrameBuffers,
  appendDirectVideoFrames,
  appendDirectVideoRawFrames,
  attachDirectVideoClientBenchmark,
  cancelDirectVideoSession,
  createDirectVideoSession,
  finalizeDirectVideoSession,
  renderDraftVideo
} from '../exports/videoDraft.js';
import { findLatestValidRenderExport, listRenderHistory } from '../exports/history.js';
import {
  assertExistingReelSource,
  loadReelSettings,
  resolveReelProjectPath,
  saveReelSettings,
  saveReelWatermarkImage
} from '../reel/core.js';
import {
  cancelReelExport,
  probeReelSource,
  startReelExport
} from '../reel/export.js';
import { buildInstagramConfig, buildTikTokConfig, buildYouTubeConfig } from '../publish/config.js';
import { LocalCredentialStore, LocalPublishSettingsStore, normalizeInstagramSessionRecord, normalizeYouTubeTokenRecord } from '../publish/credentialStore.js';
import { PublishService } from '../publish/publishService.js';
import { createPublishFetch } from '../publish/network.js';
import { safeErrorMessage } from '../publish/security.js';
import { TikTokProvider } from '../publish/providers/tiktok/tiktokProvider.js';
import { YouTubeProvider } from '../publish/providers/youtube/youtubeProvider.js';
import { InstagramProvider } from '../publish/providers/instagram/instagramProvider.js';
import { resolveAssetPath } from '../shared/path.js';
import { buildServerConfig, hasAuth, isPathInside, loadEnvFile, readEnvFileValues, resolveServerEnvPath } from '../server/config.js';
import { importTkMusicTrack } from '../tkmusic/importTrack.js';
import {
  TK_MUSIC_PROVIDER,
  getTkMusicLibraryCoverPath,
  listTkMusicLibrary
} from '../source-providers/tkMusicProvider.js';
import {
  loadVisualizerPresetLibrary,
  upsertVisualizerPresetInLibrary
} from '../visualizer/library.js';
import {
  deleteLyricsStylePresetFromLibrary,
  loadLyricsStylePresetLibrary,
  upsertLyricsStylePresetInLibrary
} from '../lyrics/library.js';
import {
  applyProjectTemplate,
  createProjectTemplateFromProject,
  loadProjectTemplateLibrary,
  upsertProjectTemplateInLibrary
} from '../templates/projectTemplates.js';
import {
  buildMobileProjectContext,
  serializeMobilePublishStatus,
  serializeMobileRenderJob
} from '../mobile/context.js';
import { applyMobileLayerAction, applyMobileVerticalFormat, patchMobileLayer } from '../mobile/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const serviceVersion = String(packageMetadata.version || 'unknown');
const publicDir = path.join(projectRoot, 'src', 'editor', 'public');
const defaultProjectPath = path.join(projectRoot, 'examples', 'blank.kr8', 'project.json');
const visualizerPresetLibraryPath = path.join(projectRoot, 'presets', 'visualizers', 'library.json');
const lyricsStylePresetLibraryPath = path.join(projectRoot, 'presets', 'lyrics', 'library.json');
const projectTemplateLibraryPath = path.join(projectRoot, 'presets', 'project-templates', 'library.json');
let coverLabWorkflowPath = path.join(projectRoot, 'workflow', 'Kr8_Cover_Workflow_API.json');
const defaultJsonBodyLimit = 10_000_000;
const clipJsonBodyLimit = 180_000_000;

let currentProjectPath = defaultProjectPath;
let currentProjectDirectory = path.dirname(currentProjectPath);
let currentProject = null;
let serverConfig = buildServerConfig();
const clipExportSessions = new Map();
const directVideoSessions = new Map();
const headlessExportJobs = new Map();
const reelExportJobs = new Map();
const latestPublishJobIds = new Map();
const coverLabJobs = new Map();
let publishService = null;
let tikTokConfig = buildTikTokConfig();
let youTubeConfig = buildYouTubeConfig();
let instagramConfig = buildInstagramConfig();
let publishEnvPath = path.join(projectRoot, '.env.local');
let projectFileSelector = selectKr8ProjectFile;
let systemFontCache = null;
let systemFontFaces = [];
let systemFontFileCache = new Map();

export async function createEditorServer(options = {}) {
  publishEnvPath = resolveServerEnvPath(options.envPath, projectRoot);
  projectFileSelector = options.projectFileSelector || selectKr8ProjectFile;
  await loadEnvFile(publishEnvPath);
  serverConfig = buildServerConfig(options);
  coverLabWorkflowPath = serverConfig.optionalServices.coverWorkflowPath
    ? path.resolve(serverConfig.optionalServices.coverWorkflowPath)
    : path.join(projectRoot, 'workflow', 'Kr8_Cover_Workflow_API.json');
  tikTokConfig = buildTikTokConfig();
  youTubeConfig = buildYouTubeConfig();
  instagramConfig = buildInstagramConfig();
  publishService = createPublishService();
  currentProjectPath = resolveProjectPathForServer(options.projectPath || serverConfig.projectPath || defaultProjectPath);
  currentProjectDirectory = path.dirname(currentProjectPath);
  currentProject = null;

  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response);
    } catch (error) {
      sendJson(response, 500, { error: safeErrorMessage(error, publishSecrets()) });
    }
  });

  return server;
}

function createPublishService() {
  const settingsStore = new LocalPublishSettingsStore();
  const publishFetch = createPublishFetch();
  const tikTokProvider = new TikTokProvider({
    config: tikTokConfig,
    tokenStore: new LocalCredentialStore({ provider: 'tiktok' }),
    fetchImpl: publishFetch
  });
  const youTubeProvider = new YouTubeProvider({
    config: youTubeConfig,
    tokenStore: new LocalCredentialStore({ provider: 'youtube', normalizeRecord: normalizeYouTubeTokenRecord }),
    fetchImpl: publishFetch
  });
  const instagramProvider = new InstagramProvider({
    config: instagramConfig,
    sessionStore: new LocalCredentialStore({ provider: 'instagram', normalizeRecord: normalizeInstagramSessionRecord }),
    fetchImpl: publishFetch,
    configLoader: reloadInstagramConfig
  });
  return new PublishService({
    providers: { tiktok: tikTokProvider, youtube: youTubeProvider, instagram: instagramProvider },
    settingsStore,
    errorSecrets: publishSecrets()
  });
}

async function reloadInstagramConfig() {
  const envFile = await readEnvFileValues(publishEnvPath);
  const instagramEnv = Object.fromEntries(Object.entries(envFile.values).filter(([key]) => key.startsWith('INSTAGRAM_')));
  instagramConfig = buildInstagramConfig({ ...process.env, ...instagramEnv });
  return instagramConfig;
}

function publishSecrets() {
  return [
    tikTokConfig.clientKey, tikTokConfig.clientSecret, youTubeConfig.clientId, youTubeConfig.clientSecret,
    instagramConfig.appId, instagramConfig.appSecret, instagramConfig.accessToken, instagramConfig.bridgeToken
  ].filter(Boolean);
}

async function routeRequest(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (
    request.method === 'GET'
    && (url.pathname === '/api/health' || url.pathname === '/api/server/health')
  ) {
    response.setHeader('cache-control', 'no-store');
    sendJson(response, 200, {
      status: 'ok',
      service: 'Kr8 Studio',
      version: serviceVersion,
      timestamp: new Date().toISOString()
    });
    return;
  }
  if (!isAuthorizedRequest(request, response)) return;

  if (request.method === 'GET' && url.pathname === '/mobile') {
    response.writeHead(302, { location: '/mobile/' });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mobile/context') {
    const project = await readCurrentProject();
    sendJson(response, 200, {
      ...buildMobileProjectContext(project),
      render: serializeMobileRenderJob(findLatestHeadlessJob(currentProjectPath))
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/mobile/project/vertical') {
    currentProject = applyMobileVerticalFormat(await readCurrentProject());
    await writeFile(currentProjectPath, serializeProject(currentProject), 'utf8');
    sendJson(response, 200, { ...buildMobileProjectContext(currentProject), saved: true });
    return;
  }

  const mobileLayerMatch = url.pathname.match(/^\/api\/mobile\/layers\/([^/]+)(?:\/(action))?$/);
  if (request.method === 'POST' && mobileLayerMatch) {
    const layerId = decodeURIComponent(mobileLayerMatch[1]);
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    try {
      if (mobileLayerMatch[2] === 'action') {
        const result = applyMobileLayerAction(await readCurrentProject(), layerId, String(payload.action || ''));
        currentProject = result.project;
        await writeFile(currentProjectPath, serializeProject(currentProject), 'utf8');
        sendJson(response, 200, { ...buildMobileProjectContext(currentProject), selectedLayerId: result.selectedLayerId, saved: true });
      } else {
        currentProject = patchMobileLayer(await readCurrentProject(), layerId, payload.patch || {});
        await writeFile(currentProjectPath, serializeProject(currentProject), 'utf8');
        sendJson(response, 200, { ...buildMobileProjectContext(currentProject), selectedLayerId: layerId, saved: true });
      }
    } catch (error) {
      sendJson(response, 400, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mobile/render/status') {
    const requestedId = String(url.searchParams.get('jobId') || '');
    const requestedJob = requestedId ? headlessExportJobs.get(requestedId) : null;
    const job = requestedJob?.projectPath === currentProjectPath
      ? requestedJob
      : findLatestHeadlessJob(currentProjectPath);
    sendJson(response, 200, serializeMobileRenderJob(job));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mobile/publish/status') {
    const providers = ['tiktok', 'youtube', 'instagram'];
    const statuses = await Promise.all(providers.map(async (provider) => {
      const connection = await publishService.getConnectionStatus(provider);
      const jobId = latestPublishJobIds.get(provider);
      const upload = jobId ? publishService.getUploadProgress(jobId, provider) : null;
      return serializeMobilePublishStatus(provider, connection, upload);
    }));
    sendJson(response, 200, { providers: statuses });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/project') {
    const projectPath = url.searchParams.get('path');
    if (projectPath) {
      currentProjectPath = resolveProjectPathForServer(projectPath);
      currentProjectDirectory = path.dirname(currentProjectPath);
      currentProject = null;
    }

    const project = await readCurrentProject();
    sendJson(response, 200, {
      project,
      projectPath: currentProjectPath,
      projectDirectory: currentProjectDirectory
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project/select') {
    const selection = await projectFileSelector({ initialDirectory: currentProjectDirectory });
    if (!selection.supported) {
      sendJson(response, 501, { error: 'Native project selection is unavailable on this host. Enter the project path manually.' });
      return;
    }
    if (!selection.path) {
      sendJson(response, 200, { cancelled: true });
      return;
    }
    const selectedPath = resolveProjectPathForServer(selection.path);
    const project = deserializeProject(await readFile(selectedPath, 'utf8'));
    currentProjectPath = selectedPath;
    currentProjectDirectory = path.dirname(selectedPath);
    currentProject = project;
    sendJson(response, 200, {
      cancelled: false,
      project,
      projectPath: currentProjectPath,
      projectDirectory: currentProjectDirectory
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/system/fonts') {
    const fonts = await listSystemFontFamilies({ refresh: url.searchParams.get('refresh') === '1' });
    sendJson(response, 200, {
      fonts,
      fontFaces: systemFontFaces,
      count: fonts.length
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/cover-lab/config') {
    let workflow = {};
    let workflowAvailable = true;
    try {
      workflow = await loadCoverWorkflowTemplate(coverLabWorkflowPath);
    } catch {
      workflowAvailable = false;
    }
    const workflowLoras = workflowAvailable ? extractWorkflowLoras(workflow) : [];
    sendJson(response, 200, {
      version: 1,
      ratios: COVER_LAB_RATIOS,
      defaults: createDefaultCoverLabSettings({
        ollama: { endpoint: serverConfig.optionalServices.ollamaUrl },
        comfy: { endpoint: serverConfig.optionalServices.comfyUiUrl },
        loras: workflowLoras
      }),
      loras: workflowLoras,
      identities: listIdentityPresets(),
      workflowAvailable
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/cover-lab/ollama/models') {
    const models = await listOllamaModels({
      endpoint: url.searchParams.get('endpoint') || undefined
    });
    sendJson(response, 200, { models, count: models.length });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/cover-lab/ollama/prompt') {
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const settings = normalizeCoverLabSettings(payload.settings || payload);
    const ratio = findRatio(settings.generation.ratio);
    const identityPreset = resolveIdentity(settings.identity);
    const prompt = await createOllamaCoverPrompt({
      endpoint: settings.ollama.endpoint,
      model: settings.ollama.model,
      context: settings.context,
      identityPreset,
      identity: settings.identity,
      ratio: {
        ...ratio,
        width: settings.generation.width,
        height: settings.generation.height
      }
    });
    const negative = applyIdentityNegativePrompt(
      settings.prompts.negative,
      identityPreset,
      settings.identity
    );
    sendJson(response, 200, { prompt, negative });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/cover-lab/identity/prompt') {
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const settings = normalizeCoverLabSettings(payload.settings || payload);
    const identityPreset = resolveIdentity(settings.identity);
    sendJson(response, 200, {
      prompt: insertIdentityIntoPrompt(settings.prompts.positive, identityPreset, settings.identity),
      negative: applyIdentityNegativePrompt(
        settings.prompts.negative,
        identityPreset,
        settings.identity
      )
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/cover-lab/generate') {
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const settings = normalizeCoverLabSettings(payload.settings || payload);
    if (!settings.prompts.positive) {
      sendJson(response, 400, { error: 'Positive Prompt is required.' });
      return;
    }
    const identityPreset = resolveIdentity(settings.identity);
    settings.prompts.positive = insertIdentityIntoPrompt(
      settings.prompts.positive,
      identityPreset,
      settings.identity
    );
    settings.prompts.negative = applyIdentityNegativePrompt(
      settings.prompts.negative,
      identityPreset,
      settings.identity
    );
    const template = await loadCoverWorkflowTemplate(coverLabWorkflowPath);
    const jobId = `cover_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const seed = settings.generation.randomizeSeed
      ? createRandomSeed()
      : settings.generation.seed;
    settings.generation.seed = seed;
    const patched = patchCoverWorkflow(template, {
      jobId,
      songTitle: settings.context.title || (await readCurrentProject()).name,
      positivePrompt: settings.prompts.positive,
      negativePrompt: settings.prompts.negative,
      width: settings.generation.width,
      height: settings.generation.height,
      batchSize: settings.generation.batchSize,
      seed,
      generateUpscaled: settings.generation.generateUpscaled,
      loras: settings.loras,
      identity: settings.identity,
      identityPreset
    });
    const generated = await generateComfyCover({
      endpoint: settings.comfy.endpoint,
      workflow: patched.workflow,
      manifest: patched.manifest,
      clientId: `kr8-${jobId}`
    });
    const measuredResults = await Promise.all(generated.results.map(async (result) => {
      try {
        const image = await fetchComfyImage({ endpoint: settings.comfy.endpoint, result });
        const dimensions = readImageDimensions(image.data);
        return dimensions ? { ...result, ...dimensions } : result;
      } catch {
        return result;
      }
    }));
    const job = {
      id: jobId,
      promptId: generated.promptId,
      endpoint: settings.comfy.endpoint,
      settings,
      manifest: patched.manifest,
      results: measuredResults,
      createdAt: new Date().toISOString()
    };
    coverLabJobs.set(jobId, job);
    trimCoverLabJobs();
    sendJson(response, 200, {
      jobId,
      promptId: generated.promptId,
      seed,
      prompt: settings.prompts.positive,
      negative: settings.prompts.negative,
      results: measuredResults.map((result, index) => ({
        ...result,
        previewUrl: `/api/cover-lab/results/${encodeURIComponent(jobId)}/${index}`,
        downloadUrl: `/api/cover-lab/results/${encodeURIComponent(jobId)}/${index}?download=1`
      }))
    });
    return;
  }

  const coverLabResultMatch = url.pathname.match(/^\/api\/cover-lab\/results\/([^/]+)\/(\d+)$/);
  if (request.method === 'GET' && coverLabResultMatch) {
    const jobId = decodeURIComponent(coverLabResultMatch[1]);
    const index = Number(coverLabResultMatch[2]);
    const job = coverLabJobs.get(jobId);
    const result = job?.results?.[index];
    if (!job || !result) {
      sendJson(response, 404, { error: 'Cover Lab result is no longer available.' });
      return;
    }
    const image = await fetchComfyImage({ endpoint: job.endpoint, result });
    response.writeHead(200, {
      'content-type': image.contentType,
      'content-length': image.data.length,
      'cache-control': 'no-store',
      ...(url.searchParams.get('download') === '1'
        ? { 'content-disposition': `attachment; filename="${safeDownloadFilename(result.filename)}"` }
        : {})
    });
    response.end(image.data);
    return;
  }

  const coverLabUseMatch = url.pathname.match(/^\/api\/cover-lab\/results\/([^/]+)\/(\d+)\/use$/);
  if (request.method === 'POST' && coverLabUseMatch) {
    const jobId = decodeURIComponent(coverLabUseMatch[1]);
    const index = Number(coverLabUseMatch[2]);
    const job = coverLabJobs.get(jobId);
    const result = job?.results?.[index];
    if (!job || !result) {
      sendJson(response, 404, { error: 'Cover Lab result is no longer available.' });
      return;
    }
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const settings = normalizeCoverLabSettings(payload.settings || job.settings);
    const image = await fetchComfyImage({ endpoint: job.endpoint, result });
    const imported = await importCoverAsset(await readCurrentProject(), currentProjectDirectory, {
      filename: result.filename,
      data: image.data
    });
    imported.asset.metadata = {
      ...(imported.asset.metadata || {}),
      generatedBy: 'cover-lab',
      promptId: job.promptId,
      variant: result.variant,
      seed: result.seed,
      width: result.width,
      height: result.height
    };
    const applied = applyCoverAssetToProject(imported.project, imported.asset, settings);
    currentProject = applied.project;
    sendJson(response, 200, {
      project: currentProject,
      asset: imported.asset,
      layer: applied.layer
    });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/system/font-files/')) {
    const fontId = decodeURIComponent(url.pathname.replace('/api/system/font-files/', ''));
    if (!systemFontFileCache.has(fontId)) {
      await listSystemFontFamilies();
    }
    const fontPath = systemFontFileCache.get(fontId);
    if (!fontPath || !(await exists(fontPath))) {
      sendJson(response, 404, { error: 'Font file not found.' });
      return;
    }
    await serveAsset(request, response, fontPath);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/source-providers/tkmusic/tracks') {
    const catalog = await listTkMusicLibrary({
      libraryRoot: serverConfig.tkMusicLibraryRoot || undefined,
      refresh: url.searchParams.get('refresh') === '1'
    });
    sendJson(response, 200, {
      ...catalog,
      tracks: catalog.tracks.map((track) => ({
        ...track,
        coverUrl: track.availability.cover
          ? `/api/source-providers/tkmusic/cover?trackId=${encodeURIComponent(track.id)}`
          : ''
      }))
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/source-providers/tkmusic/cover') {
    const trackId = String(url.searchParams.get('trackId') || '').trim();
    if (!trackId) {
      sendJson(response, 400, { error: 'trackId is required.' });
      return;
    }
    let coverPath = '';
    try {
      coverPath = await getTkMusicLibraryCoverPath(trackId, {
        libraryRoot: serverConfig.tkMusicLibraryRoot || undefined
      });
    } catch {
      sendJson(response, 404, { error: 'TKMusic cover not found.' });
      return;
    }
    if (!coverPath || !(await exists(coverPath))) {
      sendJson(response, 404, { error: 'TKMusic cover not found.' });
      return;
    }
    await serveAsset(request, response, coverPath);
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/project') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = deserializeProject(JSON.stringify(payload.project));
    await writeFile(currentProjectPath, serializeProject(project), 'utf8');
    currentProject = project;
    sendJson(response, 200, {
      saved: true,
      projectPath: currentProjectPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/lyrics-editor/apply') {
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const result = await applyLyricsDocument(
      await readCurrentProject(),
      currentProjectDirectory,
      payload.document || { lines: payload.cues || [] },
      { duration: payload.duration }
    );
    currentProject = result.project;
    sendJson(response, 200, {
      applied: true,
      project: currentProject,
      asset: result.asset,
      document: result.document,
      validation: result.validation
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/import-audio') {
    const filename = url.searchParams.get('filename') || request.headers['x-filename'] || '';
    const mode = url.searchParams.get('mode') === 'create' ? 'create' : 'replace';
    const replaceConfirmed = url.searchParams.get('replace') === '1';
    const updateProjectMetadata = url.searchParams.get('updateMetadata') === '1';
    const title = String(url.searchParams.get('title') || '').trim();
    const artist = String(url.searchParams.get('artist') || '').trim();
    const formatId = String(url.searchParams.get('formatId') || 'landscape-1080p');
    const upload = await streamRequestToTemporaryFile(request, {
      filename,
      maxBytes: serverConfig.maxAudioUploadBytes
    });
    let createdProjectDirectory = '';
    try {
      const probe = await probeAudioFile(upload.path, {
        ffmpegCommand: serverConfig.ffmpegPath || undefined
      });
      const current = await readCurrentProject();
      const currentAudio = current.assets.find((asset) =>
        asset.type === 'audio' && asset.role === 'song' && !asset.missing
      ) || null;
      const createNewProject = mode === 'create' || isStartupBlankProject(current, currentProjectPath);
      if (!createNewProject && currentAudio && !replaceConfirmed) {
        sendJson(response, 409, {
          error: 'Replace current audio confirmation is required.',
          currentAudio: summarizeAudioAsset(currentAudio, current.composition?.duration)
        });
        return;
      }

      let targetProject = current;
      let targetDirectory = currentProjectDirectory;
      let targetProjectPath = currentProjectPath;
      if (createNewProject) {
        const destination = await createLocalAudioProjectDestination(
          serverConfig.projectsRoot
            ? path.resolve(serverConfig.projectsRoot)
            : path.join(projectRoot, 'examples'),
          title || probe.title || path.basename(filename, path.extname(filename))
        );
        createdProjectDirectory = destination.outputDir;
        targetDirectory = destination.outputDir;
        targetProjectPath = destination.projectPath;
        targetProject = createProjectFoundationFromAudio({
          title: title || probe.title || path.basename(filename, path.extname(filename)),
          artist: artist || probe.artist,
          duration: probe.duration,
          formatId,
          seed: probe.title || filename
        });
      }

      const imported = await importAudioAsset(targetProject, targetDirectory, {
        sourcePath: upload.path,
        originalFilename: filename,
        probe,
        title,
        artist,
        updateProjectMetadata: createNewProject || updateProjectMetadata
      }, {
        ffmpegCommand: serverConfig.ffmpegPath || undefined
      });
      if (createNewProject) {
        await writeFile(targetProjectPath, serializeProject(imported.project), 'utf8');
      }
      currentProjectPath = targetProjectPath;
      currentProjectDirectory = targetDirectory;
      currentProject = imported.project;
      sendJson(response, 200, {
        imported: true,
        createdProject: createNewProject,
        saved: createNewProject,
        project: currentProject,
        projectPath: currentProjectPath,
        projectDirectory: currentProjectDirectory,
        audio: summarizeImportedAudio(imported.asset),
        previousAudio: imported.previousAsset
          ? summarizeAudioAsset(imported.previousAsset, Number(targetProject.composition?.duration || 0))
          : null,
        warnings: imported.warnings
      });
    } catch (error) {
      if (createdProjectDirectory) {
        await rm(createdProjectDirectory, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    } finally {
      await rm(upload.directory, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/import-cover') {
    const filename = url.searchParams.get('filename') || request.headers['x-filename'] || '';
    const data = await readBinaryRequestBody(request, { maxBytes: serverConfig.maxUploadBytes });
    const project = await readCurrentProject();
    const result = await importCoverAsset(project, currentProjectDirectory, { filename, data });
    currentProject = result.project;
    sendJson(response, 200, {
      asset: result.asset,
      project: currentProject
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/import-cover-video') {
    const filename = url.searchParams.get('filename') || request.headers['x-filename'] || '';
    const data = await readBinaryRequestBody(request, { maxBytes: serverConfig.maxUploadBytes });
    const project = await readCurrentProject();
    const result = await importCoverVideoAsset(project, currentProjectDirectory, { filename, data });
    currentProject = result.project;
    sendJson(response, 200, {
      asset: result.asset,
      project: currentProject
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/import-text-texture') {
    const filename = url.searchParams.get('filename') || request.headers['x-filename'] || '';
    const data = await readBinaryRequestBody(request, { maxBytes: serverConfig.maxUploadBytes });
    const project = await readCurrentProject();
    const result = await importTextTextureAsset(project, currentProjectDirectory, { filename, data });
    currentProject = result.project;
    sendJson(response, 200, {
      asset: result.asset,
      project: currentProject
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/projects/import-tkmusic') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const trackId = String(payload.trackId || '').trim();
    if (!trackId) {
      sendJson(response, 400, { error: 'trackId is required.' });
      return;
    }
    const resolved = await TK_MUSIC_PROVIDER.resolve({
      trackId,
      libraryRoot: serverConfig.tkMusicLibraryRoot || undefined
    });
    const outputRoot = serverConfig.projectsRoot ? path.resolve(serverConfig.projectsRoot) : path.join(projectRoot, 'examples');
    const destination = await resolveTkMusicImportDestination(outputRoot, resolved);
    if (destination.existingProject) {
      currentProjectPath = destination.projectPath;
      currentProjectDirectory = destination.outputDir;
      currentProject = destination.existingProject;
      sendJson(response, 200, {
        imported: false,
        openedExisting: true,
        project: currentProject,
        projectPath: currentProjectPath,
        projectDirectory: currentProjectDirectory,
        warnings: []
      });
      return;
    }
    const result = await importTkMusicTrack({
      trackDir: resolved.providerMetadata.trackDir,
      outputDir: destination.outputDir
    });
    currentProjectPath = result.projectPath;
    currentProjectDirectory = path.dirname(currentProjectPath);
    currentProject = result.project;
    sendJson(response, 200, {
      imported: true,
      project: currentProject,
      projectPath: currentProjectPath,
      projectDirectory: currentProjectDirectory,
      warnings: result.warnings
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/frame') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const result = await saveFrameExport(currentProjectDirectory, {
      dataUrl: payload.dataUrl,
      timestamp: payload.timestamp,
      projectName: project.name
    });
    sendJson(response, 200, {
      exported: true,
      ...result
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/clip') {
    const body = await readRequestBody(request, { maxBytes: clipJsonBodyLimit });
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const result = await saveFrameSequenceExport(currentProjectDirectory, {
      frames: payload.frames,
      startTimestamp: payload.startTimestamp,
      fps: payload.fps,
      projectName: project.name
    });
    sendJson(response, 200, {
      exported: true,
      ...result
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/clip/start') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const session = await createFrameSequenceExportSession(currentProjectDirectory, {
      projectName: project.name,
      startTimestamp: payload.startTimestamp,
      fps: payload.fps,
      expectedFrameCount: payload.expectedFrameCount
    });
    const sessionId = createSessionId();
    clipExportSessions.set(sessionId, session);
    sendJson(response, 200, {
      sessionId,
      outputPath: session.exportsDir,
      relativePath: path.relative(currentProjectDirectory, session.exportsDir).replaceAll(path.sep, '/'),
      expectedFrameCount: session.expectedFrameCount,
      fps: session.fps
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/clip/batch') {
    const body = await readRequestBody(request, { maxBytes: clipJsonBodyLimit });
    const payload = JSON.parse(body || '{}');
    const session = clipExportSessions.get(String(payload.sessionId || ''));
    if (!session) {
      sendJson(response, 404, { error: 'Clip export session not found.' });
      return;
    }
    await appendFrameSequenceExportBatch(session, {
      frames: payload.frames,
      offset: payload.offset
    });
    if (payload.final) {
      const result = await finalizeFrameSequenceExportSession(session);
      clipExportSessions.delete(String(payload.sessionId || ''));
      sendJson(response, 200, {
        exported: true,
        ...result
      });
      return;
    }
    sendJson(response, 200, {
      appended: true,
      frameCount: session.frames.length
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/direct-mp4/start') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const audioAsset = project.assets.find((asset) => asset.type === 'audio' && asset.role === 'song' && !asset.missing);
    const audioPath = audioAsset ? resolveAssetPath(currentProjectDirectory, audioAsset) : '';
    const compositeVideoLayer = payload.compositeVideoLayerId
      ? project.layers.find((layer) => layer.id === payload.compositeVideoLayerId && layer.type === 'video' && layer.visible)
      : null;
    const compositeVideoAsset = compositeVideoLayer
      ? project.assets.find((asset) => asset.id === compositeVideoLayer.properties?.assetId && asset.type === 'video' && !asset.missing)
      : null;
    const compositeVideoPath = compositeVideoAsset ? resolveAssetPath(currentProjectDirectory, compositeVideoAsset) : '';
    const session = await createDirectVideoSession(currentProjectDirectory, {
      projectName: project.name,
      startTimestamp: payload.startTimestamp,
      duration: payload.duration,
      fps: payload.fps,
      frameCount: payload.frameCount,
      frameFormat: payload.raw ? 'raw-rgba' : 'png',
      width: project.composition?.width || payload.width,
      height: project.composition?.height || payload.height,
      audioPath,
      compositeVideoPath,
      compositeVideoStartTime: payload.compositeVideoStartTime,
      videoEncoder: payload.hardwareEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264',
      encoderPreset: payload.fast ? 'ultrafast' : 'veryfast',
      crf: payload.fast ? 24 : 20,
      cq: 23
    });
    const sessionId = createSessionId();
    directVideoSessions.set(sessionId, session);
    if (payload.headlessJobId) {
      const headlessJob = headlessExportJobs.get(String(payload.headlessJobId || ''));
      if (headlessJob) headlessJob.directSessionId = sessionId;
    }
    sendJson(response, 200, {
      sessionId,
      outputPath: session.outputPath,
      relativePath: session.relativePath,
      expectedFrameCount: session.expectedFrameCount,
      fps: session.fps,
      hasAudio: Boolean(session.audioPath)
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/direct-mp4/cancel') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const sessionId = String(payload.sessionId || '');
    const session = directVideoSessions.get(sessionId);
    if (!session) {
      sendJson(response, 404, { error: 'Direct MP4 session not found.' });
      return;
    }
    const cancelled = cancelDirectVideoSession(session);
    directVideoSessions.delete(sessionId);
    sendJson(response, 200, {
      cancelled,
      sessionId
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/direct-mp4/batch') {
    const body = await readRequestBody(request, { maxBytes: clipJsonBodyLimit });
    const payload = JSON.parse(body || '{}');
    const sessionId = String(payload.sessionId || '');
    const session = directVideoSessions.get(sessionId);
    if (!session) {
      sendJson(response, 404, { error: 'Direct MP4 session not found.' });
      return;
    }
    try {
      await appendDirectVideoFrames(session, payload.frames || []);
      if (payload.final) {
        attachDirectVideoClientBenchmark(session, payload.benchmark);
        const result = await finalizeDirectVideoSession(session);
        directVideoSessions.delete(sessionId);
        sendJson(response, 200, {
          rendered: true,
          ...result
        });
        return;
      }
      sendJson(response, 200, {
        appended: true,
        frameCount: session.writtenFrames,
        bytes: session.bytes
      });
    } catch (error) {
      directVideoSessions.delete(sessionId);
      session.child?.kill?.();
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/direct-mp4/batch-binary') {
    const data = await readBinaryRequestBody(request, { maxBytes: clipJsonBodyLimit });
    const payload = parseDirectMp4BinaryBatch(data);
    const sessionId = String(payload.sessionId || '');
    const session = directVideoSessions.get(sessionId);
    if (!session) {
      sendJson(response, 404, { error: 'Direct MP4 session not found.' });
      return;
    }
    try {
      await appendDirectVideoFrameBuffers(session, payload.frames || []);
      if (payload.final) {
        attachDirectVideoClientBenchmark(session, payload.benchmark);
        const result = await finalizeDirectVideoSession(session);
        directVideoSessions.delete(sessionId);
        sendJson(response, 200, {
          rendered: true,
          ...result
        });
        return;
      }
      sendJson(response, 200, {
        appended: true,
        frameCount: session.writtenFrames,
        bytes: session.bytes
      });
    } catch (error) {
      directVideoSessions.delete(sessionId);
      session.child?.kill?.();
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/direct-mp4/batch-raw') {
    const data = await readBinaryRequestBody(request, { maxBytes: clipJsonBodyLimit });
    const payload = parseDirectMp4BinaryBatch(data);
    const sessionId = String(payload.sessionId || '');
    const session = directVideoSessions.get(sessionId);
    if (!session) {
      sendJson(response, 404, { error: 'Direct MP4 session not found.' });
      return;
    }
    try {
      await appendDirectVideoRawFrames(session, payload.frames || []);
      if (payload.final) {
        attachDirectVideoClientBenchmark(session, payload.benchmark);
        const result = await finalizeDirectVideoSession(session);
        directVideoSessions.delete(sessionId);
        sendJson(response, 200, {
          rendered: true,
          ...result
        });
        return;
      }
      sendJson(response, 200, {
        appended: true,
        frameCount: session.writtenFrames,
        bytes: session.bytes
      });
    } catch (error) {
      directVideoSessions.delete(sessionId);
      session.child?.kill?.();
      throw error;
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/headless-mp4/start') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    try {
      if (countRunningHeadlessJobs() >= serverConfig.headlessExportConcurrency) {
        sendJson(response, 409, { error: 'Another headless export is already running.' });
        return;
      }
      const job = await startHeadlessExportJob(request, payload.options || {});
      sendJson(response, 200, {
        jobId: job.id,
        status: job.status,
        options: job.options,
        browserPath: job.browserPath
      });
    } catch (error) {
      const statusCode = /Chrome|Edge|browser/i.test(error.message || '') ? 409 : 500;
      sendJson(response, statusCode, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/headless-mp4/progress') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const job = headlessExportJobs.get(String(payload.jobId || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Headless export job not found.' });
      return;
    }
    job.status = job.status === 'running' ? 'running' : job.status;
    job.progress = {
      ...(job.progress || {}),
      ...(payload.progress || {}),
      updatedAt: new Date().toISOString()
    };
    sendJson(response, 200, { updated: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/headless-mp4/cancel') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const job = headlessExportJobs.get(String(payload.jobId || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Headless export job not found.' });
      return;
    }
    cancelHeadlessExportJob(job);
    sendJson(response, 200, {
      cancelled: true,
      jobId: job.id,
      status: job.status
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/headless-mp4/complete') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const job = headlessExportJobs.get(String(payload.jobId || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Headless export job not found.' });
      return;
    }
    if (job.status === 'cancelled') {
      sendJson(response, 200, { completed: true, status: job.status });
      return;
    }
    job.status = payload.ok === false ? 'failed' : 'done';
    job.completedAt = new Date().toISOString();
    job.result = payload.result || null;
    job.error = payload.ok === false ? String(payload.error || 'Headless export failed.') : '';
    sendJson(response, 200, { completed: true, status: job.status });
    setTimeout(() => cleanupHeadlessJobProcess(job), 250);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/exports/headless-mp4/status') {
    const job = headlessExportJobs.get(String(url.searchParams.get('jobId') || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Headless export job not found.' });
      return;
    }
    sendJson(response, 200, {
      jobId: job.id,
      status: job.status,
      options: job.options,
      progress: job.progress || null,
      result: job.result || null,
      error: job.error || '',
      startedAt: job.startedAt,
      completedAt: job.completedAt || ''
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/open-folder') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const openedPath = await openExportFolder(payload.path);
    sendJson(response, 200, {
      opened: true,
      path: openedPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/exports/mp4-draft') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    try {
      const project = await readCurrentProject();
      const audioAsset = project.assets.find((asset) => asset.type === 'audio' && asset.role === 'song' && !asset.missing);
      const audioPath = audioAsset ? resolveAssetPath(currentProjectDirectory, audioAsset) : '';
      const result = await renderDraftVideo(currentProjectDirectory, {
        clipPath: payload.clipPath,
        audioPath
      });
      sendJson(response, 200, {
        rendered: true,
        ...result
      });
    } catch (error) {
      const statusCode = /FFmpeg unavailable/i.test(error.message || '') ? 409 : 500;
      sendJson(response, statusCode, { error: error.message || String(error) });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/exports/history') {
    const limit = Number(url.searchParams.get('limit') || 20);
    sendJson(response, 200, {
      history: await listRenderHistory(currentProjectDirectory, { limit })
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/reel/context') {
    const project = await readCurrentProject();
    const latestExport = await findLatestValidRenderExport(currentProjectDirectory);
    if (!latestExport) {
      sendJson(response, 200, {
        available: false,
        projectName: project.name,
        projectPath: currentProjectPath,
        exportDirectory: path.join(currentProjectDirectory, 'exports', 'reels')
      });
      return;
    }
    const media = await probeReelSource(latestExport.outputPath);
    const settings = await loadReelSettings(currentProjectDirectory, media.duration, latestExport.relativePath);
    sendJson(response, 200, {
      available: true,
      projectName: project.name,
      projectPath: currentProjectPath,
      projectDirectory: currentProjectDirectory,
      exportDirectory: path.join(currentProjectDirectory, 'exports', 'reels'),
      source: {
        ...latestExport,
        sourceUrl: `/api/reel/source?path=${encodeURIComponent(latestExport.relativePath)}`
      },
      media,
      settings
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/reel/source') {
    const sourcePath = await assertExistingReelSource(currentProjectDirectory, url.searchParams.get('path'));
    await serveAsset(request, response, sourcePath);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/reel/watermark-image') {
    const imagePath = resolveReelProjectPath(currentProjectDirectory, url.searchParams.get('path'));
    if (!imagePath || !(await exists(imagePath)) || path.extname(imagePath).toLowerCase() !== '.png') {
      sendJson(response, 404, { error: 'Reel watermark PNG not found.' });
      return;
    }
    await serveAsset(request, response, imagePath);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reel/watermark-image') {
    const body = await readRequestBody(request);
    const result = await saveReelWatermarkImage(currentProjectDirectory, JSON.parse(body || '{}'));
    sendJson(response, 200, { imported: true, ...result });
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/reel/settings') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const latestExport = await findLatestValidRenderExport(currentProjectDirectory);
    if (!latestExport) {
      sendJson(response, 409, { error: 'No final video export is available for Reel Mode.' });
      return;
    }
    const media = await probeReelSource(latestExport.outputPath);
    const result = await saveReelSettings(currentProjectDirectory, {
      ...(payload.settings || {}),
      sourceVideo: latestExport.relativePath
    }, media.duration);
    sendJson(response, 200, {
      saved: true,
      settings: result.settings,
      settingsPath: result.settingsPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reel/export/start') {
    if ([...reelExportJobs.values()].some((job) => job.status === 'running')) {
      sendJson(response, 409, { error: 'Another Reel export is already running.' });
      return;
    }
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const latestExport = await findLatestValidRenderExport(currentProjectDirectory);
    if (!latestExport) {
      sendJson(response, 409, { error: 'No final video export is available for Reel Mode.' });
      return;
    }
    const media = await probeReelSource(latestExport.outputPath);
    const saved = await saveReelSettings(currentProjectDirectory, {
      ...(payload.settings || {}),
      sourceVideo: latestExport.relativePath
    }, media.duration);
    const watermarkImagePath = saved.settings.watermark.enabled && saved.settings.watermark.type === 'image'
      ? resolveReelProjectPath(currentProjectDirectory, saved.settings.watermark.imagePath)
      : '';
    const job = await startReelExport(currentProjectDirectory, {
      projectName: project.name,
      sourcePath: latestExport.outputPath,
      media,
      settings: saved.settings,
      watermarkImagePath,
      videoEncoder: payload.videoEncoder === 'libx264' ? 'libx264' : undefined
    });
    reelExportJobs.set(job.id, job);
    job.done.finally(() => {
      setTimeout(() => reelExportJobs.delete(job.id), 60 * 60 * 1000);
    }).catch(() => {});
    sendJson(response, 200, {
      jobId: job.id,
      status: job.status,
      outputPath: job.plan.outputPath,
      relativePath: job.plan.relativePath,
      videoEncoder: job.plan.videoEncoder,
      duration: job.plan.duration
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/reel/export/status') {
    const job = reelExportJobs.get(String(url.searchParams.get('jobId') || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Reel export job not found.' });
      return;
    }
    sendJson(response, 200, serializeReelJob(job));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reel/export/cancel') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const job = reelExportJobs.get(String(payload.jobId || ''));
    if (!job) {
      sendJson(response, 404, { error: 'Reel export job not found.' });
      return;
    }
    sendJson(response, 200, { cancelled: cancelReelExport(job), ...serializeReelJob(job) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/publish/context') {
    const project = await readCurrentProject();
    const context = await publishService.getContext(currentProjectDirectory, url.searchParams.get('provider') || 'tiktok');
    sendJson(response, 200, {
      ...context,
      projectName: project.name,
      projectPath: currentProjectPath
    });
    return;
  }

  const publishRoute = url.pathname.match(/^\/api\/publish\/(tiktok|youtube|instagram)\/(connect|disconnect|refresh|upload\/start|upload\/cancel)$/);
  const publishStatusRoute = url.pathname.match(/^\/api\/publish\/(tiktok|youtube|instagram)\/(connect\/status|upload\/status)$/);

  if (request.method === 'POST' && publishRoute?.[2] === 'connect') {
    const provider = publishRoute[1];
    try {
      const started = publishService.startConnect(provider);
      const ready = provider === 'instagram'
        ? started
        : await publishService.waitForConnectAuthorization(started.jobId, provider);
      sendJson(response, 200, ready || started);
    } catch (error) {
      sendJson(response, 409, { error: safeErrorMessage(error, publishSecrets()) });
    }
    return;
  }

  if (request.method === 'GET' && publishStatusRoute?.[2] === 'connect/status') {
    const provider = publishStatusRoute[1];
    const job = publishService.getConnectProgress(url.searchParams.get('jobId'), provider);
    if (!job) {
      sendJson(response, 404, { error: `${publishProviderLabel(provider)} connection job not found.` });
      return;
    }
    sendJson(response, 200, job);
    return;
  }

  if (request.method === 'POST' && publishRoute?.[2] === 'disconnect') {
    sendJson(response, 200, await publishService.disconnect(publishRoute[1]));
    return;
  }

  if (request.method === 'POST' && publishRoute?.[2] === 'refresh') {
    try { sendJson(response, 200, await publishService.refreshCredentials(publishRoute[1])); }
    catch (error) { sendJson(response, 409, { error: safeErrorMessage(error, publishSecrets()) }); }
    return;
  }

  if (request.method === 'POST' && publishRoute?.[2] === 'upload/start') {
    const provider = publishRoute[1];
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    try {
      const job = await publishService.startUpload(currentProjectDirectory, {
        provider,
        confirmed: payload.confirmed === true,
        caption: String(payload.caption || ''),
        title: String(payload.title || ''),
        description: String(payload.description || ''),
        tags: payload.tags,
        privacy: String(payload.privacy || 'private'),
        categoryId: String(payload.categoryId || '10'),
        madeForKids: payload.madeForKids === true,
        containsSyntheticMedia: payload.containsSyntheticMedia !== false,
        thumbnail: decodeYouTubeThumbnail(payload.thumbnail),
        destination: String(payload.destination || 'reel'),
        shareToFeed: payload.shareToFeed !== false,
        publishAnyway: payload.publishAnyway === true
      });
      if (job?.jobId) latestPublishJobIds.set(provider, job.jobId);
      sendJson(response, 200, job);
    } catch (error) {
      sendJson(response, 409, { error: safeErrorMessage(error, publishSecrets()) });
    }
    return;
  }

  if (request.method === 'GET' && publishStatusRoute?.[2] === 'upload/status') {
    const provider = publishStatusRoute[1];
    const job = publishService.getUploadProgress(url.searchParams.get('jobId'), provider);
    if (!job) {
      sendJson(response, 404, { error: `${publishProviderLabel(provider)} upload job not found.` });
      return;
    }
    sendJson(response, 200, job);
    return;
  }

  if (request.method === 'POST' && publishRoute?.[2] === 'upload/cancel') {
    const provider = publishRoute[1];
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const cancelled = publishService.cancelUpload(payload.jobId, provider);
    if (!cancelled) {
      sendJson(response, 409, { error: `${publishProviderLabel(provider)} upload is not running or is already irreversible.` });
      return;
    }
    sendJson(response, 200, { cancelled: true, job: publishService.getUploadProgress(payload.jobId, provider) });
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/publish/settings') {
    const body = await readRequestBody(request);
    const settings = await publishService.saveSettings(JSON.parse(body || '{}'));
    sendJson(response, 200, { saved: true, settings });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/visualizer-presets') {
    sendJson(response, 200, {
      library: await loadVisualizerPresetLibrary(visualizerPresetLibraryPath),
      libraryPath: visualizerPresetLibraryPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/visualizer-presets') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const library = await upsertVisualizerPresetInLibrary(visualizerPresetLibraryPath, payload.preset);
    sendJson(response, 200, {
      saved: true,
      library,
      libraryPath: visualizerPresetLibraryPath
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/lyrics-style-presets') {
    sendJson(response, 200, {
      library: await loadLyricsStylePresetLibrary(lyricsStylePresetLibraryPath),
      libraryPath: lyricsStylePresetLibraryPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/lyrics-style-presets') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const library = await upsertLyricsStylePresetInLibrary(lyricsStylePresetLibraryPath, payload.preset);
    sendJson(response, 200, {
      saved: true,
      library,
      libraryPath: lyricsStylePresetLibraryPath
    });
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/lyrics-style-presets') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const library = await deleteLyricsStylePresetFromLibrary(lyricsStylePresetLibraryPath, payload.id);
    sendJson(response, 200, {
      deleted: true,
      library,
      libraryPath: lyricsStylePresetLibraryPath
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/project-templates') {
    sendJson(response, 200, {
      library: await loadProjectTemplateLibrary(projectTemplateLibraryPath),
      libraryPath: projectTemplateLibraryPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project-templates') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const project = await readCurrentProject();
    const template = createProjectTemplateFromProject(project, { name: payload.name });
    const library = await upsertProjectTemplateInLibrary(projectTemplateLibraryPath, template);
    sendJson(response, 200, {
      saved: true,
      template,
      library,
      libraryPath: projectTemplateLibraryPath
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project-templates/apply') {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const library = await loadProjectTemplateLibrary(projectTemplateLibraryPath);
    const template = library.templates.find((item) => item.id === payload.templateId);
    if (!template) {
      sendJson(response, 404, { error: 'Project template not found.' });
      return;
    }
    currentProject = applyProjectTemplate(await readCurrentProject(), template);
    sendJson(response, 200, {
      applied: true,
      template,
      project: currentProject
    });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
    const assetId = decodeURIComponent(url.pathname.replace('/api/assets/', ''));
    const project = await readCurrentProject();
    const asset = project.assets.find((item) => item.id === assetId);
    const assetPath = resolveAssetPath(currentProjectDirectory, asset);

    if (!assetPath || !(await exists(assetPath))) {
      sendJson(response, 404, { error: 'Asset not found.' });
      return;
    }

    await serveAsset(request, response, assetPath);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/brand/Kr8_Studio.png') {
    const brandPath = path.join(projectRoot, 'assets', 'Kr8_Studio.png');
    if (!(await exists(brandPath))) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Brand asset not found.');
      return;
    }
    await serveAsset(request, response, brandPath);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/vendor/')) {
    const vendorRoot = path.join(projectRoot, 'node_modules', 'mp4box', 'dist');
    const requested = decodeURIComponent(url.pathname.replace('/vendor/', ''));
    const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
    const vendorPath = path.join(vendorRoot, safePath);
    const safeVendorRoot = `${vendorRoot}${path.sep}`;
    if (!(vendorPath === vendorRoot || vendorPath.startsWith(safeVendorRoot)) || !(await exists(vendorPath))) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Vendor file not found.');
      return;
    }
    response.writeHead(200, { 'content-type': contentTypeFor(vendorPath) });
    createReadStream(vendorPath).pipe(response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/core/advanced-typography.js') {
    await serveAsset(request, response, path.join(projectRoot, 'src', 'text', 'advancedTypography.js'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/core/animation-evaluate.js') {
    await serveAsset(request, response, path.join(projectRoot, 'src', 'animation', 'evaluate.js'));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/core/lyrics-editor/')) {
    const requested = decodeURIComponent(url.pathname.replace('/core/lyrics-editor/', ''));
    const allowed = new Set([
      'editorState.js',
      'importExport.js',
      'operations.js',
      'schema.js',
      'timecode.js',
      'validation.js'
    ]);
    if (!allowed.has(requested)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Lyrics Editor module not found.');
      return;
    }
    await serveAsset(request, response, path.join(projectRoot, 'src', 'lyrics-editor', requested));
    return;
  }

  if (request.method === 'GET') {
    await serveStatic(url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed.' });
}

function decodeYouTubeThumbnail(value) {
  if (!value) return null;
  const contentType = String(value.contentType || '').toLowerCase();
  if (!['image/jpeg', 'image/png'].includes(contentType)) throw new Error('YouTube thumbnail must be a JPG or PNG file.');
  const match = String(value.dataUrl || '').match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== contentType) throw new Error('YouTube thumbnail data is invalid.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2_000_000) throw new Error('YouTube thumbnail must be no larger than 2 MB.');
  return { contentType, buffer };
}

async function readCurrentProject() {
  if (!currentProject) {
    currentProject = deserializeProject(await readFile(currentProjectPath, 'utf8'));
  }
  return currentProject;
}

function resolveProjectPathForServer(projectPath) {
  const fallbackProjectPath = serverConfig.projectsRoot
    ? path.join(path.resolve(serverConfig.projectsRoot), 'blank.kr8', 'project.json')
    : defaultProjectPath;
  const resolved = path.resolve(projectPath || fallbackProjectPath);
  if (serverConfig.projectsRoot && !isPathInside(resolved, serverConfig.projectsRoot)) {
    throw new Error(`Project path must be inside KR8_PROJECTS_ROOT: ${serverConfig.projectsRoot}`);
  }
  return resolved;
}

function isAuthorizedRequest(request, response) {
  if (!hasAuth(serverConfig)) return true;
  const header = String(request.headers.authorization || '');
  const expected = `Basic ${Buffer.from(`${serverConfig.auth.username}:${serverConfig.auth.password}`).toString('base64')}`;
  if (header === expected) return true;
  response.writeHead(401, {
    'content-type': 'text/plain; charset=utf-8',
    'www-authenticate': 'Basic realm="Kr8 Studio"'
  });
  response.end('Authentication required.');
  return false;
}

function countRunningHeadlessJobs() {
  let count = 0;
  for (const job of headlessExportJobs.values()) {
    if (job.status === 'running') count += 1;
  }
  return count;
}

function findLatestHeadlessJob(projectPath = '') {
  let latest = null;
  for (const job of headlessExportJobs.values()) {
    if (projectPath && job.projectPath !== projectPath) continue;
    if (!latest || String(job.startedAt || '') > String(latest.startedAt || '')) latest = job;
  }
  return latest;
}

async function startHeadlessExportJob(request, options = {}) {
  const browserPath = await resolveHeadlessBrowserPath();
  const jobId = `headless_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const width = Math.max(1, Math.round(Number(options.width || 1920)));
  const height = Math.max(1, Math.round(Number(options.height || 1080)));
  const normalizedOptions = {
    preset: String(options.preset || 'custom-range'),
    start: Math.max(0, Number(options.start || 0)),
    end: Math.max(0, Number(options.end || 0)),
    fps: Math.max(1, Math.min(30, Math.round(Number(options.fps || 30)))),
    frameCount: Math.max(1, Math.min(18000, Math.round(Number(options.frameCount || 1)))),
    raw: options.raw !== false,
    composite: options.composite === true,
    hardwareEncoder: options.hardwareEncoder === 'h264_nvenc' ? 'h264_nvenc' : '',
    fast: options.fast === true,
    width,
    height
  };
  const origin = getRequestOrigin(request);
  const exportUrl = new URL('/index.html', origin);
  if (hasAuth(serverConfig)) {
    exportUrl.username = serverConfig.auth.username;
    exportUrl.password = serverConfig.auth.password;
  }
  exportUrl.searchParams.set('headlessExport', jobId);
  for (const [key, value] of Object.entries(normalizedOptions)) {
    if (typeof value === 'boolean') {
      exportUrl.searchParams.set(key, value ? '1' : '0');
    } else {
      exportUrl.searchParams.set(key, String(value));
    }
  }

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-headless-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    exportUrl.toString()
  ];
  if (serverConfig.chromeNoSandbox) {
    args.unshift('--no-sandbox');
  }
  const child = spawn(browserPath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  });
  const job = {
    id: jobId,
    projectPath: currentProjectPath,
    status: 'running',
    startedAt: new Date().toISOString(),
    browserPath,
    userDataDir,
    options: normalizedOptions,
    progress: {
      stage: 'launching-browser',
      completedFrames: 0,
      totalFrames: normalizedOptions.frameCount,
      averageFps: 0
    },
    child,
    result: null,
    error: ''
  };
  headlessExportJobs.set(jobId, job);
  child.once('exit', (code, signal) => {
    if (job.status === 'running') {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = `Headless browser exited before completion${Number.isInteger(code) ? ` (code ${code})` : ''}${signal ? ` (${signal})` : ''}.`;
    }
    cleanupHeadlessUserData(job);
  });
  return job;
}

async function resolveHeadlessBrowserPath() {
  const candidates = [
    serverConfig.browserPath,
    process.env.KR8_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      try {
        await access(candidate, fsConstants.F_OK);
        return candidate;
      } catch {}
    }
  }
  throw new Error('Chrome or Edge executable not found. Set KR8_BROWSER_PATH to enable headless exports.');
}

async function listSystemFontFamilies(options = {}) {
  if (!options.refresh && systemFontCache) return systemFontCache;
  const discovered = [];
  systemFontFaces = [];
  systemFontFileCache = new Map();
  if (process.platform === 'win32') {
    discovered.push(...await readWindowsFontRegistry());
  } else {
    discovered.push(...await readFontconfigFamilies());
  }
  if (!discovered.length) {
    discovered.push(...await scanFontDirectories());
  }
  systemFontCache = normalizeFontFamilyList(discovered);
  return systemFontCache;
}

async function readWindowsFontRegistry() {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
  ];
  const families = [];
  const fontsDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  for (const key of keys) {
    try {
      const output = await execFileText('reg', ['query', key]);
      const records = extractWindowsFontRegistryRecords(output);
      for (const record of records) {
        const fontPath = path.isAbsolute(record.fileName) ? record.fileName : path.join(fontsDir, record.fileName);
        const internalFamily = await readFontFileFamily(fontPath);
        const family = internalFamily || record.displayName;
        registerSystemFontFace(family, fontPath);
        if (internalFamily && internalFamily.toLowerCase() !== record.displayName.toLowerCase()) {
          registerSystemFontFace(record.displayName, fontPath);
        }
        families.push(family);
        if (record.displayName !== family) families.push(record.displayName);
      }
    } catch {}
  }
  return families;
}

export function extractWindowsFontRegistryFamilies(output) {
  return extractWindowsFontRegistryRecords(output).map((record) => record.displayName);
}

export function extractWindowsFontRegistryRecords(output) {
  const families = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_\w+\s+(.+)$/i.exec(line);
    if (!match) continue;
    const displayName = match[1]
      .replace(/\s*\((?:TrueType|OpenType|Type 1)\)\s*$/i, '')
      .trim();
    const fileName = match[2].trim();
    if (displayName && fileName) families.push({ displayName, fileName });
  }
  return families;
}

async function readFontFileFamily(fontPath) {
  if (!/\.(?:ttf|otf|ttc)$/i.test(fontPath)) return '';
  try {
    const data = await readFile(fontPath);
    return parseFontFamilyFromBuffer(data);
  } catch {
    return '';
  }
}

export function parseFontFamilyFromBuffer(data) {
  if (!Buffer.isBuffer(data) || data.length < 12) return '';
  const tableOffset = findFontTable(data, 'name');
  if (tableOffset < 0 || tableOffset + 6 > data.length) return '';
  const count = data.readUInt16BE(tableOffset + 2);
  const stringOffset = data.readUInt16BE(tableOffset + 4);
  const storageOffset = tableOffset + stringOffset;
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const recordOffset = tableOffset + 6 + index * 12;
    if (recordOffset + 12 > data.length) break;
    const platformId = data.readUInt16BE(recordOffset);
    const nameId = data.readUInt16BE(recordOffset + 6);
    if (nameId !== 1) continue;
    const length = data.readUInt16BE(recordOffset + 8);
    const offset = data.readUInt16BE(recordOffset + 10);
    const start = storageOffset + offset;
    const end = start + length;
    if (start < 0 || end > data.length || start >= end) continue;
    const value = decodeFontName(data.subarray(start, end), platformId);
    if (value) names.push({ platformId, value });
  }
  return (names.find((name) => name.platformId === 3)?.value || names[0]?.value || '').trim();
}

function findFontTable(data, tag) {
  const tableCount = data.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > data.length) break;
    if (data.toString('ascii', recordOffset, recordOffset + 4) === tag) {
      return data.readUInt32BE(recordOffset + 8);
    }
  }
  return -1;
}

function decodeFontName(data, platformId) {
  if (platformId === 0 || platformId === 3) {
    let text = '';
    for (let index = 0; index + 1 < data.length; index += 2) {
      const code = data.readUInt16BE(index);
      if (code) text += String.fromCharCode(code);
    }
    return text.trim();
  }
  return data.toString('latin1').replace(/\0/g, '').trim();
}

async function readFontconfigFamilies() {
  try {
    const output = await execFileText('fc-list', [':', 'family']);
    return output
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((name) => name.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function scanFontDirectories() {
  const home = os.homedir();
  const directories = process.platform === 'win32'
    ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')]
    : [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        path.join(home, '.fonts'),
        path.join(home, '.local', 'share', 'fonts')
      ];
  const families = [];
  for (const directory of directories) {
    families.push(...await scanFontDirectory(directory, 0));
  }
  return families;
}

async function scanFontDirectory(directory, depth) {
  if (depth > 4) return [];
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const families = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      families.push(...await scanFontDirectory(fullPath, depth + 1));
      continue;
    }
    if (!entry.isFile() || !/\.(?:ttf|otf|ttc|woff2?)$/i.test(entry.name)) continue;
    const family = await readFontFileFamily(fullPath) || fontFamilyFromFilename(entry.name);
    registerSystemFontFace(family, fullPath);
    families.push(family);
  }
  return families;
}

function registerSystemFontFace(family, fontPath) {
  const name = String(family || '').trim().replace(/\s+/g, ' ');
  if (!name || !/\.(?:ttf|otf|ttc|woff2?)$/i.test(fontPath)) return;
  const id = Buffer.from(path.resolve(fontPath)).toString('base64url');
  if (!systemFontFileCache.has(id)) {
    systemFontFileCache.set(id, path.resolve(fontPath));
  }
  if (!systemFontFaces.some((face) => face.id === id && face.family.toLowerCase() === name.toLowerCase())) {
    if (systemFontFaces.some((face) => face.family.toLowerCase() === name.toLowerCase())) return;
    systemFontFaces.push({
      id,
      family: name,
      url: `/api/system/font-files/${encodeURIComponent(id)}`
    });
  }
}

function fontFamilyFromFilename(filename) {
  return path.basename(String(filename || ''), path.extname(String(filename || '')))
    .replace(/[_-]+/g, ' ')
    .replace(/\b(?:regular|bold|italic|light|medium|semibold|extrabold|black|thin|condensed|narrow)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeFontFamilyList(families) {
  const seen = new Map();
  for (const rawName of families) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function getRequestOrigin(request) {
  if (serverConfig.internalOrigin) return serverConfig.internalOrigin;
  const host = request.headers.host || '127.0.0.1:5174';
  return `http://${host}`;
}

function cleanupHeadlessJobProcess(job) {
  if (!job?.child || job.child.killed) return;
  try {
    job.child.kill();
  } catch {}
}

function cancelHeadlessExportJob(job) {
  if (!job) return false;
  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();
  job.error = 'Headless MP4 cancelled.';
  if (job.directSessionId) {
    const directSession = directVideoSessions.get(job.directSessionId);
    if (directSession) {
      cancelDirectVideoSession(directSession);
      directVideoSessions.delete(job.directSessionId);
    }
  }
  cleanupHeadlessJobProcess(job);
  cleanupHeadlessUserData(job);
  return true;
}

function cleanupHeadlessUserData(job) {
  if (!job?.userDataDir) return;
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(job.userDataDir);
  if (!resolved.startsWith(`${tempRoot}${path.sep}`)) return;
  rm(resolved, { recursive: true, force: true }).catch(() => {});
}

async function serveStatic(urlPath, response) {
  const requested = urlPath === '/' ? '/index.html' : urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath;
  const safePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath);
  const publicRoot = `${publicDir}${path.sep}`;

  if (!(filePath === publicDir || filePath.startsWith(publicRoot)) || !(await exists(filePath))) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const info = await stat(filePath);
  if (info.isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'cache-control': 'no-store'
  });
  createReadStream(filePath).pipe(response);
}

async function serveAsset(request, response, assetPath) {
  const info = await stat(assetPath);
  const range = request.headers.range;
  const headers = {
    'content-type': contentTypeFor(assetPath),
    'cache-control': 'no-store',
    'accept-ranges': 'bytes'
  };

  if (!range) {
    response.writeHead(200, {
      ...headers,
      'content-length': info.size
    });
    createReadStream(assetPath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
  if (!match) {
    response.writeHead(416, {
      ...headers,
      'content-range': `bytes */${info.size}`
    });
    response.end();
    return;
  }

  const start = match[1] === '' ? Math.max(0, info.size - Number(match[2] || 0)) : Number(match[1]);
  const end = match[2] === '' ? info.size - 1 : Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= info.size) {
    response.writeHead(416, {
      ...headers,
      'content-range': `bytes */${info.size}`
    });
    response.end();
    return;
  }

  const safeEnd = Math.min(end, info.size - 1);
  response.writeHead(206, {
    ...headers,
    'content-length': safeEnd - start + 1,
    'content-range': `bytes ${start}-${safeEnd}/${info.size}`
  });
  createReadStream(assetPath, { start, end: safeEnd }).pipe(response);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function trimCoverLabJobs(maxJobs = 12) {
  while (coverLabJobs.size > maxJobs) {
    const oldestId = coverLabJobs.keys().next().value;
    coverLabJobs.delete(oldestId);
  }
}

function safeDownloadFilename(value) {
  return path.basename(String(value || 'cover.webp')).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function publishProviderLabel(provider) {
  return provider === 'youtube' ? 'YouTube' : provider === 'instagram' ? 'Instagram' : 'TikTok';
}

function readRequestBody(request, options = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = Number(options.maxBytes || defaultJsonBodyLimit);
    let body = '';
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (rejected) return;
      body += chunk;
      if (body.length > maxBytes) {
        rejected = true;
        reject(new Error(`Request body too large. Limit is ${Math.round(maxBytes / 1_000_000)} MB.`));
      }
    });
    request.on('end', () => {
      if (!rejected) resolve(body);
    });
    request.on('error', reject);
  });
}

function readBinaryRequestBody(request, options = {}) {
  return new Promise((resolve, reject) => {
    const maxBytes = Number(options.maxBytes || 25_000_000);
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large.'));
      }
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function streamRequestToTemporaryFile(request, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes || 1_000_000_000));
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Audio upload is too large. Limit is ${Math.round(maxBytes / 1_000_000)} MB.`);
  }
  const originalFilename = path.basename(String(options.filename || ''));
  const sanitizedFilename = sanitizeAudioFilename(originalFilename);
  if (!originalFilename || !sanitizedFilename) throw new Error('Audio filename is required.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-audio-upload-'));
  const outputPath = path.join(directory, sanitizedFilename);
  try {
    await new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath, { flags: 'wx' });
      let bytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        request.unpipe(output);
        output.destroy();
        request.resume();
        reject(error);
      };
      request.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          fail(new Error(`Audio upload is too large. Limit is ${Math.round(maxBytes / 1_000_000)} MB.`));
        }
      });
      request.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        if (bytes <= 0) {
          reject(new Error('Audio file is missing or empty.'));
          return;
        }
        resolve();
      });
      request.pipe(output);
    });
    return { directory, path: outputPath, filename: originalFilename };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function parseDirectMp4BinaryBatch(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.length < 4) {
    throw new Error('Direct MP4 binary batch is empty.');
  }
  const headerLength = buffer.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > buffer.length - 4) {
    throw new Error('Direct MP4 binary batch header is invalid.');
  }
  const header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8'));
  let offset = 4 + headerLength;
  const frames = [];
  for (const frame of header.frames || []) {
    const size = Math.max(0, Math.round(Number(frame.size || 0)));
    const end = offset + size;
    if (size <= 0 || end > buffer.length) {
      throw new Error('Direct MP4 binary batch frame size is invalid.');
    }
    frames.push({
      timestamp: Number(frame.timestamp || 0),
      buffer: buffer.subarray(offset, end)
    });
    offset = end;
  }
  return {
    sessionId: header.sessionId,
    final: Boolean(header.final),
    benchmark: header.benchmark || null,
    frames
  };
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function openExportFolder(requestedPath) {
  const projectExportsRoot = path.join(currentProjectDirectory, 'exports');
  const safeRoot = `${path.resolve(projectExportsRoot)}${path.sep}`;
  const resolved = path.resolve(String(requestedPath || ''));
  if (!(resolved === path.resolve(projectExportsRoot) || resolved.startsWith(safeRoot))) {
    throw new Error('Export path must be inside the current project exports directory.');
  }

  const info = await stat(resolved);
  const folder = info.isDirectory() ? resolved : path.dirname(resolved);
  if (process.platform === 'win32') {
    spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [folder], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [folder], { detached: true, stdio: 'ignore' }).unref();
  }
  return folder;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.ttc': 'font/collection',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  return types[ext] || 'application/octet-stream';
}

function safeSlug(value) {
  return String(value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function isStartupBlankProject(project, projectPath) {
  if (project?.id === 'kr8_blank_project') return true;
  if ((project?.assets || []).length || (project?.layers || []).length) return false;
  return path.basename(path.dirname(String(projectPath || ''))).toLowerCase() === 'blank.kr8';
}

async function createLocalAudioProjectDestination(outputRoot, title) {
  const baseSlug = portableProjectSlug(title || 'local-audio');
  await mkdir(outputRoot, { recursive: true });
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const outputDir = path.join(outputRoot, `${baseSlug}${suffix}.kr8`);
    const projectPath = path.join(outputDir, 'project.json');
    if (await exists(outputDir)) continue;
    await mkdir(outputDir, { recursive: false });
    return { outputDir, projectPath };
  }
  throw new Error('Could not create a unique Kr8 project directory for the audio.');
}

function portableProjectSlug(value) {
  return String(value || 'local-audio')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'local-audio';
}

function summarizeImportedAudio(asset) {
  const metadata = asset?.metadata || {};
  return {
    id: asset?.id || '',
    filename: metadata.originalFilename || path.basename(String(asset?.path || '')),
    duration: Number(metadata.duration || 0),
    format: metadata.format || '',
    codec: metadata.codec || '',
    sampleRate: Number(metadata.sampleRate || 0),
    channels: Number(metadata.channels || 0),
    title: metadata.title || '',
    artist: metadata.artist || '',
    album: metadata.album || '',
    proxyGenerated: Boolean(metadata.proxyGenerated),
    embeddedCover: Boolean(metadata.embeddedCover),
    bytes: Number(metadata.bytes || 0)
  };
}

function summarizeAudioAsset(asset, fallbackDuration = 0) {
  const metadata = asset?.metadata || {};
  return {
    id: asset?.id || '',
    filename: metadata.originalFilename || path.basename(String(asset?.path || '')),
    duration: Number(metadata.duration || fallbackDuration || 0),
    format: metadata.format || path.extname(String(asset?.path || '')).slice(1),
    proxyGenerated: Boolean(metadata.proxyGenerated)
  };
}

async function resolveTkMusicImportDestination(outputRoot, resolved) {
  const slug = safeSlug(resolved.title);
  const sourceId = String(resolved.sourceId || '').trim();
  const candidates = [
    path.join(outputRoot, `${slug}.kr8`),
    path.join(outputRoot, `${slug}-${safeSlug(sourceId).slice(0, 8)}.kr8`)
  ];

  for (let index = 2; index < 100; index += 1) {
    candidates.push(path.join(outputRoot, `${slug}-${safeSlug(sourceId).slice(0, 8)}-${index}.kr8`));
  }

  for (const outputDir of candidates) {
    const projectPath = path.join(outputDir, 'project.json');
    if (!(await exists(outputDir))) {
      return { outputDir, projectPath, existingProject: null };
    }
    if (!(await exists(projectPath))) continue;
    try {
      const existingProject = deserializeProject(await readFile(projectPath, 'utf8'));
      const existingSourceId = String(
        existingProject.source?.sourceId || existingProject.source?.trackId || ''
      ).trim();
      if (sourceId && existingSourceId === sourceId) {
        return { outputDir, projectPath, existingProject };
      }
    } catch {
      // Keep malformed or unrelated project directories intact and try another name.
    }
  }

  throw new Error(`No collision-safe project directory is available for ${resolved.title}.`);
}

function createSessionId() {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function serializeReelJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    outTime: job.outTime,
    duration: job.plan.duration,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result
  };
}

function parseCliArgs(argv) {
  const options = {
    port: 0,
    host: '',
    projectPath: '',
    projectsRoot: '',
    envPath: '',
    serverMode: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      options.port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--host') {
      options.host = argv[i + 1];
      i += 1;
    } else if (arg === '--project') {
      options.projectPath = argv[i + 1];
      i += 1;
    } else if (arg === '--projects-root') {
      options.projectsRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--env') {
      options.envPath = argv[i + 1];
      i += 1;
    } else if (arg === '--server') {
      options.serverMode = true;
    }
  }

  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliArgs(process.argv.slice(2));
  options.envPath = resolveServerEnvPath(options.envPath, projectRoot);
  const envResult = await loadEnvFile(options.envPath);
  const cliConfig = buildServerConfig(options);
  options.host = options.host || cliConfig.host;
  options.port = options.port || cliConfig.port;
  options.projectPath = options.projectPath || cliConfig.projectPath || defaultProjectPath;
  const server = await createEditorServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`Kr8 editor listening at http://${options.host}:${options.port}`);
    console.log(`Project: ${path.resolve(options.projectPath)}`);
    console.log(`Server mode: ${serverConfig.serverMode ? 'on' : 'off'}${hasAuth(serverConfig) ? ', auth on' : ', auth off'}`);
    if (envResult.loaded) console.log(`Env: ${envResult.path}`);
  });
}
