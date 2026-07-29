import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { createRandomId } from '../shared/id.js';
import { relativeAssetPath } from '../shared/path.js';

const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export async function importCoverAsset(project, projectDirectory, input = {}) {
  const filename = sanitizeFilename(input.filename || '');
  const ext = path.extname(filename).toLowerCase();
  const data = input.data;

  if (!filename || !COVER_EXTENSIONS.has(ext)) {
    throw new Error('Cover must be PNG, JPG, JPEG, or WEBP.');
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cover file is missing or empty.');
  }

  const assetsDir = path.join(projectDirectory, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const targetPath = await uniqueAssetPath(assetsDir, filename);
  await writeFile(targetPath, data);

  const asset = {
    id: createRandomId('asset'),
    type: 'image',
    role: 'cover',
    path: relativeAssetPath(projectDirectory, targetPath),
    missing: false,
    metadata: {
      imported: true,
      importedAt: new Date().toISOString(),
      originalFilename: filename
    }
  };

  return {
    project: {
      ...project,
      assets: [...(project.assets || []), asset]
    },
    asset
  };
}

export function findOriginalCoverAsset(project) {
  return (project.assets || []).find((asset) =>
    asset.type === 'image' &&
    asset.role === 'cover' &&
    !asset.missing &&
    !asset.metadata?.imported
  ) || null;
}

function sanitizeFilename(filename) {
  return path.basename(String(filename || '')).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function uniqueAssetPath(directory, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext) || 'cover';
  let candidate = path.join(directory, filename);
  let index = 1;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${base}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
