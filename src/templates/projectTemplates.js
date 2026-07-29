import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_TEMPLATE_LIBRARY_VERSION = 1;

const TEMPLATE_METADATA_KEYS = [
  'lyricsStylePresets',
  'textStylePresets',
  'visualizerStylePresets',
  'sceneVisualizerPresets'
];

export async function loadProjectTemplateLibrary(libraryPath) {
  try {
    return normalizeProjectTemplateLibrary(JSON.parse(await readFile(libraryPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyProjectTemplateLibrary();
    throw error;
  }
}

export async function saveProjectTemplateLibrary(libraryPath, library) {
  const normalized = normalizeProjectTemplateLibrary(library);
  await mkdir(path.dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function upsertProjectTemplateInLibrary(libraryPath, template) {
  const library = await loadProjectTemplateLibrary(libraryPath);
  const sanitized = sanitizeProjectTemplate(template);
  return saveProjectTemplateLibrary(libraryPath, {
    ...library,
    templates: [
      ...library.templates.filter((item) => item.id !== sanitized.id),
      sanitized
    ]
  });
}

export function createProjectTemplateFromProject(project, options = {}) {
  const name = String(options.name || project?.name || 'Kr8 Template').trim();
  if (!name) throw new Error('Project template name is required.');
  const now = new Date().toISOString();
  const id = options.id || `tpl_${slugify(name)}`;
  const composition = project?.composition || {};
  return sanitizeProjectTemplate({
    id,
    name,
    scope: 'global',
    createdAt: options.createdAt || now,
    providerAgnostic: true,
    composition: {
      width: composition.width || 1920,
      height: composition.height || 1080,
      fps: composition.fps || 30,
      backgroundColor: composition.backgroundColor || '#05070a',
      referenceDuration: Number(composition.duration || 0)
    },
    layers: (project?.layers || [])
      .filter((layer) => layer.type !== 'audio')
      .map(sanitizeTemplateLayer),
    metadata: pickTemplateMetadata(project?.metadata || {})
  });
}

export function applyProjectTemplate(project, template) {
  const sanitized = sanitizeProjectTemplate(template);
  const currentLayers = Array.isArray(project?.layers) ? project.layers : [];
  const currentDuration = Number(project?.composition?.duration || sanitized.composition.referenceDuration || 0);
  const usedIds = new Set();
  const byKey = new Map(currentLayers.map((layer) => [layerKey(layer), layer]));
  const nextLayers = [];

  for (const [index, templateLayer] of sanitized.layers.entries()) {
    const existing = byKey.get(layerKey(templateLayer));
    const nextLayer = existing
      ? mergeTemplateLayer(existing, templateLayer, sanitized.composition.referenceDuration, currentDuration)
      : createLayerFromTemplate(templateLayer, sanitized.id, index, sanitized.composition.referenceDuration, currentDuration, usedIds);
    usedIds.add(nextLayer.id);
    nextLayers.push(nextLayer);
  }

  for (const layer of currentLayers) {
    if (!nextLayers.some((item) => item.id === layer.id) && shouldPreserveUnmatchedLayer(layer)) {
      usedIds.add(layer.id);
      nextLayers.push(layer);
    }
  }

  return {
    ...project,
    composition: {
      ...(project.composition || {}),
      width: sanitized.composition.width,
      height: sanitized.composition.height,
      fps: sanitized.composition.fps,
      backgroundColor: sanitized.composition.backgroundColor
    },
    layers: nextLayers.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    metadata: {
      ...(project.metadata || {}),
      ...pickTemplateMetadata(sanitized.metadata || {}),
      appliedProjectTemplateId: sanitized.id,
      appliedProjectTemplateName: sanitized.name
    }
  };
}

export function normalizeProjectTemplateLibrary(payload = {}) {
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  return {
    version: PROJECT_TEMPLATE_LIBRARY_VERSION,
    templates: templates.map(sanitizeProjectTemplate)
  };
}

function createEmptyProjectTemplateLibrary() {
  return {
    version: PROJECT_TEMPLATE_LIBRARY_VERSION,
    templates: []
  };
}

export function sanitizeProjectTemplate(template) {
  if (!template || typeof template !== 'object') {
    throw new Error('Project template must be an object.');
  }
  if (!template.id || !template.name) {
    throw new Error('Project template requires id and name.');
  }
  const composition = template.composition || {};
  return {
    id: String(template.id),
    name: String(template.name),
    scope: template.scope ? String(template.scope) : 'global',
    createdAt: template.createdAt ? String(template.createdAt) : new Date().toISOString(),
    providerAgnostic: template.providerAgnostic !== false,
    composition: {
      width: Math.max(1, Math.round(Number(composition.width || 1920))),
      height: Math.max(1, Math.round(Number(composition.height || 1080))),
      fps: Math.max(1, Math.round(Number(composition.fps || 30))),
      backgroundColor: String(composition.backgroundColor || '#05070a'),
      referenceDuration: Math.max(0, Number(composition.referenceDuration || 0))
    },
    layers: Array.isArray(template.layers) ? template.layers.map(sanitizeTemplateLayer) : [],
    metadata: pickTemplateMetadata(template.metadata || {})
  };
}

function sanitizeTemplateLayer(layer) {
  const properties = sanitizeTemplateProperties(layer);
  return {
    id: String(layer.id || `template_layer_${slugify(layer.name || layer.type || 'layer')}`),
    type: String(layer.type || 'shape'),
    name: String(layer.name || 'Layer'),
    visible: layer.visible !== false,
    locked: layer.locked === true,
    parentId: layer.parentId ?? null,
    order: Number(layer.order || 0),
    start: Number(layer.start || 0),
    ...(layer.end !== undefined ? { end: Number(layer.end || 0) } : {}),
    transform: structuredClone(layer.transform || {}),
    opacity: Number(layer.opacity ?? 1),
    blendMode: String(layer.blendMode || 'normal'),
    properties,
    effects: structuredClone(layer.effects || []),
    audioBindings: structuredClone(layer.audioBindings || []),
    animations: structuredClone(layer.animations || [])
  };
}

function sanitizeTemplateProperties(layer) {
  const properties = structuredClone(layer.properties || {});
  delete properties.assetId;
  delete properties.previewText;
  if (layer.type === 'text' && isTrackTextLayer(layer)) {
    delete properties.text;
  }
  return properties;
}

function mergeTemplateLayer(existing, templateLayer, referenceDuration, currentDuration) {
  const templateProperties = structuredClone(templateLayer.properties || {});
  const nextProperties = {
    ...templateProperties
  };
  if ((templateLayer.type === 'image' || templateLayer.type === 'video') && existing.properties?.assetId) {
    nextProperties.assetId = existing.properties.assetId;
  }
  if (templateLayer.type === 'text' && templateProperties.text === undefined && existing.properties?.text !== undefined) {
    nextProperties.text = existing.properties.text;
  }

  return {
    ...existing,
    type: templateLayer.type,
    name: templateLayer.name,
    visible: templateLayer.visible,
    locked: templateLayer.locked,
    parentId: templateLayer.parentId,
    order: templateLayer.order,
    start: templateLayer.start,
    end: scaleTemplateEnd(templateLayer.end, referenceDuration, currentDuration),
    transform: structuredClone(templateLayer.transform || {}),
    opacity: templateLayer.opacity,
    blendMode: templateLayer.blendMode,
    properties: nextProperties,
    effects: structuredClone(templateLayer.effects || []),
    audioBindings: structuredClone(templateLayer.audioBindings || []),
    animations: structuredClone(templateLayer.animations || [])
  };
}

function createLayerFromTemplate(templateLayer, templateId, index, referenceDuration, currentDuration, usedIds) {
  const idBase = `layer_${slugify(templateId)}_${slugify(templateLayer.name)}_${index}`;
  let id = idBase;
  let suffix = 1;
  while (usedIds.has(id)) {
    id = `${idBase}_${suffix}`;
    suffix += 1;
  }
  return {
    ...structuredClone(templateLayer),
    id,
    parentId: null,
    end: scaleTemplateEnd(templateLayer.end, referenceDuration, currentDuration)
  };
}

function scaleTemplateEnd(end, referenceDuration, currentDuration) {
  if (end === undefined) return undefined;
  const safeEnd = Number(end || 0);
  if (referenceDuration > 0 && safeEnd >= referenceDuration * 0.98) {
    return currentDuration || safeEnd;
  }
  return safeEnd;
}

function shouldPreserveUnmatchedLayer(layer) {
  return layer.type === 'audio' || layer.type === 'group';
}

function pickTemplateMetadata(metadata) {
  const picked = {};
  for (const key of TEMPLATE_METADATA_KEYS) {
    if (metadata[key] !== undefined) picked[key] = structuredClone(metadata[key]);
  }
  return picked;
}

function layerKey(layer) {
  return `${String(layer?.type || '').toLowerCase()}::${String(layer?.name || '').toLowerCase()}`;
}

function isTrackTextLayer(layer) {
  const name = String(layer.name || '').toLowerCase();
  return name.includes('song') || name.includes('title') || name.includes('artist');
}

function slugify(value) {
  return String(value || 'template')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'template';
}
