import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildInstagramConfig, publicInstagramConfig } from '../src/publish/config.js';
import { LocalCredentialStore, normalizeInstagramSessionRecord } from '../src/publish/credentialStore.js';
import { InstagramClient } from '../src/publish/providers/instagram/instagramClient.js';
import { InstagramProvider } from '../src/publish/providers/instagram/instagramProvider.js';
import { LONG_REEL_WARNING, STORY_DURATION_ERROR, normalizeInstagramOptions, validateInstagramMedia } from '../src/publish/providers/instagram/validation.js';

test('Instagram config validates backend credentials without exposing secrets', () => {
  const missing = buildInstagramConfig({});
  assert.equal(missing.configured, false);
  const configured = buildInstagramConfig({
    INSTAGRAM_APP_ID: 'app', INSTAGRAM_APP_SECRET: 'secret', INSTAGRAM_USER_ID: 'user', INSTAGRAM_ACCESS_TOKEN: 'token',
    INSTAGRAM_BRIDGE_TOKEN: 'bridge-secret', INSTAGRAM_BRIDGE_URL: 'https://media-bridge.example.com'
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.bridgeConfigured, true);
  const visible = JSON.stringify(publicInstagramConfig(configured));
  assert.doesNotMatch(visible, /secret|token/);
  assert.match(visible, /media-bridge\.example\.com/);
});

test('Instagram config normalizes a bridge hostname to HTTPS and rejects unsafe URLs', () => {
  const base = {
    INSTAGRAM_APP_ID: 'app', INSTAGRAM_APP_SECRET: 'secret', INSTAGRAM_USER_ID: 'user',
    INSTAGRAM_ACCESS_TOKEN: 'token', INSTAGRAM_BRIDGE_TOKEN: 'bridge-secret'
  };
  const hostname = buildInstagramConfig({ ...base, INSTAGRAM_BRIDGE_URL: 'media-bridge.example.com' });
  assert.equal(hostname.bridgeBaseUrl, 'https://media-bridge.example.com');
  assert.equal(hostname.bridgeConfigured, true);

  const unsafe = buildInstagramConfig({ ...base, INSTAGRAM_BRIDGE_URL: 'http://media-bridge.example.com' });
  assert.equal(unsafe.bridgeBaseUrl, '');
  assert.equal(unsafe.bridgeConfigured, false);
});

test('Instagram validation handles Reel warning and hard Story limit', () => {
  const short = media({ duration: 45 });
  assert.equal(validateInstagramMedia(short, { destination: 'reel' }).valid, true);
  assert.equal(validateInstagramMedia(short, { destination: 'story' }).valid, true);
  const long = validateInstagramMedia(media({ duration: 240 }), { destination: 'reel' });
  assert.equal(long.valid, true);
  assert.deepEqual(long.warnings, [LONG_REEL_WARNING]);
  const story = validateInstagramMedia(media({ duration: 61 }), { destination: 'story' });
  assert.equal(story.valid, false);
  assert.ok(story.errors.includes(STORY_DURATION_ERROR));
});

test('Instagram metadata removes Story caption and preserves Reel Share to Feed', () => {
  assert.deepEqual(normalizeInstagramOptions({ destination: 'story', caption: 'ignored', shareToFeed: true }), {
    destination: 'story', caption: '', shareToFeed: false, publishAnyway: false
  });
  assert.equal(normalizeInstagramOptions({ destination: 'reel', caption: 'Hello', shareToFeed: false }).shareToFeed, false);
});

test('Instagram client performs account lookup, container creation, polling and publish', async () => {
  const calls = [];
  const client = new InstagramClient(config(), { maxRetries: 0, fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/debug_token')) return json({ data: { is_valid: true, app_id: 'app', user_id: 'user' } });
    if (pathname.endsWith('/user') && !pathname.endsWith('/media_publish')) return json({ id: 'user', username: 'kr8', name: 'Kr8', account_type: 'BUSINESS' });
    if (pathname.endsWith('/media')) return json({ id: 'container' });
    if (pathname.endsWith('/container')) return json({ id: 'container', status_code: 'FINISHED' });
    if (pathname.endsWith('/media_publish')) return json({ id: 'media' });
    if (pathname.endsWith('/media')) return json({ id: 'media', permalink: 'https://instagram.test/p/media' });
    return json({ id: 'media', permalink: 'https://instagram.test/p/media' });
  }});
  assert.equal((await client.inspectToken('access')).valid, true);
  assert.equal((await client.getAccount('access', 'user')).accountType, 'BUSINESS');
  assert.equal((await client.createContainer('access', 'user', { destination: 'reel', videoUrl: 'https://bridge.test/m/token', caption: 'Caption', shareToFeed: true })).containerId, 'container');
  assert.equal((await client.getContainerStatus('access', 'container')).code, 'FINISHED');
  assert.equal((await client.publishContainer('access', 'user', 'container')).mediaId, 'media');
  assert.ok(calls.some((call) => call.body.includes('caption=Caption') && call.body.includes('share_to_feed=true')));
});

