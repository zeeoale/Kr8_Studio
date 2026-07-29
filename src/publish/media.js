import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { probeReelSource } from '../reel/export.js';

const CONTAINERS = new Map([
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm']
]);
const VIDEO_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9']);

export async function findLatestValidReelExport(projectDirectory) {
  const reelsDirectory = path.resolve(projectDirectory, 'exports', 'reels');
  let files;
  try { files = await readdir(reelsDirectory, { withFileTypes: true }); } catch { return null; }
  const candidates = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.reel.json')) continue;
    try {
      const metadataPath = path.join(reelsDirectory, file.name);
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (metadata.type !== 'kr8-reel-render-metadata') continue;
      const rawPath = String(metadata.relativePath || metadata.outputPath || '');
      const outputPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(projectDirectory, rawPath);
      if (!(outputPath === reelsDirectory || outputPath.startsWith(`${reelsDirectory}${path.sep}`))) continue;
      const info = await stat(outputPath);
      if (!info.isFile() || info.size <= 0) continue;
      candidates.push({
        outputPath,
        relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
        metadataPath,
        createdAt: String(metadata.createdAt || info.mtime.toISOString()),
        sizeBytes: info.size,
        duration: Number(metadata.duration || 0)
      });
    } catch {}
  }
  return candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
}

export async function validatePublishMedia(filePath, options = {}) {
  const resolved = path.resolve(String(filePath || ''));
  const extension = path.extname(resolved).toLowerCase();
  const errors = [];
  let info;
  try {
    await access(resolved, fsConstants.R_OK);
    info = await stat(resolved);
  } catch {
    return invalidDescriptor(resolved, ['Video file is missing or unreadable.']);
  }
  if (!info.isFile() || info.size <= 0) errors.push('Video file is empty or unreadable.');
  if (!CONTAINERS.has(extension)) errors.push('Publisher supports MP4, MOV, or WebM files.');
  let media = null;
  if (errors.length === 0) {
    try {
      const probe = options.probe || probeReelSource;
      media = await probe(resolved, options);
    } catch {
      errors.push('ffprobe could not read the video file.');
    }
  }
  if (media) {
    if (!media.hasVideo) errors.push('The file has no video track.');
    if (!VIDEO_CODECS.has(String(media.videoCodec || '').toLowerCase())) errors.push(`Unsupported video codec: ${media.videoCodec || 'unknown'}.`);
    if (!(media.width > 0 && media.height > 0)) errors.push('Video dimensions are invalid.');
    if (!(media.fps > 0)) errors.push('Video frame rate is invalid.');
    if (!(media.duration > 0)) errors.push('Video duration must be greater than zero.');
  }
  return {
    valid: errors.length === 0,
    errors,
    path: resolved,
    name: path.basename(resolved),
    extension,
    contentType: CONTAINERS.get(extension) || 'application/octet-stream',
    sizeBytes: info.size,
    duration: Number(media?.duration || 0),
    width: Number(media?.width || 0),
    height: Number(media?.height || 0),
    fps: Number(media?.fps || 0),
    videoCodec: String(media?.videoCodec || ''),
    audioCodec: String(media?.audioCodec || ''),
    hasAudio: Boolean(media?.hasAudio)
  };
}

function invalidDescriptor(filePath, errors) {
  return {
    valid: false,
    errors,
    path: filePath,
    name: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase(),
    contentType: 'application/octet-stream',
    sizeBytes: 0,
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    videoCodec: '',
    audioCodec: '',
    hasAudio: false
  };
}
