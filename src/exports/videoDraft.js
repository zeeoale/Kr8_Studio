import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { formatAspectRatioToken } from './aspectRatio.js';

import { assertAbsolutePathWithinRoot, resolveRelativePathWithinRoot } from '../security/pathPolicy.js';

export const SDR_BT709_FILTER = 'scale=out_color_matrix=bt709:out_range=tv,setparams=range=tv:colorspace=bt709:color_trc=bt709:color_primaries=bt709,format=yuv420p';
export const SDR_BT709_OUTPUT_ARGS = [
  '-pix_fmt', 'yuv420p',
  '-color_range:v', 'tv',
  '-colorspace:v', 'bt709',
  '-color_trc:v', 'bt709',
  '-color_primaries:v', 'bt709',
  '-bsf:v', 'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1'
];

export async function isFfmpegAvailable(command = 'ffmpeg') {
  const resolved = await resolveFfmpegCommand(command);
  if (!resolved) return false;
  return (await canRun(resolved)) || (await canRunViaPowerShell(resolved));
}

export async function resolveFfmpegCommand(command = process.env.KR8_FFMPEG_PATH || 'ffmpeg') {
  if (command && command !== 'ffmpeg') return command;
  if (await canRun(command)) return command;
  const fromPath = await findFfmpegInPath();
  if (fromPath) return fromPath;
  if (process.platform !== 'win32') return '';
  return (await findWindowsWingetFfmpeg()) || (await resolveWindowsPowerShellCommand('ffmpeg'));
}

export async function createDraftVideoPlan(projectDirectory, options = {}) {
  const projectExportsRoot = path.resolve(projectDirectory, 'exports');
  const clipPath = assertAbsolutePathWithinRoot(projectExportsRoot, options.clipPath, { mustExist: true });

  const manifestPath = path.join(clipPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.type !== 'kr8-frame-sequence') {
    throw new Error('Draft MP4 requires a Kr8 frame sequence manifest.');
  }
  if (!Array.isArray(manifest.frames) || !manifest.frames.length) {
    throw new Error('Draft MP4 requires at least one exported frame.');
  }

  const fps = Math.max(1, Math.round(Number(manifest.fps || options.fps || 6)));
  const startTimestamp = Math.max(0, Number(manifest.startTimestamp || 0));
  const duration = framesDuration(manifest.frames, fps);
  const audioPath = options.audioPath ? path.resolve(String(options.audioPath)) : '';
  const videosDir = path.join(projectDirectory, 'exports', 'videos');
  const outputPath = path.join(videosDir, `${path.basename(clipPath)}.mp4`);
  const concatPath = path.join(clipPath, 'ffmpeg-frames.txt');
  const frames = [];

  for (const frame of manifest.frames) {
    const framePath = resolveRelativePathWithinRoot(clipPath, frame.relativePath, { mustExist: true });
    await access(framePath, fsConstants.F_OK);
    frames.push(framePath);
  }

  return {
    fps,
    startTimestamp,
    duration,
    audioPath,
    clipPath,
    manifestPath,
    concatPath,
    outputPath,
    relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
    frameCount: frames.length,
    frames,
    args: buildFfmpegArgs({ concatPath, outputPath, fps, audioPath, startTimestamp, duration })
  };
}

export async function renderDraftVideo(projectDirectory, options = {}) {
  const ffmpegCommand = await resolveFfmpegCommand(options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || 'ffmpeg');
  if (!ffmpegCommand || !(await isFfmpegAvailable(ffmpegCommand))) {
    throw new Error('FFmpeg unavailable. Install FFmpeg or add it to PATH to render MP4 drafts.');
  }

  const plan = await createDraftVideoPlan(projectDirectory, options);
  await mkdir(path.dirname(plan.outputPath), { recursive: true });
  await writeFile(plan.concatPath, buildConcatList(plan.frames, plan.fps), 'utf8');
  if (plan.audioPath) {
    await access(plan.audioPath, fsConstants.F_OK);
  }
  await runFfmpeg(ffmpegCommand, plan.args);
  const metadata = buildRenderMetadata(projectDirectory, {
    rendererMode: 'png-sequence-mp4-draft',
    outputPath: plan.outputPath,
    startTimestamp: plan.startTimestamp,
    duration: plan.duration,
    fps: plan.fps,
    frameCount: plan.frameCount,
    expectedFrameCount: plan.frameCount,
    hasAudio: Boolean(plan.audioPath),
    audioPath: plan.audioPath,
    ffmpegCommand,
    args: plan.args
  });
  const metadataPath = getRenderMetadataPath(plan.outputPath);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  return {
    outputPath: plan.outputPath,
    relativePath: plan.relativePath,
    metadataPath,
    metadataRelativePath: path.relative(projectDirectory, metadataPath).replaceAll(path.sep, '/'),
    frameCount: plan.frameCount,
    fps: plan.fps,
    hasAudio: Boolean(plan.audioPath)
  };
}

