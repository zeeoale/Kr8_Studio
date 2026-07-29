export function createDefaultTransform(overrides = {}) {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    ...overrides
  };
}

export function createBaseLayer(overrides = {}) {
  return {
    id: '',
    type: 'shape',
    name: 'Layer',
    visible: true,
    locked: false,
    parentId: undefined,
    order: 0,
    start: 0,
    end: undefined,
    transform: createDefaultTransform(),
    opacity: 1,
    blendMode: 'normal',
    properties: {},
    effects: [],
    audioBindings: [],
    animations: [],
    ...overrides
  };
}
