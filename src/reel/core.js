import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export const REEL_SETTINGS_SCHEMA_VERSION = 1;
export const REEL_SETTINGS_RELATIVE_PATH = 'exports/reel/reel-mode.json';

export const DEFAULT_REEL_SETTINGS = Object.freeze({
  sourceVideo: '',
  trimStart: 0,
  trimEnd: 0,
  videoFadeIn: 0,
  videoFadeOut: 1.5,
  audioFadeIn: 0,
  audioFadeOut: 2.5,
  volume: 1,
  watermark: Object.freeze({
    enabled: false,
    type: 'text',
    text: 'TK MUSIC',
    imagePath: '',
    position: 'bottom-right',
    margin: 32,
    scale: 0.05,
    opacity: 0.65,
    visibility: 'entire',
    lastSeconds: 4
  })
});

const WATERMARK_POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const WATERMARK_VISIBILITY = new Set(['entire', 'last-seconds']);

export function normalizeReelSettings(input = {}, sourceDuration = 0) {
  const duration = finiteRange(sourceDuration, 0, Number.MAX_SAFE_INTEGER, 0);
  const requestedStart = finiteRange(input.trimStart, 0, duration, 0);
  const defaultEnd = duration > 0 ? duration : requestedStart;
  const requestedEnd = finiteRange(input.trimEnd, 0, duration || Number.MAX_SAFE_INTEGER, defaultEnd);
  const trimStart = Math.min(requestedStart, Math.max(0, requestedEnd));
  const trimEnd = Math.max(trimStart, requestedEnd || defaultEnd);
  const effectiveDuration = Math.max(0, trimEnd - trimStart);
  const maxFade = Math.min(5, effectiveDuration);
  const watermarkInput = input.watermark && typeof input.watermark === 'object' ? input.watermark : {};

  return {
    sourceVideo: normalizeRelativePath(input.sourceVideo),
    trimStart,
    trimEnd,
    videoFadeIn: finiteRange(input.videoFadeIn, 0, maxFade, DEFAULT_REEL_SETTINGS.videoFadeIn),
    videoFadeOut: finiteRange(input.videoFadeOut, 0, maxFade, DEFAULT_REEL_SETTINGS.videoFadeOut),
    audioFadeIn: finiteRange(input.audioFadeIn, 0, maxFade, DEFAULT_REEL_SETTINGS.audioFadeIn),
    audioFadeOut: finiteRange(input.audioFadeOut, 0, maxFade, DEFAULT_REEL_SETTINGS.audioFadeOut),
    volume: finiteRange(input.volume, 0, 2, DEFAULT_REEL_SETTINGS.volume),
    watermark: {
      enabled: watermarkInput.enabled === true,
      type: watermarkInput.type === 'image' ? 'image' : 'text',
      text: String(watermarkInput.text ?? DEFAULT_REEL_SETTINGS.watermark.text).slice(0, 240),
      imagePath: normalizeRelativePath(watermarkInput.imagePath),
      position: WATERMARK_POSITIONS.has(watermarkInput.position)
        ? watermarkInput.position
        : DEFAULT_REEL_SETTINGS.watermark.position,
      margin: Math.round(finiteRange(watermarkInput.margin, 0, 500, DEFAULT_REEL_SETTINGS.watermark.margin)),
      scale: finiteRange(watermarkInput.scale, 0.02, 0.5, DEFAULT_REEL_SETTINGS.watermark.scale),
      opacity: finiteRange(watermarkInput.opacity, 0, 1, DEFAULT_REEL_SETTINGS.watermark.opacity),
      visibility: WATERMARK_VISIBILITY.has(watermarkInput.visibility)
        ? watermarkInput.visibility
        : DEFAULT_REEL_SETTINGS.watermark.visibility,
      lastSeconds: finiteRange(watermarkInput.lastSeconds, 0.1, Math.max(0.1, effectiveDuration || 4), DEFAULT_REEL_SETTINGS.watermark.lastSeconds)
    }
  };
}

export function calculateReelTiming(settings, sourceDuration) {
  const normalized = normalizeReelSettings(settings, sourceDuration);
  const duration = Math.max(0, normalized.trimEnd - normalized.trimStart);
  return {
    ...normalized,
    duration,
    videoFadeOutStart: Math.max(0, duration - normalized.videoFadeOut),
    audioFadeOutStart: Math.max(0, duration - normalized.audioFadeOut),
    watermarkStart: normalized.watermark.visibility === 'last-seconds'
      ? Math.max(0, duration - normalized.watermark.lastSeconds)
      : 0
  };
}

export async function loadReelSettings(projectDirectory, sourceDuration = 0, sourceVideo = '') {
  const settingsPath = getReelSettingsPath(projectDirectory);
  let saved = {};
  try {
    const document = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (document.type === 'kr8-reel-settings' && document.settings && typeof document.settings === 'object') {
      saved = document.settings;
    }
  } catch {}
  return normalizeReelSettings({ ...saved, sourceVideo: sourceVideo || saved.sourceVideo }, sourceDuration);
}

export async function saveReelSettings(projectDirectory, settings, sourceDuration = 0) {
  const normalized = normalizeReelSettings(settings, sourceDuration);
  const settingsPath = getReelSettingsPath(projectDirectory);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({
    type: 'kr8-reel-settings',
    schemaVersion: REEL_SETTINGS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: normalized
  }, null, 2), 'utf8');
  return { settings: normalized, settingsPath };
}

export function getReelSettingsPath(projectDirectory) {
  return path.join(projectDirectory, ...REEL_SETTINGS_RELATIVE_PATH.split('/'));
}

export function resolveReelProjectPath(projectDirectory, relativePath, options = {}) {
  const raw = normalizeRelativePath(relativePath);
  if (!raw) return '';
  const root = path.resolve(projectDirectory, options.root || 'exports');
  const resolved = path.resolve(projectDirectory, raw);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error('Reel path must stay inside the current project exports directory.');
  }
  return resolved;
}

export async function assertExistingReelSource(projectDirectory, relativePath) {
  const resolved = resolveReelProjectPath(projectDirectory, relativePath);
  await access(resolved, fsConstants.F_OK);
  return resolved;
}

export async function saveReelWatermarkImage(projectDirectory, input = {}) {
  const filename = path.basename(String(input.filename || 'watermark.png'));
  if (path.extname(filename).toLowerCase() !== '.png') {
    throw new Error('Reel watermark image must be a PNG file.');
  }
  const match = String(input.dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Reel watermark image data is invalid.');
  const data = Buffer.from(match[1], 'base64');
  if (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Reel watermark image is not a valid PNG.');
  }
  const directory = path.join(projectDirectory, 'exports', 'reel', 'assets');
  await mkdir(directory, { recursive: true });
  const parsed = path.parse(filename);
  for (let index = 1; index < 10_000; index += 1) {
    const candidateName = index === 1 ? filename : `${parsed.name}-${index}${parsed.ext}`;
    const outputPath = path.join(directory, candidateName);
    try {
      await access(outputPath, fsConstants.F_OK);
    } catch {
      await writeFile(outputPath, data);
      return {
        outputPath,
        relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/')
      };
    }
  }
  throw new Error('Unable to allocate a Reel watermark filename.');
}

export function normalizeRelativePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
}

function finiteRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
