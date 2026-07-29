import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class LocalCredentialStore {
  constructor(options = {}) {
    this.provider = String(options.provider || 'tiktok');
    this.filePath = path.resolve(options.filePath || defaultPublishDataPath(`${this.provider}-token.json`));
    this.normalizeRecord = options.normalizeRecord || normalizeTokenRecord;
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      return this.normalizeRecord(value);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new Error(`${providerLabel(this.provider)} credential store could not be read.`);
    }
  }

  async save(record) {
    const normalized = this.normalizeRecord(record);
    if (!normalized) throw new Error(`${providerLabel(this.provider)} token record is incomplete.`);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.filePath), 0o700).catch(() => {});
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600).catch(() => {});
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
    return normalized;
  }

  async clear() {
    await rm(this.filePath, { force: true });
  }
}

export class LocalPublishSettingsStore {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath || defaultPublishDataPath('settings.json'));
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      return normalizePublishSettings(value);
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizePublishSettings({});
      throw new Error('Publish settings could not be read.');
    }
  }

  async save(settings) {
    const normalized = normalizePublishSettings(settings);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
    return normalized;
  }
}

export function normalizeTokenRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const accessToken = String(value.access_token || '');
  const refreshToken = String(value.refresh_token || '');
  const openId = String(value.open_id || '');
  if (!accessToken || !refreshToken || !openId) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    open_id: openId,
    scope: normalizeScope(value.scope),
    expires_at: Math.max(0, Number(value.expires_at || 0)),
    refresh_expires_at: Math.max(0, Number(value.refresh_expires_at || 0)),
    token_type: String(value.token_type || 'Bearer'),
    profile: normalizeProfile(value.profile)
  };
}

export function normalizeYouTubeTokenRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const accessToken = String(value.access_token || '');
  const refreshToken = String(value.refresh_token || '');
  if (!accessToken || !refreshToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    scope: normalizeScope(value.scope),
    expires_at: Math.max(0, Number(value.expires_at || 0)),
    token_type: String(value.token_type || 'Bearer'),
    profile: normalizeYouTubeProfile(value.profile)
  };
}

export function normalizeInstagramSessionRecord(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    access_token: String(value.access_token || ''),
    expires_at: Math.max(0, Number(value.expires_at || 0)),
    last_refresh_at: Math.max(0, Number(value.last_refresh_at || 0)),
    last_validation_at: Math.max(0, Number(value.last_validation_at || 0)),
    profile: normalizeInstagramProfile(value.profile)
  };
}

export function defaultPublishDataPath(filename) {
  if (process.env.KR8_PUBLISH_DATA_DIR) {
    return path.join(path.resolve(process.env.KR8_PUBLISH_DATA_DIR), filename);
  }
  const base = (process.platform === 'win32' ? process.env.APPDATA : process.env.XDG_CONFIG_HOME)
    || path.join(os.homedir(), '.config');
  return path.join(base, 'Kr8 Studio', 'publish', filename);
}

function normalizeScope(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [...new Set(parts.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    displayName: String(value.displayName || ''),
    avatarUrl: String(value.avatarUrl || '')
  };
}

function normalizeYouTubeProfile(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    channelId: String(value.channelId || ''),
    displayName: String(value.displayName || ''),
    avatarUrl: String(value.avatarUrl || '')
  };
}

function normalizeInstagramProfile(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    userId: String(value.userId || ''),
    username: String(value.username || ''),
    displayName: String(value.displayName || ''),
    accountType: String(value.accountType || ''),
    avatarUrl: String(value.avatarUrl || '')
  };
}

function providerLabel(value) {
  return value === 'youtube' ? 'YouTube' : value === 'instagram' ? 'Instagram' : 'TikTok';
}

function normalizePublishSettings(value) {
  return {
    schemaVersion: 1,
    provider: 'tiktok',
    chunkSizeMiB: Math.max(5, Math.min(64, Number(value?.chunkSizeMiB || 16)))
  };
}
