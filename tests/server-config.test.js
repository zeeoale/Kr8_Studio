import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildServerConfig, hasAuth, isPathInside, loadEnvFile, readEnvFileValues, resolveServerEnvPath } from '../src/server/config.js';

test('loadEnvFile reads simple key value pairs without overriding existing env', async () => {
  const originalValue = process.env.KR8_AUTH_USER;
  process.env.KR8_AUTH_USER = 'existing';
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'kr8-env-'));
  const envPath = path.join(tempDir, '.env.server');
  await writeFile(envPath, [
    '# comment',
    'KR8_SERVER_MODE=1',
    'KR8_AUTH_USER=from-file',
    'KR8_AUTH_PASSWORD="secret value"'
  ].join('\n'), 'utf8');

  const result = await loadEnvFile(envPath);

  assert.equal(result.loaded, true);
  assert.equal(process.env.KR8_SERVER_MODE, '1');
  assert.equal(process.env.KR8_AUTH_USER, 'existing');
  assert.equal(process.env.KR8_AUTH_PASSWORD, 'secret value');

  delete process.env.KR8_SERVER_MODE;
  delete process.env.KR8_AUTH_PASSWORD;
  if (originalValue === undefined) {
    delete process.env.KR8_AUTH_USER;
  } else {
    process.env.KR8_AUTH_USER = originalValue;
  }
});

test('readEnvFileValues can reread changed credentials without mutating process env', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-env-reread-'));
  const envPath = path.join(root, '.env.local');
  const original = process.env.INSTAGRAM_ACCESS_TOKEN;
  process.env.INSTAGRAM_ACCESS_TOKEN = 'running-token';
  try {
    await writeFile(envPath, 'INSTAGRAM_ACCESS_TOKEN=file-token\nINSTAGRAM_APP_ID=app\n');
    const result = await readEnvFileValues(envPath);
    assert.equal(result.values.INSTAGRAM_ACCESS_TOKEN, 'file-token');
    assert.equal(process.env.INSTAGRAM_ACCESS_TOKEN, 'running-token');
  } finally {
    if (original === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = original;
  }
});

test('resolveServerEnvPath defaults CLI startup to project .env.local and preserves explicit env files', () => {
  const projectRoot = path.resolve('C:/Kr8 Studio');
  assert.equal(resolveServerEnvPath('', projectRoot), path.join(projectRoot, '.env.local'));
  assert.equal(resolveServerEnvPath('config/server.env', projectRoot), path.resolve('config/server.env'));
});

test('buildServerConfig enables server host defaults and auth detection', () => {
  const previous = snapshotEnv([
    'KR8_SERVER_MODE',
    'KR8_AUTH_USER',
    'KR8_AUTH_PASSWORD',
    'KR8_INTERNAL_ORIGIN',
    'KR8_CHROME_NO_SANDBOX'
  ]);
  process.env.KR8_SERVER_MODE = '1';
  process.env.KR8_AUTH_USER = 'kr8';
  process.env.KR8_AUTH_PASSWORD = 'secret';
  process.env.KR8_INTERNAL_ORIGIN = 'http://127.0.0.1:5174';
  process.env.KR8_CHROME_NO_SANDBOX = '1';

  const config = buildServerConfig();

  assert.equal(config.serverMode, true);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(hasAuth(config), true);
  assert.equal(config.internalOrigin, 'http://127.0.0.1:5174');
  assert.equal(config.chromeNoSandbox, true);
  restoreEnv(previous);
});

test('isPathInside accepts descendants and rejects sibling paths', () => {
  assert.equal(isPathInside('/srv/kr8/projects/song.kr8/project.json', '/srv/kr8/projects'), true);
  assert.equal(isPathInside('/srv/kr8-other/project.json', '/srv/kr8/projects'), false);
});

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
