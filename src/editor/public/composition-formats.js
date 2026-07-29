export const COMPOSITION_FORMATS = [
  {
    id: 'landscape-1080p',
    name: '16:9 Landscape',
    width: 1920,
    height: 1080,
    outputTarget: '16:9'
  },
  {
    id: 'vertical-1080p',
    name: '9:16 Vertical',
    width: 1080,
    height: 1920,
    outputTarget: '9:16'
  },
  {
    id: 'square-1080p',
    name: '1:1 Square',
    width: 1080,
    height: 1080,
    outputTarget: '1:1'
  }
];

export function findCompositionFormat(formatId) {
  return COMPOSITION_FORMATS.find((format) => format.id === formatId) || COMPOSITION_FORMATS[0];
}

export function getCompositionFormatId(composition = {}) {
  const width = Math.round(Number(composition.width || 0));
  const height = Math.round(Number(composition.height || 0));
  return COMPOSITION_FORMATS.find((format) => format.width === width && format.height === height)?.id || 'custom';
}

export function applyCompositionFormat(project, formatId, options = {}) {
  const format = findCompositionFormat(formatId);
  const composition = project?.composition || {};
  const previousWidth = Math.max(1, Number(composition.width || format.width));
  const previousHeight = Math.max(1, Number(composition.height || format.height));
  const scaleX = format.width / previousWidth;
  const scaleY = format.height / previousHeight;
  const shouldScaleLayers = options.scaleLayers !== false;

  return {
    ...project,
    composition: {
      ...composition,
      width: format.width,
      height: format.height,
      fps: Math.max(1, Math.round(Number(composition.fps || 30))),
      outputTarget: format.outputTarget,
      formatId: format.id
    },
    layers: shouldScaleLayers
      ? (project.layers || []).map((layer) => scaleLayerToComposition(layer, scaleX, scaleY))
      : project.layers || [],
    metadata: {
      ...(project.metadata || {}),
      outputTargets: [format.outputTarget],
      compositionFormatId: format.id
    }
  };
}

function scaleLayerToComposition(layer, scaleX, scaleY) {
  const transform = layer.transform || {};
  const nextTransform = {
    ...transform
  };
  for (const key of ['x', 'width']) {
    if (typeof nextTransform[key] === 'number') nextTransform[key] *= scaleX;
  }
  for (const key of ['y', 'height']) {
    if (typeof nextTransform[key] === 'number') nextTransform[key] *= scaleY;
  }
  return {
    ...layer,
    transform: nextTransform
  };
}
