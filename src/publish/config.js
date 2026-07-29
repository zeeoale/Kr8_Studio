export const TIKTOK_REQUIRED_SCOPES = Object.freeze(['user.info.basic', 'video.upload']);
export const YOUTUBE_REQUIRED_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl'
]);

export function buildTikTokConfig(env = process.env) {
  const clientKey = String(env.TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || '').trim();
  const environment = String(env.TIKTOK_ENV || 'sandbox').trim().toLowerCase();
  const missing = [];
  if (!clientKey) missing.push('TIKTOK_CLIENT_KEY');
  if (!clientSecret) missing.push('TIKTOK_CLIENT_SECRET');

  return {
    clientKey,
    clientSecret,
    environment: environment === 'production' ? 'production' : 'sandbox',
    scopes: [...TIKTOK_REQUIRED_SCOPES],
    configured: missing.length === 0,
    missing
  };
}

export function publicTikTokConfig(config) {
  return {
    configured: Boolean(config?.configured),
    environment: config?.environment === 'production' ? 'production' : 'sandbox',
    scopes: [...TIKTOK_REQUIRED_SCOPES],
    missing: Array.isArray(config?.missing) ? [...config.missing] : []
  };
}

export function buildYouTubeConfig(env = process.env) {
  const clientId = String(env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = String(env.YOUTUBE_CLIENT_SECRET || '').trim();
  const missing = [];
  if (!clientId) missing.push('YOUTUBE_CLIENT_ID');
  if (!clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
  return {
    clientId,
    clientSecret,
    scopes: [...YOUTUBE_REQUIRED_SCOPES],
    configured: missing.length === 0,
    missing
  };
}

export function publicYouTubeConfig(config) {
  return {
    configured: Boolean(config?.configured),
    scopes: [...YOUTUBE_REQUIRED_SCOPES],
    missing: Array.isArray(config?.missing) ? [...config.missing] : []
  };
}

export function buildInstagramConfig(env = process.env) {
  const appId = String(env.INSTAGRAM_APP_ID || '').trim();
  const appSecret = String(env.INSTAGRAM_APP_SECRET || '').trim();
  const userId = String(env.INSTAGRAM_USER_ID || '').trim();
  const accessToken = String(env.INSTAGRAM_ACCESS_TOKEN || '').trim();
  const bridgeBaseUrl = normalizeBridgeBaseUrl(env.INSTAGRAM_BRIDGE_URL || '');
  const bridgeToken = String(env.INSTAGRAM_BRIDGE_TOKEN || '').trim();
  const graphVersion = String(env.INSTAGRAM_GRAPH_VERSION || 'v23.0').trim();
  const missing = [];
  if (!appId) missing.push('INSTAGRAM_APP_ID');
  if (!appSecret) missing.push('INSTAGRAM_APP_SECRET');
  if (!userId) missing.push('INSTAGRAM_USER_ID');
  if (!accessToken) missing.push('INSTAGRAM_ACCESS_TOKEN');
  return {
    appId,
    appSecret,
    userId,
    accessToken,
    bridgeBaseUrl,
    bridgeToken,
    graphVersion: /^v\d+\.\d+$/.test(graphVersion) ? graphVersion : 'v23.0',
    configured: missing.length === 0,
    bridgeConfigured: Boolean(bridgeBaseUrl && bridgeToken),
    autoRefresh: false,
    missing
  };
}

export function publicInstagramConfig(config) {
  return {
    configured: Boolean(config?.configured),
    bridgeConfigured: Boolean(config?.bridgeConfigured),
    bridgeHost: safeHost(config?.bridgeBaseUrl),
    autoRefresh: false,
    missing: Array.isArray(config?.missing) ? [...config.missing] : []
  };
}

function safeHost(value) {
  try { return new URL(String(value || '')).host; } catch { return ''; }
}

function normalizeBridgeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const loopbackHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}
