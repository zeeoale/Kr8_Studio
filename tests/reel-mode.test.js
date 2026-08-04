import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findLatestValidRenderExport,
  findValidRenderExport,
  listValidRenderExports
} from '../src/exports/history.js';
import {
  calculateReelTiming,
  loadReelSettings,
  normalizeReelSettings,
  saveReelSettings,
  saveReelWatermarkImage
} from '../src/reel/core.js';
import {
  buildReelFfmpegArgs,
  buildReelFilterComplex,
  cancelReelExport,
  createReelExportPlan
} from '../src/reel/export.js';

test('findLatestValidRenderExport returns the newest existing final video', async () => {
  const projectDirectory = await createProjectDirectory();
  const videosDirectory = path.join(projectDirectory, 'exports', 'videos');
  await writeFile(path.join(videosDirectory, 'older.mp4'), 'older');
  await writeFile(path.join(videosDirectory, 'newer.mp4'), 'newer');
  await writeRenderMetadata(videosDirectory, 'older', '2026-07-19T10:00:00.000Z');
  await writeRenderMetadata(videosDirectory, 'newer', '2026-07-19T11:00:00.000Z');

  const latest = await findLatestValidRenderExport(projectDirectory);

  assert.equal(latest.relativePath, 'exports/videos/newer.mp4');
});

test('findLatestValidRenderExport ignores metadata whose video is missing', async () => {
  const projectDirectory = await createProjectDirectory();
  const videosDirectory = path.join(projectDirectory, 'exports', 'videos');
  await writeRenderMetadata(videosDirectory, 'missing', '2026-07-19T11:00:00.000Z');

  assert.equal(await findLatestValidRenderExport(projectDirectory), null);
});

test('render history preserves and selects landscape and portrait exports independently', async () => {
  const projectDirectory = await createProjectDirectory();
  const videosDirectory = path.join(projectDirectory, 'exports', 'videos');
  for (const [name, width, height, createdAt] of [
    ['song-9_16', 1080, 1920, '2026-08-04T10:00:00.000Z'],
    ['song-16_9', 1920, 1080, '2026-08-04T11:00:00.000Z']
  ]) {
    await writeFile(path.join(videosDirectory, `${name}.mp4`), name);
    await writeRenderMetadata(videosDirectory, name, createdAt, { width, height });
  }

  const sources = await listValidRenderExports(projectDirectory);
  const portrait = await findValidRenderExport(projectDirectory, 'exports\\videos\\song-9_16.mp4');

  assert.deepEqual(sources.map((source) => source.aspectRatio), ['16:9', '9:16']);
  assert.equal(portrait.relativePath, 'exports/videos/song-9_16.mp4');
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.height, 1920);
});

test('normalizeReelSettings validates trim and clamps fades on short videos', () => {
  const settings = normalizeReelSettings({
    trimStart: 1,
    trimEnd: 2.5,
    videoFadeIn: 5,
    videoFadeOut: 8,
    audioFadeIn: -2,
    audioFadeOut: 4
  }, 3);

  assert.equal(settings.trimStart, 1);
  assert.equal(settings.trimEnd, 2.5);
  assert.equal(settings.videoFadeIn, 1.5);
  assert.equal(settings.videoFadeOut, 1.5);
  assert.equal(settings.audioFadeIn, 0);
  assert.equal(settings.audioFadeOut, 1.5);
});

test('calculateReelTiming computes fade-out starts after trim', () => {
  const timing = calculateReelTiming({
    trimStart: 10,
    trimEnd: 20,
    videoFadeOut: 1.5,
    audioFadeOut: 2.5
  }, 30);

  assert.equal(timing.duration, 10);
  assert.equal(timing.videoFadeOutStart, 8.5);
  assert.equal(timing.audioFadeOutStart, 7.5);
});

test('Reel settings serialize separately and load without project mutation', async () => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-reel-settings-'));
  const saved = await saveReelSettings(projectDirectory, {
    sourceVideo: 'exports/videos/source with spaces.mp4',
    trimStart: 2,
    trimEnd: 12,
    videoFadeOut: 2,
    watermark: { enabled: true, type: 'text', text: 'TK MUSIC' }
  }, 20);
  const loaded = await loadReelSettings(projectDirectory, 20);
  const document = JSON.parse(await readFile(saved.settingsPath, 'utf8'));

  assert.equal(document.type, 'kr8-reel-settings');
  assert.equal(document.schemaVersion, 1);
  assert.equal(loaded.sourceVideo, 'exports/videos/source with spaces.mp4');
  assert.equal(loaded.trimStart, 2);
  assert.equal(loaded.watermark.text, 'TK MUSIC');
});

test('buildReelFfmpegArgs safely keeps paths with spaces as separate arguments', () => {
  const sourcePath = 'C:/Kr8 Project/exports/videos/source video.mp4';
  const outputPath = 'C:/Kr8 Project/exports/reels/project_reel.mp4';
  const args = buildReelFfmpegArgs({
    sourcePath,
    outputPath,
    sourceDuration: 30,
    sourceHasAudio: true,
    fps: 30,
    width: 1920,
    height: 1080,
    videoEncoder: 'h264_nvenc',
    settings: { trimStart: 5, trimEnd: 15, videoFadeOut: 1, audioFadeOut: 2 }
  });

  assert.equal(args[args.indexOf('-i') + 1], path.resolve(sourcePath));
  assert.equal(args.at(-1), path.resolve(outputPath));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc');
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
  assert.equal(args[args.indexOf('-color_range:v') + 1], 'tv');
  assert.equal(args[args.indexOf('-colorspace:v') + 1], 'bt709');
  assert.match(args[args.indexOf('-filter_complex') + 1], /fade=t=out:st=9:d=1/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /afade=t=out:st=8:d=2/);
});

