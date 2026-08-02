import path from 'node:path';

export function buildMobileProjectContext(project) {
  const layers = Array.isArray(project?.layers) ? project.layers : [];
  const assets = Array.isArray(project?.assets) ? project.assets : [];
  const titleLayer = findNamedTextLayer(layers, 'song title');
  const artistLayer = findNamedTextLayer(layers, 'artist');
  const coverLayer = layers.find((layer) => layer?.visible !== false && layer?.type === 'image' && layer?.properties?.assetId);
  const videoLayer = layers.find((layer) => layer?.visible !== false && layer?.type === 'video' && layer?.properties?.assetId);
  const audioAsset = assets.find((asset) => asset?.type === 'audio' && asset?.role === 'song' && !asset?.missing);
  const lyricsAsset = assets.find((asset) => asset?.type === 'lyrics' && !asset?.missing);
  const coverAsset = findAsset(assets, coverLayer?.properties?.assetId)
    || assets.find((asset) => asset?.type === 'image' && asset?.role === 'cover' && !asset?.missing);

  return {
    project: {
      id: String(project?.id || ''),
      name: String(project?.name || 'Untitled Kr8 Project'),
      title: String(project?.metadata?.title || titleLayer?.properties?.text || project?.name || 'Untitled'),
      artist: String(project?.metadata?.artist || artistLayer?.properties?.text || ''),
      schemaVersion: Number(project?.schemaVersion || 1),
      updatedAt: String(project?.updatedAt || '')
    },
    composition: {
      width: positiveNumber(project?.composition?.width, 1920),
      height: positiveNumber(project?.composition?.height, 1080),
      fps: positiveNumber(project?.composition?.fps, 30),
      duration: Math.max(0, Number(project?.composition?.duration || 0)),
      backgroundColor: String(project?.composition?.backgroundColor || '#050608'),
      outputTarget: String(project?.composition?.outputTarget || ''),
      verticalReady: Number(project?.composition?.width) === 1080 && Number(project?.composition?.height) === 1920
    },
    media: {
      audioUrl: assetUrl(audioAsset),
      coverUrl: assetUrl(coverAsset),
      lyricsUrl: assetUrl(lyricsAsset),
      hasVisibleVideoLayer: Boolean(videoLayer)
    },
    layers: layers.map((layer) => ({
      id: String(layer?.id || ''),
      name: String(layer?.name || layer?.type || 'Layer'),
      type: String(layer?.type || 'unknown'),
      visible: layer?.visible !== false,
      locked: layer?.locked === true,
      order: Number(layer?.order || 0),
      opacity: clampNumber(layer?.opacity, 0, 1, 1),
      blendMode: String(layer?.blendMode || 'normal'),
      transform: sanitizeTransform(layer?.transform),
      properties: sanitizeLayerProperties(layer?.type, layer?.properties),
      assetUrl: assetUrl(findAsset(assets, layer?.properties?.assetId)),
      textureAssetUrl: assetUrl(findAsset(assets, layer?.properties?.textureMask?.assetId))
    })),
    scenes: (Array.isArray(project?.scenes) ? project.scenes : []).map((scene) => ({
      id: String(scene?.id || ''),
      name: String(scene?.name || 'Scene'),
      start: Math.max(0, Number(scene?.start || 0)),
      end: Math.max(0, Number(scene?.end || 0))
    }))
  };
}

export function serializeMobileRenderJob(job) {
  if (!job) return { status: 'idle' };
  const result = job.result?.export || job.result || null;
  const outputPath = String(result?.absolutePath || result?.outputPath || '');
  return {
    jobId: String(job.id || ''),
    status: String(job.status || 'idle'),
    progress: {
      stage: String(job.progress?.stage || ''),
      completedFrames: Math.max(0, Number(job.progress?.completedFrames || 0)),
      totalFrames: Math.max(0, Number(job.progress?.totalFrames || job.options?.frameCount || 0)),
      averageFps: Math.max(0, Number(job.progress?.averageFps || 0))
    },
    startedAt: String(job.startedAt || ''),
    completedAt: String(job.completedAt || ''),
    error: String(job.error || ''),
    output: outputPath ? { filename: path.win32.basename(outputPath) } : null
  };
}

export function serializeMobilePublishStatus(provider, connection, upload) {
  return {
    provider,
    connected: connection?.connected === true,
    state: String(connection?.state || (connection?.connected ? 'connected' : 'disconnected')),
    account: String(connection?.displayName || connection?.channelTitle || connection?.username || ''),
    upload: upload ? {
      jobId: String(upload.jobId || ''),
      status: String(upload.status || ''),
      progress: Math.max(0, Math.min(100, Number(upload.progress || 0))),
      bytesSent: Math.max(0, Number(upload.bytesSent || 0)),
      totalBytes: Math.max(0, Number(upload.totalBytes || 0)),
      error: String(upload.error || '')
    } : null
  };
}

function findNamedTextLayer(layers, name) {
  return layers.find((layer) => layer?.type === 'text' && String(layer?.name || '').trim().toLowerCase() === name);
}

function findAsset(assets, id) {
  if (!id) return null;
  return assets.find((asset) => asset?.id === id && !asset?.missing) || null;
}

function assetUrl(asset) {
  return asset?.id ? `/api/assets/${encodeURIComponent(asset.id)}` : '';
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sanitizeTransform(transform = {}) {
  const result = {};
  for (const key of ['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'anchorX', 'anchorY']) {
    const value = Number(transform?.[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function sanitizeLayerProperties(type, properties = {}) {
  const common = ['color', 'backgroundColor', 'backgroundOpacity', 'padding', 'radius', 'fit'];
  const byType = {
    shape: ['fill'],
    text: [
      'text', 'fontFamily', 'fontSize', 'align', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowBlur',
      'typographyPresetId', 'typography', 'lineEditing', 'textEffects', 'textureMask'
    ],
    lyrics: [
      'fontFamily', 'fontSize', 'color', 'align', 'lineHeight', 'maxLines',
      'backgroundColor', 'backgroundOpacity', 'padding', 'radius',
      'strokeColor', 'strokeWidth',
      'glowColor', 'glowBlur', 'glowIntensity',
      'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'
    ],
    image: [],
    video: ['loop', 'startOffset', 'playbackRate'],
    visualizer: ['bars', 'visualizerType', 'accentColor', 'minFrequency', 'maxFrequency', 'gain', 'sensitivity', 'floor', 'highFrequencyBoost', 'lowFrequencyDamping', 'midFrequencyDamping', 'noiseGate', 'innerRadius', 'outerRadius', 'barThickness', 'arc', 'startAngle', 'mirror']
  };
  const allowed = new Set([...common, ...(byType[type] || [])]);
  const result = {};
  for (const key of allowed) {
    const value = properties?.[key];
    if (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) result[key] = value;
    else if (value && typeof value === 'object') result[key] = structuredClone(value);
  }
  return result;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}