test('Instagram client retries transient responses but not permanent Meta errors', async () => {
  let transientCalls = 0;
  const transient = new InstagramClient(config(), { maxRetries: 2, sleep: async () => {}, fetchImpl: async () => {
    transientCalls += 1;
    return transientCalls === 1 ? json({ error: { message: 'temporary', code: 2, is_transient: true } }, 503) : json({ data: { is_valid: true } });
  }});
  assert.equal((await transient.inspectToken('access')).valid, true);
  assert.equal(transientCalls, 2);

  let permanentCalls = 0;
  const permanent = new InstagramClient(config(), { maxRetries: 2, sleep: async () => {}, fetchImpl: async () => {
    permanentCalls += 1;
    return json({ error: { message: 'bad permission', code: 10 } }, 400);
  }});
  await assert.rejects(() => permanent.inspectToken('access'), /bad permission/);
  assert.equal(permanentCalls, 1);
});

test('Instagram provider rejects an invalid token clearly', async () => {
  const client = fakeClient();
  client.inspectToken = async () => ({ valid: false, appId: 'app', userId: 'user' });
  const provider = new InstagramProvider({ config: config(), sessionStore: memoryStore(), client, bridge: {} });
  await assert.rejects(() => provider.connect(), /invalid or expired/);
});

test('Instagram connect reloads a changed env token and replaces a stale local session', async () => {
  const store = memoryStore();
  await store.save({ access_token: 'stale-token', profile: { userId: 'user', username: 'old' } });
  const inspected = [];
  const client = fakeClient();
  client.inspectToken = async (token) => {
    inspected.push(token);
    return { valid: token === 'fresh-token', appId: 'app', userId: 'user', expiresAt: Date.now() + 100000 };
  };
  const provider = new InstagramProvider({
    config: config({ accessToken: 'previous-env-token' }),
    configLoader: async () => config({ accessToken: 'fresh-token' }),
    sessionStore: store,
    client,
    bridge: {}
  });
  const result = await provider.connect();
  assert.equal(result.connected, true);
  assert.deepEqual(inspected, ['fresh-token']);
  assert.equal((await store.load()).access_token, 'fresh-token');
});

test('Instagram connect falls back from an invalid refreshed session to current config token', async () => {
  const store = memoryStore();
  await store.save({ access_token: 'expired-refreshed-token', profile: { userId: 'user', username: 'old' } });
  const inspected = [];
  const client = fakeClient();
  client.inspectToken = async (token) => {
    inspected.push(token);
    return { valid: token === 'current-env-token', appId: 'app', userId: 'user', expiresAt: Date.now() + 100000 };
  };
  const provider = new InstagramProvider({
    config: config({ accessToken: 'current-env-token' }),
    configLoader: async () => config({ accessToken: 'current-env-token' }),
    sessionStore: store,
    client,
    bridge: {}
  });
  const result = await provider.connect();
  assert.equal(result.connected, true);
  assert.deepEqual(inspected, ['expired-refreshed-token', 'current-env-token']);
  assert.equal((await store.load()).access_token, 'current-env-token');
});

test('Instagram provider validates account and publishes through bridge without changing local file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-instagram-provider-'));
  const filePath = path.join(directory, 'reel.mp4');
  await writeFile(filePath, 'unchanged-video');
  const before = await readFile(filePath);
  const cleanup = [];
  const provider = new InstagramProvider({
    config: config(), sessionStore: memoryStore(), pollIntervalMs: 0,
    client: fakeClient(),
    bridge: {
      async upload(_media, options) { options.onProgress({ progress: 1, bytesSent: before.length, totalBytes: before.length, bytesPerSecond: 100, etaSeconds: 0 }); return { id: 'bridge-id', mediaUrl: 'https://bridge.test/m/private', fingerprint: {} }; },
      async cleanup(id) { cleanup.push(id); return true; }
    }
  });
  const connection = await provider.connect();
  assert.equal(connection.connected, true);
  assert.equal(connection.username, 'kr8');
  const started = provider.startUpload(media({ path: filePath, sizeBytes: before.length }), { destination: 'reel', caption: 'Caption', shareToFeed: true });
  await provider.jobs.get(started.jobId).done;
  const finished = provider.getProgress(started.jobId);
  assert.equal(finished.status, 'uploaded');
  assert.equal(finished.permalink, 'https://instagram.test/p/media');
  assert.deepEqual(cleanup, ['bridge-id']);
  assert.deepEqual(await readFile(filePath), before);
  assert.doesNotMatch(JSON.stringify(finished), /bridge\.test|private|access-token/);
});

