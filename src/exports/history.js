import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { assertAbsolutePathWithinRoot, resolveRelativePathWithinRoot } from '../security/pathPolicy.js';
import { formatAspectRatioLabel } from './aspectRatio.js';

export async function listRenderHistory(projectDirectory, options = {}) {
  const limit = Math.max(1, Math.min(100, Math.round(Number(options.limit || 20))));
  const videosDir = path.join(projectDirectory, 'exports', 'videos');
  const entries = [];

  try {
    await access(videosDir, fsConstants.F_OK);
  } catch {
    return [];
  }

  const files = await readdir(videosDir, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.render.json')) continue;
    const metadataPath = path.join(videosDir, file.name);
    const item = await readRenderMetadata(projectDirectory, metadataPath);
    if (item) entries.push(item);
  }

  return entries
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export async function findLatestValidRenderExport(projectDirectory) {
  const history = await listValidRenderExports(projectDirectory, { limit: 100 });
  return history[0] || null;
}

export async function findValidRenderExport(projectDirectory, relativePath) {
  const requested = normalizeRenderRelativePath(relativePath);
  if (!requested) return null;
  const history = await listValidRenderExports(projectDirectory, { limit: 100 });
  return history.find((item) => item.relativePath === requested) || null;
}

export async function listValidRenderExports(projectDirectory, options = {}) {
  const history = await listRenderHistory(projectDirectory, { limit: options.limit || 100 });
  const valid = [];
  for (const item of history) {
    if (!item.outputPath || item.sizeBytes <= 0) continue;
    try {
      const info = await stat(item.outputPath);
      if (info.isFile() && info.size > 0) valid.push(item);
    } catch {}
  }
  return valid;
}

async function readRenderMetadata(projectDirectory, metadataPath) {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata.type !== 'kr8-render-metadata') return null;

    const exportsRoot = path.resolve(projectDirectory, 'exports');
    const rawPath = String(metadata.outputPath || metadata.relativePath || '');
    const outputPath = path.isAbsolute(rawPath)
      ? assertAbsolutePathWithinRoot(exportsRoot, rawPath)
      : resolveRelativePathWithinRoot(projectDirectory, rawPath);
    assertAbsolutePathWithinRoot(exportsRoot, outputPath);

    let sizeBytes = 0;
    try {
      sizeBytes = (await stat(outputPath)).size;
    } catch {}

    const width = Math.max(0, Math.round(Number(metadata.width || 0)));
    const height = Math.max(0, Math.round(Number(metadata.height || 0)));
    return {
      rendererMode: String(metadata.rendererMode || 'unknown'),
      createdAt: String(metadata.createdAt || ''),
      outputPath,
      relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
      metadataPath,
      metadataRelativePath: path.relative(projectDirectory, metadataPath).replaceAll(path.sep, '/'),
      videoEncoder: String(metadata.videoEncoder || ''),
      startTimestamp: Number(metadata.startTimestamp || 0),
      duration: Number(metadata.duration || 0),
      fps: Number(metadata.fps || 0),
      frameCount: Number(metadata.frameCount || 0),
      expectedFrameCount: Number(metadata.expectedFrameCount || metadata.frameCount || 0),
      hasAudio: Boolean(metadata.hasAudio),
      width,
      height,
      aspectRatio: width > 0 && height > 0 ? formatAspectRatioLabel(width, height) : '',
      benchmark: metadata.benchmark && typeof metadata.benchmark === 'object' ? metadata.benchmark : null,
      sizeBytes
    };
  } catch {
    return null;
  }
}

function normalizeRenderRelativePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
}
