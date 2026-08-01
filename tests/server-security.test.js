import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

import { createEditorServer } from '../src/editor/server.js';

const blankTemplate = JSON.parse(await readFile(path.resolve(import.meta.dirname, '..', 'examples', 'blank.kr8', 'project.json'), 'utf8'));

test('project API uses root-relative IDs and rejects arbitrary path input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-project-api-'));
  const first = await writeProject(root, 'first.kr8', 'First');
  const second = await writeProject(root, 'second.kr8', 'Second');
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'kr8-project-outside-'));
  const outside = await writeProject(outsideRoot, 'outside.kr8', 'Outside');
  const { server, origin } = await start({ projectPath: first, projectsRoot: root });
  try {
    const initial = await fetch(`${origin}/api/project`);
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).projectId, 'first.kr8/project.json');

    for (const attack of [
      '../outside.kr8/project.json',
      '..\\outside.kr8\\project.json',
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\project.json',
      '%2e%2e%2foutside.kr8%2fproject.json',
      '%252e%252e%252foutside.kr8%252fproject.json'
    ]) {
      const response = await fetch(`${origin}/api/project/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: attack })
      });
      assert.equal(response.status, 400, attack);
      assert.equal((await response.text()).includes(root), false);
      assert.equal((await readFile(outside, 'utf8')).includes('Outside'), true);
    }

    const legacy = await fetch(`${origin}/api/project?path=${encodeURIComponent(second)}`);
    assert.equal(legacy.status, 400);
    const opened = await fetch(`${origin}/api/project/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'second.kr8/project.json' })
    });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).project.name, 'Second');
  } finally {
    await close(server);
  }
});

test('project assets cannot read outside the active project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-asset-api-'));
  const outside = path.join(root, 'secret.txt');
  await writeFile(outside, 'secret');
  const projectPath = await writeProject(root, 'song.kr8', 'Song', [{
    id: 'escape', type: 'audio', role: 'song', path: '../secret.txt', missing: false
  }]);
  const { server, origin } = await start({ projectPath, projectsRoot: root });
  try {
    const response = await fetch(`${origin}/api/assets/escape`);
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes('secret'), false);

    const validProject = structuredClone(blankTemplate);
    validProject.assets = [{ id: 'absolute', type: 'image', path: outside, missing: false }];
    const saveResponse = await fetch(`${origin}/api/project`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: validProject })
    });
    assert.equal(saveResponse.status, 400);
  } finally {
    await close(server);
  }
});

test('server rejects malicious Host and Origin before API routing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-origin-api-'));
  const projectPath = await writeProject(root, 'song.kr8', 'Song');
  const { server, origin } = await start({ projectPath, projectsRoot: root });
  try {
    const maliciousOrigin = await fetch(`${origin}/api/project`, { headers: { origin: 'https://evil.example' } });
    assert.equal(maliciousOrigin.status, 403);
    const malformedHost = await rawRequest(origin, '/api/project', { host: 'evil.example' });
    assert.equal(malformedHost.statusCode, 421);
    const stateChangingGet = await fetch(`${origin}/api/project/open`);
    assert.notEqual(stateChangingGet.status, 200);
  } finally {
    await close(server);
  }
});

async function writeProject(root, directory, name, assets = []) {
  const projectDirectory = path.join(root, directory);
  await mkdir(projectDirectory, { recursive: true });
  const projectPath = path.join(projectDirectory, 'project.json');
  await writeFile(projectPath, JSON.stringify({
    ...structuredClone(blankTemplate),
    id: `project-${name}`,
    name,
    assets,
    layers: [],
    scenes: []
  }));
  return projectPath;
}

async function start(options) {
  const server = await createEditorServer({ ...options, host: '127.0.0.1', port: 0, envPath: 'missing-security-test.env' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function rawRequest(origin, pathname, headers) {
  const target = new URL(pathname, origin);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end();
  });
}
