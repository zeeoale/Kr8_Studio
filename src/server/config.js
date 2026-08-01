import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadEnvFile(filePath = '.env') {
  const result = await readEnvFileValues(filePath);
  if (!result.loaded) return { loaded: false, path: result.path };
  for (const [key, value] of Object.entries(result.values)) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
  return { loaded: true, path: result.path };
}

export async function readEnvFileValues(filePath = '.env') {
  const resolved = path.resolve(filePath);
  let text = '';
  try {
    text = await readFile(resolved, 'utf8');
  } catch {
    return { loaded: false, path: resolved, values: {} };
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return { loaded: true, path: resolved, values };
}

export function resolveServerEnvPath(value, projectRoot = process.cwd()) {
  const requested = String(value || '').trim();
  return path.resolve(requested || path.join(projectRoot, '.env.local'));
}

export function buildServerConfig(options = {}) {
  const serverMode = readBoolean(process.env.KR8_SERVER_MODE, false) || options.serverMode === true;
  const host = String(options.host || process.env.KR8_HOST || '127.0.0.1').trim();
  const portValue = options.port ?? process.env.KR8_PORT;
  const port = Number(portValue === undefined || portValue === '' ? 5174 : portValue);
  return {
    serverMode,
    host,
    port,
    projectPath: options.projectPath || process.env.KR8_DEFAULT_PROJECT || '',
    projectsRoot: options.projectsRoot || process.env.KR8_PROJECTS_ROOT || '',
    exportsRoot: options.exportsRoot || process.env.KR8_EXPORTS_ROOT || '',
    tkMusicLibraryRoot: options.tkMusicLibraryRoot || process.env.KR8_TKMUSIC_LIBRARY_ROOT || '',
    ffmpegPath: options.ffmpegPath || process.env.KR8_FFMPEG_PATH || '',
    ffprobePath: options.ffprobePath || process.env.KR8_FFPROBE_PATH || '',
    browserPath: process.env.KR8_BROWSER_PATH || '',
    internalOrigin: process.env.KR8_INTERNAL_ORIGIN || '',
    trustedOrigins: parseTrustedOrigins(options.trustedOrigins ?? process.env.KR8_TRUSTED_ORIGINS),
    chromeNoSandbox: readBoolean(process.env.KR8_CHROME_NO_SANDBOX, false),
    auth: {
      username: process.env.KR8_AUTH_USER || '',
      password: process.env.KR8_AUTH_PASSWORD || ''
    },
    headlessExportConcurrency: Math.max(1, Number(process.env.KR8_HEADLESS_EXPORT_CONCURRENCY || 1)),
    maxUploadBytes: Math.max(1_000_000, Number(process.env.KR8_MAX_UPLOAD_MB || 25) * 1_000_000),
    maxAudioUploadBytes: Math.max(10_000_000, Number(process.env.KR8_MAX_AUDIO_UPLOAD_MB || 1024) * 1_000_000),
    optionalServices: {
      ollamaUrl: normalizeLocalServiceUrl(process.env.KR8_OLLAMA_URL, 'http://127.0.0.1:11434'),
      comfyUiUrl: normalizeLocalServiceUrl(process.env.KR8_COMFYUI_URL, 'http://127.0.0.1:8188'),
      coverWorkflowPath: String(process.env.KR8_COVER_WORKFLOW_PATH || '').trim()
    }
  };
}

export function isExternalBindHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(normalized);
}

export function hasAuth(config) {
  return Boolean(config?.auth?.username && config?.auth?.password);
}

function unquoteEnvValue(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function normalizeLocalServiceUrl(value, fallback) {
  const raw = String(value || fallback || '').trim();
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    if (url.username || url.password) return fallback;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function parseTrustedOrigins(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
