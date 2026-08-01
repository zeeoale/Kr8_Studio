import path from 'node:path';

import { resolveRelativePathWithinRoot } from '../security/pathPolicy.js';

export function toPosixPath(value) {
  return String(value || '').replaceAll('\\', '/');
}

export function relativeAssetPath(fromDirectory, targetPath) {
  return toPosixPath(path.relative(fromDirectory, targetPath));
}

export function normalizeProjectRelativePath(value) {
  return toPosixPath(value).replace(/^\.\/+/, '');
}

export function isBase64LikeAssetPath(value) {
  return /^data:/i.test(String(value || ''));
}

export function resolveProjectPath(projectDirectory, relativePath) {
  return resolveRelativePathWithinRoot(projectDirectory, relativePath);
}

export function resolveAssetPath(projectDirectory, asset) {
  if (!asset || !asset.path || asset.missing) {
    return '';
  }

  return resolveProjectPath(projectDirectory, asset.path);
}
