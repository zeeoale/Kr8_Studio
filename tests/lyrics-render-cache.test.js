import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLyricsRenderCacheKey,
  calculateLyricsEffectPadding,
  createLyricsRenderCache
} from '../src/editor/public/lyrics-render-cache.js';

test('lyrics render cache reuses one bitmap until cue or appearance changes', () => {
  const cache = createLyricsRenderCache();
  let renders = 0;
  const base = {
    text: 'A cached lyric',
    width: 1200,
    height: 180,
    properties: { fontFamily: 'Arial', fontSize: 60, strokeWidth: 3 },
    glow: { color: '#ff0000', blur: 18, intensity: 1 },
    shadow: { color: '#000000', blur: 0, offsetX: 0, offsetY: 0 }
  };
  const key = buildLyricsRenderCacheKey(base);
  const render = () => ({ bitmap: ++renders });

  assert.equal(cache.getOrCreate('lyrics', key, render).bitmap, 1);
  assert.equal(cache.getOrCreate('lyrics', key, render).bitmap, 1);
  assert.equal(renders, 1);

  const nextKey = buildLyricsRenderCacheKey({ ...base, text: 'The next cue' });
  assert.equal(cache.getOrCreate('lyrics', nextKey, render).bitmap, 2);
  assert.deepEqual(cache.stats(), { size: 1, hits: 1, misses: 2 });
});

test('lyrics render cache key excludes dynamic opacity and transition timing', () => {
  const base = {
    text: 'Fade me',
    width: 800,
    height: 120,
    properties: {
      fontFamily: 'Georgia',
      fontSize: 48,
      color: '#ffffff',
      transition: { type: 'fade', fadeIn: 0.1 }
    }
  };
  const first = buildLyricsRenderCacheKey(base);
  const second = buildLyricsRenderCacheKey({
    ...base,
    opacity: 0.2,
    properties: { ...base.properties, transition: { type: 'fade', fadeIn: 0.8 } }
  });

  assert.equal(first, second);
});

test('lyrics effect padding preserves glow and offset shadow overflow', () => {
  const padding = calculateLyricsEffectPadding({
    strokeWidth: 5,
    glow: { blur: 18, intensity: 0.65 },
    shadow: { blur: 8, offsetX: -4, offsetY: 12 }
  });

  assert.ok(padding >= 43);
});

test('lyrics render cache evicts old layers without growing indefinitely', () => {
  const cache = createLyricsRenderCache({ maxLayers: 2 });
  cache.getOrCreate('one', 'a', () => 1);
  cache.getOrCreate('two', 'b', () => 2);
  cache.getOrCreate('three', 'c', () => 3);

  assert.equal(cache.stats().size, 2);
  assert.equal(cache.getOrCreate('one', 'a', () => 4), 4);
});
