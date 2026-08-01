import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PathSecurityError,
  assertAbsolutePathWithinRoot,
  resolveRelativePathWithinRoot
} from '../src/security/pathPolicy.js';
import { resolveAssetPath } from '../src/shared/path.js';

test('relative path policy rejects traversal, mixed separators, drives, UNC, and encoded traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-path-root-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const attacks = [
    '../secret.txt',
    '..\\secret.txt',
    'safe/..\\..\\secret.txt',
    'C:\\Windows\\win.ini',
    'C:/Windows/win.ini',
    '\\\\server\\share\\secret.txt',
    '//server/share/secret.txt',
    '%2e%2e%2fsecret.txt',
    '%252e%252e%252fsecret.txt'
  ];
  for (const attack of attacks) {
    assert.throws(() => resolveRelativePathWithinRoot(root, attack), PathSecurityError, attack);
  }
  assert.equal(resolveRelativePathWithinRoot(root, 'project.json'), path.join(root, 'project.json'));
});

test('absolute containment rejects sibling paths instead of relying on string prefixes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'kr8-path-parent-'));
  const root = path.join(parent, 'projects');
  const sibling = path.join(parent, 'projects-other');
  await mkdir(root);
  await mkdir(sibling);
  assert.throws(() => assertAbsolutePathWithinRoot(root, path.join(sibling, 'project.json')), PathSecurityError);
});

test('asset resolution rejects paths outside the project root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kr8-asset-root-'));
  assert.throws(
    () => resolveAssetPath(root, { id: 'escape', path: '../outside.mp3', type: 'audio' }),
    PathSecurityError
  );
});

test('canonical containment rejects symlink or junction escapes when supported', async (context) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'kr8-link-parent-'));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  const link = path.join(root, 'linked');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    context.skip(`Symlink/junction creation is unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(() => resolveRelativePathWithinRoot(root, 'linked/secret.txt'), PathSecurityError);
});
