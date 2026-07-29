import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ['src', 'assets', 'presets', 'examples', 'bridge']) {
  const sourceRoot = path.join(root, entry);
  await cp(sourceRoot, path.join(dist, entry), {
    recursive: true,
    filter: (source) => {
      if (entry !== 'examples') return true;
      const segments = path.relative(sourceRoot, source).split(path.sep);
      return !segments.includes('exports');
    }
  });
}

for (const entry of [
  'package.json',
  'package-lock.json',
  '.env.example',
  '.env.server.example',
  'README.md',
  'LICENSE',
  'NOTICE',
  'COMMERCIAL-LICENSE.md',
  'TRADEMARKS.md',
  'ASSET-LICENSE.md'
]) {
  await cp(path.join(root, entry), path.join(dist, entry));
}

const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(dist, '.build-manifest.json'), `${JSON.stringify({
  name: metadata.name,
  version: metadata.version,
  builtAt: new Date().toISOString(),
  entry: 'src/editor/server.js'
}, null, 2)}\n`);

console.log(`Built ${metadata.name}@${metadata.version} into ${path.relative(root, dist)}`);
