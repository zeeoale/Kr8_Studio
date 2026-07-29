import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildYouTubeConfig, publicYouTubeConfig, YOUTUBE_REQUIRED_SCOPES } from '../src/publish/config.js';
import { LocalCredentialStore, normalizeYouTubeTokenRecord } from '../src/publish/credentialStore.js';
import { createOAuthCallbackServer } from '../src/publish/oauthCallback.js';
import { normalizeYouTubeMetadata, toYouTubeVideoResource } from '../src/publish/providers/youtube/metadata.js';
import { uploadYouTubeResumable } from '../src/publish/providers/youtube/resumableUpload.js';
import { YouTubeClient } from '../src/publish/providers/youtube/youtubeClient.js';
import { YouTubeProvider } from '../src/publish/providers/youtube/youtubeProvider.js';

test('YouTube config requires credentials and never exposes their values', () => {
  const missing = buildYouTubeConfig({});
  const configured = buildYouTubeConfig({ YOUTUBE_CLIENT_ID: 'client-value', YOUTUBE_CLIENT_SECRET: 'secret-value' });
  assert.deepEqual(missing.missing, ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET']);
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.scopes, YOUTUBE_REQUIRED_SCOPES);
  const safe = JSON.stringify(publicYouTubeConfig(configured));
  assert.doesNotMatch(safe, /client-value|secret-value/);
});

test('YouTube OAuth callback uses a safe loopback URL and rejects bad state', async () => {
  const server = await createOAuthCallbackServer({
    state: 'youtube-state', callbackPath: '/youtube/callback/', providerName: 'YouTube', timeoutMs: 1000
  });
  try {
    assert.match(server.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/youtube\/callback\/$/);
    const response = await fetch(`${server.redirectUri}?code=code&state=wrong`);
    assert.equal(response.status, 400);
    await assert.rejects(server.callback, (error) => error.code === 'state_mismatch');
  } finally { server.close(); }
});

test('YouTube client builds desktop PKCE OAuth and refresh requests', async () => {
  const requests = [];
  const client = new YouTubeClient(config(), { fetchImpl: async (url, init) => {
    requests.push({ url: String(url), body: Object.fromEntries(init.body.entries()) });
    return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: YOUTUBE_REQUIRED_SCOPES.join(' ') });
  } });
  const authorization = new URL(client.buildAuthorizationUrl({ redirectUri: 'http://127.0.0.1:3210/youtube/callback/', state: 'state', codeChallenge: 'challenge' }));
  assert.deepEqual(authorization.searchParams.get('scope').split(' ').sort(), [...YOUTUBE_REQUIRED_SCOPES].sort());
  assert.equal(authorization.searchParams.get('access_type'), 'offline');
  assert.equal(authorization.searchParams.get('prompt'), 'consent');
  await client.exchangeCode({ code: 'code', redirectUri: 'http://127.0.0.1:3210/youtube/callback/', codeVerifier: 'verifier' });
  await client.refreshToken('refresh');
  assert.equal(requests[0].body.code_verifier, 'verifier');
  assert.equal(requests[1].body.grant_type, 'refresh_token');
});

test('YouTube channel info is normalized from channels.list', async () => {
  const client = new YouTubeClient(config(), { fetchImpl: async (url) => {
    assert.match(String(url), /youtube\/v3\/channels/);
    return jsonResponse({ items: [{ id: 'channel-id', snippet: { title: 'TKMusic', thumbnails: { default: { url: 'avatar' } } } }] });
  } });
  assert.deepEqual(await client.getChannelInfo('access'), { channelId: 'channel-id', displayName: 'TKMusic', avatarUrl: 'avatar' });
});

test('YouTube metadata validates title, privacy, tags and Music category', () => {
  assert.equal(normalizeYouTubeMetadata({ title: '' }).valid, false);
  assert.equal(normalizeYouTubeMetadata({ title: 'Video', privacy: 'friends' }).valid, false);
  const value = normalizeYouTubeMetadata({ title: 'Video', tags: 'kr8, music, kr8', madeForKids: 'yes' });
  assert.deepEqual(value.tags, ['kr8', 'music']);
  assert.equal(value.categoryId, '10');
  assert.equal(toYouTubeVideoResource(value).status.selfDeclaredMadeForKids, true);
  assert.equal(toYouTubeVideoResource(value).status.containsSyntheticMedia, true);
  assert.equal(toYouTubeVideoResource({ title: 'Video', containsSyntheticMedia: 'no' }).status.containsSyntheticMedia, false);
});