test('watermark disabled produces no drawtext or overlay filter', () => {
  const timing = calculateReelTiming({ trimEnd: 10, watermark: { enabled: false } }, 10);
  const filter = buildReelFilterComplex({ timing, sourceHasAudio: false, width: 1920, height: 1080 });

  assert.doesNotMatch(filter, /drawtext|overlay=/);
  assert.doesNotMatch(filter, /\[aout\]/);
});

test('text watermark uses a UTF-8 text file and time visibility', () => {
  const timing = calculateReelTiming({
    trimEnd: 10,
    watermark: {
      enabled: true,
      type: 'text',
      text: 'TK MUSIC',
      position: 'bottom-right',
      visibility: 'last-seconds',
      lastSeconds: 4
    }
  }, 10);
  const filter = buildReelFilterComplex({
    timing,
    sourceHasAudio: true,
    width: 1920,
    height: 1080,
    watermarkTextPath: 'C:/Kr8 Project/exports/reel/watermark.txt',
    watermarkFontPath: 'C:/Windows/Fonts/arial.ttf'
  });

  assert.match(filter, /drawtext=fontfile='C\\:\/Windows\/Fonts\/arial\.ttf':textfile='C\\:\/Kr8 Project\/exports\/reel\/watermark\.txt'/);
  assert.match(filter, /x=w-tw-32:y=h-th-32/);
  assert.match(filter, /enable='between\(t,6,10\)'/);
});

test('PNG watermark is scaled and overlaid from the second input', () => {
  const args = buildReelFfmpegArgs({
    sourcePath: 'source.mp4',
    outputPath: 'output.mp4',
    watermarkImagePath: 'logo mark.png',
    sourceDuration: 10,
    sourceHasAudio: false,
    width: 1920,
    height: 1080,
    settings: {
      trimEnd: 10,
      watermark: { enabled: true, type: 'image', imagePath: 'exports/reel/assets/logo mark.png', scale: 0.12 }
    }
  });
  const filter = args[args.indexOf('-filter_complex') + 1];

  assert.ok(args.includes(path.resolve('logo mark.png')));
  assert.match(filter, /\[1:v\]format=rgba,scale=-1:130/);
  assert.match(filter, /\[vbase\]\[wm\]overlay=main_w-overlay_w-32:main_h-overlay_h-32/);
  assert.equal(args.includes('[aout]'), false);
});

test('PNG watermark import rejects missing or invalid image data', async () => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-reel-watermark-'));
  await assert.rejects(
    () => saveReelWatermarkImage(projectDirectory, { filename: 'watermark.jpg', dataUrl: '' }),
    /must be a PNG/
  );
  await assert.rejects(
    () => saveReelWatermarkImage(projectDirectory, { filename: 'watermark.png', dataUrl: 'data:image/png;base64,ZmFrZQ==' }),
    /not a valid PNG/
  );
});

test('cancelReelExport stops only its FFmpeg child', () => {
  const calls = [];
  const job = {
    status: 'running',
    child: { kill: () => calls.push('kill') }
  };

  assert.equal(cancelReelExport(job), true);
  assert.equal(job.status, 'cancelled');
  assert.deepEqual(calls, ['kill']);
  assert.equal(cancelReelExport(job), false);
});

test('createReelExportPlan never overwrites an existing Reel output', async () => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-reel-plan-'));
  const sourcePath = path.join(projectDirectory, 'exports', 'videos', 'source.mp4');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, 'source');
  const reelsDirectory = path.join(projectDirectory, 'exports', 'reels');
  await mkdir(reelsDirectory, { recursive: true });
  await writeFile(path.join(reelsDirectory, 'demo_reel.mp4'), 'existing');

  const plan = await createReelExportPlan(projectDirectory, {
    projectName: 'Demo',
    sourcePath,
    media: { duration: 10, hasVideo: true, hasAudio: false, width: 1920, height: 1080, fps: 30 },
    settings: { trimEnd: 10 },
    ffmpegCommand: 'ffmpeg',
    videoEncoder: 'libx264'
  });

  assert.equal(path.basename(plan.outputPath), 'demo_reel_2.mp4');
});

async function createProjectDirectory() {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'kr8-reel-history-'));
  await mkdir(path.join(projectDirectory, 'exports', 'videos'), { recursive: true });
  return projectDirectory;
}

async function writeRenderMetadata(videosDirectory, name, createdAt, options = {}) {
  await writeFile(path.join(videosDirectory, `${name}.render.json`), JSON.stringify({
    type: 'kr8-render-metadata',
    createdAt,
    relativePath: `exports/videos/${name}.mp4`,
    duration: 10,
    fps: 30,
    frameCount: 300,
    hasAudio: true,
    ...options
  }));
}
