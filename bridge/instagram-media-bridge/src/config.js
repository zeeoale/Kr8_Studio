import path from 'node:path';

export function buildBridgeConfig(env = process.env, overrides = {}) {
  const value = { ...env, ...overrides };
  const publicBaseUrl = String(value.BRIDGE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const authToken = String(value.BRIDGE_AUTH_TOKEN || '').trim();
  const allowInsecure = value.BRIDGE_ALLOW_INSECURE === true || String(value.BRIDGE_ALLOW_INSECURE || '') === '1';
  if (!authToken || authToken.length < 24) throw new Error('BRIDGE_AUTH_TOKEN must contain at least 24 characters.');
  if (!publicBaseUrl) throw new Error('BRIDGE_PUBLIC_BASE_URL is required.');
  const url = new URL(publicBaseUrl);
  if (url.protocol !== 'https:' && !allowInsecure) throw new Error('BRIDGE_PUBLIC_BASE_URL must use HTTPS.');
  return {
    host: String(value.BRIDGE_HOST || '127.0.0.1'),
    port: Math.max(1, Math.min(65535, Number(value.BRIDGE_PORT || 8787))),
    publicBaseUrl,
    authToken,
    dataDir: path.resolve(String(value.BRIDGE_DATA_DIR || './data')),
    ttlMs: Math.max(60_000, Number(value.BRIDGE_TTL_SECONDS || 3600) * 1000),
    tombstoneTtlMs: Math.max(60_000, Number(value.BRIDGE_TOMBSTONE_TTL_SECONDS || 86400) * 1000),
    maxBytes: Math.max(1_000_000, Number(value.BRIDGE_MAX_BYTES || 1_000_000_000)),
    uploadsPerHour: Math.max(1, Number(value.BRIDGE_UPLOADS_PER_HOUR || 20)),
    cleanupIntervalMs: Math.max(10_000, Number(value.BRIDGE_CLEANUP_INTERVAL_SECONDS || 60) * 1000)
  };
}
