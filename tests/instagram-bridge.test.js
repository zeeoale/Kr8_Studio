import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createBridgeServer } from '../bridge/instagram-media-bridge/src/server.js';
import { BridgeStore } from '../bridge/instagram-media-bridge/src/store.js';

const AUTH = 'bridge-test-secret-at-least-24-chars';

test('bridge authenticates uploads, serves opaque media with Range/HEAD, cleans up and returns 410', async (t) => {
  const fixture = await bridgeFixture(t);
  const unauthorized = await fetch(`${fixture.base}/v1/media`, { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '5' }, body: Buffer.from('video') });
  assert.equal(unauthorized.status, 401);
  const video = mp4('video');
  const uploaded = await upload(fixture.base, video);
  assert.doesNotMatch(uploaded.mediaUrl, /video|\.mp4/);
  const full = await fetch(uploaded.mediaUrl);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), video);
  const head = await fetch(uploaded.mediaUrl, { method: 'HEAD' });
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const partial = await fetch(uploaded.mediaUrl, { headers: { range: 'bytes=4-7' } });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), 'ftyp');
  const removed = await fetch(`${fixture.base}/v1/media/${uploaded.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(removed.status, 200);
  assert.equal((await fetch(uploaded.mediaUrl)).status, 410);
});

test('bridge rejects MIME, traversal and upload rate excess', async (t) => {
  const fixture = await bridgeFixture(t, { uploadsPerHour: 1 });
  const badMime = await fetch(`${fixture.base}/v1/media`, { method: 'POST', headers: { ...auth(), 'content-type': 'text/plain', 'content-length': '1' }, body: Buffer.from('x') });
  assert.equal(badMime.status, 415);
  await upload(fixture.base, mp4('first'));
  const limited = await fetch(`${fixture.base}/v1/media`, { method: 'POST', headers: { ...auth(), 'content-type': 'video/mp4', 'content-length': '6' }, body: Buffer.from('second') });
  assert.equal(limited.status, 429);
  assert.equal((await fetch(`${fixture.base}/m/../../etc/passwd`)).status, 404);
});

test('bridge rejects a forged video/mp4 MIME when the MP4 signature is absent', async (t) => {
  const fixture = await bridgeFixture(t);
  const body = Buffer.from('this-is-not-an-mp4');
  const response = await fetch(`${fixture.base}/v1/media`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'video/mp4', 'content-length': String(body.length) }, body
  });
  assert.equal(response.status, 415);
  assert.deepEqual(await readdir(fixture.store.paths.media), []);
});

test('bridge expires media and interrupted store upload leaves no partial file', async (t) => {
  let now = Date.now();
  const fixture = await bridgeFixture(t, { clock: () => now, ttlMs: 60_000 });
  const uploaded = await upload(fixture.base, mp4('expires'));
  now += 61_000;
  assert.equal((await fetch(uploaded.mediaUrl)).status, 410);

  const broken = new Readable({ read() { this.push(Buffer.from('half')); this.destroy(new Error('connection reset')); } });
  await assert.rejects(() => fixture.store.receive(broken, { contentType: 'video/mp4', size: 8, sha256: '' }), /connection reset/);
  assert.deepEqual(await readdir(fixture.store.paths.tmp), []);
});

async function bridgeFixture(t, overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-instagram-bridge-'));
  const config = {
    host: '127.0.0.1', port: 0, publicBaseUrl: 'http://127.0.0.1', authToken: AUTH, dataDir,
    ttlMs: overrides.ttlMs || 60_000, tombstoneTtlMs: 60_000, maxBytes: 1_000_000,
    uploadsPerHour: overrides.uploadsPerHour || 20, cleanupIntervalMs: 60_000
  };
  const store = new BridgeStore(config, { clock: overrides.clock });
  const server = await createBridgeServer({ config, store, clock: overrides.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  config.publicBaseUrl = base;
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { base, store };
}

async function upload(base, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const response = await fetch(`${base}/v1/media`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'video/mp4', 'content-length': String(payload.length) }, body: payload
  });
  assert.equal(response.status, 201);
  return response.json();
}
function auth() { return { authorization: `Bearer ${AUTH}` }; }
function mp4(label) {
  const payload = Buffer.from(String(label));
  const header = Buffer.alloc(12); header.writeUInt32BE(12 + payload.length, 0); header.write('ftyp', 4); header.write('isom', 8);
  return Buffer.concat([header, payload]);
}
