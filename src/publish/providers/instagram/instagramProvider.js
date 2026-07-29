import { safeErrorMessage } from '../../security.js';
import { InstagramBridgeClient, fingerprint } from './bridgeClient.js';
import { InstagramApiError, InstagramClient } from './instagramClient.js';
import { LONG_REEL_WARNING, normalizeInstagramOptions, validateInstagramMedia } from './validation.js';

const ACTIVE_STATES = new Set(['validating', 'uploading', 'retrying', 'waiting_meta_fetch', 'processing', 'publishing', 'cleaning_up']);
const PROFESSIONAL_TYPES = new Set(['PROFESSIONAL', 'BUSINESS', 'MEDIA_CREATOR', 'CREATOR']);
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60_000;

export class InstagramProvider {
  constructor(options) {
    this.config = options.config;
    this.configLoader = typeof options.configLoader === 'function' ? options.configLoader : null;
    this.fetchImpl = options.fetchImpl;
    this.usesDefaultClient = !options.client;
    this.usesDefaultBridge = !options.bridge;
    this.sessionStore = options.sessionStore;
    this.client = options.client || new InstagramClient(options.config, { fetchImpl: options.fetchImpl });
    this.bridge = options.bridge || new InstagramBridgeClient(options.config, { fetchImpl: options.fetchImpl });
    this.clock = options.clock || (() => Date.now());
    this.sleep = options.sleep || delay;
    this.pollIntervalMs = Math.max(0, Number(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
    this.pollTimeoutMs = Math.max(1, Number(options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS));
    this.jobs = new Map();
    this.suppressAutoValidation = false;
  }

  async getConnectionStatus(options = {}) {
    if (!this.config.configured) return this.#notConfigured();
    if (this.suppressAutoValidation && !options.refreshProfile) return this.#notValidated();
    const session = await this.sessionStore.load().catch(() => null);
    if (session?.profile && !options.refreshProfile) return this.#connectedStatus(session);
    try {
      return await this.#validateAccount();
    } catch (error) {
      return { ...this.#notValidated(), state: 'invalid', reason: safeErrorMessage(error, this.#secrets()) };
    }
  }

  async connect() {
    const configTokenChanged = await this.#reloadConfig();
    if (!this.config.configured) throw new Error(`Instagram configuration is missing: ${this.config.missing.join(', ')}.`);
    this.suppressAutoValidation = false;
    const session = await this.sessionStore.load().catch(() => null);
    if (configTokenChanged && session?.access_token !== this.config.accessToken) {
      await this.sessionStore.clear();
      return this.#validateAccount({ access_token: this.config.accessToken });
    }
    try {
      return await this.#validateAccount(session);
    } catch (error) {
      if (!session?.access_token || session.access_token === this.config.accessToken) throw error;
      await this.sessionStore.clear();
      return this.#validateAccount({ access_token: this.config.accessToken });
    }
  }

  async disconnect() {
    this.suppressAutoValidation = true;
    await this.sessionStore.clear();
    return this.#notValidated();
  }

  async refreshToken() {
    if (!this.config.configured) throw new Error('Instagram credentials are not configured.');
    const current = await this.sessionStore.load().catch(() => null);
    const refreshed = await this.client.refreshLongLivedToken(this.#accessToken(current));
    if (!refreshed.accessToken) throw new Error('Instagram did not return a refreshed access token.');
    const saved = await this.sessionStore.save({
      ...current,
      access_token: refreshed.accessToken,
      expires_at: refreshed.expiresAt,
      last_refresh_at: this.clock(),
      last_validation_at: 0,
      profile: current?.profile || null
    });
    this.suppressAutoValidation = false;
    return this.#validateAccount(saved);
  }

  validateMedia(media) {
    return validateInstagramMedia(media, { destination: 'reel' });
  }

  startUpload(media, rawOptions = {}) {
    const options = normalizeInstagramOptions(rawOptions);
    const validated = validateInstagramMedia(media, options);
    if (!validated.valid) throw new Error(validated.errors[0] || 'The video is not valid for Instagram.');
    if (validated.warnings.includes(LONG_REEL_WARNING) && !options.publishAnyway) throw new Error(`${LONG_REEL_WARNING} Enable Publish anyway to continue.`);
    if (!this.config.bridgeConfigured) throw new Error('Instagram media bridge is not configured. Add INSTAGRAM_BRIDGE_TOKEN before publishing.');
    if ([...this.jobs.values()].some((job) => ACTIVE_STATES.has(job.status))) throw new Error('Another Instagram publish is already running.');
    const id = `instagram_publish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const job = {
      id,
      status: 'validating',
      destination: options.destination,
      progress: 0,
      bytesSent: 0,
      totalBytes: validated.sizeBytes,
      bytesPerSecond: 0,
      etaSeconds: null,
      retryCount: 0,
      startedAt: new Date(this.clock()).toISOString(),
      completedAt: '',
      error: '',
      warning: validated.warnings[0] || '',
      cleanupWarning: '',
      containerId: '',
      mediaId: '',
      permalink: '',
      bridgeId: '',
      irreversible: false,
      controller: new AbortController(),
      done: null
    };
    this.jobs.set(id, job);
    job.done = this.#runPublish(job, validated, options);
    job.done.catch(() => {});
    return serializeInstagramJob(job);
  }

  getProgress(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    return job ? serializeInstagramJob(job) : null;
  }

  cancel(jobId) {
    const job = this.jobs.get(String(jobId || ''));
    if (!job || !ACTIVE_STATES.has(job.status) || job.irreversible) return false;
    job.status = 'cancelled';
    job.completedAt = new Date(this.clock()).toISOString();
    job.error = 'Instagram publishing cancelled before media_publish.';
    job.controller.abort();
    return true;
  }

  async #runPublish(job, media, options) {
    let bridgeRecord = null;
    try {
      const session = await this.sessionStore.load().catch(() => null);
      const accessToken = this.#accessToken(session);
      if (!accessToken) throw new Error('Instagram token is unavailable.');
      const account = await this.#validateAccount(session);
      const before = await fingerprint(media.path);
      job.status = 'uploading';
      bridgeRecord = await this.bridge.upload(media, {
        signal: job.controller.signal,
        onProgress: (progress) => { if (job.status !== 'cancelled') Object.assign(job, progress, { status: 'uploading' }); },
        onRetry: ({ retryCount }) => { if (job.status !== 'cancelled') Object.assign(job, { status: 'retrying', retryCount }); }
      });
      job.bridgeId = bridgeRecord.id;
      if (job.status === 'cancelled') return job;
      job.status = 'waiting_meta_fetch';
      const container = await this.client.createContainer(accessToken, this.config.userId, {
        ...options, videoUrl: bridgeRecord.mediaUrl
      });
      if (!container.containerId) throw new Error('Instagram did not return a media container ID.');
      job.containerId = container.containerId;
      job.status = 'processing';
      await this.#waitForContainer(accessToken, job);
      if (job.status === 'cancelled') return job;
      job.status = 'publishing';
      job.irreversible = true;
      const published = await this.client.publishContainer(accessToken, this.config.userId, job.containerId);
      if (!published.mediaId) throw new Error('Instagram media_publish completed without a media ID.');
      job.mediaId = published.mediaId;
      const finalMedia = await this.client.getMedia(accessToken, job.mediaId);
      job.permalink = finalMedia.permalink;
      job.status = 'cleaning_up';
      await this.#cleanup(job, bridgeRecord);
      bridgeRecord = null;
      const after = await fingerprint(media.path);
      if (before.size !== after.size || before.sha256 !== after.sha256) throw new Error('The local Reel changed during Instagram publishing.');
      job.status = 'uploaded';
      job.progress = 1;
      job.bytesSent = job.totalBytes;
      job.completedAt = new Date(this.clock()).toISOString();
      return job;
    } catch (error) {
      if (job.status === 'cancelled' || error?.name === 'AbortError' || error?.code === 'cancelled') {
        job.status = 'cancelled';
        job.completedAt ||= new Date(this.clock()).toISOString();
        return job;
      }
      job.status = 'failed';
      job.completedAt = new Date(this.clock()).toISOString();
      job.error = safeErrorMessage(error, this.#secrets());
      throw error;
    } finally {
      if (bridgeRecord) await this.#cleanup(job, bridgeRecord);
    }
  }

  async #waitForContainer(accessToken, job) {
    const deadline = this.clock() + this.pollTimeoutMs;
    while (true) {
      if (job.controller.signal.aborted) throw Object.assign(new Error('Instagram publishing cancelled.'), { name: 'AbortError', code: 'cancelled' });
      const status = await this.client.getContainerStatus(accessToken, job.containerId);
      if (status.code === 'FINISHED') return;
      if (['ERROR', 'EXPIRED'].includes(status.code)) throw new Error(status.status ? `Instagram processing failed: ${status.status}` : 'Instagram processing failed.');
      if (this.clock() >= deadline) throw Object.assign(new Error('Instagram media processing timed out.'), { code: 'processing_timeout' });
      await this.sleep(this.pollIntervalMs, job.controller.signal);
    }
  }

  async #cleanup(job, bridgeRecord) {
    if (!bridgeRecord?.id) return;
    const previous = job.status;
    if (!['failed', 'cancelled'].includes(previous)) job.status = 'cleaning_up';
    try { await this.bridge.cleanup(bridgeRecord.id); }
    catch (error) { job.cleanupWarning = safeErrorMessage(error, this.#secrets()); }
    finally { job.bridgeId = ''; if (['failed', 'cancelled'].includes(previous)) job.status = previous; }
  }

  async #validateAccount(existing = null) {
    const session = existing || await this.sessionStore.load().catch(() => null);
    const accessToken = this.#accessToken(session);
    const inspected = await this.client.inspectToken(accessToken);
    if (!inspected.valid) throw Object.assign(new Error('Instagram access token is invalid or expired.'), { code: 'invalid_token' });
    if (inspected.appId && inspected.appId !== this.config.appId) throw new Error('Instagram token belongs to a different Meta app.');
    const profile = await this.client.getAccount(accessToken, this.config.userId);
    if (profile.userId !== this.config.userId) throw new Error('Instagram account identity did not match INSTAGRAM_USER_ID.');
    if (!PROFESSIONAL_TYPES.has(profile.accountType)) throw new Error('Instagram account is not a Professional account.');
    const saved = await this.sessionStore.save({
      ...session,
      access_token: session?.access_token || '',
      expires_at: inspected.expiresAt || session?.expires_at || 0,
      last_validation_at: this.clock(),
      profile
    });
    return this.#connectedStatus(saved);
  }

  async #reloadConfig() {
    if (!this.configLoader) return false;
    const previousAccessToken = String(this.config?.accessToken || '');
    const nextConfig = await this.configLoader();
    if (!nextConfig || typeof nextConfig !== 'object') return false;
    this.config = nextConfig;
    if (this.usesDefaultClient) this.client = new InstagramClient(nextConfig, { fetchImpl: this.fetchImpl });
    if (this.usesDefaultBridge) this.bridge = new InstagramBridgeClient(nextConfig, { fetchImpl: this.fetchImpl });
    return previousAccessToken !== String(nextConfig.accessToken || '');
  }

  #accessToken(session) { return String(session?.access_token || this.config.accessToken || ''); }
  #connectedStatus(session) {
    return {
      state: 'connected', connected: true, configured: true, bridgeConfigured: this.config.bridgeConfigured,
      displayName: session.profile?.displayName || session.profile?.username || 'Instagram account',
      username: session.profile?.username || '', avatarUrl: session.profile?.avatarUrl || '',
      accountType: session.profile?.accountType || '', userId: session.profile?.userId || '',
      tokenValid: true, expiresAt: session.expires_at || 0, lastValidatedAt: session.last_validation_at || 0
    };
  }
  #notValidated() { return { state: 'not_validated', connected: false, configured: true, bridgeConfigured: this.config.bridgeConfigured, tokenValid: null }; }
  #notConfigured() { return { state: 'not_configured', connected: false, configured: false, bridgeConfigured: this.config.bridgeConfigured, tokenValid: false, missing: [...this.config.missing] }; }
  #secrets() { return [this.config.accessToken, this.config.appSecret, this.config.appId, this.config.bridgeToken]; }
}

function serializeInstagramJob(job) {
  return {
    jobId: job.id, status: job.status, destination: job.destination,
    progress: Number(job.progress || 0), bytesSent: Number(job.bytesSent || 0), totalBytes: Number(job.totalBytes || 0),
    bytesPerSecond: Number(job.bytesPerSecond || 0), etaSeconds: job.etaSeconds === null ? null : Number(job.etaSeconds),
    retryCount: Number(job.retryCount || 0), startedAt: job.startedAt, completedAt: job.completedAt,
    error: job.error, warning: job.warning, cleanupWarning: job.cleanupWarning, irreversible: job.irreversible,
    mediaId: job.status === 'uploaded' ? job.mediaId : '', permalink: job.status === 'uploaded' ? job.permalink : ''
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Instagram publishing cancelled.'), { name: 'AbortError', code: 'cancelled' })); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}

export function isPermanentInstagramError(error) {
  return error instanceof InstagramApiError && !error.transient;
}
