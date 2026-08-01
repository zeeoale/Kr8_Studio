import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildRenderMetadata,
  buildConcatList,
  buildCompositeFfmpegArgs,
  buildDirectFfmpegArgs,
  buildFfmpegArgs,
  cancelDirectVideoSession,
  createDraftVideoPlan,
  getRenderMetadataPath
} from '../src/exports/videoDraft.js';

test('buildFfmpegArgs creates an MP4 draft command from a concat list', () => {
  const args = buildFfmpegArgs({
    concatPath: 'clip/ffmpeg-frames.txt',
    outputPath: 'exports/videos/demo.mp4',
    fps: 6
  });

  assert.deepEqual(args.slice(0, 7), ['-y', '-f', 'concat', '-safe', '0', '-i', 'clip/ffmpeg-frames.txt']);
  assert.ok(args.includes('fps=6,scale=out_color_matrix=bt709:out_range=tv,setparams=range=tv:colorspace=bt709:color_trc=bt709:color_primaries=bt709,format=yuv420p'));
  assertSdrBt709OutputArgs(args);
  assert.equal(args.at(-1), 'exports/videos/demo.mp4');
});

test('buildFfmpegArgs can include trimmed audio for clip exports', () => {
  const args = buildFfmpegArgs({
    concatPath: 'clip/ffmpeg-frames.txt',
    outputPath: 'exports/videos/demo.mp4',
    fps: 30,
    audioPath: 'song.mp3',
    startTimestamp: 65.25,
    duration: 5
  });

  assert.ok(args.includes('song.mp3'));
  assert.ok(args.includes('-ss'));
  assert.ok(args.includes('65.250000'));
  assert.ok(args.includes('-t'));
  assert.ok(args.includes('5.000000'));
  assert.ok(args.includes('-map'));
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('1:a:0'));
  assert.ok(args.includes('-c:a'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('-shortest'));
});

test('buildDirectFfmpegArgs creates an image pipe MP4 command with optional audio', () => {
  const args = buildDirectFfmpegArgs({
    outputPath: 'exports/videos/direct.mp4',
    fps: 30,
    audioPath: 'song.mp3',
    startTimestamp: 12.5,
    duration: 10
  });

  assert.deepEqual(args.slice(0, 9), ['-y', '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0']);
  assert.ok(args.includes('song.mp3'));
  assert.ok(args.includes('12.500000'));
  assert.ok(args.includes('10.000000'));
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('1:a:0'));
  assert.ok(args.includes('aac'));
  assertSdrBt709OutputArgs(args);
  assert.equal(args.at(-1), 'exports/videos/direct.mp4');
});

test('buildDirectFfmpegArgs supports fast draft encoder settings', () => {
  const args = buildDirectFfmpegArgs({
    outputPath: 'exports/videos/direct-fast.mp4',
    fps: 30,
    encoderPreset: 'ultrafast',
    crf: 24
  });

  assert.equal(args[args.indexOf('-preset') + 1], 'ultrafast');
  assert.equal(args[args.indexOf('-crf') + 1], '24');
});

test('buildDirectFfmpegArgs supports raw RGBA pipe mode', () => {
  const args = buildDirectFfmpegArgs({
    outputPath: 'exports/videos/direct-raw.mp4',
    fps: 30,
    frameFormat: 'raw-rgba',
    width: 1920,
    height: 1080
  });

  assert.deepEqual(args.slice(0, 12), [
    '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', '1920x1080',
    '-r', '30',
    '-i'
  ]);
  assert.equal(args[12], 'pipe:0');
  assert.equal(args.at(-1), 'exports/videos/direct-raw.mp4');
});

test('buildDirectFfmpegArgs supports h264 NVENC mode', () => {
  const args = buildDirectFfmpegArgs({
    outputPath: 'exports/videos/direct-nvenc.mp4',
    fps: 30,
    frameFormat: 'raw-rgba',
    width: 1920,
    height: 1080,
    videoEncoder: 'h264_nvenc',
    cq: 23
  });

  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc');
  assert.equal(args[args.indexOf('-preset') + 1], 'p4');
  assert.equal(args[args.indexOf('-cq') + 1], '23');
  assert.equal(args.includes('-crf'), false);
  assertSdrBt709OutputArgs(args);
  assert.equal(args.at(-1), 'exports/videos/direct-nvenc.mp4');
});

