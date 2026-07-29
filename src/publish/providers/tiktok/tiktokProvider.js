import { TIKTOK_REQUIRED_SCOPES } from '../../config.js';
import { createChunkPlan, uploadFileInChunks } from '../../chunks.js';
import { createOAuthCallbackServer } from '../../oauthCallback.js';
import { openDefaultBrowser } from '../../openBrowser.js';
import { createOAuthState, safeErrorMessage } from '../../security.js';
import { TikTokApiError, TikTokClient } from './tiktokClient.js';
import { createTikTokPkcePair } from './pkce.js';

const ACCESS_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STATUS_TIMEOUT_MS = 120_000;

export class TikTokProvider {
  constructor(options) {
    this.config = options.config;
    this.tokenStore = options.tokenStore;
    this.client = options.client || new TikTokClient(options.config, { fetchImpl: options.fetchImpl });
    this.callbackFactory = options.callbackFactory || createOAuthCallbackServer;
    this.browserOpener = options.browserOpener || openDefaultBrowser;
    this.clock = options.clock || (() => Date.now());
    this.oauthTimeoutMs = Number(options.oauthTimeoutMs || 180_000);
    this.chunkSizeBytes = Number(options.chunkSizeBytes || 0) || undefined;
    this.fetchImpl = options.fetchImpl;
    this.statusPollIntervalMs = Math.max(0, Number(options.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS));
    this.statusTimeoutMs = Math.max(1, Number(options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS));
    this.sleep = options.sleep || delay;
    this.jobs = new Map();
    this.activeCallback = null;
  }

