import assert from 'node:assert/strict';
import test from 'node:test';

import { PublishService } from '../src/publish/publishService.js';

test('publish service requires explicit confirmation before any upload', async () => {
  const provider = fakeProvider({ connected: true });
  const service = serviceWith(provider);
  await assert.rejects(() => service.startUpload('project', { confirmed: false }), /confirmation is required/);
  assert.equal(provider.uploadCalls, 0);
});

test('publish service rejects disconnected accounts and invalid media', async () => {
  const disconnected = fakeProvider({ connected: false });
  await assert.rejects(() => serviceWith(disconnected).startUpload('project', { confirmed: true }), /Connect TikTok/);

  const invalid = fakeProvider({ connected: true });
  const service = serviceWith(invalid, { valid: false, errors: ['Bad video.'] });
  await assert.rejects(() => service.startUpload('project', { confirmed: true }), /Bad video/);
});

test('publish service forwards progress and controlled cancellation', async () => {
  const provider = fakeProvider({ connected: true });
  const service = serviceWith(provider);
  const started = await service.startUpload('project', { confirmed: true, caption: 'Draft note' });

  assert.equal(started.status, 'uploading');
  assert.equal(service.getUploadProgress(started.jobId).progress, 0.5);
  assert.equal(service.cancelUpload(started.jobId), true);
  assert.equal(provider.caption, 'Draft note');
});

test('connection jobs expose failure without throwing secrets to the caller', async () => {
  const provider = fakeProvider({ connected: false });
  provider.connect = async () => { throw new Error('Login failed with secret-value'); };
  const service = serviceWith(provider, compatibleMedia(), ['secret-value']);
  const started = service.startConnect();
  await service.connectionJobs.get(started.jobId).done;
  const result = service.getConnectProgress(started.jobId);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Login failed/);
  assert.doesNotMatch(result.error, /secret-value/);
});

test('connection jobs expose the OAuth URL without asking the service session to open a browser', async () => {
  const provider = fakeProvider({ connected: false });
  provider.connect = async ({ onAuthorizationUrl }) => {
    onAuthorizationUrl('https://accounts.example.test/oauth?state=opaque');
    return { connected: true };
  };
  const service = serviceWith(provider);
  const started = service.startConnect();
  const ready = await service.waitForConnectAuthorization(started.jobId, 'tiktok');
  assert.equal(ready.authorizationUrl, 'https://accounts.example.test/oauth?state=opaque');
  await service.connectionJobs.get(started.jobId).done;
  assert.equal(service.getConnectProgress(started.jobId).status, 'connected');
});

test('connection jobs reject non-HTTPS authorization URLs', async () => {
  const provider = fakeProvider({ connected: false });
  provider.connect = async ({ onAuthorizationUrl }) => {
    onAuthorizationUrl('http://accounts.example.test/oauth');
    return { connected: true };
  };
  const service = serviceWith(provider);
  const started = service.startConnect();
  await service.connectionJobs.get(started.jobId).done;
  const result = service.getConnectProgress(started.jobId);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /must use HTTPS/);
});

function serviceWith(provider, media = compatibleMedia(), errorSecrets = []) {
  return new PublishService({
    providers: { tiktok: provider },
    findLatestReel: async () => ({ outputPath: 'reel.mp4', relativePath: 'exports/reels/reel.mp4' }),
    validateMedia: async () => media,
    settingsStore: { load: async () => ({ chunkSizeMiB: 16 }), save: async (value) => value },
    errorSecrets
  });
}

function fakeProvider(connection) {
  return {
    uploadCalls: 0,
    caption: '',
    async getConnectionStatus() { return connection; },
    async connect() { return { connected: true }; },
    async disconnect() { return { connected: false }; },
    validateMedia(media) { return media; },
    startUpload(_media, options) { this.uploadCalls += 1; this.caption = options.caption; return { jobId: 'job', status: 'uploading' }; },
    cancel() { return true; },
    getProgress() { return { jobId: 'job', status: 'uploading', progress: 0.5 }; }
  };
}

function compatibleMedia() {
  return { valid: true, errors: [], path: 'reel.mp4', sizeBytes: 100, contentType: 'video/mp4' };
}
