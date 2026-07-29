import { createStableId } from '../shared/id.js';
import { createBaseLayer, createDefaultTransform } from '../layers/defaults.js';

export const TK_NOIR_PULSE_PRESET_ID = 'tk-noir-pulse';

export function createTkNoirPulsePreset(context = {}) {
  const duration = Number(context.duration || 180);
  const trackTitle = context.title || 'Untitled Track';
  const artist = context.artist || 'Unknown Artist';
  const coverAssetId = context.coverAssetId || 'asset_cover';

  const layerId = (name) => createStableId(TK_NOIR_PULSE_PRESET_ID, `${context.seed || trackTitle}:${name}`);

  const coverLayerId = layerId('cover');
  const bassBindingId = createStableId(TK_NOIR_PULSE_PRESET_ID, `${context.seed || trackTitle}:cover:bass-scale`);

  return {
    id: TK_NOIR_PULSE_PRESET_ID,
    name: 'TK Noir Pulse',
    version: 1,
    description: 'Minimal dark visualizer foundation with cover pulse and title typography.',
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration,
      backgroundColor: '#05070A',
      pixelAspectRatio: 1
    },
    layers: [
      createBaseLayer({
        id: layerId('background'),
        type: 'shape',
        name: 'Background',
        order: 0,
        start: 0,
        end: duration,
        transform: createDefaultTransform({ x: 960, y: 540, width: 1920, height: 1080 }),
        properties: {
          shape: 'rect',
          fill: '#05070A'
        }
      }),
      createBaseLayer({
        id: coverLayerId,
        type: 'image',
        name: 'Cover',
        order: 10,
        start: 0,
        end: duration,
        transform: createDefaultTransform({ x: 960, y: 500, width: 620, height: 620 }),
        properties: {
          assetId: coverAssetId,
          fit: 'cover',
          radius: 8,
          shadow: {
            color: '#000000',
            blur: 50,
            opacity: 0.45
          }
        },
        audioBindings: [
          {
            id: bassBindingId,
            source: 'bass',
            targetProperty: 'transform.scaleX',
            amount: 0.08,
            min: 1,
            max: 1.08,
            smoothing: 0.35,
            attack: 0.08,
            release: 0.25,
            curve: 'ease-out'
          },
          {
            id: createStableId(TK_NOIR_PULSE_PRESET_ID, `${context.seed || trackTitle}:cover:bass-scale-y`),
            source: 'bass',
            targetProperty: 'transform.scaleY',
            amount: 0.08,
            min: 1,
            max: 1.08,
            smoothing: 0.35,
            attack: 0.08,
            release: 0.25,
            curve: 'ease-out'
          }
        ]
      }),
      createBaseLayer({
        id: layerId('visualizer'),
        type: 'visualizer',
        name: 'Bass Spectrum',
        order: 20,
        start: 0,
        end: duration,
        transform: createDefaultTransform({ x: 960, y: 900, width: 1180, height: 120 }),
        opacity: 0.72,
        blendMode: 'screen',
        properties: {
          visualizerType: 'bars',
          source: 'frequencyBins',
          color: '#EDEDED',
          accentColor: '#B50F1D',
          bars: 64,
          minFrequency: 40,
          maxFrequency: 16000,
          gain: 1,
          sensitivity: 1.08,
          floor: 0.04,
          highFrequencyBoost: 0.75,
          placeholder: true
        }
      }),
      createBaseLayer({
        id: layerId('song-title'),
        type: 'text',
        name: 'Song Title',
        order: 30,
        start: 0,
        end: duration,
        transform: createDefaultTransform({ x: 960, y: 125, width: 1500, height: 120 }),
        properties: {
          text: trackTitle,
          fontFamily: 'Montserrat SemiBold',
          fontSize: 68,
          color: '#F5F0EA',
          align: 'center',
          letterSpacing: 0,
          typography: {
            version: 1,
            fontFamily: 'Montserrat SemiBold',
            fontSize: 68,
            fontWeight: 600,
            fontStyle: 'normal',
            lineHeight: 1,
            letterSpacing: 0,
            wordSpacing: 0,
            align: 'center',
            verticalAlign: 'middle',
            textTransform: 'none',
            color: '#F5F0EA',
            textOpacity: 1,
            autoWrap: false,
            boxMode: 'fixed-box',
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            rotation: 0,
            stretchX: 1,
            stretchY: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            offsetX: 0,
            offsetY: 0
          }
        }
      }),
      createBaseLayer({
        id: layerId('artist'),
        type: 'text',
        name: 'Artist',
        order: 40,
        start: 0,
        end: duration,
        transform: createDefaultTransform({ x: 960, y: 175, width: 1200, height: 80 }),
        opacity: 0.78,
        properties: {
          text: artist,
          fontFamily: 'Montserrat Medium',
          fontSize: 34,
          color: '#FAFAFA',
          align: 'center',
          letterSpacing: 0,
          typography: {
            version: 1,
            fontFamily: 'Montserrat Medium',
            fontSize: 34,
            fontWeight: 500,
            fontStyle: 'normal',
            lineHeight: 1,
            letterSpacing: 0,
            wordSpacing: 0,
            align: 'center',
            verticalAlign: 'middle',
            textTransform: 'none',
            color: '#FAFAFA',
            textOpacity: 1,
            autoWrap: false,
            boxMode: 'fixed-box',
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            rotation: 0,
            stretchX: 1,
            stretchY: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            offsetX: 0,
            offsetY: 0
          }
        }
      })
    ],
    scenes: [
      {
        id: createStableId(TK_NOIR_PULSE_PRESET_ID, `${context.seed || trackTitle}:scene:main`),
        name: 'Main',
        start: 0,
        end: duration,
        overrides: []
      }
    ],
    metadata: {
      outputTargets: ['16:9'],
      source: 'Kr8 foundation preset'
    }
  };
}
