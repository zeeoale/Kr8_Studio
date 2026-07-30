import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function saveFrameExport(projectDirectory, options = {}) {
  const dataUrl = String(options.dataUrl || '');
  const timestamp = Number(options.timestamp || 0);
  const projectName = String(options.projectName || 'kr8-frame');

  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Frame export requires a PNG data URL.');
  }

  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) {
    throw new Error('Frame export image is empty.');
  }

  const exportsDir = path.join(projectDirectory, 'exports', 'frames');
  await mkdir(exportsDir, { recursive: true });
  const filename = `${slugify(projectName)}-${formatTimestamp(timestamp)}.png`;
  const outputPath = path.join(exportsDir, filename);
  await writeFile(outputPath, buffer);

  return {
    outputPath,
    relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
    bytes: buffer.length
  };
}

export async function saveFrameSequenceExport(projectDirectory, options = {}) {
  const frames = Array.isArray(options.frames) ? options.frames : [];
  const startTimestamp = Number(options.startTimestamp || 0);
  const fps = Math.max(1, Math.round(Number(options.fps || 6)));
  const projectName = String(options.projectName || 'kr8-clip');

  if (!frames.length) {
    throw new Error('Clip export requires at least one frame.');
  }
  if (frames.length > 240) {
    throw new Error('Clip export supports up to 240 frames.');
  }

  const clipSlug = `${slugify(projectName)}-${formatTimestamp(startTimestamp)}-${frames.length}f`;
  const exportsDir = path.join(projectDirectory, 'exports', 'clips', clipSlug);
  await mkdir(exportsDir, { recursive: true });

  const savedFrames = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index] || {};
    const dataUrl = String(frame.dataUrl || '');
    const timestamp = Number(frame.timestamp ?? startTimestamp + index / fps);
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error(`Clip frame ${index + 1} requires a PNG data URL.`);
    }
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length) {
      throw new Error(`Clip frame ${index + 1} image is empty.`);
    }

    const filename = `frame-${String(index + 1).padStart(4, '0')}-${formatTimestamp(timestamp)}.png`;
    const outputPath = path.join(exportsDir, filename);
    await writeFile(outputPath, buffer);
    savedFrames.push({
      index,
      timestamp,
      outputPath,
      relativePath: path.relative(projectDirectory, outputPath).replaceAll(path.sep, '/'),
      bytes: buffer.length
    });
  }

  const manifest = {
    type: 'kr8-frame-sequence',
    projectName,
    startTimestamp,
    fps,
    frameCount: savedFrames.length,
    frames: savedFrames.map((frame) => ({
      index: frame.index,
      timestamp: frame.timestamp,
      relativePath: path.basename(frame.outputPath),
      bytes: frame.bytes
    }))
  };
  const manifestPath = path.join(exportsDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    outputPath: exportsDir,
    relativePath: path.relative(projectDirectory, exportsDir).replaceAll(path.sep, '/'),
    manifestPath,
    manifestRelativePath: path.relative(projectDirectory, manifestPath).replaceAll(path.sep, '/'),
    frameCount: savedFrames.length,
    fps,
    frames: savedFrames
  };
}

export async function createFrameSequenceExportSession(projectDirectory, options = {}) {
  const startTimestamp = Number(options.startTimestamp || 0);
  const fps = Math.max(1, Math.round(Number(options.fps || 6)));
  const projectName = String(options.projectName || 'kr8-clip');
  const expectedFrameCount = Math.max(1, Math.round(Number(options.expectedFrameCount || 1)));
  const clipSlug = `${slugify(projectName)}-${formatTimestamp(startTimestamp)}-${expectedFrameCount}f`;
  const exportsDir = path.join(projectDirectory, 'exports', 'clips', clipSlug);
  await mkdir(exportsDir, { recursive: true });

  return {
    projectDirectory,
    projectName,
    startTimestamp,
    fps,
    expectedFrameCount,
    exportsDir,
    manifestPath: path.join(exportsDir, 'manifest.json'),
    frames: []
  };
}

export async function appendFrameSequenceExportBatch(session, options = {}) {
  if (!session || !session.exportsDir) {
    throw new Error('Clip export session is required.');
  }
  const frames = Array.isArray(options.frames) ? options.frames : [];
  const offset = Math.max(0, Math.round(Number(options.offset || 0)));
  const savedFrames = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frameNumber = offset + index;
    const frame = frames[index] || {};
    const dataUrl = String(frame.dataUrl || '');
    const timestamp = Number(frame.timestamp ?? session.startTimestamp + frameNumber / session.fps);
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error(`Clip frame ${frameNumber + 1} requires a PNG data URL.`);
    }
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length) {
      throw new Error(`Clip frame ${frameNumber + 1} image is empty.`);
    }

    const filename = `frame-${String(frameNumber + 1).padStart(4, '0')}-${formatTimestamp(timestamp)}.png`;
    const outputPath = path.join(session.exportsDir, filename);
    await writeFile(outputPath, buffer);
    const savedFrame = {
      index: frameNumber,
      timestamp,
      outputPath,
      relativePath: path.relative(session.projectDirectory, outputPath).replaceAll(path.sep, '/'),
      bytes: buffer.length
    };
    savedFrames.push(savedFrame);
  }

  session.frames = [
    ...(session.frames || []).filter((frame) => !savedFrames.some((next) => next.index === frame.index)),
    ...savedFrames
  ].sort((a, b) => a.index - b.index);

  return {
    savedFrames,
    frameCount: session.frames.length
  };
}

export async function finalizeFrameSequenceExportSession(session) {
  if (!session || !session.exportsDir) {
    throw new Error('Clip export session is required.');
  }
  const frames = [...(session.frames || [])].sort((a, b) => a.index - b.index);
  if (!frames.length) {
    throw new Error('Clip export requires at least one frame.');
  }
  const manifest = {
    type: 'kr8-frame-sequence',
    projectName: session.projectName,
    startTimestamp: session.startTimestamp,
    fps: session.fps,
    frameCount: frames.length,
    expectedFrameCount: session.expectedFrameCount,
    frames: frames.map((frame) => ({
      index: frame.index,
      timestamp: frame.timestamp,
      relativePath: path.basename(frame.outputPath),
      bytes: frame.bytes
    }))
  };
  await writeFile(session.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    outputPath: session.exportsDir,
    relativePath: path.relative(session.projectDirectory, session.exportsDir).replaceAll(path.sep, '/'),
    manifestPath: session.manifestPath,
    manifestRelativePath: path.relative(session.projectDirectory, session.manifestPath).replaceAll(path.sep, '/'),
    frameCount: frames.length,
    expectedFrameCount: session.expectedFrameCount,
    fps: session.fps,
    frames
  };
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
  return String(value || 'kr8-frame')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kr8-frame';
}