test('Instagram provider requires Publish anyway for long Reels and blocks long Stories', async () => {
  const provider = new InstagramProvider({ config: config(), sessionStore: memoryStore(), client: fakeClient(), bridge: {} });
  assert.throws(() => provider.startUpload(media({ duration: 240 }), { destination: 'reel' }), /Publish anyway/);
  assert.throws(() => provider.startUpload(media({ duration: 61 }), { destination: 'story' }), /60-second Story limit/);
});

test('Instagram cancel aborts before publish and cleanup remains controlled', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-instagram-cancel-'));
  const filePath = path.join(directory, 'reel.mp4');
  await writeFile(filePath, 'video');
  const provider = new InstagramProvider({
    config: config(), sessionStore: memoryStore(), client: fakeClient(),
    bridge: { upload: (_media, options) => new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    }), cleanup: async () => true }
  });
  const started = provider.startUpload(media({ path: filePath, sizeBytes: 5 }), { destination: 'reel' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.cancel(started.jobId), true);
  await provider.jobs.get(started.jobId).done;
  assert.equal(provider.getProgress(started.jobId).status, 'cancelled');
});

test('Instagram processing failure cleans the bridge object and never reports published', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-instagram-processing-error-'));
  const filePath = path.join(directory, 'reel.mp4');
  await writeFile(filePath, 'video');
  const client = fakeClient();
  client.getContainerStatus = async () => ({ code: 'ERROR', status: 'Media rejected' });
  const cleaned = [];
  const provider = new InstagramProvider({
    config: config(), sessionStore: memoryStore(), client, pollIntervalMs: 0,
    bridge: { async upload() { return { id: 'bridge-id', mediaUrl: 'https://bridge.test/m/private' }; }, async cleanup(id) { cleaned.push(id); } }
  });
  const started = provider.startUpload(media({ path: filePath, sizeBytes: 5 }), { destination: 'reel' });
  await assert.rejects(() => provider.jobs.get(started.jobId).done, /Media rejected/);
  assert.equal(provider.getProgress(started.jobId).status, 'failed');
  assert.deepEqual(cleaned, ['bridge-id']);
});

test('Instagram manual refresh writes only the local credential store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-instagram-session-'));
  const store = new LocalCredentialStore({ provider: 'instagram', filePath: path.join(directory, 'instagram.json'), normalizeRecord: normalizeInstagramSessionRecord });
  const client = fakeClient();
  client.refreshLongLivedToken = async () => ({ accessToken: 'refreshed-token', expiresAt: 999999 });
  const provider = new InstagramProvider({ config: config(), sessionStore: store, client, bridge: {} });
  const result = await provider.refreshToken();
  assert.equal(result.connected, true);
  assert.equal((await store.load()).access_token, 'refreshed-token');
});

function config(overrides = {}) {
  return { appId: 'app', appSecret: 'app-secret', userId: 'user', accessToken: 'access-token', graphVersion: 'v23.0', configured: true, missing: [], bridgeBaseUrl: 'https://bridge.test', bridgeToken: 'bridge-secret', bridgeConfigured: true, ...overrides };
}
function media(overrides = {}) {
  return { valid: true, errors: [], extension: '.mp4', contentType: 'video/mp4', path: 'reel.mp4', sizeBytes: 100, duration: 30, width: 1080, height: 1920, fps: 30, videoCodec: 'h264', hasAudio: true, audioCodec: 'aac', ...overrides };
}
function memoryStore() {
  let record = null;
  return { async load() { return record; }, async save(value) { record = normalizeInstagramSessionRecord(value); return record; }, async clear() { record = null; } };
}
function fakeClient() {
  return {
    async inspectToken() { return { valid: true, appId: 'app', userId: 'user', expiresAt: Date.now() + 100000 }; },
    async getAccount() { return { userId: 'user', username: 'kr8', displayName: 'Kr8', accountType: 'BUSINESS', avatarUrl: '' }; },
    async createContainer(_token, _user, options) { assert.ok(options.videoUrl); return { containerId: 'container' }; },
    async getContainerStatus() { return { code: 'FINISHED', status: '' }; },
    async publishContainer() { return { mediaId: 'media' }; },
    async getMedia() { return { mediaId: 'media', permalink: 'https://instagram.test/p/media' }; },
    async refreshLongLivedToken() { return { accessToken: 'new-token', expiresAt: Date.now() + 100000 }; }
  };
}
function json(value, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return value; } }; }
