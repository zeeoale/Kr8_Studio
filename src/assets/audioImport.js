import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';

import { createStableId } from '../shared/id.js';
import { relativeAssetPath } from '../shared/path.js';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg']);
const DIRECT_PLAYBACK_CODECS = new Map([
  ['.mp3', new Set(['mp3'])],
  ['.wav', new Set(['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le'])],
  ['.flac', new Set(['flac'])],
  ['.m4a', new Set(['aac'])],
  ['.ogg', new Set(['vorbis', 'opus', 'flac'])]
]);

export async function importAudioAsset(project, projectDirectory, input = {}, options = {}) {
  const sourcePath = path.resolve(String(input.sourcePath || ''));
  const originalFilename = path.basename(String(input.originalFilename || sourcePath));
  const extension = path.extname(originalFilename).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) {
    throw new Error('Audio must be MP3, WAV, FLAC, M4A, AAC, or OGG.');
  }
  await assertNonEmptyFile(sourcePath);

  const probe = input.probe || await probeAudioFile(sourcePath, options);
  const sha256 = await hashFile(sourcePath);
  const audioDirectory = path.join(projectDirectory, 'assets', 'audio');
  await mkdir(audioDirectory, { recursive: true });

  const sanitizedFilename = sanitizeAudioFilename(originalFilename);
  const copiedOriginalPath = await uniqueAssetPath(audioDirectory, sanitizedFilename);
  const shouldProxy = input.forceProxy === true || !isDirectPlaybackReliable(extension, probe.codec);
  let playbackPath = copiedOriginalPath;
  let proxyPath = '';

  try {
    await copyFile(sourcePath, copiedOriginalPath, fsConstants.COPYFILE_EXCL);
    if (shouldProxy) {
      proxyPath = await uniqueAssetPath(
        audioDirectory,
        `${path.basename(sanitizedFilename, extension)}-playback.wav`
      );
      await createPlaybackProxy(copiedOriginalPath, proxyPath, options);
      await assertNonEmptyFile(proxyPath);
      playbackPath = proxyPath;
    }
  } catch (error) {
    await Promise.all([
      rm(copiedOriginalPath, { force: true }).catch(() => {}),
      proxyPath ? rm(proxyPath, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
    throw error;
  }

  const now = new Date().toISOString();
  const sourceRelativePath = relativeAssetPath(projectDirectory, copiedOriginalPath);
  const playbackRelativePath = relativeAssetPath(projectDirectory, playbackPath);
  const assetId = createStableId('audio-asset', sha256);
  const asset = {
    id: assetId,
    type: 'audio',
    role: 'song',
    path: playbackRelativePath,
    missing: false,
    metadata: {
      preferred: true,
      imported: true,
      importedAt: now,
      sourceProvider: 'local-files',
      originalFilename,
      sourcePath: sourceRelativePath,
      playbackPath: playbackRelativePath,
      proxyGenerated: shouldProxy,
      proxyReason: shouldProxy ? (input.forceProxy ? 'forced' : 'browser-compatibility') : '',
      waveformCacheKey: sha256,
      sha256,
      bytes: probe.bytes,
      duration: probe.duration,
      format: probe.format,
      codec: probe.codec,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      title: probe.title,
      artist: probe.artist,
      album: probe.album,
      embeddedCover: probe.embeddedCover
    }
  };

  const previousDuration = Number(project?.composition?.duration || 0);
  const existingAudio = (project.assets || []).find((item) =>
    item?.type === 'audio' && item?.role === 'song' && !item?.missing
  ) || null;
  const assets = (project.assets || [])
    .filter((item) => item?.id !== asset.id)
    .map((item) => item?.type === 'audio' && item?.role === 'song'
      ? {
          ...item,
          role: 'song-previous',
          metadata: {
            ...(item.metadata || {}),
            replacedAt: now
          }
        }
      : item);
  const updateProjectMetadata = input.updateProjectMetadata === true;
  const title = String(input.title || probe.title || path.basename(originalFilename, extension)).trim();
  const artist = String(input.artist || probe.artist || '').trim();
  const duration = probe.duration;
  const updatedProject = {
    ...project,
    updatedAt: now,
    composition: {
      ...(project.composition || {}),
      duration
    },
    assets: [...assets, asset],
    layers: updateTimedEnds(project.layers, previousDuration, duration),
    scenes: updateTimedEnds(project.scenes, previousDuration, duration),
    metadata: {
      ...(project.metadata || {}),
      ...(updateProjectMetadata && title ? { title } : {}),
      ...(updateProjectMetadata ? { artist } : {}),
      audioSourceProvider: 'local-files',
      audioImportedAt: now
    }
  };

  if (updateProjectMetadata) {
    updatedProject.layers = updateTitleAndArtistLayers(updatedProject.layers, title, artist);
  }

  return {
    project: updatedProject,
    asset,
    previousAsset: existingAudio,
    probe,
    warnings: buildTimingWarnings(project, duration)
  };
}

export async function probeAudioFile(filePath, options = {}) {
  const resolved = path.resolve(String(filePath || ''));
  await assertNonEmptyFile(resolved);
  const ffprobeCommand = resolveFfprobeCommand(options);
  const output = await execFileText(
    ffprobeCommand,
    [
      '-v', 'error',
      '-show_entries',
      'format=format_name,duration,size:format_tags=title,artist,album:stream=index,codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic',
      '-of', 'json',
      resolved
    ],
    options
  );
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error('FFprobe returned invalid audio metadata.');
  }
  const audioStream = (payload.streams || []).find((stream) => stream.codec_type === 'audio');
  if (!audioStream) throw new Error('The selected file does not contain an audio stream.');
  const duration = Number(payload.format?.duration || 0);
  if (!(duration > 0)) throw new Error('The selected audio has no valid duration.');
  const info = await stat(resolved);
  const tags = normalizeTags(payload.format?.tags);
  return {
    duration,
    bytes: info.size,
    format: String(payload.format?.format_name || '').split(',')[0],
    codec: String(audioStream.codec_name || ''),
    sampleRate: Math.max(0, Number(audioStream.sample_rate || 0)),
    channels: Math.max(0, Number(audioStream.channels || 0)),
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    embeddedCover: (payload.streams || []).some((stream) =>
      stream.codec_type === 'video' && Number(stream.disposition?.attached_pic || 0) === 1
    )
  };
}

export function isDirectPlaybackReliable(extension, codec) {
  return DIRECT_PLAYBACK_CODECS.get(String(extension || '').toLowerCase())
    ?.has(String(codec || '').toLowerCase()) || false;
}

export function sanitizeAudioFilename(filename) {
  const raw = path.basename(String(filename || 'audio'))
    .normalize('NFKC')
    .replace(/[\u0000-\u001F<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const extension = path.extname(raw).toLowerCase();
  const base = path.basename(raw, extension)
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '') || 'audio';
  return `${base.slice(0, 120)}${extension}`;
}

export function updateTimedEnds(items, previousDuration, nextDuration, tolerance = 0.075) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const end = Number(item?.end);
    if (!Number.isFinite(end) || Math.abs(end - previousDuration) > tolerance) return item;
    return { ...item, end: nextDuration };
  });
}

