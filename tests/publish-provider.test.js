import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { TikTokProvider, tokenRecordFromResponse } from '../src/publish/providers/tiktok/tiktokProvider.js';
import { TikTokApiError, TikTokClient } from '../src/publish/providers/tiktok/tiktokClient.js';
import { createTikTokPkcePair } from '../src/publish/providers/tiktok/pkce.js';

test('TikTok desktop PKCE uses its required SHA-256 hex challenge', async () => {
  const { createHash } = await import('node:crypto');
  const pkce = createTikTokPkcePair();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(pkce.challenge, /^[a-f0-9]{64}$/);
  assert.equal(pkce.challenge, createHash('sha256').update(pkce.verifier).digest('hex'));
  assert.equal(pkce.method, 'S256');
});

test('TikTok connect verifies callback, exchanges token and stores account profile', async () => {
  const store = memoryStore();
  let openedUrl = '';
  const client = fakeClient();
  const provider = new TikTokProvider({
    config: config(), tokenStore: store, client,
    callbackFactory: async ({ state }) => ({
      redirectUri: 'http://127.0.0.1:3210/tiktok/callback/',
      callback: Promise.resolve({ code: 'auth-code', state }),
      close() {}
    }),
    browserOpener: (url) => { openedUrl = url; },
    clock: () => 1_000
  });

  const status = await provider.connect();
  assert.equal(status.connected, true);
  assert.equal(status.displayName, 'Kr8 Sandbox');
  assert.match(openedUrl, /code_challenge=/);
  assert.match(new URL(openedUrl).searchParams.get('code_challenge'), /^[a-f0-9]{64}$/);
  assert.equal(store.value.open_id, 'open-id');
  assert.equal(store.value.profile.displayName, 'Kr8 Sandbox');
});

test('expired access token refreshes automatically and rotates refresh token', async () => {
  const store = memoryStore({
    access_token: 'old-access', refresh_token: 'old-refresh', open_id: 'open-id',
    scope: ['user.info.basic', 'video.upload'], expires_at: 100, refresh_expires_at: 100_000,
    token_type: 'Bearer', profile: { displayName: 'Cached', avatarUrl: '' }
  });
  const client = fakeClient();
  const provider = new TikTokProvider({ config: config(), tokenStore: store, client, clock: () => 10_000 });
  const status = await provider.getConnectionStatus();

  assert.equal(status.connected, true);
  assert.equal(client.refreshCalls, 1);
  assert.equal(store.value.refresh_token, 'rotated-refresh');
});

test('expired refresh token clears local credentials and becomes disconnected', async () => {
  const store = memoryStore({
    access_token: 'access', refresh_token: 'refresh', open_id: 'open-id', scope: ['user.info.basic', 'video.upload'],
    expires_at: 100, refresh_expires_at: 200, token_type: 'Bearer', profile: null
  });
  const provider = new TikTokProvider({ config: config(), tokenStore: store, client: fakeClient(), clock: () => 1_000 });
  const status = await provider.getConnectionStatus();
  assert.equal(status.connected, false);
  assert.equal(store.value, null);
});

test('revoked access token during account lookup clears local credentials', async () => {
  const token = validToken();
  token.profile = null;
  const store = memoryStore(token);
  const client = fakeClient();
  client.getUserInfo = async () => { throw new TikTokApiError('revoked', { code: 'access_token_invalid', status: 401 }); };
  const provider = new TikTokProvider({ config: config(), tokenStore: store, client });
  const status = await provider.getConnectionStatus();
  assert.equal(status.connected, false);
  assert.equal(store.value, null);
});

test('disconnect revokes when possible and always deletes the local token', async () => {
  const store = memoryStore(validToken());
  const client = fakeClient();
  const provider = new TikTokProvider({ config: config(), tokenStore: store, client });
  const status = await provider.disconnect();
  assert.equal(status.connected, false);
  assert.equal(client.revokeCalls, 1);
  assert.equal(store.value, null);
});

test('token response computes absolute expirations and preserves rotated fields', () => {
  const record = tokenRecordFromResponse({
    access_token: 'access', refresh_token: 'refresh', open_id: 'open', scope: 'video.upload,user.info.basic',
    expires_in: 10, refresh_expires_in: 20, token_type: 'Bearer'
  }, 1_000);
  assert.equal(record.expires_at, 11_000);
  assert.equal(record.refresh_expires_at, 21_000);
  assert.deepEqual(record.scope, ['user.info.basic', 'video.upload']);
});

