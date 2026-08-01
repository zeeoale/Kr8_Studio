const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function validateHttpRequest(request, config = {}) {
  const port = Number(request.socket?.localPort || config.port || 0);
  const trustedOrigins = normalizeTrustedOrigins(config.trustedOrigins || []);
  const allowedAuthorities = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    ...trustedOrigins.map((origin) => new URL(origin).host)
  ]);

  const host = String(request.headers.host || '').toLowerCase();
  if (!host || !allowedAuthorities.has(host)) {
    return { allowed: false, statusCode: 421, message: 'Request host is not allowed.' };
  }

  const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return { allowed: false, statusCode: 403, message: 'Cross-site requests are not allowed.' };
  }

  const origin = String(request.headers.origin || '').trim();
  if (origin) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
      ...trustedOrigins
    ]);
    if (!allowedOrigins.has(normalizeOrigin(origin))) {
      return { allowed: false, statusCode: 403, message: 'Request origin is not allowed.' };
    }
  } else if (!SAFE_METHODS.has(String(request.method || 'GET').toUpperCase()) && fetchSite) {
    return { allowed: false, statusCode: 403, message: 'A valid Origin header is required for browser writes.' };
  }

  return { allowed: true };
}

export function normalizeTrustedOrigins(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values : String(values || '').split(',')) {
    const normalized = normalizeOrigin(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

export function isStateChangingMethod(method) {
  return !SAFE_METHODS.has(String(method || '').toUpperCase());
}
