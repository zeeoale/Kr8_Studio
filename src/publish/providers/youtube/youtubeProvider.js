import { YOUTUBE_REQUIRED_SCOPES } from '../../config.js';
import { createOAuthCallbackServer } from '../../oauthCallback.js';
import { openDefaultBrowser } from '../../openBrowser.js';
import { createOAuthState, createPkcePair, safeErrorMessage } from '../../security.js';
import { normalizeYouTubeMetadata } from './metadata.js';
import { uploadYouTubeResumable } from './resumableUpload.js';
import { YouTubeApiError, YouTubeClient } from './youtubeClient.js';

const ACCESS_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const ACTIVE_STATES = new Set(['preparing', 'initializing', 'uploading', 'retrying', 'processing']);

export class YouTubeProvider {
  constructor(options) {
    this.config = options.config;
    this.tokenStore = options.tokenStore;
    this.client = options.client || new YouTubeClient(options.config, { fetchImpl: options.fetchImpl });
    this.fetchImpl = options.fetchImpl;
    this.callbackFactory = options.callbackFactory || createOAuthCallbackServer;
    this.browserOpener = options.browserOpener || openDefaultBrowser;
    this.clock = options.clock || (() => Date.now());
    this.sleep = options.sleep || delay;
    this.oauthTimeoutMs = Number(options.oauthTimeoutMs || 180_000);
    this.statusPollIntervalMs = Math.max(0, Number(options.statusPollIntervalMs ?? 3000));
    this.statusTimeoutMs = Math.max(1, Number(options.statusTimeoutMs ?? 15 * 60_000));
    this.chunkSizeBytes = Number(options.chunkSizeBytes || 8 * 1024 * 1024);
    this.maxRetries = Number(options.maxRetries ?? 6);
    this.jobs = new Map();
    this.activeCallback = null;
  }