test('TikTok upload init rejects a response without upload_url', async () => {
  const client = new TikTokClient(config(), { fetchImpl: async () => jsonResponse({ data: { publish_id: 'id' }, error: { code: 'ok' } }) });
  await assert.rejects(() => client.initializeUpload('access', { video_size: 8, chunk_size: 8, total_chunk_count: 1 }), (error) => error.code === 'missing_upload_url');
});

test('TikTok API surfaces access_token_invalid and scope_not_authorized codes', async () => {
  for (const code of ['access_token_invalid', 'scope_not_authorized']) {
    const client = new TikTokClient(config(), { fetchImpl: async () => jsonResponse({ error: { code, message: code } }, 401) });
    await assert.rejects(() => client.initializeUpload('access', { video_size: 8, chunk_size: 8, total_chunk_count: 1 }), (error) => error.code === code);
  }
});

test('TikTok status fetch returns inbox delivery and failure details', async () => {
  const client = new TikTokClient(config(), { fetchImpl: async () => jsonResponse({
    data: { status: 'SEND_TO_USER_INBOX', fail_reason: '', uploaded_bytes: 123 },
    error: { code: 'ok' }
  }) });
  assert.deepEqual(await client.getPublishStatus('access', 'publish-id'), {
    status: 'SEND_TO_USER_INBOX', failReason: '', uploadedBytes: 123
  });
});

test('provider uploads a valid draft and reports publish id only on completion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-provider-upload-'));
  const filePath = path.join(directory, 'reel.mp4');
  await writeFile(filePath, '12345678');
  const store = memoryStore(validToken());
  const client = fakeClient();
  let uploadCalls = 0;
  const provider = new TikTokProvider({
    config: config(), tokenStore: store, client,
    fetchImpl: async () => { uploadCalls += 1; return { ok: true, status: 201 }; },
    clock: () => Date.now()
  });
  const started = provider.startUpload({ valid: true, path: filePath, sizeBytes: 8, contentType: 'video/mp4' });
  assert.equal(started.publishId, '');
  await provider.jobs.get(started.jobId).done;
  const finished = provider.getProgress(started.jobId);
  assert.equal(finished.status, 'uploaded');
  assert.equal(finished.tikTokStatus, 'SEND_TO_USER_INBOX');
  assert.equal(finished.publishId, 'publish-id');
  assert.equal(uploadCalls, 1);
});

function config() {
  return { clientKey: 'key', clientSecret: 'secret', environment: 'sandbox', configured: true, missing: [], scopes: ['user.info.basic', 'video.upload'] };
}

function validToken() {
  const now = Date.now();
  return {
    access_token: 'access', refresh_token: 'refresh', open_id: 'open-id', scope: ['user.info.basic', 'video.upload'],
    expires_at: now + 60 * 60 * 1000, refresh_expires_at: now + 24 * 60 * 60 * 1000, token_type: 'Bearer',
    profile: { displayName: 'Kr8 Sandbox', avatarUrl: '' }
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

function fakeClient() {
  return {
    refreshCalls: 0,
    revokeCalls: 0,
    buildAuthorizationUrl: ({ redirectUri, state, codeChallenge }) => `https://www.tiktok.com/v2/auth/authorize/?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}`,
    async exchangeCode() { return { access_token: 'access', refresh_token: 'refresh', open_id: 'open-id', expires_in: 3600, refresh_expires_in: 86400, scope: 'user.info.basic,video.upload', token_type: 'Bearer' }; },
    async refreshToken() { this.refreshCalls += 1; return { access_token: 'new-access', refresh_token: 'rotated-refresh', open_id: 'open-id', expires_in: 3600, refresh_expires_in: 86400, scope: 'user.info.basic,video.upload', token_type: 'Bearer' }; },
    async revoke() { this.revokeCalls += 1; return true; },
    async getUserInfo() { return { openId: 'open-id', displayName: 'Kr8 Sandbox', avatarUrl: 'https://example.test/avatar.jpg' }; },
    async initializeUpload() { return { uploadUrl: 'https://upload.example.test/session?signature=kept', publishId: 'publish-id' }; },
    async getPublishStatus() { return { status: 'SEND_TO_USER_INBOX', failReason: '', uploadedBytes: 8 }; }
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
