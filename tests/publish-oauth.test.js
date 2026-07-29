import assert from 'node:assert/strict';
import test from 'node:test';

import { createOAuthCallbackServer } from '../src/publish/oauthCallback.js';
import { TikTokClient } from '../src/publish/providers/tiktok/tiktokClient.js';

test('OAuth callback uses an ephemeral localhost port and exact path', async () => {
  const server = await createOAuthCallbackServer({ state: 'expected-state', timeoutMs: 1000 });
  try {
    assert.match(server.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/tiktok\/callback\/$/);
    const wrong = await fetch(`http://127.0.0.1:${server.port}/tiktok/callback`);
    assert.equal(wrong.status, 404);
    const response = await fetch(`${server.redirectUri}?code=abc&state=expected-state`);
    assert.equal(response.status, 200);
    assert.deepEqual(await server.callback, { code: 'abc', state: 'expected-state' });
  } finally {
    server.close();
  }
});

test('OAuth callback rejects a state mismatch', async () => {
  const server = await createOAuthCallbackServer({ state: 'expected', timeoutMs: 1000 });
  const response = await fetch(`${server.redirectUri}?code=abc&state=wrong`);
  assert.equal(response.status, 400);
  await assert.rejects(server.callback, (error) => error.code === 'state_mismatch');
});

test('OAuth callback handles access_denied explicitly', async () => {
  const server = await createOAuthCallbackServer({ state: 'expected', timeoutMs: 1000 });
  const response = await fetch(`${server.redirectUri}?error=access_denied&state=expected`);
  assert.equal(response.status, 400);
  await assert.rejects(server.callback, (error) => error.code === 'access_denied');
});

test('OAuth callback times out and closes its temporary server', async () => {
  const server = await createOAuthCallbackServer({ state: 'expected', timeoutMs: 30 });
  await assert.rejects(server.callback, (error) => error.code === 'timeout');
});

test('TikTok token exchange includes desktop PKCE and redirect URI', async () => {
  let request;
  const client = new TikTokClient(config(), {
    fetchImpl: async (url, init) => {
      request = { url, init, body: Object.fromEntries(init.body.entries()) };
      return jsonResponse({ access_token: 'access', refresh_token: 'refresh', open_id: 'open', expires_in: 10, refresh_expires_in: 20, scope: 'user.info.basic,video.upload' });
    }
  });
  await client.exchangeCode({ code: 'code', redirectUri: 'http://127.0.0.1:1234/tiktok/callback/', codeVerifier: 'verifier' });

  assert.match(request.url, /oauth\/token/);
  assert.equal(request.body.grant_type, 'authorization_code');
  assert.equal(request.body.code_verifier, 'verifier');
  assert.equal(request.body.redirect_uri, 'http://127.0.0.1:1234/tiktok/callback/');
});

test('TikTok refresh uses a rotated refresh token response', async () => {
  let body;
  const client = new TikTokClient(config(), {
    fetchImpl: async (_url, init) => {
      body = Object.fromEntries(init.body.entries());
      return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', open_id: 'open', expires_in: 10, refresh_expires_in: 20, scope: 'user.info.basic,video.upload' });
    }
  });
  const payload = await client.refreshToken('old-refresh');
  assert.equal(body.grant_type, 'refresh_token');
  assert.equal(body.refresh_token, 'old-refresh');
  assert.equal(payload.refresh_token, 'new-refresh');
});

function config() {
  return { clientKey: 'key', clientSecret: 'secret', scopes: ['user.info.basic', 'video.upload'] };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
