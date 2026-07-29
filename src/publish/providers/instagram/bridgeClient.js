import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Transform } from 'node:stream';

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class InstagramBridgeClient {
  constructor(config, options = {}) {
    this.baseUrl = String(config.bridgeBaseUrl || '').replace(/\/+$/, '');
    this.token = String(config.bridgeToken || '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.maxRetries = Math.max(0, Number(options.maxRetries ?? 2));
    this.sleep = options.sleep || delay;
  }

  async upload(media, options = {}) {
    const before = await fingerprint(media.path);
    let attempt = 0;
    while (true) {
      const started = Date.now();
      let sent = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          sent += chunk.length;
          const elapsed = Math.max(1, Date.now() - started) / 1000;
          options.onProgress?.({
            progress: sent / before.size,
            bytesSent: sent,
            totalBytes: before.size,
            bytesPerSecond: sent / elapsed,
            etaSeconds: sent ? Math.max(0, (before.size - sent) / (sent / elapsed)) : null
          });
          callback(null, chunk);
        }
      });
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/v1/media`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': media.contentType,
            'content-length': String(before.size),
            'x-content-sha256': before.sha256
          },
          body: createReadStream(media.path).pipe(meter),
          duplex: 'half',
          signal: options.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = Object.assign(new Error(String(payload.error || `Media bridge upload failed (${response.status}).`)), { status: response.status });
          throw error;
        }
        if (!payload.id || !payload.mediaUrl) throw new Error('Media bridge returned an incomplete upload record.');
        const url = new URL(payload.mediaUrl);
        if (url.protocol !== 'https:' && !this.baseUrl.startsWith('http://127.0.0.1')) throw new Error('Media bridge returned a non-HTTPS URL.');
        return { id: String(payload.id), mediaUrl: url.toString(), expiresAt: String(payload.expiresAt || ''), fingerprint: before };
      } catch (error) {
        if (options.signal?.aborted) throw Object.assign(new Error('Instagram bridge upload cancelled.'), { name: 'AbortError', code: 'cancelled' });
        if (attempt >= this.maxRetries || !isTransient(error)) throw error;
        attempt += 1;
        options.onRetry?.({ retryCount: attempt });
        await this.sleep(Math.min(8_000, 500 * (2 ** (attempt - 1))), options.signal);
      }
    }
  }

  async cleanup(id) {
    if (!id) return false;
    let attempt = 0;
    while (true) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/v1/media/${encodeURIComponent(id)}`, {
          method: 'DELETE', headers: { authorization: `Bearer ${this.token}` }
        });
        if (response.ok || response.status === 404 || response.status === 410) return true;
        const error = Object.assign(new Error(`Media bridge cleanup failed (${response.status}).`), { status: response.status });
        if (attempt >= this.maxRetries || !isTransient(error)) throw error;
      } catch (error) {
        if (attempt >= this.maxRetries || !isTransient(error)) throw error;
      }
      attempt += 1;
      await this.sleep(Math.min(8_000, 500 * (2 ** (attempt - 1))));
    }
  }
}

export async function fingerprint(filePath) {
  const info = await stat(filePath);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return { size: info.size, sha256: hash.digest('hex') };
}

function isTransient(error) { return !error?.status || TRANSIENT_STATUS.has(Number(error.status)); }
function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Instagram bridge upload cancelled.'), { name: 'AbortError', code: 'cancelled' })); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
