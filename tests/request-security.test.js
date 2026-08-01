import assert from 'node:assert/strict';
import test from 'node:test';

import { validateHttpRequest } from '../src/server/requestSecurity.js';

function request(headers = {}, method = 'GET') {
  return { method, headers, socket: { localPort: 5174 } };
}

test('request policy accepts exact local Host and trusted local Origin', () => {
  assert.equal(validateHttpRequest(request({ host: '127.0.0.1:5174' })).allowed, true);
  assert.equal(validateHttpRequest(request({
    host: 'localhost:5174',
    origin: 'http://localhost:5174',
    'sec-fetch-site': 'same-origin'
  }, 'POST')).allowed, true);
});

test('request policy allows missing Origin for non-browser clients but not browser writes', () => {
  assert.equal(validateHttpRequest(request({ host: '127.0.0.1:5174' }, 'POST')).allowed, true);
  const browserWrite = validateHttpRequest(request({
    host: '127.0.0.1:5174',
    'sec-fetch-site': 'same-origin'
  }, 'POST'));
  assert.equal(browserWrite.allowed, false);
  assert.equal(browserWrite.statusCode, 403);
});

test('request policy rejects malicious Origin, cross-site metadata, and malformed Host', () => {
  for (const candidate of [
    request({ host: '127.0.0.1:5174', origin: 'https://evil.example' }, 'POST'),
    request({ host: '127.0.0.1:5174', 'sec-fetch-site': 'cross-site' }, 'POST'),
    request({ host: 'evil.example:5174' }),
    request({ host: '127.0.0.1:9999' }),
    request({ host: '' })
  ]) {
    assert.equal(validateHttpRequest(candidate).allowed, false);
  }
});

test('trusted VPN origins require explicit configuration', () => {
  const vpnRequest = request({
    host: 'kr8.vpn.example',
    origin: 'https://kr8.vpn.example',
    'sec-fetch-site': 'same-origin'
  }, 'POST');
  assert.equal(validateHttpRequest(vpnRequest).allowed, false);
  assert.equal(validateHttpRequest(vpnRequest, { trustedOrigins: ['https://kr8.vpn.example'] }).allowed, true);
});
