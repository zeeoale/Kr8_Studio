import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';

test('editor health endpoint is lightweight, public and contains no sensitive configuration', async () => {
  const previousUser = process.env.KR8_AUTH_USER;
  const previousPassword = process.env.KR8_AUTH_PASSWORD;
  process.env.KR8_AUTH_USER = 'health-test-user';
  process.env.KR8_AUTH_PASSWORD = 'health-test-secret';
  const projectPath = path.resolve(import.meta.dirname, '..', 'examples', 'blank.kr8', 'project.json');
  const server = await createEditorServer({ projectPath, host: '127.0.0.1', port: 0, envPath: 'missing-health-test.env' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    for (const endpoint of ['/api/health', '/api/server/health']) {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`);
      const text = await response.text();
      const payload = JSON.parse(text);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(payload).sort(), ['service', 'status', 'timestamp', 'version']);
      assert.equal(payload.status, 'ok');
      assert.equal(payload.service, 'Kr8 Studio');
      assert.match(payload.version, /^\d+\.\d+\.\d+/);
      assert.equal(Number.isNaN(Date.parse(payload.timestamp)), false);
      assert.equal(text.includes('health-test-secret'), false);
      assert.equal(text.includes(projectPath), false);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }

    const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/project`);
    assert.equal(protectedResponse.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore('KR8_AUTH_USER', previousUser);
    restore('KR8_AUTH_PASSWORD', previousPassword);
  }
});

test('editor server serves Publish UI and exposes only safe TikTok status', async () => {
  const previousKey = process.env.TIKTOK_CLIENT_KEY;
  const previousSecret = process.env.TIKTOK_CLIENT_SECRET;
  const previousPublishDataDir = process.env.KR8_PUBLISH_DATA_DIR;
  const publishDataDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-publish-server-'));
  process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
  process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
  process.env.KR8_PUBLISH_DATA_DIR = publishDataDir;
  const projectPath = path.resolve(import.meta.dirname, '..', 'examples', 'blank.kr8', 'project.json');
  const projectBefore = await readFile(projectPath, 'utf8');
  const server = await createEditorServer({ projectPath, host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const page = await fetch(`http://127.0.0.1:${port}/publish/index.html`);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /Kr8 Publish/);
    assert.match(pageHtml, /authorizationLink/);

    const contextResponse = await fetch(`http://127.0.0.1:${port}/api/publish/context`);
    const text = await contextResponse.text();
    const context = JSON.parse(text);
    assert.equal(contextResponse.status, 200);
    assert.equal(context.available, false);
    assert.equal(context.connection.connected, false);
    assert.equal(text.includes('test-client-key'), false);
    assert.equal(text.includes('test-client-secret'), false);

    const upload = await fetch(`http://127.0.0.1:${port}/api/publish/tiktok/upload/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: false })
    });
    assert.equal(upload.status, 409);
    const projectAfter = await readFile(projectPath, 'utf8');
    assert.equal(projectAfter, projectBefore);
    assert.equal(projectAfter.includes('test-client-secret'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore('TIKTOK_CLIENT_KEY', previousKey);
    restore('TIKTOK_CLIENT_SECRET', previousSecret);
    restore('KR8_PUBLISH_DATA_DIR', previousPublishDataDir);
    await rm(publishDataDir, { recursive: true, force: true });
  }
});

test('editor server opens a selected Kr8 project without requiring a typed path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-project-picker-server-'));
  const firstDirectory = path.join(root, 'first.kr8');
  const selectedDirectory = path.join(root, 'selected.kr8');
  await mkdir(firstDirectory, { recursive: true });
  await mkdir(selectedDirectory, { recursive: true });
  const firstPath = path.join(firstDirectory, 'project.json');
  const selectedPath = path.join(selectedDirectory, 'project.json');
  await writeFile(firstPath, JSON.stringify(project('First')));
  await writeFile(selectedPath, JSON.stringify(project('Selected')));
  const server = await createEditorServer({
    projectPath: firstPath,
    projectsRoot: root,
    host: '127.0.0.1',
    port: 0,
    projectFileSelector: async () => ({ supported: true, path: selectedPath })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/project/select`, { method: 'POST' });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.cancelled, false);
    assert.equal(payload.project.name, 'Selected');
    assert.equal(payload.projectPath, selectedPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('editor server serves the dedicated mobile companion and a sanitized project context', async () => {
  const projectPath = path.resolve(import.meta.dirname, '..', 'examples', 'kr8-demo-landscape.kr8', 'project.json');
  const server = await createEditorServer({ projectPath, host: '127.0.0.1', port: 0, envPath: 'missing-mobile-test.env' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const redirect = await fetch(`http://127.0.0.1:${port}/mobile`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/mobile/');

    const page = await fetch(`http://127.0.0.1:${port}/mobile/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Kr8 Mobile/);
    assert.match(html, /Headless render/);
    assert.match(html, /Open Publisher/);
    assert.match(html, /stageCanvas/);
    assert.match(html, /9:16 Vertical/);
    assert.match(html, /TKMusic Library/);
    assert.match(html, /Inspector/);

    const contextResponse = await fetch(`http://127.0.0.1:${port}/api/mobile/context`);
    const contextText = await contextResponse.text();
    const context = JSON.parse(contextText);
    assert.equal(contextResponse.status, 200);
    assert.equal(context.project.title, 'Signal Bloom');
    assert.equal(context.media.audioUrl.startsWith('/api/assets/'), true);
    assert.equal(context.media.coverUrl.startsWith('/api/assets/'), true);
    assert.equal(context.media.lyricsUrl.startsWith('/api/assets/'), true);
    assert.equal(context.layers.some((layer) => layer.type === 'visualizer'), true);
    assert.equal(contextText.includes('C:\\NodeApp'), false);
    assert.equal(contextText.includes('../../../TKMusic'), false);

    const renderStatus = await fetch(`http://127.0.0.1:${port}/api/mobile/render/status`);
    assert.deepEqual(await renderStatus.json(), { status: 'idle' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function project(name) {
  return {
    schemaVersion: 1,
    id: `project-${name.toLowerCase()}`,
    name,
    composition: { width: 1920, height: 1080, fps: 30, duration: 10, backgroundColor: '#000000', pixelAspectRatio: 1 },
    assets: [], layers: [], scenes: [], presets: [], metadata: {}, migrations: []
  };
}

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
