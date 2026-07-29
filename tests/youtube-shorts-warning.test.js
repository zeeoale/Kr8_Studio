import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getYouTubeShortsWarning,
  isNineSixteenVideo,
  YOUTUBE_SHORTS_MAX_DURATION_SECONDS
} from '../src/editor/public/publish/youtube-shorts.js';

test('YouTube Shorts warning recognizes 9:16 media', () => {
  assert.equal(isNineSixteenVideo({ width: 1080, height: 1920 }), true);
  assert.equal(isNineSixteenVideo({ width: 1920, height: 1080 }), false);
});

test('YouTube Shorts warning is hidden through exactly three minutes', () => {
  const media = { width: 1080, height: 1920, duration: YOUTUBE_SHORTS_MAX_DURATION_SECONDS };
  assert.equal(getYouTubeShortsWarning(media), '');
});

test('YouTube Shorts warning appears above three minutes', () => {
  const warning = getYouTubeShortsWarning({ width: 1080, height: 1920, duration: 180.01 });
  assert.match(warning, /regular video/);
  assert.match(warning, /Shorts feed/);
});

test('YouTube Shorts warning ignores long landscape media', () => {
  assert.equal(getYouTubeShortsWarning({ width: 1920, height: 1080, duration: 240 }), '');
});
