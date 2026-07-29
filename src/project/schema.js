import { isBase64LikeAssetPath } from '../shared/path.js';
import { validateCoverLabSettings } from '../cover-lab/schema.js';

export const CURRENT_SCHEMA_VERSION = 1;

const LAYER_TYPES = new Set([
  'audio',
  'image',
  'video',
  'text',
  'lyrics',
  'visualizer',
  'waveform',
  'particle',
  'shader',
  'shape',
  'adjustment',
  'camera',
  'group'
]);

export function validateProject(project) {
  const errors = [];

  if (!project || typeof project !== 'object') {
    return { valid: false, errors: ['Project must be an object.'] };
  }

  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${project.schemaVersion}`);
  }

  requireString(project.id, 'id', errors);
  requireString(project.name, 'name', errors);
  validateComposition(project.composition, errors);
  validateAssets(project.assets, errors);
  validateLayers(project.layers, errors);
  validateScenes(project.scenes, errors);
  if (project.metadata?.coverLab !== undefined) {
    errors.push(...validateCoverLabSettings(project.metadata.coverLab));
  }

  if (!Array.isArray(project.presets)) {
    errors.push('presets must be an array.');
  }

  if (!Array.isArray(project.migrations)) {
    errors.push('migrations must be an array.');
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidProject(project) {
  const result = validateProject(project);
  if (!result.valid) {
    throw new Error(`Invalid Kr8 project:\n${result.errors.join('\n')}`);
  }
  return project;
}

function validateComposition(composition, errors) {
  if (!composition || typeof composition !== 'object') {
    errors.push('composition must be an object.');
    return;
  }

  requirePositiveNumber(composition.width, 'composition.width', errors);
  requirePositiveNumber(composition.height, 'composition.height', errors);
  requirePositiveNumber(composition.fps, 'composition.fps', errors);
  requireNumber(composition.duration, 'composition.duration', errors);
  requireString(composition.backgroundColor, 'composition.backgroundColor', errors);
}

function validateAssets(assets, errors) {
  if (!Array.isArray(assets)) {
    errors.push('assets must be an array.');
    return;
  }

  const ids = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') {
      errors.push('asset entries must be objects.');
      continue;
    }

    requireUniqueString(asset.id, 'asset.id', ids, errors);
    requireString(asset.type, `asset(${asset.id || '?'}).type`, errors);
    requireString(asset.path, `asset(${asset.id || '?'}).path`, errors);

    if (isBase64LikeAssetPath(asset.path)) {
      errors.push(`asset(${asset.id}).path must not be an embedded data URI.`);
    }
  }
}

function validateLayers(layers, errors) {
  if (!Array.isArray(layers)) {
    errors.push('layers must be an array.');
    return;
  }

  const ids = new Set();
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      errors.push('layer entries must be objects.');
      continue;
    }

    requireUniqueString(layer.id, 'layer.id', ids, errors);
    if (!LAYER_TYPES.has(layer.type)) {
      errors.push(`layer(${layer.id || '?'}).type is not supported: ${layer.type}`);
    }

    requireString(layer.name, `layer(${layer.id || '?'}).name`, errors);
    requireBoolean(layer.visible, `layer(${layer.id || '?'}).visible`, errors);
    requireBoolean(layer.locked, `layer(${layer.id || '?'}).locked`, errors);
    requireNumber(layer.order, `layer(${layer.id || '?'}).order`, errors);
    requireNumber(layer.start, `layer(${layer.id || '?'}).start`, errors);
    if (layer.end !== undefined) requireNumber(layer.end, `layer(${layer.id}).end`, errors);
    requireNumber(layer.opacity, `layer(${layer.id || '?'}).opacity`, errors);
    requireString(layer.blendMode, `layer(${layer.id || '?'}).blendMode`, errors);

    if (!layer.transform || typeof layer.transform !== 'object') {
      errors.push(`layer(${layer.id || '?'}).transform must be an object.`);
    }

    if (!Array.isArray(layer.effects)) errors.push(`layer(${layer.id || '?'}).effects must be an array.`);
    if (!Array.isArray(layer.audioBindings)) errors.push(`layer(${layer.id || '?'}).audioBindings must be an array.`);
    if (!Array.isArray(layer.animations)) errors.push(`layer(${layer.id || '?'}).animations must be an array.`);
    if (layer.type === 'text') validateAdvancedTextProperties(layer, errors);
  }
}

function validateAdvancedTextProperties(layer, errors) {
  const properties = layer.properties;
  if (!properties || typeof properties !== 'object') {
    errors.push(`layer(${layer.id}).properties must be an object.`);
    return;
  }
  if (properties.typography !== undefined) {
    if (!properties.typography || typeof properties.typography !== 'object') {
      errors.push(`layer(${layer.id}).properties.typography must be an object.`);
    } else {
      for (const key of [
        'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing',
        'textOpacity', 'scaleX', 'scaleY', 'skewX', 'skewY', 'rotation',
        'stretchX', 'stretchY', 'anchorX', 'anchorY', 'offsetX', 'offsetY'
      ]) {
        if (properties.typography[key] !== undefined) {
          requireNumber(properties.typography[key], `layer(${layer.id}).properties.typography.${key}`, errors);
        }
      }
    }
  }
  if (properties.lineEditing !== undefined) {
    if (!properties.lineEditing || typeof properties.lineEditing !== 'object') {
      errors.push(`layer(${layer.id}).properties.lineEditing must be an object.`);
    } else if (!Array.isArray(properties.lineEditing.lines)) {
      errors.push(`layer(${layer.id}).properties.lineEditing.lines must be an array.`);
    } else {
      const lineIds = new Set();
      for (const line of properties.lineEditing.lines) {
        if (!line || typeof line !== 'object') {
          errors.push(`layer(${layer.id}).properties.lineEditing.lines entries must be objects.`);
          continue;
        }
        requireUniqueString(line.id, `layer(${layer.id}).textLine.id`, lineIds, errors);
      }
    }
  }
  for (const key of ['textEffects', 'textureMask']) {
    if (properties[key] !== undefined && (!properties[key] || typeof properties[key] !== 'object')) {
      errors.push(`layer(${layer.id}).properties.${key} must be an object.`);
    }
  }
}

function validateScenes(scenes, errors) {
  if (!Array.isArray(scenes)) {
    errors.push('scenes must be an array.');
    return;
  }

  const ids = new Set();
  for (const scene of scenes) {
    if (!scene || typeof scene !== 'object') {
      errors.push('scene entries must be objects.');
      continue;
    }

    requireUniqueString(scene.id, 'scene.id', ids, errors);
    requireString(scene.name, `scene(${scene.id || '?'}).name`, errors);
    requireNumber(scene.start, `scene(${scene.id || '?'}).start`, errors);
    requireNumber(scene.end, `scene(${scene.id || '?'}).end`, errors);
    if (!Array.isArray(scene.overrides)) errors.push(`scene(${scene.id || '?'}).overrides must be an array.`);
  }
}

function requireUniqueString(value, label, seen, errors) {
  requireString(value, label, errors);
  if (typeof value !== 'string') return;
  if (seen.has(value)) errors.push(`${label} must be unique: ${value}`);
  seen.add(value);
}

function requireString(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} must be a non-empty string.`);
  }
}

function requireBoolean(value, label, errors) {
  if (typeof value !== 'boolean') {
    errors.push(`${label} must be a boolean.`);
  }
}

function requireNumber(value, label, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number.`);
  }
}

function requirePositiveNumber(value, label, errors) {
  requireNumber(value, label, errors);
  if (typeof value === 'number' && value <= 0) {
    errors.push(`${label} must be greater than 0.`);
  }
}
