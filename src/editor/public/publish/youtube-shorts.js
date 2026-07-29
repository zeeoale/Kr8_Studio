export const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;

const NINE_SIXTEEN_RATIO = 9 / 16;
const ASPECT_RATIO_TOLERANCE = 0.01;

export function isNineSixteenVideo(media = {}) {
  const width = Number(media.width);
  const height = Number(media.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  return Math.abs((width / height) - NINE_SIXTEEN_RATIO) <= ASPECT_RATIO_TOLERANCE;
}

export function getYouTubeShortsWarning(media = {}) {
  const duration = Number(media.duration);
  if (!isNineSixteenVideo(media) || !Number.isFinite(duration) || duration <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS) return '';
  return 'This 9:16 video is longer than 3 minutes. YouTube will upload it as a regular video, so it will not enter the Shorts feed.';
}