export async function createDirectVideoSession(projectDirectory, options = {}) {
  const ffmpegCommand = await resolveFfmpegCommand(options.ffmpegCommand || process.env.KR8_FFMPEG_PATH || 'ffmpeg');
  if (!ffmpegCommand || !(await isFfmpegAvailable(ffmpegCommand))) {
    throw new Error('FFmpeg unavailable. Install FFmpeg or add it to PATH to render MP4 drafts.');
  }

  const fps = Math.max(1, Math.round(Number(options.fps || 30)));
  const frameCount = Math.max(1, Math.round(Number(options.frameCount || 1)));
  const startTimestamp = Math.max(0, Number(options.startTimestamp || 0));
  const duration = Math.max(1 / fps, Number(options.duration || frameCount / fps));
  const frameFormat = options.frameFormat === 'raw-rgba' ? 'raw-rgba' : 'png';
  const width = Math.max(1, Math.round(Number(options.width || 1920)));
  const height = Math.max(1, Math.round(Number(options.height || 1080)));
  const audioPath = options.audioPath ? path.resolve(String(options.audioPath)) : '';
  const compositeVideoPath = options.compositeVideoPath ? path.resolve(String(options.compositeVideoPath)) : '';
  const compositeVideoStartTime = Math.max(0, Number(options.compositeVideoStartTime || 0));
  const videoEncoder = options.videoEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264';
  const videosDir = path.join(projectDirectory, 'exports', 'videos');
  await mkdir(videosDir, { recursive: true });
  if (audioPath) await access(audioPath, fsConstants.F_OK);
  if (compositeVideoPath) await access(compositeVideoPath, fsConstants.F_OK);

  const basename = buildDirectVideoBasename({
    ...options,
    startTimestamp,
    frameCount,
    frameFormat,
    width,
    height,
    compositeVideoPath,
    videoEncoder
  });
  const outputPath = await nextAvailableVideoPath(videosDir, basename);
  const args = compositeVideoPath ? buildCompositeFfmpegArgs({
    outputPath,
    fps,
    width,
    height,
    overlayFrameFormat: frameFormat,
    videoPath: compositeVideoPath,
    videoStartTime: compositeVideoStartTime,
    audioPath,
    startTimestamp,
    duration,
    videoEncoder,
    encoderPreset: options.encoderPreset,
    crf: options.crf,
    cq: options.cq
  }) : buildDirectFfmpegArgs({
    outputPath,
    fps,
    frameFormat,
    width,
    height,
    audioPath,
    startTimestamp,
    duration,
    videoEncoder,
    encoderPreset: options.encoderPreset,
    crf: options.crf,
    cq: options.cq
  });
  const processState = spawnFfmpegForPipe(ffmpegCommand, args);

  return {
    projectDirectory,
    outputPath,
    relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
    fps,
    frameFormat,
    width,
    height,
    frameCount,
    expectedFrameCount: frameCount,
    startTimestamp,
    duration,
    compositeVideoPath,
    compositeVideoStartTime,
    audioPath,
    videoEncoder,
    ffmpegCommand,
    args,
    writtenFrames: 0,
    bytes: 0,
    benchmark: {
      stdinWriteMs: 0,
      finalizeMs: 0,
      client: null
    },
    ...processState
  };
}

export function buildDirectVideoBasename(options = {}) {
  const frameFormat = options.frameFormat === 'raw-rgba' ? 'raw-rgba' : 'png';
  const videoEncoder = options.videoEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264';
  const suffix = options.compositeVideoPath
    ? (videoEncoder === 'h264_nvenc' ? 'composite-nvenc' : 'composite-cpu')
    : frameFormat === 'raw-rgba'
      ? (videoEncoder === 'h264_nvenc' ? 'raw-nvenc' : 'raw-cpu')
      : 'direct';
  const aspect = formatAspectRatioToken(options.width || 1920, options.height || 1080);
  const frameCount = Math.max(1, Math.round(Number(options.frameCount || 1)));
  const startTimestamp = Math.max(0, Number(options.startTimestamp || 0));
  return `${slugify(options.projectName || 'kr8-direct')}-${aspect}-${formatTimestamp(startTimestamp)}-${frameCount}f-${suffix}.mp4`;
}