test('YouTube resumable upload resumes at the server Range after network interruption', async () => {
  const fixture = await videoFixture(300_000);
  const calls = [];
  const result = await uploadYouTubeResumable({
    filePath: fixture, fileSize: 300_000, contentType: 'video/mp4', uploadUrl: 'https://upload.test/session',
    chunkSizeBytes: 256 * 1024, maxRetries: 2, getAccessToken: async () => 'access',
    fetchImpl: async (_url, init) => {
      calls.push(init.headers['content-range']);
      if (calls.length === 1) return response(308, null, { range: 'bytes=0-262143' });
      if (calls.length === 2) throw new Error('network interrupted');
      if (calls.length === 3) return response(308, null, { range: 'bytes=0-262143' });
      return jsonResponse({ id: 'video-id' }, 201);
    }
  });
  assert.equal(result.video.id, 'video-id');
  assert.equal(result.bytesSent, 300_000);
  assert.equal(result.retryCount, 1);
  assert.equal(calls[2], 'bytes */300000');
  assert.equal(calls[3], 'bytes 262144-299999/300000');
});

test('YouTube resumable upload does not retry permanent errors', async () => {
  const fixture = await videoFixture(8);
  let calls = 0;
  await assert.rejects(() => uploadYouTubeResumable({
    filePath: fixture, fileSize: 8, contentType: 'video/mp4', uploadUrl: 'https://upload.test/session',
    getAccessToken: async () => 'access', fetchImpl: async () => { calls += 1; return jsonResponse({ error: { message: 'bad request' } }, 400); }
  }), /bad request/);
  assert.equal(calls, 1);
});

