import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { assertAbsolutePathWithinRoot, resolveRelativePathWithinRoot } from '../security/pathPolicy.js';

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
  const history = await listRenderHistory(projectDirectory, { limit: 100 });
  for (const item of history) {
    if (!item.outputPath || item.sizeBytes <= 0) continue;
    try {
      const info = await stat(item.outputPath);
      if (info.isFile() && info.size > 0) return item;
    } catch {}
  }
  return null;
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
      benchmark: metadata.benchmark && typeof metadata.benchmark === 'object' ? metadata.benchmark : null,
      sizeBytes
    };
  } catch {
    return null;
  }
}
