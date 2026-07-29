export type Kr8SchemaVersion = 1;

export type Kr8LayerType =
  | "audio"
  | "image"
  | "video"
  | "text"
  | "lyrics"
  | "visualizer"
  | "waveform"
  | "particle"
  | "shader"
  | "shape"
  | "adjustment"
  | "camera"
  | "group";

export type Kr8BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "color-dodge"
  | "color-burn"
  | "difference"
  | "exclusion"
  | "add"
  | "subtract";

export interface Kr8Composition {
  width: number;
  height: number;
  fps: 24 | 25 | 30 | 50 | 60;
  duration: number;
  backgroundColor: string;
  pixelAspectRatio: number;
}

export interface Kr8Asset {
  id: string;
  type: "audio" | "image" | "video" | "lyrics" | "subtitle" | "font" | "json";
  role?: "song" | "cover" | "coverVideo" | "lyrics" | "subtitle" | "metadata" | "logo" | "background" | "texture";
  path: string;
  originalPath?: string;
  mimeType?: string;
  missing?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Kr8Transform {
  x: number;
  y: number;
  width?: number;
  height?: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface Kr8EffectRef {
  id: string;
  type: string;
  enabled: boolean;
  properties: Record<string, unknown>;
}

export interface Kr8AnimationKeyframe {
  time: number;
  value: unknown;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | string;
}

export interface Kr8AnimationTrack {
  id: string;
  targetProperty: string;
  enabled: boolean;
  keyframes: Kr8AnimationKeyframe[];
}

export interface Kr8TypographySettings {
  version: 1;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  textTransform: "none" | "uppercase" | "lowercase";
  color: string;
  textOpacity: number;
  maxWidth?: number;
  autoWrap: boolean;
  boxMode: "auto-size" | "fixed-box";
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  rotation: number;
  stretchX: number;
  stretchY: number;
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
}

export interface Kr8TextLineOverride {
  id: string;
  textSnapshot: string;
  offsetX: number;
  offsetY: number;
  fontSize?: number;
  letterSpacing?: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export interface Kr8TextLineEditing {
  enabled: boolean;
  lines: Kr8TextLineOverride[];
}

export interface Kr8TextEffects {
  stroke: {
    enabled: boolean;
    color: string;
    width: number;
    opacity: number;
    position: "inside" | "center" | "outside";
  };
  shadow: {
    enabled: boolean;
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
    opacity: number;
  };
  glow: {
    enabled: boolean;
    color: string;
    blur: number;
    intensity: number;
  };
  distressed: {
    enabled: boolean;
    amount: number;
    scale: number;
    seed: number;
    threshold: number;
    inverted: boolean;
  };
  glitch: {
    enabled: boolean;
    amount: number;
    sliceCount: number;
    horizontalDisplacement: number;
    verticalDisplacement: number;
    rgbSplit: boolean;
    seed: number;
    mode: "static" | "animated";
  };
  scanlines: {
    enabled: boolean;
    density: number;
    thickness: number;
    angle: number;
    opacity: number;
    seed: number;
  };
}

export interface Kr8TextTextureMask {
  enabled: boolean;
  assetId: string;
  blendMode: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  invertMask: boolean;
  contrast: number;
  threshold: number;
}

export interface Kr8TextLayerProperties extends Record<string, unknown> {
  text: string;
  typography?: Kr8TypographySettings;
  lineEditing?: Kr8TextLineEditing;
  textEffects?: Kr8TextEffects;
  textureMask?: Kr8TextTextureMask;
  typographyPresetId?: string;
}

export interface Kr8AudioFrame {
  time: number;
  waveform: Float32Array;
  frequencyBins: Float32Array;
  bass: number;
  mids: number;
  highs: number;
  energy: number;
  rms: number;
  transient: number;
  beat: boolean;
  loudness?: number;
}

export interface Kr8AudioBinding {
  id: string;
  source:
    | "bass"
    | "mids"
    | "highs"
    | "energy"
    | "rms"
    | "beat"
    | "transient"
    | "frequencyBins";
  targetProperty: string;
  amount: number;
  min?: number;
  max?: number;
  smoothing?: number;
  attack?: number;
  release?: number;
  invert?: boolean;
  curve?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | string;
}

export interface Kr8Layer {
  id: string;
  type: Kr8LayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  parentId?: string;
  order: number;
  start: number;
  end?: number;
  transform: Kr8Transform;
  opacity: number;
  blendMode: Kr8BlendMode;
  properties: Record<string, unknown>;
  effects: Kr8EffectRef[];
  audioBindings: Kr8AudioBinding[];
  animations: Kr8AnimationTrack[];
}

export interface Kr8SceneOverride {
  layerId: string;
  properties: Record<string, unknown>;
}

export interface Kr8Scene {
  id: string;
  name: string;
  start: number;
  end: number;
  enabledLayerIds?: string[];
  overrides: Kr8SceneOverride[];
  transitionIn?: {
    type: string;
    duration: number;
    properties?: Record<string, unknown>;
  };
  transitionOut?: {
    type: string;
    duration: number;
    properties?: Record<string, unknown>;
  };
}

export interface Kr8Preset {
  id: string;
  name: string;
  version: number;
  description: string;
  composition: Kr8Composition;
  layers: Kr8Layer[];
  scenes: Kr8Scene[];
  metadata?: Record<string, unknown>;
}

export interface Kr8SourceRef {
  provider: string;
  sourceId?: string;
  sourceRoot?: string;
  trackId?: string;
  trackDir?: string;
  metadataPath?: string;
}

export interface Kr8Project {
  schemaVersion: Kr8SchemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source?: Kr8SourceRef;
  composition: Kr8Composition;
  assets: Kr8Asset[];
  layers: Kr8Layer[];
  scenes: Kr8Scene[];
  presets: string[];
  migrations: string[];
  metadata: Record<string, unknown>;
}

export interface Kr8CoverLabState {
  version: 1;
  context: {
    title: string;
    artist: string;
    lyrics: string;
    sunoPrompt: string;
    mood: string;
    visualDirection: string;
  };
  ollama: {
    endpoint: string;
    model: string;
  };
  prompts: {
    positive: string;
    negative: string;
  };
  identity: {
    presetId: "takara" | "none" | "custom";
    preserve: boolean;
    useLora: boolean;
    loraStrength: number;
    notes: string;
    customDna: string;
  };
  generation: {
    ratio: "square" | "portrait" | "vertical" | "landscape" | "tk-wide";
    width: number;
    height: number;
    seed: number;
    randomizeSeed: boolean;
    batchSize: number;
    generateUpscaled: boolean;
  };
  comfy: {
    endpoint: string;
  };
  loras: Array<{
    slot: string;
    enabled: boolean;
    filename: string;
    strength: number;
  }>;
  selectedAssetId: string;
}
