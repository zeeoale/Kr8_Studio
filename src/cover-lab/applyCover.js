import { createRandomId } from '../shared/id.js';
import { normalizeLayerOrder } from '../layers/operations.js';

export function applyCoverAssetToProject(project, asset, coverLabSettings = {}) {
  const layers = [...(project.layers || [])];
  let coverLayerIndex = layers.findIndex((layer) => String(layer.name || '').trim().toLowerCase() === 'cover');
  if (coverLayerIndex < 0) {
    coverLayerIndex = layers.findIndex((layer) => layer.type === 'image' && layer.properties?.assetId);
  }
  let coverLayer;
  if (coverLayerIndex >= 0) {
    const current = layers[coverLayerIndex];
    coverLayer = {
      ...current,
      type: 'image',
      name: 'Cover',
      properties: {
        ...(current.properties || {}),
        assetId: asset.id,
        fit: current.properties?.fit || 'cover'
      }
    };
    layers[coverLayerIndex] = coverLayer;
  } else {
    const composition = project.composition || {};
    coverLayer = {
      id: createRandomId('layer'),
      type: 'image',
      name: 'Cover',
      visible: true,
      locked: false,
      parentId: undefined,
      order: Math.max(0, ...(layers.map((layer) => Number(layer.order || 0)))) + 10,
      start: 0,
      end: Number(composition.duration || 0),
      transform: {
        x: Number(composition.width || 1920) / 2,
        y: Number(composition.height || 1080) / 2,
        width: Number(composition.width || 1920),
        height: Number(composition.height || 1080),
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5
      },
      opacity: 1,
      blendMode: 'normal',
      properties: { assetId: asset.id, fit: 'cover', radius: 0 },
      effects: [],
      audioBindings: [],
      animations: []
    };
    layers.push(coverLayer);
  }
  return {
    project: {
      ...project,
      layers: normalizeLayerOrder(layers),
      metadata: {
        ...(project.metadata || {}),
        coverLab: {
          ...coverLabSettings,
          version: 1,
          selectedAssetId: asset.id
        }
      }
    },
    layer: coverLayer
  };
}