export async function nextAvailableVideoPath(directory, basename) {
  const parsed = path.parse(path.basename(String(basename || 'kr8-export.mp4')));
  for (let index = 1; index < 10_000; index += 1) {
    const filename = index === 1 ? `${parsed.name}${parsed.ext}` : `${parsed.name}-${index}${parsed.ext}`;
    const candidate = path.join(directory, filename);
    try {
      await access(candidate, fsConstants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error('Unable to allocate a collision-safe video export filename.');
}

export async function appendDirectVideoFrames(session, frames = []) {
  if (!session?.child?.stdin) {
    throw new Error('Direct MP4 session is required.');
  }
  for (const frame of frames) {
    const buffer = decodePngDataUrl(frame?.dataUrl);
    const writeStart = performanceNow();
    await writeToStream(session.child.stdin, buffer);
    session.benchmark.stdinWriteMs += performanceNow() - writeStart;
    session.writtenFrames += 1;
    session.bytes += buffer.length;
  }
  return {
    frameCount: session.writtenFrames,
    bytes: session.bytes
  };
}

export function attachDirectVideoClientBenchmark(session, benchmark = null) {
  if (!session) return;
  session.benchmark = session.benchmark || {};
  session.benchmark.client = benchmark || null;
}

export async function appendDirectVideoFrameBuffers(session, frames = []) {
  if (!session?.child?.stdin) {
    throw new Error('Direct MP4 session is required.');
  }
  for (const frame of frames) {
    const buffer = normalizePngBuffer(frame?.buffer);
    const writeStart = performanceNow();
    await writeToStream(session.child.stdin, buffer);
    session.benchmark.stdinWriteMs += performanceNow() - writeStart;
    session.writtenFrames += 1;
    session.bytes += buffer.length;
  }
  return {
    frameCount: session.writtenFrames,
    bytes: session.bytes
  };
}

export async function appendDirectVideoRawFrames(session, frames = []) {
  if (!session?.child?.stdin) {
    throw new Error('Direct MP4 session is required.');
  }
  const expectedBytes = Math.max(1, Number(session.width || 0)) * Math.max(1, Number(session.height || 0)) * 4;
  for (const frame of frames) {
    const buffer = normalizeRawRgbaBuffer(frame?.buffer, expectedBytes);
    const writeStart = performanceNow();
    await writeToStream(session.child.stdin, buffer);
    session.benchmark.stdinWriteMs += performanceNow() - writeStart;
    session.writtenFrames += 1;
    session.bytes += buffer.length;
  }
  return {
    frameCount: session.writtenFrames,
    bytes: session.bytes
  };
}

export async function finalizeDirectVideoSession(session) {
  if (!session?.child?.stdin) {
    throw new Error('Direct MP4 session is required.');
  }
  session.child.stdin.end();
  const finalizeStart = performanceNow();
  await session.done;
  session.benchmark.finalizeMs += performanceNow() - finalizeStart;
  const metadata = buildRenderMetadata(session.projectDirectory, {
    rendererMode: session.compositeVideoPath
      ? 'direct-mp4-composite'
      : session.frameFormat === 'raw-rgba'
        ? 'direct-mp4-raw'
        : 'direct-mp4',
    outputPath: session.outputPath,
    startTimestamp: session.startTimestamp,
    duration: session.duration,
    fps: session.fps,
    frameCount: session.writtenFrames,
    expectedFrameCount: session.expectedFrameCount,
    hasAudio: Boolean(session.audioPath),
    audioPath: session.audioPath,
    compositeVideoPath: session.compositeVideoPath,
    compositeVideoStartTime: session.compositeVideoStartTime,
    ffmpegCommand: session.ffmpegCommand,
    args: session.args,
    videoEncoder: session.videoEncoder,
    bytes: session.bytes,
    frameFormat: session.frameFormat,
    width: session.width,
    height: session.height,
    benchmark: buildServerBenchmark(session)
  });
  const metadataPath = getRenderMetadataPath(session.outputPath);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  return {
    outputPath: session.outputPath,
    relativePath: session.relativePath,
    metadataPath,
    metadataRelativePath: path.relative(session.projectDirectory, metadataPath).replaceAll(path.sep, '/'),
    frameCount: session.writtenFrames,
    expectedFrameCount: session.expectedFrameCount,
    fps: session.fps,
    hasAudio: Boolean(session.audioPath),
    bytes: session.bytes,
    frameFormat: session.frameFormat,
    benchmark: buildServerBenchmark(session)
  };
}

export function cancelDirectVideoSession(session) {
  if (!session?.child) return false;
  session.done?.catch?.(() => {});
  try {
    session.child.stdin?.destroy?.();
  } catch {}
  try {
    session.child.kill();
  } catch {}
  return true;
}

export function getRenderMetadataPath(outputPath) {
  return `${String(outputPath || '').replace(/\.mp4$/i, '')}.render.json`;
}

export function buildRenderMetadata(projectDirectory, options = {}) {
  const outputPath = path.resolve(String(options.outputPath || ''));
  const audioPath = options.audioPath ? path.resolve(String(options.audioPath)) : '';
  const compositeVideoPath = options.compositeVideoPath ? path.resolve(String(options.compositeVideoPath)) : '';
  return {
    type: 'kr8-render-metadata',
    schemaVersion: 1,
    rendererMode: String(options.rendererMode || 'unknown'),
    createdAt: new Date().toISOString(),
    outputPath,
    relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
    metadataPath: getRenderMetadataPath(outputPath),
    startTimestamp: Math.max(0, Number(options.startTimestamp || 0)),
    duration: Math.max(0, Number(options.duration || 0)),
    fps: Math.max(1, Math.round(Number(options.fps || 1))),
    frameCount: Math.max(0, Math.round(Number(options.frameCount || 0))),
    expectedFrameCount: Math.max(0, Math.round(Number(options.expectedFrameCount || options.frameCount || 0))),
    hasAudio: Boolean(options.hasAudio),
    audioPath: audioPath ? path.relative(projectDirectory, audioPath).replaceAll(path.sep, '/') : '',
    compositeVideoPath: compositeVideoPath ? path.relative(projectDirectory, compositeVideoPath).replaceAll(path.sep, '/') : '',
    compositeVideoStartTime: Math.max(0, Number(options.compositeVideoStartTime || 0)),
    ffmpeg: {
      command: String(options.ffmpegCommand || 'ffmpeg'),
      args: Array.isArray(options.args) ? options.args.map(String) : []
    },
    videoEncoder: String(options.videoEncoder || 'libx264'),
    bytes: Math.max(0, Number(options.bytes || 0)),
    frameFormat: String(options.frameFormat || ''),
    width: Math.max(0, Math.round(Number(options.width || 0))),
    height: Math.max(0, Math.round(Number(options.height || 0))),
    benchmark: options.benchmark || null
  };
}

export function buildFfmpegArgs({ concatPath, outputPath, fps, audioPath = '', startTimestamp = 0, duration = 0 }) {
  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath
  ];

  if (audioPath) {
    args.push(
      '-ss', formatFfmpegSeconds(startTimestamp),
      '-t', formatFfmpegSeconds(duration),
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0'
    );
  }

  args.push(
    '-vf', `fps=${fps},${SDR_BT709_FILTER}`,
    '-c:v', 'libx264',
    ...SDR_BT709_OUTPUT_ARGS,
    '-preset', 'veryfast',
    '-crf', '20',
  );

  if (audioPath) {
    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest'
    );
  }

  args.push(
    '-movflags', '+faststart+write_colr',
    outputPath
  );
  return args;
}

export function buildDirectFfmpegArgs({
  outputPath,
  fps,
  frameFormat = 'png',
  width = 1920,
  height = 1080,
  audioPath = '',
  startTimestamp = 0,
  duration = 0,
  encoderPreset = 'veryfast',
  crf = 20,
  cq = 23,
  videoEncoder = 'libx264'
}) {
  const safeFps = String(Math.max(1, Math.round(Number(fps || 30))));
  const encoder = videoEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264';
  const args = ['-y'];
  if (frameFormat === 'raw-rgba') {
    args.push(
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${Math.max(1, Math.round(Number(width || 1920)))}x${Math.max(1, Math.round(Number(height || 1080)))}`,
      '-r', safeFps,
      '-i', 'pipe:0'
    );
  } else {
    args.push(
      '-f', 'image2pipe',
      '-framerate', safeFps,
      '-vcodec', 'png',
      '-i', 'pipe:0'
    );
  }

  if (audioPath) {
    args.push(
      '-ss', formatFfmpegSeconds(startTimestamp),
      '-t', formatFfmpegSeconds(duration),
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0'
    );
  }

  args.push(
    '-vf', SDR_BT709_FILTER,
    '-c:v', encoder,
    ...SDR_BT709_OUTPUT_ARGS
  );
  if (encoder === 'h264_nvenc') {
    args.push(
      '-preset', 'p4',
      '-cq', String(cq ?? 23)
    );
  } else {
    args.push(
      '-preset', String(encoderPreset || 'veryfast'),
      '-crf', String(crf ?? 20)
    );
  }

  if (audioPath) {
    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest'
    );
  }

  args.push(
    '-movflags', '+faststart+write_colr',
    outputPath
  );
  return args;
}

export function buildCompositeFfmpegArgs({
  outputPath,
  fps,
  overlayFrameFormat = 'raw-rgba',
  width = 1920,
  height = 1080,
  videoPath = '',
  videoStartTime = 0,
  audioPath = '',
  startTimestamp = 0,
  duration = 0,
  encoderPreset = 'veryfast',
  crf = 20,
  cq = 23,
  videoEncoder = 'libx264'
}) {
  const safeFps = String(Math.max(1, Math.round(Number(fps || 30))));
  const safeWidth = Math.max(1, Math.round(Number(width || 1920)));
  const safeHeight = Math.max(1, Math.round(Number(height || 1080)));
  const encoder = videoEncoder === 'h264_nvenc' ? 'h264_nvenc' : 'libx264';
  const args = ['-y'];

  if (overlayFrameFormat === 'raw-rgba') {
    args.push(
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${safeWidth}x${safeHeight}`,
      '-r', safeFps,
      '-i', 'pipe:0'
    );
  } else {
    args.push(
      '-f', 'image2pipe',
      '-framerate', safeFps,
      '-vcodec', 'png',
      '-i', 'pipe:0'
    );
  }

  args.push(
    '-stream_loop', '-1',
    '-ss', formatFfmpegSeconds(videoStartTime),
    '-t', formatFfmpegSeconds(duration),
    '-i', videoPath
  );

  if (audioPath) {
    args.push(
      '-ss', formatFfmpegSeconds(startTimestamp),
      '-t', formatFfmpegSeconds(duration),
      '-i', audioPath
    );
  }

  args.push(
    '-filter_complex',
    `[1:v]scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=increase,crop=${safeWidth}:${safeHeight},setsar=1[bg];[bg][0:v]overlay=0:0:format=auto,${SDR_BT709_FILTER}[v]`,
    '-map', '[v]'
  );

  if (audioPath) {
    args.push('-map', '2:a:0');
  } else {
    args.push('-an');
  }

  args.push(
    '-c:v', encoder,
    ...SDR_BT709_OUTPUT_ARGS
  );
  if (encoder === 'h264_nvenc') {
    args.push(
      '-preset', 'p4',
      '-cq', String(cq ?? 23)
    );
  } else {
    args.push(
      '-preset', String(encoderPreset || 'veryfast'),
      '-crf', String(crf ?? 20)
    );
  }

  if (audioPath) {
    args.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest'
    );
  }

  args.push(
    '-movflags', '+faststart+write_colr',
    outputPath
  );
  return args;
}

