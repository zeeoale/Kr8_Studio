import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeProjectRelativePath } from '../shared/path.js';
import { normalizeLyricsDocument, serializeLyricsDocument } from './schema.js';
import { validateLyricsCues } from './validation.js';

export const CONTROLLED_LYRICS_PATH = 'assets/lyrics.kr8.json';

export async function applyLyricsDocument(project, projectDirectory, input, options = {}) {
  if (!project || typeof project !== 'object') throw new Error('A Kr8 project is required.');
  if (!projectDirectory) throw new Error('The Kr8 project directory is required.');

  const normalized = normalizeLyricsDocument(input);
  const validation = validateLyricsCues(normalized.cues, {
    duration: options.duration ?? project.composition?.duration
  });
  if (!validation.valid) {
    throw new Error(`Lyrics contain blocking validation errors:\n${validation.errors.map((item) => item.message).join('\n')}`);
  }

  const nextProject = clone(project);
  const assets = Array.isArray(nextProject.assets) ? nextProject.assets : [];
  const lyricsAssetIndex = assets.findIndex((asset) =>
    asset?.role === 'lyrics' || asset?.type === 'lyrics'
  );
  const previous = lyricsAssetIndex >= 0 ? assets[lyricsAssetIndex] : null;
  const previousPath = normalizeProjectRelativePath(previous?.path || '');
  const originalPath = previous?.originalPath
    || (previousPath && previousPath !== CONTROLLED_LYRICS_PATH ? previousPath : '');
  const now = options.now || new Date().toISOString();
  const asset = {
    ...(previous || {}),
    id: previous?.id || stableLyricsAssetId(nextProject.id),
    type: 'lyrics',
    role: previous?.role || 'lyrics',
    path: CONTROLLED_LYRICS_PATH,
    ...(originalPath ? { originalPath } : {}),
    missing: false,
    metadata: {
      ...(previous?.metadata || {}),
      format: 'kr8-aligned-json',
      edited: true,
      editedAt: now
    }
  };

  if (lyricsAssetIndex >= 0) assets[lyricsAssetIndex] = asset;
  else assets.push(asset);
  nextProject.assets = assets;

  const document = serializeLyricsDocument({
    ...normalized.document,
    kr8Source: {
      ...(normalized.document.kr8Source || {}),
      ...(originalPath ? { originalPath } : {}),
      assetId: asset.id
    }
  }, normalized.cues);
  const destination = path.join(projectDirectory, ...CONTROLLED_LYRICS_PATH.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  return {
    project: nextProject,
    asset,
    document,
    cues: normalized.cues,
    validation,
    path: destination
  };
}

function stableLyricsAssetId(projectId) {
  const digest = createHash('sha256')
    .update(`${String(projectId || 'kr8')}\0lyrics`)
    .digest('hex')
    .slice(0, 16);
  return `kr8_${digest}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
