import { spawn } from 'node:child_process';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import {
  SDR_BT709_FILTER,
  SDR_BT709_OUTPUT_ARGS,
  resolveFfmpegCommand
} from '../exports/videoDraft.js';
import { calculateReelTiming } from './core.js';

export async function probeReelSource(sourcePath, options = {}) {
  await access(sourcePath, fsConstants.F_OK);
  const ffmpegCommand = await resolveFfmpegCommand(options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || 'ffmpeg');
  if (!ffmpegCommand) throw new Error('FFmpeg unavailable.');
  const ffprobeCommand = resolveFfprobeCommand(ffmpegCommand, options.ffprobeCommand);
  const payload = await runJsonProcess(ffprobeCommand, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries',
    '-of', 'json',
    sourcePath
  ]);
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video') || null;
  const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
  const duration = Math.max(0, Number(payload.format?.duration || 0));
  return {
    duration,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: Math.max(0, Math.round(Number(video?.width || 0))),
    height: Math.max(0, Math.round(Number(video?.height || 0))),
    fps: parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate),
    videoCodec: String(video?.codec_name || ''),
    audioCodec: String(audio?.codec_name || ''),
    pixelFormat: String(video?.pix_fmt || ''),
    colorRange: String(video?.color_range || ''),
    colorSpace: String(video?.color_space || ''),
    colorTransfer: String(video?.color_transfer || ''),
    colorPrimaries: String(video?.color_primaries || '')
  };
}

