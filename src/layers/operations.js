import { createRandomId } from '../shared/id.js';

export function sortLayersForRender(layers) {
  return [...(layers || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function normalizeLayerOrder(layers) {
  return [...(layers || [])].map((layer, index) => ({
    ...layer,
    order: index * 10
  }));
}

export function updateLayer(project, layerId, updater) {
  return {
    ...project,
    layers: project.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const nextLayer = typeof updater === 'function' ? updater(structuredClone(layer)) : { ...layer, ...updater };
      return nextLayer;
    })
  };
}

export function toggleLayerVisibility(project, layerId) {
  return updateLayer(project, layerId, (layer) => ({
    ...layer,
    visible: !layer.visible
  }));
}

export function toggleLayerLock(project, layerId) {
  return updateLayer(project, layerId, (layer) => ({
    ...layer,
    locked: !layer.locked
  }));
}

export function renameLayer(project, layerId, name) {
  const nextName = String(name || '').trim();
  if (!nextName) return project;
  return updateLayer(project, layerId, { name: nextName });
}

export function reorderLayer(project, layerId, direction) {
  const sorted = normalizeLayerOrder(project.layers);
  const index = sorted.findIndex((layer) => layer.id === layerId);
  if (index < 0) return project;

  const targetIndex = index + Number(direction || 0);
  if (targetIndex < 0 || targetIndex >= sorted.length) return project;

  const next = [...sorted];
  const [layer] = next.splice(index, 1);
  next.splice(targetIndex, 0, layer);

  return {
    ...project,
    layers: normalizeLayerOrder(next)
  };
}

export function addLayer(project, layer) {
  if (!layer || typeof layer !== 'object') return { project, addedLayerId: '' };
  const sorted = normalizeLayerOrder(project.layers);
  const nextLayer = structuredClone(layer);
  const maxOrder = sorted.reduce((max, item) => Math.max(max, Number(item.order || 0)), -10);
  nextLayer.order = Number.isFinite(Number(nextLayer.order)) ? Number(nextLayer.order) : maxOrder + 10;

  return {
    project: {
      ...project,
      layers: normalizeLayerOrder([...sorted, nextLayer])
    },
    addedLayerId: nextLayer.id
  };
}

export function duplicateLayer(project, layerId) {
  const sorted = normalizeLayerOrder(project.layers);
  const index = sorted.findIndex((layer) => layer.id === layerId);
  if (index < 0) return { project, duplicatedLayerId: '' };

  const source = sorted[index];
  const duplicate = structuredClone(source);
  duplicate.id = createRandomId('layer');
  duplicate.name = `${source.name} Copy`;
  duplicate.locked = false;
  duplicate.audioBindings = (duplicate.audioBindings || []).map((binding) => ({
    ...binding,
    id: createRandomId('binding')
  }));
  duplicate.effects = (duplicate.effects || []).map((effect) => ({
    ...effect,
    id: createRandomId('effect')
  }));
  duplicate.animations = (duplicate.animations || []).map((animation) => ({
    ...animation,
    id: createRandomId('animation')
  }));

  const next = [...sorted];
  next.splice(index + 1, 0, duplicate);

  return {
    project: {
      ...project,
      layers: normalizeLayerOrder(next)
    },
    duplicatedLayerId: duplicate.id
  };
}

export function deleteLayer(project, layerId) {
  return {
    ...project,
    layers: normalizeLayerOrder(project.layers.filter((layer) => layer.id !== layerId))
  };
}
