export const SCENE_VISUALIZER_PRESETS = [
  {
    id: 'intro',
    match: ['intro'],
    properties: {
      gain: 0.62,
      sensitivity: 1.32,
      lowFrequencyDamping: 0.62,
      midFrequencyDamping: 0.32,
      noiseGate: 0.055,
      shadowLength: 0.18
    }
  },
  {
    id: 'verse',
    match: ['verse'],
    properties: {
      gain: 0.72,
      sensitivity: 1.28,
      lowFrequencyDamping: 0.58,
      midFrequencyDamping: 0.3,
      noiseGate: 0.045,
      shadowLength: 0.24
    }
  },
  {
    id: 'chorus',
    match: ['chorus', 'hook'],
    properties: {
      gain: 0.92,
      sensitivity: 1.12,
      lowFrequencyDamping: 0.44,
      midFrequencyDamping: 0.2,
      noiseGate: 0.032,
      shadowLength: 0.36
    }
  },
  {
    id: 'bridge',
    match: ['bridge', 'solo', 'instrumental'],
    properties: {
      gain: 0.82,
      sensitivity: 1.18,
      lowFrequencyDamping: 0.5,
      midFrequencyDamping: 0.22,
      noiseGate: 0.038,
      rotationSpeed: 0.01,
      shadowLength: 0.3
    }
  },
  {
    id: 'outro',
    match: ['outro'],
    properties: {
      gain: 0.58,
      sensitivity: 1.36,
      lowFrequencyDamping: 0.64,
      midFrequencyDamping: 0.34,
      noiseGate: 0.06,
      shadowLength: 0.14
    }
  }
];

export function ensureProjectSceneVisualizerPresets(project) {
  const existing = Array.isArray(project?.metadata?.sceneVisualizerPresets)
    ? project.metadata.sceneVisualizerPresets
    : [];
  const byId = new Map(existing.map((preset) => [preset.id, preset]));
  for (const preset of SCENE_VISUALIZER_PRESETS) {
    if (!byId.has(preset.id)) byId.set(preset.id, structuredClone(preset));
  }
  return {
    ...project,
    metadata: {
      ...(project.metadata || {}),
      sceneVisualizerPresets: [...byId.values()]
    }
  };
}

export function applySceneVisualizerPreset(project, scene) {
  if (!project || !scene) return project;
  const preset = findSceneVisualizerPreset(project, scene.name);
  if (!preset) return project;

  return {
    ...project,
    layers: (project.layers || []).map((layer) => {
      if (layer.type !== 'visualizer') return layer;
      if (layer.properties?.sceneVisualizerEnabled !== true) return layer;
      return {
        ...layer,
        properties: {
          ...(layer.properties || {}),
          sceneVisualizerPresetId: preset.id,
          ...(preset.properties || {})
        }
      };
    })
  };
}

export function findSceneVisualizerPreset(project, sceneName) {
  const presets = Array.isArray(project?.metadata?.sceneVisualizerPresets)
    ? project.metadata.sceneVisualizerPresets
    : SCENE_VISUALIZER_PRESETS;
  const normalized = normalize(sceneName);
  return presets.find((preset) => {
    const matches = Array.isArray(preset.match) ? preset.match : [preset.id];
    return matches.some((item) => normalized.includes(normalize(item)));
  }) || null;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