  async getConnectionStatus(options = {}) {
    if (!this.config.configured) return { state: 'not_configured', connected: false, missing: [...this.config.missing] };
    try {
      const token = await this.#getValidToken();
      if (!token) return this.#disconnectedStatus();
      assertYouTubeScope(token.scope);
      let profile = token.profile;
      if (!profile?.channelId || options.refreshProfile) {
        profile = await this.client.getChannelInfo(token.access_token);
        token.profile = profile;
        await this.tokenStore.save(token);
      }
      return this.#connectedStatus(token);
    } catch (error) {
      if (isInvalidCredentialError(error)) await this.tokenStore.clear().catch(() => {});
      return { ...this.#disconnectedStatus(), reason: safeErrorMessage(error, this.#secrets()) };
    }
  }

  async connect(options = {}) {
    if (!this.config.configured) throw new Error(`YouTube configuration is missing: ${this.config.missing.join(', ')}.`);
    if (this.activeCallback) throw new Error('A YouTube login is already in progress.');
    const state = createOAuthState();
    const pkce = createPkcePair();
    const callbackServer = await this.callbackFactory({
      state,
      timeoutMs: this.oauthTimeoutMs,
      callbackPath: '/youtube/callback/',
      providerName: 'YouTube'
    });
    this.activeCallback = callbackServer;
    try {
      const authorizationUrl = this.client.buildAuthorizationUrl({
        redirectUri: callbackServer.redirectUri,
        state,
        codeChallenge: pkce.challenge
      });
      if (typeof options.onAuthorizationUrl === 'function') options.onAuthorizationUrl(authorizationUrl);
      else this.browserOpener(authorizationUrl);
      const callback = await callbackServer.callback;
      let payload;
      try {
        payload = await this.client.exchangeCode({
          code: callback.code,
          redirectUri: callbackServer.redirectUri,
          codeVerifier: pkce.verifier
        });
      } catch (error) {
        throw new Error(`YouTube token exchange failed: ${safeErrorMessage(error, this.#secrets())}`);
      }
      const previous = await this.tokenStore.load().catch(() => null);
      const token = youtubeTokenRecordFromResponse(payload, this.clock(), previous, this.config.scopes);
      assertYouTubeScope(token.scope);
      try {
        token.profile = await this.client.getChannelInfo(token.access_token);
      } catch (error) {
        throw new Error(`YouTube channel lookup failed: ${safeErrorMessage(error, this.#secrets())}`);
      }
      await this.tokenStore.save(token);
      return this.#connectedStatus(token);
    } finally {
      callbackServer.close?.();
      this.activeCallback = null;
    }
  }

  async disconnect() {
    this.activeCallback?.close?.();
    this.activeCallback = null;
    const token = await this.tokenStore.load().catch(() => null);
    if (token?.access_token) await this.client.revoke(token.access_token).catch(() => {});
    await this.tokenStore.clear();
    return this.#disconnectedStatus();
  }

  validateMedia(media) {
    return media;
  }

  startUpload(media, options = {}) {
    if (!media?.valid) throw new Error(media?.errors?.[0] || 'The Reel is not valid for YouTube upload.');
    const metadata = normalizeYouTubeMetadata(options);
    if (!metadata.valid) throw new Error(metadata.errors[0]);
    if ([...this.jobs.values()].some((job) => ACTIVE_STATES.has(job.status))) throw new Error('Another YouTube upload is already running.');
    const id = `youtube_upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const job = {
      id,
      status: 'preparing',
      progress: 0,
      bytesSent: 0,
      totalBytes: media.sizeBytes,
      bytesPerSecond: 0,
      etaSeconds: null,
      retryCount: 0,
      startedAt: new Date(this.clock()).toISOString(),
      completedAt: '',
      error: '',
      warning: '',
      videoId: '',
      videoUrl: '',
      requestedPrivacy: metadata.privacy,
      effectivePrivacy: '',
      containsSyntheticMedia: metadata.containsSyntheticMedia,
      effectiveSyntheticMedia: null,
      processingStatus: '',
      metadata,
      thumbnail: options.thumbnail || null,
      controller: new AbortController(),
      done: null
    };
    this.jobs.set(id, job);
    job.done = this.#runUpload(job, media);
    job.done.catch(() => {});
    return serializeYouTubeJob(job);
  }

  getProgress(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    return job ? serializeYouTubeJob(job) : null;
  }

  cancel(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    if (!job || !ACTIVE_STATES.has(job.status)) return false;
    job.status = 'cancelled';
    job.completedAt = new Date(this.clock()).toISOString();
    job.error = 'YouTube upload cancelled.';
    job.controller.abort();
    return true;
  }

  async #runUpload(job, media) {
    try {
      let token = await this.#getValidToken();
      if (!token) throw new Error('YouTube is not connected.');
      assertYouTubeScope(token.scope);
      job.status = 'initializing';
      const session = await this.client.initializeResumableUpload(token.access_token, media, job.metadata);
      job.status = 'uploading';
      const result = await uploadYouTubeResumable({
        filePath: media.path,
        fileSize: media.sizeBytes,
        contentType: media.contentType,
        uploadUrl: session.uploadUrl,
        chunkSizeBytes: this.chunkSizeBytes,
        maxRetries: this.maxRetries,
        fetchImpl: this.fetchImpl,
        signal: job.controller.signal,
        getAccessToken: async () => {
          token = await this.#getValidToken();
          if (!token) throw new Error('YouTube authorization expired.');
          return token.access_token;
        },
        onProgress: (progress) => {
          if (job.status !== 'cancelled') Object.assign(job, progress, { status: 'uploading' });
        },
        onRetry: ({ retryCount }) => {
          if (job.status !== 'cancelled') Object.assign(job, { status: 'retrying', retryCount });
        }
      });
      if (job.status === 'cancelled') return job;
      job.videoId = String(result.video?.id || '');
      if (!job.videoId) throw new Error('YouTube upload completed without a video ID.');
      job.videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(job.videoId)}`;
      job.progress = 1;
      job.bytesSent = media.sizeBytes;
      token = await this.#getValidToken();
      if (!token) throw new Error('YouTube authorization expired while confirming video metadata.');
      const confirmedStatus = await this.client.updateVideoStatus(token.access_token, job.videoId, job.metadata);
      if (typeof confirmedStatus?.status?.containsSyntheticMedia === 'boolean') {
        job.effectiveSyntheticMedia = confirmedStatus.status.containsSyntheticMedia;
      }
      if (job.thumbnail) {
        try {
          token = await this.#getValidToken();
          await this.client.setThumbnail(token.access_token, job.videoId, job.thumbnail);
        } catch (error) {
          job.warning = `Video uploaded, but thumbnail upload failed: ${safeErrorMessage(error, this.#secrets())}`;
        }
      }
      job.status = 'processing';
      await this.#waitForProcessing(job);
      if (job.status === 'cancelled') return job;
      job.status = 'uploaded';
      job.completedAt = new Date(this.clock()).toISOString();
      return job;
    } catch (error) {
      if (job.status === 'cancelled' || error?.name === 'AbortError' || error?.code === 'cancelled') {
        job.status = 'cancelled';
        job.completedAt ||= new Date(this.clock()).toISOString();
        return job;
      }
      if (isInvalidCredentialError(error)) await this.tokenStore.clear().catch(() => {});
      job.status = 'failed';
      job.completedAt = new Date(this.clock()).toISOString();
      job.error = safeErrorMessage(error, this.#secrets());
      throw error;
    }
  }

  async #waitForProcessing(job) {
    const deadline = this.clock() + this.statusTimeoutMs;
    while (true) {
      if (job.controller.signal.aborted) return;
      const token = await this.#getValidToken();
      if (!token) throw new Error('YouTube authorization expired while checking processing status.');
      const status = await this.client.getVideoStatus(token.access_token, job.videoId);
      job.effectivePrivacy = status.privacy;
      if (typeof status.containsSyntheticMedia === 'boolean') {
        job.effectiveSyntheticMedia = status.containsSyntheticMedia;
      }
      job.processingStatus = status.processingStatus || status.uploadStatus;
      if (status.channelId && (!token.profile?.channelId || token.profile.channelId !== status.channelId)) {
        token.profile = {
          channelId: status.channelId,
          displayName: status.channelTitle || token.profile?.displayName || 'YouTube channel',
          avatarUrl: token.profile?.avatarUrl || ''
        };
        await this.tokenStore.save(token);
      }
      if (status.processingStatus === 'succeeded' || status.uploadStatus === 'processed') return;
      if (['failed', 'terminated', 'rejected', 'deleted'].includes(status.processingStatus) || ['failed', 'rejected', 'deleted'].includes(status.uploadStatus)) {
        throw new Error(status.processingFailureReason ? `YouTube processing failed: ${status.processingFailureReason}.` : 'YouTube processing failed.');
      }
      if (this.clock() >= deadline) {
        job.warning = 'Upload completed. YouTube is still processing the video.';
        return;
      }
      await this.sleep(this.statusPollIntervalMs, job.controller.signal);
    }
  }