test('YouTube resumable cancellation preserves the local video', async () => {
  const fixture = await videoFixture(8);
  const controller = new AbortController();
  const upload = uploadYouTubeResumable({
    filePath: fixture, fileSize: 8, contentType: 'video/mp4', uploadUrl: 'https://upload.test/session',
    signal: controller.signal, getAccessToken: async () => 'access',
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(upload, (error) => error.code === 'cancelled');
  assert.equal((await stat(fixture)).size, 8);
});

test('YouTube client sends metadata and optional thumbnail to the correct APIs', async () => {
  const requests = [];
  const client = new YouTubeClient(config(), { fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/upload/youtube/v3/videos')) return response(200, null, { location: 'https://upload.test/session' });
    if (String(url).includes('/youtube/v3/videos') && init.method === 'PUT') return jsonResponse({ id: 'video-id', status: JSON.parse(init.body).status });
    if (String(url).includes('/youtube/v3/videos')) return jsonResponse({ items: [{ status: { privacyStatus: 'private', embeddable: true } }] });
    return jsonResponse({ items: [] });
  } });
  const session = await client.initializeResumableUpload('access', { sizeBytes: 8, contentType: 'video/mp4' }, { title: 'Kr8', privacy: 'private', categoryId: '10' });
  assert.equal(session.uploadUrl, 'https://upload.test/session');
  const resource = JSON.parse(requests[0].init.body);
  assert.equal(resource.snippet.categoryId, '10');
  assert.equal(resource.status.privacyStatus, 'private');
  assert.equal(resource.status.containsSyntheticMedia, true);
  await client.updateVideoStatus('access', 'video-id', { title: 'Kr8', privacy: 'private', categoryId: '10', containsSyntheticMedia: true });
  const updated = JSON.parse(requests[2].init.body);
  assert.equal(requests[2].init.method, 'PUT');
  assert.equal(updated.id, 'video-id');
  assert.equal(updated.status.containsSyntheticMedia, true);
  assert.equal(updated.status.embeddable, true);
  await client.setThumbnail('access', 'video-id', { contentType: 'image/png', buffer: Buffer.from('png') });
  assert.match(requests[3].url, /thumbnails\/set/);
});

test('YouTube provider refreshes tokens and reports effective forced privacy', async () => {
  const fixture = await videoFixture(8);
  const store = memoryStore({
    access_token: 'old', refresh_token: 'refresh', scope: YOUTUBE_REQUIRED_SCOPES, expires_at: 0,
    token_type: 'Bearer', profile: { channelId: 'channel', displayName: 'TKMusic', avatarUrl: '' }
  });
  const client = fakeClient();
  const provider = new YouTubeProvider({
    config: config(), tokenStore: store, client, statusPollIntervalMs: 0,
    fetchImpl: async () => jsonResponse({ id: 'video-id' }, 201)
  });
  const connected = await provider.getConnectionStatus();
  assert.equal(connected.connected, true);
  assert.equal(client.refreshCalls, 1);
  const started = provider.startUpload({ valid: true, path: fixture, sizeBytes: 8, contentType: 'video/mp4' }, { title: 'Kr8', privacy: 'public' });
  await provider.jobs.get(started.jobId).done;
  const finished = provider.getProgress(started.jobId);
  assert.equal(finished.status, 'uploaded');
  assert.equal(finished.requestedPrivacy, 'public');
  assert.equal(finished.effectivePrivacy, 'private');
  assert.equal(finished.effectiveSyntheticMedia, true);
  assert.equal(finished.videoUrl, 'https://www.youtube.com/watch?v=video-id');
});

test('YouTube credential store is separate and no secret is written to a project', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-youtube-store-'));
  const projectPath = path.join(directory, 'project.json');
  const tokenPath = path.join(directory, 'private', 'youtube-token.json');
  await writeFile(projectPath, JSON.stringify({ schemaVersion: 1, name: 'Project' }));
  const store = new LocalCredentialStore({ provider: 'youtube', filePath: tokenPath, normalizeRecord: normalizeYouTubeTokenRecord });
  await store.save({ access_token: 'access-secret', refresh_token: 'refresh-secret', scope: YOUTUBE_REQUIRED_SCOPES, expires_at: 100 });
  assert.match(await readFile(tokenPath, 'utf8'), /refresh-secret/);
  const project = await readFile(projectPath, 'utf8');
  assert.doesNotMatch(project, /access-secret|refresh-secret|client-secret/);
});

function config() {
  return { clientId: 'client', clientSecret: 'client-secret', configured: true, missing: [], scopes: [...YOUTUBE_REQUIRED_SCOPES] };
}

function fakeClient() {
  return {
    refreshCalls: 0,
    async refreshToken() { this.refreshCalls += 1; return { access_token: 'new', refresh_token: 'refresh', expires_in: 3600, scope: YOUTUBE_REQUIRED_SCOPES.join(' ') }; },
    async initializeResumableUpload() { return { uploadUrl: 'https://upload.test/session' }; },
    async updateVideoStatus() { return { id: 'video-id', status: { containsSyntheticMedia: true } }; },
    async getVideoStatus() { return { videoId: 'video-id', privacy: 'private', containsSyntheticMedia: null, uploadStatus: 'processed', processingStatus: 'succeeded', channelId: 'channel', channelTitle: 'TKMusic' }; },
    async getChannelInfo() { return { channelId: 'channel', displayName: 'TKMusic', avatarUrl: '' }; },
    async setThumbnail() {}, async revoke() {}
  };
}

function memoryStore(initial = null) {
  return {
    value: initial,
    async load() { return this.value ? structuredClone(this.value) : null; },
    async save(value) { this.value = structuredClone(value); return this.value; },
    async clear() { this.value = null; }
  };
}

async function videoFixture(size) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-youtube-upload-'));
  const filePath = path.join(directory, 'reel.mp4');
  await writeFile(filePath, Buffer.alloc(size, 7));
  return filePath;
}

function response(status, payload = null, headers = {}) {
  return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
}

function jsonResponse(payload, status = 200, headers = {}) {
  return response(status, payload, { 'content-type': 'application/json', ...headers });
}
