const OAUTH_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_URL = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name';
const UPLOAD_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const AUTHORIZATION_URL = 'https://www.tiktok.com/v2/auth/authorize/';

export class TikTokApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'TikTokApiError';
    this.code = String(options.code || 'tiktok_api_error');
    this.status = Number(options.status || 0);
    this.logId = String(options.logId || '');
    this.retryable = this.status >= 500;
  }
}

export class TikTokClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('Fetch is unavailable.');
  }

  buildAuthorizationUrl({ redirectUri, state, codeChallenge }) {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set('client_key', this.config.clientKey);
    url.searchParams.set('scope', this.config.scopes.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  exchangeCode({ code, redirectUri, codeVerifier }) {
    return this.#tokenRequest({
      client_key: this.config.clientKey,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
  }

  refreshToken(refreshToken) {
    return this.#tokenRequest({
      client_key: this.config.clientKey,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
  }

  async revoke(accessToken) {
    const response = await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token: accessToken
      })
    });
    if (!response.ok) await throwTikTokError(response, 'TikTok token revoke failed.');
    return true;
  }

  async getUserInfo(accessToken) {
    const payload = await this.#jsonRequest(USER_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` }
    }, 'TikTok account lookup failed.');
    const user = payload?.data?.user;
    if (!user) throw new TikTokApiError('TikTok account response was incomplete.', { code: 'invalid_response' });
    return {
      openId: String(user.open_id || ''),
      displayName: String(user.display_name || ''),
      avatarUrl: String(user.avatar_url || '')
    };
  }

  async initializeUpload(accessToken, sourceInfo) {
    const payload = await this.#jsonRequest(UPLOAD_INIT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', ...sourceInfo } })
    }, 'TikTok draft upload initialization failed.');
    const uploadUrl = String(payload?.data?.upload_url || '');
    if (!uploadUrl) throw new TikTokApiError('TikTok did not return an upload URL.', { code: 'missing_upload_url' });
    return {
      uploadUrl,
      publishId: String(payload?.data?.publish_id || '')
    };
  }

  async getPublishStatus(accessToken, publishId) {
    const payload = await this.#jsonRequest(PUBLISH_STATUS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({ publish_id: publishId })
    }, 'TikTok draft status lookup failed.');
    return {
      status: String(payload?.data?.status || ''),
      failReason: String(payload?.data?.fail_reason || ''),
      uploadedBytes: Math.max(0, Number(payload?.data?.uploaded_bytes || 0))
    };
  }

  async #tokenRequest(parameters) {
    const response = await this.fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters)
    });
    if (!response.ok) await throwTikTokError(response, 'TikTok token request failed.');
    const payload = await response.json();
    if (payload?.error || !payload?.access_token) {
      throw new TikTokApiError(String(payload?.error_description || payload?.error || 'TikTok token response was incomplete.'), {
        code: payload?.error || 'invalid_token_response',
        status: response.status
      });
    }
    return payload;
  }

  async #jsonRequest(url, init, fallbackMessage) {
    const response = await this.fetch(url, init);
    if (!response.ok) await throwTikTokError(response, fallbackMessage);
    const payload = await response.json();
    if (payload?.error?.code && payload.error.code !== 'ok') {
      throw new TikTokApiError(payload.error.message || fallbackMessage, {
        code: payload.error.code,
        status: response.status,
        logId: payload.error.log_id
      });
    }
    return payload;
  }
}

async function throwTikTokError(response, fallbackMessage) {
  let payload = null;
  try { payload = await response.json(); } catch {}
  const apiError = payload?.error || payload;
  throw new TikTokApiError(apiError?.message || apiError?.error_description || fallbackMessage, {
    code: apiError?.code || apiError?.error || `http_${response.status}`,
    status: response.status,
    logId: apiError?.log_id
  });
}
