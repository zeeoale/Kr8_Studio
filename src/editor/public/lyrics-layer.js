export function createLyricsOverlayLayer(options = {}) {
  const composition = options.composition || {};
  const width = Number(composition.width || 1920);
  const height = Number(composition.height || 1080);

  return {
    id: options.id || createBrowserId('layer'),
    type: 'lyrics',
    name: options.name || 'Lyrics Overlay',
    visible: true,
    locked: false,
    order: Number(options.order ?? 50),
    start: 0,
    end: Number(options.end ?? composition.duration ?? 180),
    transform: {
      x: width / 2,
      y: Math.round(height * 0.78),
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      width: Math.round(width * 0.78),
      height: Math.round(height * 0.16)
    },
    opacity: 1,
    blendMode: 'normal',
    properties: {
      styleId: 'noir-card',
      source: 'currentCue',
      fontFamily: 'Montserrat SemiBold',
      fontSize: 54,
      color: '#F5F0EA',
      align: 'center',
      lineHeight: 1.18,
      maxLines: 2,
      backgroundColor: '#05070A',
      backgroundOpacity: 0.55,
      padding: 28,
      radius: 10,
      strokeColor: '#000000',
      strokeWidth: 5,
      glowColor: '#000000',
      glowBlur: 18,
      glowIntensity: 0.65,
      shadowColor: '#000000',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      transition: {
        type: 'fade',
        enabled: true,
        fadeIn: 0.14,
        fadeOut: 0.18
      }
    },
    effects: [],
    audioBindings: [],
    animations: []
  };
}

function createBrowserId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
