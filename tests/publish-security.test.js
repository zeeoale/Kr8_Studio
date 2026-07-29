import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildTikTokConfig, publicTikTokConfig } from '../src/publish/config.js';
import { defaultPublishDataPath, LocalCredentialStore, LocalPublishSettingsStore } from '../src/publish/credentialStore.js';
import { createOAuthState, createPkcePair, redactSensitive } from '../src/publish/security.js';

test('TikTok config detects absent credentials and never exposes a secret publicly', () => {
  const missing = buildTikTokConfig({ TIKTOK_ENV: 'sandbox' });
  const configured = buildTikTokConfig({ TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret', TIKTOK_ENV: 'sandbox' });

  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']);
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.scopes, ['user.info.basic', 'video.upload']);
  assert.equal(JSON.stringify(publicTikTokConfig(configured)).includes('secret'), false);
  assert.equal(JSON.stringify(publicTikTokConfig(configured)).includes('key'), false);
});

test('OAuth state and PKCE values are random and correctly shaped', () => {
  const first = createOAuthState();
  const second = createOAuthState();
  const pkce = createPkcePair();

  assert.notEqual(first, second);
  assert.ok(first.length >= 32);
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pkce.method, 'S256');
});

test('secret redaction handles nested fields and token-like strings', () => {
  const value = redactSensitive({
    client_secret: 'very-secret',
    nested: { authorization: 'Bearer act.1234567890abcdef', note: 'contains very-secret' }
  }, ['very-secret']);

  assert.equal(value.client_secret, '[REDACTED]');
  assert.equal(value.nested.authorization, '[REDACTED]');
  assert.equal(value.nested.note, 'contains [REDACTED]');
});

test('credential store persists and deletes tokens outside project data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-token-'));
  const filePath = path.join(directory, 'private', 'token.json');
  const store = new LocalCredentialStore({ filePath });
  const record = await store.save({
    access_token: 'access', refresh_token: 'refresh', open_id: 'open', scope: 'video.upload,user.info.basic',
    expires_at: 100, refresh_expires_at: 200, token_type: 'Bearer'
  });

  assert.deepEqual(record.scope, ['user.info.basic', 'video.upload']);
  assert.equal((await store.load()).refresh_token, 'refresh');
  assert.match(await readFile(filePath, 'utf8'), /"access_token": "access"/);
  await store.clear();
  assert.equal(await store.load(), null);
});

test('KR8_PUBLISH_DATA_DIR is the final shared Publisher directory', () => {
  const previous = process.env.KR8_PUBLISH_DATA_DIR;
  const directory = path.join(os.tmpdir(), 'kr8-shared-publisher');
  process.env.KR8_PUBLISH_DATA_DIR = directory;
  try {
    assert.equal(defaultPublishDataPath('youtube-token.json'), path.join(directory, 'youtube-token.json'));
    assert.equal(defaultPublishDataPath('youtube-token.json').includes(path.join('Kr8 Studio', 'publish', 'Kr8 Studio')), false);
  } finally {
    if (previous === undefined) delete process.env.KR8_PUBLISH_DATA_DIR;
    else process.env.KR8_PUBLISH_DATA_DIR = previous;
  }
});

test('non-sensitive publish settings persist without token fields', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-settings-'));
  const filePath = path.join(directory, 'settings.json');
  const store = new LocalPublishSettingsStore({ filePath });
  const settings = await store.save({ chunkSizeMiB: 32, access_token: 'must-not-persist' });
  const text = await readFile(filePath, 'utf8');

  assert.equal(settings.chunkSizeMiB, 32);
  assert.equal(text.includes('must-not-persist'), false);
  assert.equal(text.includes('access_token'), false);
});
