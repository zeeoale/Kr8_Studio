const REEL_RECOMMENDATION_SECONDS = 210;
const REEL_MAX_SECONDS = 900;
const STORY_MAX_SECONDS = 60;
const INSTAGRAM_MAX_BYTES = 1_000_000_000;
const INSTAGRAM_EXTENSIONS = new Set(['.mp4']);
const INSTAGRAM_VIDEO_CODECS = new Set(['h264', 'hevc']);

export const LONG_REEL_WARNING = 'This Reel exceeds 3 minutes and 30 seconds. Instagram may upload it successfully but exclude it from recommendations to new audiences.';
export const STORY_DURATION_ERROR = 'This video exceeds the 60-second Story limit. Export a dedicated Story cut from Reel Mode before publishing.';

export function validateInstagramMedia(media, options = {}) {
  const destination = normalizeInstagramDestination(options.destination);
  const errors = [...(media?.errors || [])];
  const warnings = [];
  if (!INSTAGRAM_EXTENSIONS.has(String(media?.extension || '').toLowerCase())) errors.push('Kr8 Instagram publishing requires an MP4 file.');
  if (!INSTAGRAM_VIDEO_CODECS.has(String(media?.videoCodec || '').toLowerCase())) errors.push('Instagram requires H.264 or HEVC video.');
  if (media?.hasAudio && String(media?.audioCodec || '').toLowerCase() !== 'aac') errors.push('Instagram requires AAC audio when an audio track is present.');
  if (!(Number(media?.fps) >= 23 && Number(media?.fps) <= 60)) errors.push('Instagram requires a frame rate between 23 and 60 fps.');
  if (!(Number(media?.width) > 0 && Number(media?.height) > 0 && Math.max(Number(media.width), Number(media.height)) <= 4096)) errors.push('Instagram video dimensions are unsupported.');
  if (Number(media?.sizeBytes || 0) > INSTAGRAM_MAX_BYTES) errors.push('Instagram video size exceeds the 1 GB API limit.');
  const duration = Number(media?.duration || 0);
  if (destination === 'story') {
    if (duration > STORY_MAX_SECONDS) errors.push(STORY_DURATION_ERROR);
  } else {
    if (duration < 3 || duration > REEL_MAX_SECONDS) errors.push('Instagram Reels must be between 3 seconds and 15 minutes.');
    if (duration > REEL_RECOMMENDATION_SECONDS) warnings.push(LONG_REEL_WARNING);
  }
  return { ...media, destination, warnings, valid: errors.length === 0, errors };
}

export function normalizeInstagramDestination(value) {
  return String(value || 'reel').toLowerCase() === 'story' ? 'story' : 'reel';
}

export function normalizeInstagramOptions(value = {}) {
  const destination = normalizeInstagramDestination(value.destination);
  const caption = destination === 'reel' ? String(value.caption || '').trim().slice(0, 2200) : '';
  return {
    destination,
    caption,
    shareToFeed: destination === 'reel' && value.shareToFeed !== false,
    publishAnyway: value.publishAnyway === true
  };
}