export function buildConcatList(frames, fps) {
  const duration = 1 / Math.max(1, Number(fps || 1));
  const lines = [];
  for (const framePath of frames) {
    lines.push(`file '${escapeConcatPath(framePath)}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  lines.push(`file '${escapeConcatPath(frames.at(-1))}'`);
  return `${lines.join('\n')}\n`;
}

function runFfmpeg(command, args) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      runFfmpegViaPowerShell(command, args).then(resolve, reject);
      return;
    }
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      runFfmpegViaPowerShell(command, args).then(resolve, reject);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg failed with exit code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function runFfmpegViaPowerShell(command, args) {
  return new Promise((resolve, reject) => {
    const powershellCommand = ['&', quotePowerShell(command), ...args.map(quotePowerShell)].join(' ');
    let stderr = '';
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand], {
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg failed through PowerShell with exit code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function canRun(command) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, ['-version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

function canRunViaPowerShell(command) {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const powershellCommand = ['&', quotePowerShell(command), quotePowerShell('-version')].join(' ');
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellCommand], {
        windowsHide: true,
        stdio: 'ignore'
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

async function findFfmpegInPath() {
  const pathValue = process.env.Path || process.env.PATH || '';
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, executable);
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch {}
  }
  return '';
}

function resolveWindowsPowerShellCommand(commandName) {
  return new Promise((resolve) => {
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-Command ${commandName} -ErrorAction SilentlyContinue).Source`
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(stdout.trim().split(/\r?\n/).find(Boolean) || ''));
    } catch {
      resolve('');
    }
  });
}

