import { createTkNoirPulsePreset, TK_NOIR_PULSE_PRESET_ID } from '../presets/tk-noir-pulse.js';
import { createStableId } from '../shared/id.js';
import { applyCompositionFormat } from '../editor/public/composition-formats.js';

export function createProjectFoundationFromAudio(options = {}) {
  const title = String(options.title || 'Untitled Track').trim() || 'Untitled Track';
  const artist = String(options.artist || '').trim();
  const duration = Math.max(0.1, Number(options.duration || 180));
  const seed = String(options.seed || `${title}:${artist}`);
  const now = new Date().toISOString();
  const coverAssetId = createStableId('asset', `${seed}:missing-cover`);
  const preset = createTkNoirPulsePreset({
    seed,
    title,
    artist,
    duration,
    coverAssetId
  });
  const project = {
    schemaVersion: 1,
    id: createStableId('project', `local-files:${seed}`),
    name: `${title} - Kr8`,
    createdAt: now,
    updatedAt: now,
    source: {
      provider: 'local-files',
      sourceId: seed,
      sourceRoot: 'assets/audio'
    },
    composition: preset.composition,
    assets: [{
      id: coverAssetId,
      type: 'image',
      role: 'cover',
      path: 'missing/cover',
      missing: true
    }],
    layers: preset.layers,
    scenes: preset.scenes,
    presets: [TK_NOIR_PULSE_PRESET_ID],
    migrations: [],
    metadata: {
      title,
      artist,
      sourceProvider: 'local-files',
      sourceProviderName: 'Local Files',
      importedAt: now,
      warnings: ['Cover asset not provided.', 'Lyrics asset not provided.']
    }
  };
  return applyCompositionFormat(project, options.formatId || 'landscape-1080p');
}