async function createPlaybackProxy(inputPath, outputPath, options = {}) {
  const ffmpegCommand = options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || 'ffmpeg';
  await execFileText(
    ffmpegCommand,
    [
      '-y',
      '-v', 'error',
      '-i', inputPath,
      '-map', '0:a:0',
      '-vn',
      '-c:a', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '2',
      outputPath
    ],
    { ...options, timeout: options.proxyTimeout || 15 * 60_000 }
  );
}

function resolveFfprobeCommand(options) {
  if (options.ffprobeCommand) return options.ffprobeCommand;
  if (process.env.KR8_FFPROBE_PATH) return process.env.KR8_FFPROBE_PATH;
  const ffmpegCommand = options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || '';
  if (ffmpegCommand && path.isAbsolute(ffmpegCommand)) {
    return path.join(path.dirname(ffmpegCommand), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }
  return 'ffprobe';
}

function execFileText(command, args, options = {}) {
  if (typeof options.execFileImpl === 'function') {
    return options.execFileImpl(command, args, options);
  }
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: options.timeout || 2 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Audio processing failed: ${String(stderr || error.message).trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertNonEmptyFile(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0) throw new Error();
  } catch {
    throw new Error('Audio file is missing or empty.');
  }
}

async function uniqueAssetPath(directory, filename) {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension) || 'audio';
  let candidate = path.join(directory, filename);
  let index = 1;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${base}-${index}${extension}`);
    index += 1;
  }
  return candidate;
}

function updateTitleAndArtistLayers(layers, title, artist) {
  return (layers || []).map((layer) => {
    const isTitle = layer?.type === 'text' && /song title/i.test(String(layer.name || ''));
    const isArtist = layer?.type === 'text' && /^artist$/i.test(String(layer.name || ''));
    if (!isTitle && !isArtist) return layer;
    return {
      ...layer,
      properties: {
        ...(layer.properties || {}),
        text: isTitle ? title : artist
      }
    };
  });
}

function buildTimingWarnings(project, duration) {
  const warnings = [];
  const sceneCount = (project.scenes || []).filter((scene) => Number(scene.end || scene.start || 0) > duration).length;
  if (sceneCount) warnings.push(`${sceneCount} timeline section(s) extend beyond the new audio duration.`);
  return warnings;
}

function normalizeTags(tags) {
  const entries = Object.entries(tags || {}).map(([key, value]) => [key.toLowerCase(), String(value || '').trim()]);
  const normalized = Object.fromEntries(entries);
  return {
    title: normalized.title || '',
    artist: normalized.artist || normalized.album_artist || '',
    album: normalized.album || ''
  };
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