export function buildReelFfmpegArgs(options = {}) {
  const sourceDuration = Math.max(0, Number(options.sourceDuration || 0));
  const timing = calculateReelTiming(options.settings || {}, sourceDuration);
  if (!(timing.duration > 0)) throw new Error('Reel trim duration must be greater than zero.');

  const sourcePath = path.resolve(String(options.sourcePath || ''));
  const outputPath = path.resolve(String(options.outputPath || ''));
  const sourceHasAudio = options.sourceHasAudio === true;
  const encoder = options.videoEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264';
  const fps = Math.max(0, Number(options.fps || 0));
  const width = Math.max(1, Math.round(Number(options.width || 1920)));
  const height = Math.max(1, Math.round(Number(options.height || 1080)));
  const watermark = timing.watermark;
  const args = ['-y', '-i', sourcePath];
  let watermarkInputIndex = -1;

  if (watermark.enabled && watermark.type === 'image') {
    if (!options.watermarkImagePath) throw new Error('Watermark PNG is missing.');
    watermarkInputIndex = 1;
    args.push('-loop', '1', '-i', path.resolve(options.watermarkImagePath));
  }

  const filter = buildReelFilterComplex({
    timing,
    sourceHasAudio,
    width,
    height,
    watermarkInputIndex,
    watermarkTextPath: options.watermarkTextPath || '',
    watermarkFontPath: options.watermarkFontPath || ''
  });
  args.push('-filter_complex', filter, '-map', '[vout]');
  if (sourceHasAudio) args.push('-map', '[aout]');
  args.push('-c:v', encoder);
  if (encoder === 'h264_nvenc') {
    args.push('-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0');
  } else {
    args.push('-preset', 'veryfast', '-crf', '20');
  }
  args.push(...SDR_BT709_OUTPUT_ARGS);
  if (fps > 0) args.push('-r', formatNumber(fps));
  if (sourceHasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-t', formatNumber(timing.duration), '-movflags', '+faststart+write_colr', outputPath);
  return args;
}

export function buildReelFilterComplex(options = {}) {
  const timing = options.timing;
  const watermark = timing.watermark;
  const videoFilters = [
    `trim=start=${formatNumber(timing.trimStart)}:duration=${formatNumber(timing.duration)}`,
    'setpts=PTS-STARTPTS'
  ];
  if (timing.videoFadeIn > 0) {
    videoFilters.push(`fade=t=in:st=0:d=${formatNumber(timing.videoFadeIn)}`);
  }
  if (timing.videoFadeOut > 0) {
    videoFilters.push(`fade=t=out:st=${formatNumber(timing.videoFadeOutStart)}:d=${formatNumber(timing.videoFadeOut)}`);
  }

  const parts = [];
  const needsWatermark = watermark.enabled && (watermark.type === 'image' || watermark.text.trim());
  parts.push(`[0:v]${videoFilters.join(',')}[vbase]`);
  let lastVideoLabel = 'vbase';

  if (needsWatermark && watermark.type === 'image') {
    const watermarkHeight = Math.max(1, Math.round(options.height * watermark.scale));
    parts.push(`[${options.watermarkInputIndex}:v]format=rgba,scale=-1:${watermarkHeight},colorchannelmixer=aa=${formatNumber(watermark.opacity)}[wm]`);
    parts.push(`[vbase][wm]overlay=${watermarkOverlayPosition(watermark.position, watermark.margin)}${watermarkEnable(timing)}[vmarked]`);
    lastVideoLabel = 'vmarked';
  } else if (needsWatermark) {
    if (!options.watermarkTextPath) throw new Error('Watermark text file is required.');
    if (!options.watermarkFontPath) throw new Error('Watermark font file is required.');
    const fontSize = Math.max(12, Math.round(options.height * watermark.scale));
    const position = watermarkDrawtextPosition(watermark.position, watermark.margin);
    const textPath = escapeFilterPath(options.watermarkTextPath);
    const fontPath = escapeFilterPath(options.watermarkFontPath);
    parts.push(`[vbase]drawtext=fontfile='${fontPath}':textfile='${textPath}':reload=0:fontsize=${fontSize}:fontcolor=white@${formatNumber(watermark.opacity)}:borderw=2:bordercolor=black@${formatNumber(Math.min(1, watermark.opacity + 0.15))}:${position}${watermarkEnable(timing)}[vmarked]`);
    lastVideoLabel = 'vmarked';
  }

  parts.push(`[${lastVideoLabel}]${SDR_BT709_FILTER}[vout]`);

  if (options.sourceHasAudio) {
    const audioFilters = [
      `atrim=start=${formatNumber(timing.trimStart)}:duration=${formatNumber(timing.duration)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${formatNumber(timing.volume)}`
    ];
    if (timing.audioFadeIn > 0) {
      audioFilters.push(`afade=t=in:st=0:d=${formatNumber(timing.audioFadeIn)}`);
    }
    if (timing.audioFadeOut > 0) {
      audioFilters.push(`afade=t=out:st=${formatNumber(timing.audioFadeOutStart)}:d=${formatNumber(timing.audioFadeOut)}`);
    }
    parts.push(`[0:a]${audioFilters.join(',')}[aout]`);
  }
  return parts.join(';');
}

export async function createReelExportPlan(projectDirectory, options = {}) {
  const sourcePath = path.resolve(String(options.sourcePath || ''));
  const media = options.media || await probeReelSource(sourcePath, options);
  if (!media.hasVideo || media.duration <= 0) throw new Error('Reel source is not a valid video.');
  const settings = calculateReelTiming(options.settings || {}, media.duration);
  if (settings.watermark.enabled && settings.watermark.type === 'image') {
    await access(options.watermarkImagePath, fsConstants.F_OK);
  }
  const outputDirectory = path.join(projectDirectory, 'exports', 'reels');
  await mkdir(outputDirectory, { recursive: true });
  const basename = `${slugify(options.projectName || 'kr8')}_reel.mp4`;
  const outputPath = await nextAvailablePath(outputDirectory, basename);
  const workspaceDirectory = path.join(projectDirectory, 'exports', 'reel');
  await mkdir(workspaceDirectory, { recursive: true });
  const watermarkTextPath = settings.watermark.enabled && settings.watermark.type === 'text'
    ? path.join(workspaceDirectory, 'watermark.txt')
    : '';
  if (watermarkTextPath) await writeFile(watermarkTextPath, settings.watermark.text, 'utf8');
  const watermarkFontPath = watermarkTextPath
    ? await resolveDefaultWatermarkFontPath(options.watermarkFontPath)
    : '';
  const ffmpegCommand = await resolveFfmpegCommand(options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || 'ffmpeg');
  if (!ffmpegCommand) throw new Error('FFmpeg unavailable.');
  const nvencAvailable = options.videoEncoder === 'h264_nvenc'
    ? true
    : await isFfmpegEncoderAvailable(ffmpegCommand, 'h264_nvenc');
  const videoEncoder = options.videoEncoder === 'libx264' ? 'libx264' : (nvencAvailable ? 'h264_nvenc' : 'libx264');
  const args = buildReelFfmpegArgs({
    sourcePath,
    outputPath,
    sourceDuration: media.duration,
    sourceHasAudio: media.hasAudio,
    fps: media.fps,
    width: media.width,
    height: media.height,
    settings,
    watermarkImagePath: options.watermarkImagePath,
    watermarkTextPath,
    watermarkFontPath,
    videoEncoder
  });
  return {
    projectDirectory,
    sourcePath,
    outputPath,
    relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
    ffmpegCommand,
    args,
    media,
    settings,
    videoEncoder,
    duration: settings.duration
  };
}

export async function startReelExport(projectDirectory, options = {}) {
  const plan = await createReelExportPlan(projectDirectory, options);
  const job = {
    id: `reel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    status: 'running',
    progress: 0,
    outTime: 0,
    startedAt: new Date().toISOString(),
    completedAt: '',
    error: '',
    result: null,
    plan,
    child: null,
    done: null
  };
  const ffmpegArgs = ['-progress', 'pipe:2', '-nostats', ...plan.args];
  const child = spawn(plan.ffmpegCommand, ffmpegArgs, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  job.child = child;
  let stderr = '';
  let progressBuffer = '';
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr = `${stderr}${text}`.slice(-8000);
    progressBuffer += text;
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop() || '';
    for (const line of lines) updateJobProgress(job, line);
  });
  job.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', async (code) => {
      if (job.status === 'cancelled') {
        await rm(plan.outputPath, { force: true }).catch(() => {});
        resolve(job);
        return;
      }
      if (code !== 0) {
        job.status = 'failed';
        job.error = `FFmpeg Reel export failed with exit code ${code}: ${stderr.slice(-2500)}`;
        job.completedAt = new Date().toISOString();
        reject(new Error(job.error));
        return;
      }
      job.status = 'done';
      job.progress = 1;
      job.completedAt = new Date().toISOString();
      const outputInfo = await stat(plan.outputPath);
      const metadataPath = plan.outputPath.replace(/\.mp4$/i, '.reel.json');
      const metadata = {
        type: 'kr8-reel-render-metadata',
        schemaVersion: 1,
        createdAt: job.completedAt,
        sourcePath: path.relative(projectDirectory, plan.sourcePath).replaceAll(path.sep, '/'),
        outputPath: plan.outputPath,
        relativePath: plan.relativePath,
        duration: plan.duration,
        hasAudio: plan.media.hasAudio,
        videoEncoder: plan.videoEncoder,
        settings: plan.settings,
        bytes: outputInfo.size,
        ffmpeg: { command: plan.ffmpegCommand, args: plan.args }
      };
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      job.result = {
        outputPath: plan.outputPath,
        relativePath: plan.relativePath,
        metadataPath,
        duration: plan.duration,
        hasAudio: plan.media.hasAudio,
        videoEncoder: plan.videoEncoder,
        bytes: outputInfo.size
      };
      resolve(job);
    });
  });
  job.done.catch(() => {});
  return job;
}

export function cancelReelExport(job) {
  if (!job || job.status !== 'running') return false;
  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();
  job.error = 'Reel export cancelled.';
  try { job.child?.kill(); } catch {}
  return true;
}

export async function isFfmpegEncoderAvailable(command, encoder) {
  try {
    const output = await runTextProcess(command, ['-hide_banner', '-encoders']);
    return new RegExp(`\\b${escapeRegExp(encoder)}\\b`).test(output);
  } catch {
    return false;
  }
}

export function resolveFfprobeCommand(ffmpegCommand, override = '') {
  if (override) return override;
  const ext = path.extname(ffmpegCommand);
  const candidate = path.join(path.dirname(ffmpegCommand), `ffprobe${ext}`);
  return candidate === ffmpegCommand ? 'ffprobe' : candidate;
}

export async function resolveDefaultWatermarkFontPath(override = '') {
  const candidates = [
    override,
    process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf') : '',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/Library/Fonts/Arial.ttf'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.F_OK);
      return path.resolve(candidate);
    } catch {}
  }
  throw new Error('No local font file is available for the Reel text watermark.');
}

async function nextAvailablePath(directory, basename) {
  const parsed = path.parse(basename);
  for (let index = 1; index < 10_000; index += 1) {
    const name = index === 1 ? basename : `${parsed.name}_${index}${parsed.ext}`;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, fsConstants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error('Unable to allocate a Reel output filename.');
}

function updateJobProgress(job, line) {
  const separator = line.indexOf('=');
  if (separator < 0) return;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (key === 'out_time_us' || key === 'out_time_ms') {
    const microseconds = Number(value);
    if (Number.isFinite(microseconds)) {
      job.outTime = microseconds / 1_000_000;
      job.progress = Math.min(0.999, Math.max(0, job.outTime / job.plan.duration));
    }
  }
  if (key === 'progress' && value === 'end') job.progress = 1;
}

function watermarkEnable(timing) {
  if (timing.watermark.visibility !== 'last-seconds') return '';
  return `:enable='between(t,${formatNumber(timing.watermarkStart)},${formatNumber(timing.duration)})'`;
}

function watermarkOverlayPosition(position, margin) {
  const value = Math.max(0, Math.round(Number(margin || 0)));
  const x = position.endsWith('right') ? `main_w-overlay_w-${value}` : String(value);
  const y = position.startsWith('bottom') ? `main_h-overlay_h-${value}` : String(value);
  return `${x}:${y}`;
}

function watermarkDrawtextPosition(position, margin) {
  const value = Math.max(0, Math.round(Number(margin || 0)));
  const x = position.endsWith('right') ? `x=w-tw-${value}` : `x=${value}`;
  const y = position.startsWith('bottom') ? `y=h-th-${value}` : `y=${value}`;
  return `${x}:${y}`;
}

function escapeFilterPath(value) {
  return String(value || '').replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) return numerator / denominator;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function slugify(value) {
  return String(value || 'kr8')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kr8';
}

function runJsonProcess(command, args) {
  return runTextProcess(command, args).then((text) => JSON.parse(text));
}

function runTextProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(command)} failed with exit code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
