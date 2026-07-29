import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { saveProject } from '../project/io.js';
import { assertValidProject } from '../project/schema.js';
import { createTkNoirPulsePreset, TK_NOIR_PULSE_PRESET_ID } from '../presets/tk-noir-pulse.js';
import { createStableId } from '../shared/id.js';
import { relativeAssetPath, toPosixPath } from '../shared/path.js';

const ASSET_INPUTS = [
  { key: 'metadata', type: 'json', role: 'metadata' },
  { key: 'audio', type: 'audio', role: 'song' },
  { key: 'cover', type: 'image', role: 'cover' },
  { key: 'lyrics', type: 'lyrics', role: 'lyrics' },
  { key: 'subtitles', type: 'subtitle', role: 'subtitle' }
];

export async function importResolvedSource(provider, options = {}) {
  const resolved = await provider.resolve(options);
  const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), 'examples', `${safeSlug(resolved.title)}.kr8`));
  const copyAssets = Boolean(options.copyAssets);
  const warnings = [...(resolved.warnings || [])];
  const projectAssets = await buildAssets({
    outputDir,
    sourceId: resolved.sourceId || resolved.title,
    assets: resolved.assets || {},
    copyAssets,
    warnings
  });

  const coverAsset = projectAssets.find((asset) => asset.role === 'cover');
  const preset = createTkNoirPulsePreset({
    seed: resolved.sourceId || resolved.title,
    title: resolved.title,
    artist: resolved.artist,
    duration: resolved.duration,
    coverAssetId: coverAsset?.id || ''
  });

  const now = new Date().toISOString();
  const project = {
    schemaVersion: 1,
    id: createStableId('project', `${resolved.providerId}:${resolved.sourceId || resolved.title}`),
    name: `${resolved.title} - Kr8`,
    createdAt: now,
    updatedAt: now,
    source: buildProjectSource(outputDir, resolved),
    composition: preset.composition,
    assets: projectAssets,
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [TK_NOIR_PULSE_PRESET_ID],
    migrations: [],
    metadata: {
      title: resolved.title,
      artist: resolved.artist,
      sourceProvider: resolved.providerId,
      sourceProviderName: resolved.providerName || resolved.providerId,
      importedAt: now,
      warnings
    }
  };

  assertValidProject(project);
  const projectPath = await saveProject(outputDir, project);

  return {
    status: 'created',
    providerId: resolved.providerId,
    projectDir: outputDir,
    projectPath,
    copyAssets,
    warnings,
    project
  };
}

async function buildAssets({ outputDir, sourceId, assets, copyAssets, warnings }) {
  const outputAssets = [];
  const assetsDir = path.join(outputDir, 'assets');

  if (copyAssets) {
    await mkdir(assetsDir, { recursive: true });
  }

  for (const input of ASSET_INPUTS) {
    const source = assets[input.key] || '';
    const id = createStableId('asset', `${sourceId}:${input.key}`);

    if (!source) {
      outputAssets.push({
        id,
        type: input.type,
        role: input.role,
        path: `missing/${input.key}`,
        missing: true
      });
      continue;
    }

    let assetPath;
    if (copyAssets) {
      const targetName = `${input.key}${path.extname(source) || '.dat'}`;
      const targetPath = path.join(assetsDir, targetName);
      await copyFile(source, targetPath);
      assetPath = relativeAssetPath(outputDir, targetPath);
    } else {
      assetPath = relativeAssetPath(outputDir, source);
    }

    outputAssets.push({
      id,
      type: input.type,
      role: input.role,
      path: assetPath,
      originalPath: toPosixPath(path.relative(outputDir, source)),
      missing: false,
      metadata: input.key === 'audio' ? { preferred: true } : undefined
    });
  }

  if (copyAssets && warnings.length > 0) {
    warnings.push('Project created with copied available assets; missing assets were recorded as placeholders.');
  }

  return outputAssets;
}

function buildProjectSource(outputDir, resolved) {
  const source = {
    provider: resolved.providerId,
    sourceId: resolved.sourceId || '',
    sourceRoot: resolved.sourceRoot ? relativeAssetPath(outputDir, resolved.sourceRoot) : ''
  };

  if (resolved.providerId === 'tkmusic') {
    source.trackId = resolved.sourceId || '';
    source.trackDir = resolved.providerMetadata?.trackDir
      ? relativeAssetPath(outputDir, resolved.providerMetadata.trackDir)
      : source.sourceRoot;
    source.metadataPath = resolved.providerMetadata?.metadataPath
      ? relativeAssetPath(outputDir, resolved.providerMetadata.metadataPath)
      : '';
  }

  return source;
}

function safeSlug(value) {
  return String(value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}
