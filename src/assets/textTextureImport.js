import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { createRandomId } from '../shared/id.js';
import { relativeAssetPath } from '../shared/path.js';

const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export async function importTextTextureAsset(project, projectDirectory, input = {}) {
  const filename = sanitizeFilename(input.filename || '');
  const extension = path.extname(filename).toLowerCase();
  if (!filename || !TEXTURE_EXTENSIONS.has(extension)) {
    throw new Error('Text texture must be PNG, JPG, JPEG, or WEBP.');
  }
  if (!Buffer.isBuffer(input.data) || input.data.length === 0) {
    throw new Error('Text texture file is missing or empty.');
  }

  const assetsDirectory = path.join(projectDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const targetPath = await uniqueAssetPath(assetsDirectory, `text-texture-${filename}`);
  await writeFile(targetPath, input.data);

  const asset = {
    id: createRandomId('asset'),
    type: 'image',
    role: 'texture',
    path: relativeAssetPath(projectDirectory, targetPath),
    missing: false,
    metadata: {
      imported: true,
      purpose: 'text-texture',
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

function sanitizeFilename(filename) {
  return path.basename(String(filename || '')).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function uniqueAssetPath(directory, filename) {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension) || 'text-texture';
  let candidate = path.join(directory, filename);
  let index = 1;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${base}-${index}${extension}`);
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