async function findWindowsWingetFfmpeg() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return '';
  const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    const packages = await readdir(packagesDir, { withFileTypes: true });
    const candidates = packages
      .filter((entry) => entry.isDirectory() && /^Gyan\.FFmpeg/i.test(entry.name))
      .map((entry) => path.join(packagesDir, entry.name));
    for (const packageDir of candidates) {
      const versions = await readdir(packageDir, { withFileTypes: true });
      for (const version of versions) {
        if (!version.isDirectory() || !/^ffmpeg-/i.test(version.name)) continue;
        const ffmpegPath = path.join(packageDir, version.name, 'bin', 'ffmpeg.exe');
        try {
          await access(ffmpegPath, fsConstants.F_OK);
          return ffmpegPath;
        } catch {}
      }
    }
  } catch {}
  return '';
}

function escapeConcatPath(value) {
  return String(value || '').replaceAll('\\', '/').replaceAll("'", "'\\''");
}

function quotePowerShell(value) {
  return `'${String(value || '').replaceAll("'", "''")}'`;
}

function spawnFfmpegForPipe(command, args) {
  let stderr = '';
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe']
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg failed with exit code ${code}: ${stderr.slice(-2000)}`));
    });
  });
  return { child, done };
}

function writeToStream(stream, buffer) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      stream.off('drain', onDrain);
      reject(error);
    };
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    stream.once('error', onError);
    if (stream.write(buffer)) {
      stream.off('error', onError);
      resolve();
      return;
    }
    stream.once('drain', onDrain);
  });
}

function decodePngDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Direct MP4 frame requires a PNG data URL.');
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) {
    throw new Error('Direct MP4 frame image is empty.');
  }
  return buffer;
}

function normalizePngBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length) {
    throw new Error('Direct MP4 frame image is empty.');
  }
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    throw new Error('Direct MP4 frame requires a PNG buffer.');
  }
  return buffer;
}

function normalizeRawRgbaBuffer(value, expectedBytes) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length) {
    throw new Error('Direct MP4 raw frame is empty.');
  }
  if (buffer.length !== expectedBytes) {
    throw new Error(`Direct MP4 raw frame has ${buffer.length} bytes, expected ${expectedBytes}.`);
  }
  return buffer;
}

function buildServerBenchmark(session) {
  const frameCount = Math.max(1, Number(session.writtenFrames || 0));
  const stdinWriteMs = Math.max(0, Number(session.benchmark?.stdinWriteMs || 0));
  const finalizeMs = Math.max(0, Number(session.benchmark?.finalizeMs || 0));
  const duration = Math.max(0, Number(session.duration || 0));
  const server = {
    server: {
      stdinWriteMs,
      averageStdinWriteMs: stdinWriteMs / frameCount,
      ffmpegFinalizeMs: finalizeMs,
      ffmpegEncodeMs: stdinWriteMs + finalizeMs,
      averageFps: duration > 0 ? frameCount / duration : 0
    }
  };
  if (session.benchmark?.client) {
    server.client = session.benchmark.client;
  }
  return server;
}

function performanceNow() {
  return Number(globalThis.performance?.now?.() || Date.now());
}

function framesDuration(frames, fps) {
  if (!Array.isArray(frames) || !frames.length) return 0;
  const first = Number(frames[0]?.timestamp);
  const last = Number(frames.at(-1)?.timestamp);
  if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
    return (last - first) + 1 / Math.max(1, Number(fps || 1));
  }
  return frames.length / Math.max(1, Number(fps || 1));
}

function formatFfmpegSeconds(value) {
  return Math.max(0, Number(value || 0)).toFixed(6);
}

function formatTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const totalCentiseconds = Math.round(safe * 100);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const wholeSeconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, '0')}m${String(wholeSeconds).padStart(2, '0')}s${String(centiseconds).padStart(2, '0')}`;
}

function slugify(value) {
  return String(value || 'kr8-direct')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kr8-direct';
}
