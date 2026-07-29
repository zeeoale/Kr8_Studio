import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const forbiddenNames = new Set(['.env.local', 'google.json']);
const allowedLargeFiles = new Set([
  path.normalize('demo/Demo_Sample_Audio.flac'),
  path.normalize('examples/kr8-demo-landscape.kr8/assets/audio/Demo_Sample_Audio.flac'),
  path.normalize('examples/kr8-demo-vertical.kr8/assets/audio/Demo_Sample_Audio.flac')
]);
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.ts', '.txt', '.xml', '.yml', '.yaml'
]);
const contentRules = [
  { label: 'private Windows user path', pattern: /C:\\Users\\/i },
  { label: 'private development path', pattern: /C:\\NodeApp\\(?:TKMusic_Kr8_Studio|TKMusic|astrofox)/i },
  { label: 'private deployment domain', pattern: /\b(?:kr8|instaup)\.tikey\.art\b/i },
  { label: 'private account identifier', pattern: /\b(?:zeooa|traumakom)\b/i },
  { label: 'private network address', pattern: /\b10\.8\.0\.\d+\b|\b192\.168\.\d+\.\d+\b/ }
];

const findings = [];
for await (const filePath of walk(root)) {
  const relative = path.relative(root, filePath);
  const info = await stat(filePath);
  if (forbiddenNames.has(path.basename(filePath).toLowerCase())) {
    findings.push(`${relative}: forbidden credential filename`);
  }
  if (info.size > 20 * 1024 * 1024 && !allowedLargeFiles.has(path.normalize(relative))) {
    findings.push(`${relative}: unexpected large file (${info.size} bytes)`);
  }
  if (relative === path.normalize('scripts/public-audit.mjs')) continue;
  if (!textExtensions.has(path.extname(filePath).toLowerCase()) || info.size > 2 * 1024 * 1024) continue;
  const text = await readFile(filePath, 'utf8');
  for (const rule of contentRules) {
    if (rule.pattern.test(text)) findings.push(`${relative}: ${rule.label}`);
  }
  if (/^\.env(?:\.|$)/i.test(path.basename(filePath))
      && !relative.endsWith('.example')
      && /^\s*(?:API_KEY|TOKEN|SECRET|PASSWORD|CLIENT_SECRET|PRIVATE_KEY)\s*=\s*\S+/im.test(text)) {
    findings.push(`${relative}: possible populated secret assignment`);
  }
}

if (findings.length) {
  console.error('Public release audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Public release audit passed: no private paths, known credentials, or unexpected large files found.');
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}