  async #getValidToken() {
    const token = await this.tokenStore.load();
    if (!token) return null;
    if (token.expires_at > this.clock() + ACCESS_REFRESH_MARGIN_MS) return token;
    try {
      const payload = await this.client.refreshToken(token.refresh_token);
      const refreshed = youtubeTokenRecordFromResponse(payload, this.clock(), token, this.config.scopes);
      assertYouTubeScope(refreshed.scope);
      await this.tokenStore.save(refreshed);
      return refreshed;
    } catch (error) {
      await this.tokenStore.clear().catch(() => {});
      throw error;
    }
  }

  #connectedStatus(token) {
    return {
      state: 'connected',
      connected: true,
      displayName: token.profile?.displayName || 'YouTube channel',
      avatarUrl: token.profile?.avatarUrl || '',
      channelId: token.profile?.channelId || '',
      scopes: [...token.scope],
      expiresAt: token.expires_at
    };
  }

  #disconnectedStatus() {
    return { state: 'disconnected', connected: false };
  }

  #secrets() {
    return [this.config.clientId, this.config.clientSecret];
  }
}

export function youtubeTokenRecordFromResponse(payload, now = Date.now(), previous = null, fallbackScopes = YOUTUBE_REQUIRED_SCOPES) {
  return {
    access_token: String(payload?.access_token || ''),
    refresh_token: String(payload?.refresh_token || previous?.refresh_token || ''),
    scope: normalizeScopes(payload?.scope || previous?.scope || fallbackScopes),
    expires_at: now + Math.max(0, Number(payload?.expires_in || 0)) * 1000,
    token_type: String(payload?.token_type || previous?.token_type || 'Bearer'),
    profile: previous?.profile || null
  };
}

export function assertYouTubeScope(scopes) {
  const available = new Set(normalizeScopes(scopes));
  const missing = YOUTUBE_REQUIRED_SCOPES.filter((scope) => !available.has(scope));
  if (missing.length) throw Object.assign(new Error(`YouTube authorization is missing required scope: ${missing.join(', ')}.`), { code: 'scope_not_authorized' });
}

function normalizeScopes(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [...new Set(source.map((scope) => String(scope).trim()).filter(Boolean))].sort();
}

function serializeYouTubeJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: Number(job.progress || 0),
    bytesSent: Number(job.bytesSent || 0),
    totalBytes: Number(job.totalBytes || 0),
    bytesPerSecond: Number(job.bytesPerSecond || 0),
    etaSeconds: job.etaSeconds === null ? null : Number(job.etaSeconds),
    retryCount: Number(job.retryCount || 0),
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    warning: job.warning,
    requestedPrivacy: job.requestedPrivacy,
    effectivePrivacy: job.effectivePrivacy,
    containsSyntheticMedia: job.containsSyntheticMedia,
    effectiveSyntheticMedia: job.effectiveSyntheticMedia,
    processingStatus: job.processingStatus,
    videoId: job.status === 'uploaded' ? job.videoId : '',
    videoUrl: job.status === 'uploaded' ? job.videoUrl : ''
  };
}

function isInvalidCredentialError(error) {
  return error instanceof YouTubeApiError && (error.status === 401 || ['invalid_grant', 'invalid_token'].includes(error.code));
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('YouTube upload cancelled.'), { name: 'AbortError', code: 'cancelled' }));
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}
