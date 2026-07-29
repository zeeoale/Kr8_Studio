import { findLatestValidReelExport, validatePublishMedia } from './media.js';
import { assertPublishProvider } from './providerContract.js';
import { safeErrorMessage } from './security.js';

export class PublishService {
  constructor(options = {}) {
    this.providers = new Map();
    for (const [name, provider] of Object.entries(options.providers || {})) this.registerProvider(name, provider);
    this.settingsStore = options.settingsStore;
    this.errorSecrets = Array.isArray(options.errorSecrets) ? options.errorSecrets.filter(Boolean) : [];
    this.findLatestReel = options.findLatestReel || findLatestValidReelExport;
    this.validateMediaFile = options.validateMedia || validatePublishMedia;
    this.connectionJobs = new Map();
  }

  registerProvider(name, provider) {
    this.providers.set(name, assertPublishProvider(name, provider));
  }

  async getContext(projectDirectory, providerName = 'tiktok') {
    const name = normalizeProviderName(providerName);
    const provider = this.#provider(name);
    const [source, connection, settings] = await Promise.all([
      this.findLatestReel(projectDirectory),
      provider.getConnectionStatus(),
      this.settingsStore?.load?.() || Promise.resolve({ schemaVersion: 1, provider: name, chunkSizeMiB: 16 })
    ]);
    const baseMedia = source ? await this.validateMediaFile(source.outputPath) : null;
    const media = baseMedia ? await provider.validateMedia(baseMedia) : null;
    return {
      provider: name,
      source: source ? { ...source, media } : null,
      available: Boolean(source),
      valid: Boolean(media?.valid),
      validationErrors: media?.errors || (source ? [] : ['No exported Reel is available.']),
      connection,
      settings
    };
  }

  startConnect(providerName = 'tiktok') {
    const name = normalizeProviderName(providerName);
    if ([...this.connectionJobs.values()].some((job) => job.provider === name && job.status === 'connecting')) {
      throw new Error(`A ${providerLabel(name)} login is already in progress.`);
    }
    const id = `${name}_connect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    let resolveAuthorization;
    const authorizationReady = new Promise((resolve) => { resolveAuthorization = resolve; });
    const job = {
      id,
      provider: name,
      status: 'connecting',
      startedAt: new Date().toISOString(),
      completedAt: '',
      error: '',
      result: null,
      authorizationUrl: '',
      authorizationReady
    };
    this.connectionJobs.set(id, job);
    job.done = this.#provider(name).connect({
      onAuthorizationUrl: (authorizationUrl) => {
        job.authorizationUrl = normalizeAuthorizationUrl(authorizationUrl);
        resolveAuthorization();
      }
    })
      .then((result) => {
        job.status = 'connected';
        job.completedAt = new Date().toISOString();
        job.result = result;
        return job;
      })
      .catch((error) => {
        job.status = error?.code === 'cancelled' ? 'cancelled' : 'failed';
        job.completedAt = new Date().toISOString();
        job.error = safeErrorMessage(error, this.errorSecrets);
        return job;
      })
      .finally(resolveAuthorization);
    return serializeConnectionJob(job);
  }

  async waitForConnectAuthorization(jobId, providerName = '', timeoutMs = 5000) {
    const job = this.connectionJobs.get(String(jobId || ''));
    if (!job || (providerName && job.provider !== normalizeProviderName(providerName))) return null;
    if (!job.authorizationUrl && job.status === 'connecting') {
      await Promise.race([
        job.authorizationReady,
        new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(timeoutMs) || 5000)))
      ]);
    }
    return serializeConnectionJob(job);
  }

  getConnectProgress(jobId, providerName = '') {
    const job = this.connectionJobs.get(String(jobId || ''));
    return job && (!providerName || job.provider === normalizeProviderName(providerName)) ? serializeConnectionJob(job) : null;
  }

  disconnect(providerName = 'tiktok') {
    return this.#provider(normalizeProviderName(providerName)).disconnect();
  }

  refreshCredentials(providerName) {
    const provider = this.#provider(normalizeProviderName(providerName));
    if (typeof provider.refreshToken !== 'function') throw new Error(`${providerLabel(providerName)} does not support manual credential refresh.`);
    return provider.refreshToken();
  }

  getConnectionStatus(providerName) {
    return this.#provider(normalizeProviderName(providerName)).getConnectionStatus();
  }

  async startUpload(projectDirectory, options = {}) {
    const name = normalizeProviderName(options.provider || 'tiktok');
    if (options.confirmed !== true) throw new Error('Explicit upload confirmation is required.');
    const context = await this.getContext(projectDirectory, name);
    if (!context.source) throw new Error('No exported Reel is available.');
    if (!context.valid) throw new Error(context.validationErrors[0] || `The Reel is not valid for ${providerLabel(name)}.`);
    if (!context.connection.connected) throw new Error(`Connect ${providerLabel(name)} before uploading.`);
    return this.#provider(name).startUpload(context.source.media, options);
  }

  getUploadProgress(jobId, providerName = 'tiktok') {
    return this.#provider(normalizeProviderName(providerName)).getProgress(jobId);
  }

  cancelUpload(jobId, providerName = 'tiktok') {
    return this.#provider(normalizeProviderName(providerName)).cancel(jobId);
  }

  async saveSettings(settings) {
    if (!this.settingsStore?.save) return settings;
    return this.settingsStore.save(settings);
  }

  #provider(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Publish provider is unavailable: ${name}.`);
    return provider;
  }
}

function serializeConnectionJob(job) {
  return {
    jobId: job.id,
    provider: job.provider,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result,
    authorizationUrl: job.authorizationUrl
  };
}

function normalizeAuthorizationUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('OAuth authorization URL must use HTTPS.');
  return url.toString();
}

function normalizeProviderName(value) {
  const name = String(value || 'tiktok').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid publish provider.');
  return name;
}

function providerLabel(name) {
  return name === 'youtube' ? 'YouTube' : name === 'instagram' ? 'Instagram' : name === 'tiktok' ? 'TikTok' : name;
}
