import http from 'node:http';

import { secureEqual } from './security.js';

export class OAuthCallbackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OAuthCallbackError';
    this.code = code;
  }
}

export async function createOAuthCallbackServer(options = {}) {
  const expectedState = String(options.state || '');
  if (!expectedState) throw new Error('OAuth state is required.');
  const callbackPath = String(options.callbackPath || '/tiktok/callback/');
  const providerName = String(options.providerName || 'TikTok');
  const timeoutMs = Math.max(100, Number(options.timeoutMs || 180_000));
  let settled = false;
  let resolveCallback;
  let rejectCallback;
  let timer;

  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  callback.catch(() => {});

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== callbackPath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const errorCode = String(url.searchParams.get('error') || '');
    const returnedState = String(url.searchParams.get('state') || '');
    if (!secureEqual(returnedState, expectedState)) {
      finish(new OAuthCallbackError('state_mismatch', `${providerName} login state verification failed.`), response, 400);
      return;
    }
    if (errorCode) {
      const message = errorCode === 'access_denied'
        ? `${providerName} access was denied.`
        : `${providerName} login failed: ${errorCode}.`;
      finish(new OAuthCallbackError(errorCode, message), response, 400);
      return;
    }
    const code = String(url.searchParams.get('code') || '');
    if (!code) {
      finish(new OAuthCallbackError('missing_code', `${providerName} login returned no authorization code.`), response, 400);
      return;
    }
    settled = true;
    clearTimeout(timer);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(successPage(providerName));
    resolveCallback({ code, state: returnedState });
    setImmediate(() => server.close());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCallback(new OAuthCallbackError('timeout', `${providerName} login timed out.`));
    server.close();
  }, timeoutMs);
  timer.unref?.();

  return {
    port,
    redirectUri,
    callback,
    close() {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectCallback(new OAuthCallbackError('cancelled', `${providerName} login was cancelled.`));
      }
      server.close();
    }
  };

  function finish(error, response, statusCode) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
    response.end(errorPage(error.message));
    rejectCallback(error);
    setImmediate(() => server.close());
  }
}

function successPage(providerName) {
  const safe = escapeHtml(providerName);
  return `<!doctype html><meta charset="utf-8"><title>Kr8 Studio</title><body style="background:#11151a;color:#fff;font:16px Segoe UI,sans-serif;padding:40px"><h1>${safe} authorization received</h1><p>Return to Kr8 Studio to see the final connection status, then close this tab.</p></body>`;
}

function errorPage(message) {
  const safe = escapeHtml(message || 'Login failed.');
  return `<!doctype html><meta charset="utf-8"><title>Kr8 Studio</title><body style="background:#11151a;color:#fff;font:16px Segoe UI,sans-serif;padding:40px"><h1>Connection failed</h1><p>${safe}</p><p>Return to Kr8 Studio to try again.</p></body>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
