const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class InstagramApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = Number(options.status || 0);
    this.code = String(options.code || 'instagram_api_error');
    this.subcode = String(options.subcode || '');
    this.transient = options.transient === true || TRANSIENT_STATUS.has(this.status);
  }
}

export class InstagramClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || fetch;
    this.maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
    this.sleep = options.sleep || delay;
    this.graphBaseUrl = String(options.graphBaseUrl || `https://graph.facebook.com/${config.graphVersion}`).replace(/\/+$/, '');
  }

  async inspectToken(accessToken) {
    const url = new URL(`${this.graphBaseUrl}/debug_token`);
    url.searchParams.set('input_token', accessToken);
    url.searchParams.set('access_token', `${this.config.appId}|${this.config.appSecret}`);
    const payload = await this.#request(url, { method: 'GET' });
    const data = payload?.data || {};
    return {
      valid: data.is_valid === true,
      appId: String(data.app_id || ''),
      userId: String(data.user_id || ''),
      expiresAt: Math.max(0, Number(data.expires_at || 0)) * 1000,
      scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : []
    };
  }

  async getAccount(accessToken, userId) {
    const url = new URL(`${this.graphBaseUrl}/${encodeURIComponent(userId)}`);
    url.searchParams.set('fields', 'id,username,name,profile_picture_url');
    const payload = await this.#request(url, bearer(accessToken));
    return {
      userId: String(payload.id || ''),
      username: String(payload.username || ''),
      displayName: String(payload.name || payload.username || 'Instagram account'),
      accountType: String(payload.account_type || 'PROFESSIONAL'),
      avatarUrl: String(payload.profile_picture_url || '')
    };
  }

  async createContainer(accessToken, userId, options) {
    const body = new URLSearchParams({
      media_type: options.destination === 'story' ? 'STORIES' : 'REELS',
      video_url: options.videoUrl
    });
    if (options.destination === 'reel') {
      if (options.caption) body.set('caption', options.caption);
      body.set('share_to_feed', options.shareToFeed ? 'true' : 'false');
    }
    const payload = await this.#request(`${this.graphBaseUrl}/${encodeURIComponent(userId)}/media`, {
      ...bearer(accessToken), method: 'POST', body
    });
    return { containerId: String(payload.id || '') };
  }

  async getContainerStatus(accessToken, containerId) {
    const url = new URL(`${this.graphBaseUrl}/${encodeURIComponent(containerId)}`);
    url.searchParams.set('fields', 'id,status_code,status');
    const payload = await this.#request(url, bearer(accessToken));
    return { code: String(payload.status_code || '').toUpperCase(), status: String(payload.status || '') };
  }

  async publishContainer(accessToken, userId, containerId) {
    const body = new URLSearchParams({ creation_id: containerId });
    const payload = await this.#request(`${this.graphBaseUrl}/${encodeURIComponent(userId)}/media_publish`, {
      ...bearer(accessToken), method: 'POST', body
    });
    return { mediaId: String(payload.id || '') };
  }

  async getMedia(accessToken, mediaId) {
    const url = new URL(`${this.graphBaseUrl}/${encodeURIComponent(mediaId)}`);
    url.searchParams.set('fields', 'id,permalink,media_type,timestamp');
    const payload = await this.#request(url, bearer(accessToken));
    return { mediaId: String(payload.id || mediaId), permalink: String(payload.permalink || ''), mediaType: String(payload.media_type || '') };
  }

  async refreshLongLivedToken(accessToken) {
    const url = new URL(`${this.graphBaseUrl}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('client_secret', this.config.appSecret);
    url.searchParams.set('fb_exchange_token', accessToken);
    const payload = await this.#request(url, { method: 'GET' });
    return {
      accessToken: String(payload.access_token || ''),
      expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 0)) * 1000
    };
  }

  async #request(url, init, attempt = 0) {
    let response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      if (attempt < this.maxRetries && !init?.signal?.aborted) {
        await this.sleep(backoff(attempt), init?.signal);
        return this.#request(url, init, attempt + 1);
      }
      throw new InstagramApiError('Instagram network request failed.', { code: 'network_error', transient: true });
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const api = payload?.error || {};
    const error = new InstagramApiError(String(api.message || `Instagram API request failed (${response.status}).`), {
      status: response.status,
      code: api.code || 'instagram_api_error',
      subcode: api.error_subcode,
      transient: api.is_transient === true
    });
    if (error.transient && attempt < this.maxRetries && !init?.signal?.aborted) {
      await this.sleep(backoff(attempt), init?.signal);
      return this.#request(url, init, attempt + 1);
    }
    throw error;
  }
}

function bearer(token) { return { headers: { authorization: `Bearer ${token}` } }; }
function backoff(attempt) { return Math.min(8_000, 500 * (2 ** attempt)); }
function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Instagram request cancelled.'), { name: 'AbortError', code: 'cancelled' })); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