  async getConnectionStatus(options = {}) {
    if (!this.config.configured) {
      return { state: 'not_configured', connected: false, environment: this.config.environment, missing: [...this.config.missing] };
    }
    try {
      const token = await this.#getValidToken();
      if (!token) return this.#disconnectedStatus();
      assertRequiredScopes(token.scope);
      let profile = token.profile;
      if (!profile || options.refreshProfile) {
        const user = await this.client.getUserInfo(token.access_token);
        profile = { displayName: user.displayName, avatarUrl: user.avatarUrl };
        token.profile = profile;
        await this.tokenStore.save(token);
      }
      return {
        state: 'connected',
        connected: true,
        environment: this.config.environment,
        displayName: profile?.displayName || 'TikTok account',
        avatarUrl: profile?.avatarUrl || '',
        scopes: [...token.scope],
        expiresAt: token.expires_at
      };
    } catch (error) {
      await this.tokenStore.clear().catch(() => {});
      return { ...this.#disconnectedStatus(), reason: safeErrorMessage(error, this.#secrets()) };
    }
  }

  async connect(options = {}) {
    if (!this.config.configured) throw new Error(`TikTok configuration is missing: ${this.config.missing.join(', ')}.`);
    if (this.activeCallback) throw new Error('A TikTok login is already in progress.');
    const state = createOAuthState();
    const pkce = createTikTokPkcePair();
    const callbackServer = await this.callbackFactory({ state, timeoutMs: this.oauthTimeoutMs });
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
      const payload = await this.client.exchangeCode({
        code: callback.code,
        redirectUri: callbackServer.redirectUri,
        codeVerifier: pkce.verifier
      });
      const token = tokenRecordFromResponse(payload, this.clock());
      assertRequiredScopes(token.scope);
      const user = await this.client.getUserInfo(token.access_token);
      if (user.openId && user.openId !== token.open_id) throw new Error('TikTok account identity did not match the token.');
      token.profile = { displayName: user.displayName, avatarUrl: user.avatarUrl };
      await this.tokenStore.save(token);
      return {
        state: 'connected',
        connected: true,
        environment: this.config.environment,
        displayName: token.profile.displayName || 'TikTok account',
        avatarUrl: token.profile.avatarUrl || '',
        scopes: [...token.scope],
        expiresAt: token.expires_at
      };
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
    const errors = [...(media?.errors || [])];
    if (!(media?.width >= 360 && media?.width <= 4096 && media?.height >= 360 && media?.height <= 4096)) errors.push('Video dimensions must be between 360 and 4096 pixels per side.');
    if (!(media?.fps >= 23 && media?.fps <= 60)) errors.push('Video frame rate must be between 23 and 60 fps.');
    if (!(media?.duration > 0 && media?.duration <= 600)) errors.push('Video duration must be greater than zero and no longer than 10 minutes.');
    if (Number(media?.sizeBytes || 0) > 4_000_000_000) errors.push('Video size exceeds the TikTok 4 GB limit.');
    return { ...media, valid: errors.length === 0, errors };
  }

  startUpload(media, options = {}) {
    if (!media?.valid) throw new Error(media?.errors?.[0] || 'The Reel is not valid for TikTok upload.');
    if ([...this.jobs.values()].some((job) => ['preparing', 'initializing', 'uploading', 'retrying', 'processing'].includes(job.status))) {
      throw new Error('Another TikTok upload is already running.');
    }
    const id = `tiktok_upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
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
      publishId: '',
      tikTokStatus: '',
      caption: String(options.caption || '').slice(0, 2200),
      controller,
      done: null
    };
    this.jobs.set(id, job);
    job.done = this.#runUpload(job, media);
    job.done.catch(() => {});
    return serializeUploadJob(job);
  }

  getProgress(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    return job ? serializeUploadJob(job) : null;
  }

  cancel(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    if (!job || !['preparing', 'initializing', 'uploading', 'retrying', 'processing'].includes(job.status)) return false;
    job.status = 'cancelled';
    job.completedAt = new Date(this.clock()).toISOString();
    job.error = 'TikTok upload cancelled.';
    job.controller.abort();
    return true;
  }

  async #runUpload(job, media) {
    try {
      const token = await this.#getValidToken();
      if (!token) throw new Error('TikTok is not connected.');
      assertRequiredScopes(token.scope);
      const plan = createChunkPlan(media.sizeBytes, this.chunkSizeBytes);
      job.status = 'initializing';
      const initialized = await this.client.initializeUpload(token.access_token, {
        video_size: plan.fileSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount
      });
      job.publishId = initialized.publishId;
      job.status = 'uploading';
      const result = await uploadFileInChunks({
        filePath: media.path,
        fileSize: media.sizeBytes,
        contentType: media.contentType,
        uploadUrl: initialized.uploadUrl,
        plan,
        fetchImpl: this.fetchImpl,
        signal: job.controller.signal,
        onProgress: (progress) => {
          if (job.status === 'cancelled') return;
          Object.assign(job, progress);
        }
      });
      if (job.status === 'cancelled') return job;
      Object.assign(job, result);
      job.status = 'processing';
      await this.#waitForInboxDelivery(token.access_token, job);
      if (job.status === 'cancelled') return job;
      job.status = 'uploaded';
      job.progress = 1;
      job.completedAt = new Date(this.clock()).toISOString();
      return job;
    } catch (error) {
      if (job.status === 'cancelled' || error?.code === 'cancelled' || error?.name === 'AbortError') {
        job.status = 'cancelled';
        job.completedAt ||= new Date(this.clock()).toISOString();
        return job;
      }
      if (error instanceof TikTokApiError && error.code === 'access_token_invalid') {
        await this.tokenStore.clear().catch(() => {});
      }
      job.status = 'failed';
      job.completedAt = new Date(this.clock()).toISOString();
      job.error = safeErrorMessage(error, this.#secrets());
      throw error;
    }
  }

  async #waitForInboxDelivery(accessToken, job) {
    const deadline = this.clock() + this.statusTimeoutMs;
    while (true) {
      if (job.controller.signal.aborted) return;
      const status = await this.client.getPublishStatus(accessToken, job.publishId);
      job.tikTokStatus = status.status;
      if (status.uploadedBytes > 0) job.bytesSent = Math.min(job.totalBytes, status.uploadedBytes);
      if (status.status === 'SEND_TO_USER_INBOX' || status.status === 'PUBLISH_COMPLETE') return;
      if (status.status === 'FAILED') {
        const error = new Error(status.failReason ? `TikTok draft delivery failed: ${status.failReason}` : 'TikTok draft delivery failed.');
        error.code = 'tiktok_publish_failed';
        throw error;
      }
      if (this.clock() >= deadline) {
        const error = new Error('TikTok is still processing the draft. Check its status again shortly.');
        error.code = 'tiktok_status_timeout';
        throw error;
      }
      await this.sleep(this.statusPollIntervalMs, job.controller.signal);
    }
  }

  async #getValidToken() {
    const token = await this.tokenStore.load();
    if (!token) return null;
    const now = this.clock();
    if (!(token.refresh_expires_at > now)) {
      await this.tokenStore.clear();
      return null;
    }
    if (token.expires_at > now + ACCESS_REFRESH_MARGIN_MS) return token;
    try {
      const payload = await this.client.refreshToken(token.refresh_token);
      const refreshed = tokenRecordFromResponse(payload, now, token);
      assertRequiredScopes(refreshed.scope);
      await this.tokenStore.save(refreshed);
      return refreshed;
    } catch (error) {
      await this.tokenStore.clear().catch(() => {});
      throw error;
    }
  }

  #disconnectedStatus() {
    return { state: 'disconnected', connected: false, environment: this.config.environment };
  }

  #secrets() {
    return [this.config.clientSecret, this.config.clientKey];
  }
}

export function tokenRecordFromResponse(payload, now = Date.now(), previous = null) {
  const scope = normalizeScopes(payload?.scope || previous?.scope || []);
  return {
    access_token: String(payload?.access_token || ''),
    refresh_token: String(payload?.refresh_token || previous?.refresh_token || ''),
    open_id: String(payload?.open_id || previous?.open_id || ''),
    scope,
    expires_at: now + Math.max(0, Number(payload?.expires_in || 0)) * 1000,
    refresh_expires_at: payload?.refresh_expires_in !== undefined
      ? now + Math.max(0, Number(payload.refresh_expires_in || 0)) * 1000
      : Number(previous?.refresh_expires_at || 0),
    token_type: String(payload?.token_type || previous?.token_type || 'Bearer'),
    profile: previous?.profile || null
  };
}

export function assertRequiredScopes(scopes) {
  const available = new Set(normalizeScopes(scopes));
  const missing = TIKTOK_REQUIRED_SCOPES.filter((scope) => !available.has(scope));
  if (missing.length > 0) {
    const error = new Error(`TikTok authorization is missing required scope: ${missing.join(', ')}.`);
    error.code = 'scope_not_authorized';
    throw error;
  }
}

function normalizeScopes(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function serializeUploadJob(job) {
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
    tikTokStatus: job.tikTokStatus,
    publishId: job.status === 'uploaded' ? job.publishId : ''
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      const error = new Error('TikTok upload cancelled.');
      error.name = 'AbortError';
      error.code = 'cancelled';
      reject(error);
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}
