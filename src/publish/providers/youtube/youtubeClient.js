import { toYouTubeVideoResource } from './metadata.js';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const VIDEO_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAIL_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

export class YouTubeApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'YouTubeApiError';
    this.code = String(options.code || 'youtube_api_error');
    this.status = Number(options.status || 0);
    this.retryable = options.retryable ?? [408, 429, 500, 502, 503, 504].includes(this.status);
  }
}

export class YouTubeClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('Fetch is unavailable.');
  }

  buildAuthorizationUrl({ redirectUri, state, codeChallenge }) {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  exchangeCode({ code, redirectUri, codeVerifier }) {
    return this.#tokenRequest({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
  }

  refreshToken(refreshToken) {
    return this.#tokenRequest({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
  }

  async revoke(token) {
    const response = await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token })
    });
    if (!response.ok) await throwYouTubeError(response, 'YouTube token revoke failed.');
    return true;
  }

  async getChannelInfo(accessToken) {
    const url = new URL(CHANNELS_URL);
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('mine', 'true');
    const payload = await this.#jsonRequest(url, { headers: bearer(accessToken) }, 'YouTube channel lookup failed.');
    const channel = payload?.items?.[0];
    if (!channel) throw new YouTubeApiError('The Google account has no accessible YouTube channel.', { code: 'channel_not_found' });
    return {
      channelId: String(channel.id || ''),
      displayName: String(channel.snippet?.title || 'YouTube channel'),
      avatarUrl: String(channel.snippet?.thumbnails?.default?.url || channel.snippet?.thumbnails?.medium?.url || '')
    };
  }

  async initializeResumableUpload(accessToken, media, metadata) {
    const url = new URL(VIDEO_UPLOAD_URL);
    url.searchParams.set('uploadType', 'resumable');
    url.searchParams.set('part', 'snippet,status');
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        ...bearer(accessToken),
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(media.sizeBytes),
        'x-upload-content-type': media.contentType
      },
      body: JSON.stringify(toYouTubeVideoResource(metadata))
    });
    if (!response.ok) await throwYouTubeError(response, 'YouTube resumable upload initialization failed.');
    const uploadUrl = String(response.headers.get('location') || '');
    if (!uploadUrl) throw new YouTubeApiError('YouTube did not return a resumable upload URL.', { code: 'missing_upload_url' });
    return { uploadUrl };
  }

  async getVideoStatus(accessToken, videoId) {
    const url = new URL(VIDEOS_URL);
    url.searchParams.set('part', 'snippet,status,processingDetails,contentDetails');
    url.searchParams.set('id', videoId);
    const payload = await this.#jsonRequest(url, { headers: bearer(accessToken) }, 'YouTube video status lookup failed.');
    const video = payload?.items?.[0];
    if (!video) throw new YouTubeApiError('YouTube video status was unavailable.', { code: 'video_not_found' });
    return {
      videoId: String(video.id || videoId),
      title: String(video.snippet?.title || ''),
      channelId: String(video.snippet?.channelId || ''),
      channelTitle: String(video.snippet?.channelTitle || ''),
      privacy: String(video.status?.privacyStatus || ''),
      containsSyntheticMedia: typeof video.status?.containsSyntheticMedia === 'boolean'
        ? video.status.containsSyntheticMedia
        : null,
      uploadStatus: String(video.status?.uploadStatus || ''),
      processingStatus: String(video.processingDetails?.processingStatus || ''),
      processingFailureReason: String(video.processingDetails?.processingFailureReason || ''),
      durationIso: String(video.contentDetails?.duration || ''),
      definition: String(video.contentDetails?.definition || ''),
      dimension: String(video.contentDetails?.dimension || '')
    };
  }

  async updateVideoStatus(accessToken, videoId, metadata) {
    const resource = toYouTubeVideoResource(metadata);
    const currentUrl = new URL(VIDEOS_URL);
    currentUrl.searchParams.set('part', 'status');
    currentUrl.searchParams.set('id', videoId);
    const current = await this.#jsonRequest(currentUrl, { headers: bearer(accessToken) }, 'YouTube video status lookup failed.');
    const currentStatus = current?.items?.[0]?.status || {};
    const status = {};
    for (const key of ['embeddable', 'license', 'privacyStatus', 'publicStatsViewable', 'publishAt', 'selfDeclaredMadeForKids', 'containsSyntheticMedia']) {
      if (Object.hasOwn(currentStatus, key)) status[key] = currentStatus[key];
    }
    Object.assign(status, resource.status);
    const url = new URL(VIDEOS_URL);
    url.searchParams.set('part', 'status');
    return this.#jsonRequest(url, {
      method: 'PUT',
      headers: { ...bearer(accessToken), 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ id: videoId, status })
    }, 'YouTube video disclosure update failed.');
  }

  async setThumbnail(accessToken, videoId, thumbnail) {
    const url = new URL(THUMBNAIL_UPLOAD_URL);
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('uploadType', 'media');
    const response = await this.fetch(url, {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': thumbnail.contentType },
      body: thumbnail.buffer
    });
    if (!response.ok) await throwYouTubeError(response, 'YouTube thumbnail upload failed.');
    return response.json();
  }

  async #tokenRequest(parameters) {
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters)
    });
    if (!response.ok) await throwYouTubeError(response, 'YouTube token request failed.');
    const payload = await response.json();
    if (!payload?.access_token) throw new YouTubeApiError('YouTube token response was incomplete.', { code: 'invalid_token_response' });
    return payload;
  }

  async #jsonRequest(url, init, fallback) {
    const response = await this.fetch(url, init);
    if (!response.ok) await throwYouTubeError(response, fallback);
    return response.json();
  }
}

function bearer(accessToken) {
  return { authorization: `Bearer ${accessToken}` };
}

async function throwYouTubeError(response, fallbackMessage) {
  let payload = null;
  try { payload = await response.json(); } catch {}
  const detail = payload?.error;
  const oauthCode = typeof detail === 'string' ? detail : '';
  const oauthDescription = String(payload?.error_description || '').trim();
  const reason = detail?.errors?.[0]?.reason || detail?.status || '';
  throw new YouTubeApiError(oauthDescription || detail?.message || fallbackMessage, {
    code: oauthCode || reason || `http_${response.status}`,
    status: response.status
  });
}