test('buildCompositeFfmpegArgs overlays raw RGBA frames over a looping video background', () => {
  const args = buildCompositeFfmpegArgs({
    outputPath: 'exports/videos/composite.mp4',
    fps: 30,
    overlayFrameFormat: 'raw-rgba',
    width: 1920,
    height: 1080,
    videoPath: 'cover-video.mp4',
    videoStartTime: 3.25,
    audioPath: 'song.mp3',
    startTimestamp: 12.5,
    duration: 10,
    videoEncoder: 'h264_nvenc',
    cq: 23
  });

  assert.deepEqual(args.slice(0, 13), [
    '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', '1920x1080',
    '-r', '30',
    '-i', 'pipe:0'
  ]);
  assert.ok(args.includes('-stream_loop'));
  assert.ok(args.includes('cover-video.mp4'));
  assert.ok(args.includes('3.250000'));
  assert.ok(args.includes('song.mp3'));
  assert.ok(args.includes('12.500000'));
  assert.match(args[args.indexOf('-filter_complex') + 1], /\[bg\]\[0:v\]overlay=0:0:format=auto,scale=out_color_matrix=bt709:out_range=tv,setparams=range=tv:colorspace=bt709:color_trc=bt709:color_primaries=bt709,format=yuv420p\[v\]/);
  assert.ok(args.includes('[v]'));
  assert.ok(args.includes('2:a:0'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc');
  assertSdrBt709OutputArgs(args);
  assert.equal(args.at(-1), 'exports/videos/composite.mp4');
});

function assertSdrBt709OutputArgs(args) {
  assert.equal(args[args.lastIndexOf('-pix_fmt') + 1], 'yuv420p');
  assert.equal(args[args.indexOf('-color_range:v') + 1], 'tv');
  assert.equal(args[args.indexOf('-colorspace:v') + 1], 'bt709');
  assert.equal(args[args.indexOf('-color_trc:v') + 1], 'bt709');
  assert.equal(args[args.indexOf('-color_primaries:v') + 1], 'bt709');
  assert.equal(
    args[args.indexOf('-bsf:v') + 1],
    'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1'
  );
  assert.ok(args.includes('+faststart+write_colr'));
}

test('cancelDirectVideoSession closes only the provided direct export process', () => {
  const calls = [];
  const session = {
    child: {
      stdin: {
        destroy: () => calls.push('stdin.destroy')
      },
      kill: () => calls.push('kill')
    },
    done: Promise.reject(new Error('cancelled'))
  };

  assert.equal(cancelDirectVideoSession(session), true);
  assert.deepEqual(calls, ['stdin.destroy', 'kill']);
  assert.equal(cancelDirectVideoSession(null), false);
});

test('getRenderMetadataPath writes metadata next to the mp4', () => {
  assert.equal(
    getRenderMetadataPath('C:/project/exports/videos/demo.mp4'),
    'C:/project/exports/videos/demo.render.json'
  );
});

test('buildRenderMetadata captures direct MP4 render settings', () => {
  const metadata = buildRenderMetadata('C:/project', {
    rendererMode: 'direct-mp4',
    outputPath: 'C:/project/exports/videos/demo.mp4',
    startTimestamp: 74.72,
    duration: 5,
    fps: 30,
    frameCount: 150,
    expectedFrameCount: 150,
    hasAudio: true,
    audioPath: 'C:/project/assets/audio.mp3',
    ffmpegCommand: 'ffmpeg',
    args: ['-f', 'image2pipe'],
    videoEncoder: 'h264_nvenc',
    bytes: 1234,
    benchmark: {
      client: { averageFps: 18 },
      server: { stdinWriteMs: 100 }
    }
  });

  assert.equal(metadata.type, 'kr8-render-metadata');
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.rendererMode, 'direct-mp4');
  assert.equal(metadata.relativePath, 'exports/videos/demo.mp4');
  assert.equal(metadata.audioPath, 'assets/audio.mp3');
  assert.equal(metadata.startTimestamp, 74.72);
  assert.equal(metadata.duration, 5);
  assert.equal(metadata.fps, 30);
  assert.equal(metadata.frameCount, 150);
  assert.equal(metadata.expectedFrameCount, 150);
  assert.equal(metadata.hasAudio, true);
  assert.deepEqual(metadata.ffmpeg.args, ['-f', 'image2pipe']);
  assert.equal(metadata.videoEncoder, 'h264_nvenc');
  assert.equal(metadata.bytes, 1234);
  assert.equal(metadata.benchmark.client.averageFps, 18);
  assert.equal(metadata.benchmark.server.stdinWriteMs, 100);
  assert.match(metadata.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildConcatList writes stable frame durations', () => {
  const text = buildConcatList(['C:/clip/frame-0001.png', 'C:/clip/frame-0002.png'], 6);

  assert.match(text, /file 'C:\/clip\/frame-0001\.png'/);
  assert.match(text, /duration 0\.166667/);
  assert.match(text, /file 'C:\/clip\/frame-0002\.png'\n$/);
});

test('createDraftVideoPlan reads a Kr8 frame sequence manifest', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-video-draft-'));
  const clipDir = path.join(dir, 'exports', 'clips', 'demo-clip');
  await mkdir(clipDir, { recursive: true });
  await writeFile(path.join(clipDir, 'frame-0001.png'), 'png-a');
  await writeFile(path.join(clipDir, 'frame-0002.png'), 'png-b');
  await writeFile(path.join(clipDir, 'manifest.json'), JSON.stringify({
    type: 'kr8-frame-sequence',
    startTimestamp: 42,
    fps: 6,
    frameCount: 2,
    frames: [
      { index: 0, timestamp: 42, relativePath: 'frame-0001.png' },
      { index: 1, timestamp: 42 + 1 / 6, relativePath: 'frame-0002.png' }
    ]
  }));
  const audioPath = path.join(dir, 'song.mp3');
  await writeFile(audioPath, 'audio');

  const plan = await createDraftVideoPlan(dir, { clipPath: clipDir, audioPath });

  assert.equal(plan.frameCount, 2);
  assert.equal(plan.fps, 6);
  assert.equal(plan.startTimestamp, 42);
  assert.equal(Math.round(plan.duration * 1000), 333);
  assert.equal(plan.audioPath, audioPath);
  assert.equal(plan.relativePath, 'exports/videos/demo-clip.mp4');
  assert.equal(plan.frames.length, 2);
  assert.ok(plan.args.includes(audioPath));
  assert.equal(plan.args.at(-1), plan.outputPath);
});

test('createDraftVideoPlan rejects clip paths outside exports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kr8-video-draft-'));
  await assert.rejects(() => createDraftVideoPlan(dir, {
    clipPath: path.join(os.tmpdir(), 'outside-clip')
  }), /requested path is not allowed/);
});
