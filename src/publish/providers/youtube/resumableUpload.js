import { open } from 'node:fs/promises';

const CHUNK_UNIT = 256 * 1024;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export async function uploadYouTubeResumable(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const chunkSize = normalizeChunkSize(options.chunkSizeBytes || 8 * 1024 * 1024);
  const totalBytes = Number(options.fileSize || 0);
  const started = Date.now();
  let offset = 0;
  let retryCount = 0;
  const handle = await open(options.filePath, 'r');
  try {
    while (offset < totalBytes) {
      throwIfAborted(options.signal);
      const length = Math.min(chunkSize, totalBytes - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error('YouTube upload could not read the complete video chunk.');
      try {
        const response = await fetchImpl(options.uploadUrl, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${await options.getAccessToken()}`,
            'content-length': String(length),
            'content-type': options.contentType,
            'content-range': `bytes ${offset}-${offset + length - 1}/${totalBytes}`
          },
          body: buffer,
          signal: options.signal
        });
        if (response.status === 200 || response.status === 201) {
          offset = totalBytes;
          reportProgress(options.onProgress, offset, totalBytes, started, retryCount);
          return { video: await response.json(), bytesSent: offset, retryCount };
        }
        if (response.status === 308) {
          offset = nextOffset(response.headers.get('range'), offset + length);
          reportProgress(options.onProgress, offset, totalBytes, started, retryCount);
          continue;
        }
        if (!RETRYABLE_STATUS.has(response.status)) throw await responseError(response);
        throw Object.assign(new Error(`YouTube upload temporarily failed with HTTP ${response.status}.`), { retryable: true });
      } catch (error) {
        if (options.signal?.aborted) throw cancelledError();
        if (error?.retryable === false) throw error;
        retryCount += 1;
        if (retryCount > Number(options.maxRetries ?? 6)) throw error;
        options.onRetry?.({ retryCount, error });
        await delay(Math.min(8000, 500 * (2 ** (retryCount - 1))), options.signal);
        const recovered = await queryUploadState({ ...options, fetchImpl, totalBytes, fallbackOffset: offset });
        offset = recovered.offset;
        reportProgress(options.onProgress, offset, totalBytes, started, retryCount);
        if (recovered.video) return { video: recovered.video, bytesSent: offset, retryCount };
      }
    }
    throw new Error('YouTube upload ended without a video response.');
  } finally {
    await handle.close();
  }
}

export async function queryUploadOffset(options) {
  return (await queryUploadState(options)).offset;
}

async function queryUploadState(options) {
  throwIfAborted(options.signal);
  const response = await options.fetchImpl(options.uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${await options.getAccessToken()}`,
      'content-length': '0',
      'content-range': `bytes */${options.totalBytes}`
    },
    signal: options.signal
  });
  if (response.status === 308) return { offset: nextOffset(response.headers.get('range'), 0), video: null };
  if (response.status === 200 || response.status === 201) return { offset: options.totalBytes, video: await response.json() };
  if (response.status === 404) {
    const error = new Error('YouTube resumable upload session expired.');
    error.code = 'upload_session_expired';
    error.retryable = false;
    throw error;
  }
  throw await responseError(response);
}

function normalizeChunkSize(value) {
  return Math.max(CHUNK_UNIT, Math.floor(Number(value) / CHUNK_UNIT) * CHUNK_UNIT);
}

function nextOffset(range, fallback) {
  const match = String(range || '').match(/bytes=\d+-(\d+)/i);
  return match ? Number(match[1]) + 1 : fallback;
}

function reportProgress(callback, bytesSent, totalBytes, started, retryCount) {
  const elapsedSeconds = Math.max(0.001, (Date.now() - started) / 1000);
  const bytesPerSecond = bytesSent / elapsedSeconds;
  callback?.({
    progress: totalBytes > 0 ? bytesSent / totalBytes : 0,
    bytesSent,
    totalBytes,
    bytesPerSecond,
    etaSeconds: bytesPerSecond > 0 ? (totalBytes - bytesSent) / bytesPerSecond : null,
    retryCount
  });
}

async function responseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch {}
  const error = new Error(payload?.error?.message || `YouTube upload failed with HTTP ${response.status}.`);
  error.status = response.status;
  error.code = payload?.error?.errors?.[0]?.reason || `http_${response.status}`;
  error.retryable = RETRYABLE_STATUS.has(response.status);
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

function cancelledError() {
  const error = new Error('YouTube upload cancelled.');
  error.name = 'AbortError';
  error.code = 'cancelled';
  return error;
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => { clearTimeout(timer); reject(cancelledError()); };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}
