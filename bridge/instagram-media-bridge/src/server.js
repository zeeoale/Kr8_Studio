import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildBridgeConfig } from './config.js';
import { BridgeStore, createMediaReadStream } from './store.js';

const ALLOWED_TYPES = new Set(['video/mp4']);

export async function createBridgeServer(options = {}) {
  const config = options.config || buildBridgeConfig(process.env, options.overrides || {});
  const store = options.store || new BridgeStore(config, { clock: options.clock });
  await store.initialize();
  const rateLimiter = new UploadRateLimiter(config.uploadsPerHour, options.clock);
  const server = http.createServer(async (request, response) => {
    try { await route(request, response, { config, store, rateLimiter }); }
    catch (error) {
      if (!response.headersSent) sendJson(response, statusFor(error), { error: safeBridgeError(error) });
      else response.destroy();
    }
  });
  const cleanupTimer = setInterval(() => store.cleanupExpired().catch(() => {}), config.cleanupIntervalMs);
  cleanupTimer.unref();
  server.on('close', () => clearInterval(cleanupTimer));
  return server;
}

async function route(request, response, context) {
  const url = new URL(request.url || '/', 'http://bridge.local');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('cache-control', 'no-store');
  if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { ok: true, service: 'kr8-instagram-media-bridge' });

  if (request.method === 'POST' && url.pathname === '/v1/media') {
    requireAuth(request, context.config.authToken);
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw Object.assign(new Error('Unsupported video MIME type.'), { status: 415 });
    const size = Number(request.headers['content-length'] || 0);
    if (!Number.isSafeInteger(size) || size <= 0) throw Object.assign(new Error('A valid Content-Length is required.'), { status: 411 });
    if (size > context.config.maxBytes) throw Object.assign(new Error('Upload exceeds configured size limit.'), { status: 413 });
    const sha256 = String(request.headers['x-content-sha256'] || '').toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw Object.assign(new Error('Invalid checksum header.'), { status: 400 });
    context.rateLimiter.consume(request.socket.remoteAddress || 'unknown');
    const record = await context.store.receive(request, { contentType, size, sha256 });
    return sendJson(response, 201, {
      id: record.id,
      mediaUrl: `${context.config.publicBaseUrl}/m/${record.token}`,
      expiresAt: new Date(record.expiresAt).toISOString()
    });
  }

  const mediaMatch = url.pathname.match(/^\/m\/([A-Za-z0-9_-]{40,64})$/);
  if ((request.method === 'GET' || request.method === 'HEAD') && mediaMatch) {
    const record = await context.store.resolveToken(mediaMatch[1]);
    if (record.state === 'expired') return sendJson(response, 410, { error: 'Media URL expired or was already removed.' });
    if (record.state !== 'available') return sendJson(response, 404, { error: 'Media not found.' });
    const range = parseRange(request.headers.range, record.size);
    response.statusCode = range ? 206 : 200;
    response.setHeader('content-type', record.metadata.contentType);
    response.setHeader('accept-ranges', 'bytes');
    response.setHeader('cache-control', 'private, max-age=60');
    response.setHeader('content-length', String(range ? range.end - range.start + 1 : record.size));
    if (range) response.setHeader('content-range', `bytes ${range.start}-${range.end}/${record.size}`);
    if (request.method === 'HEAD') return response.end();
    return createMediaReadStream(record, range).pipe(response);
  }

  const deleteMatch = url.pathname.match(/^\/v1\/media\/([a-f0-9]{32})$/);
  if (request.method === 'DELETE' && deleteMatch) {
    requireAuth(request, context.config.authToken);
    const deleted = await context.store.deleteById(deleteMatch[1]);
    return sendJson(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: 'Media was already removed or never existed.' });
  }
  sendJson(response, 404, { error: 'Not found.' });
}

function requireAuth(request, expected) {
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secureEqual(supplied, expected)) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseRange(value, size) {
  if (!value) return null;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) throw Object.assign(new Error('Invalid Range header.'), { status: 416 });
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) { const suffix = Number(match[2]); start = Math.max(0, size - suffix); end = size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) throw Object.assign(new Error('Range is outside the media file.'), { status: 416 });
  return { start, end: Math.min(end, size - 1) };
}

class UploadRateLimiter {
  constructor(limit, clock = () => Date.now()) { this.limit = limit; this.clock = clock; this.entries = new Map(); }
  consume(key) {
    const cutoff = this.clock() - 3_600_000;
    const entries = (this.entries.get(key) || []).filter((time) => time > cutoff);
    if (entries.length >= this.limit) throw Object.assign(new Error('Upload rate limit exceeded.'), { status: 429 });
    entries.push(this.clock()); this.entries.set(key, entries);
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value)); response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('content-length', String(body.length)); response.end(body);
}
function statusFor(error) { return Number(error?.status || (error?.code === 'too_large' ? 413 : error?.code === 'unsupported_media' ? 415 : 500)); }
function safeBridgeError(error) { return statusFor(error) >= 500 ? 'Bridge request failed.' : String(error?.message || 'Bridge request failed.').slice(0, 240); }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { process.loadEnvFile('.env'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const config = buildBridgeConfig();
  const server = await createBridgeServer({ config });
  server.listen(config.port, config.host, () => process.stdout.write(`Kr8 Instagram media bridge listening on ${config.host}:${config.port}\n`));
}
