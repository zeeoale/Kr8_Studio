import { open } from 'node:fs/promises';

export const MIB = 1024 * 1024;
export const MIN_CHUNK_BYTES = 5 * MIB;
export const MAX_CHUNK_BYTES = 64 * MIB;
export const DEFAULT_CHUNK_BYTES = 16 * MIB;

export function createChunkPlan(fileSize, preferredChunkBytes = DEFAULT_CHUNK_BYTES) {
  const size = Math.max(0, Math.trunc(Number(fileSize || 0)));
  if (size <= 0) throw new Error('Upload file is empty.');
  const preferred = Math.max(MIN_CHUNK_BYTES, Math.min(MAX_CHUNK_BYTES, Math.trunc(Number(preferredChunkBytes || DEFAULT_CHUNK_BYTES))));
  const totalChunkCount = size <= preferred ? 1 : Math.max(1, Math.floor(size / preferred));
  const chunks = [];
  let start = 0;
  for (let index = 0; index < totalChunkCount; index += 1) {
    const isLast = index === totalChunkCount - 1;
    const length = isLast ? size - start : preferred;
    chunks.push({ index, start, end: start + length - 1, length });
    start += length;
  }
  return {
    fileSize: size,
    chunkSize: totalChunkCount === 1 ? size : preferred,
    totalChunkCount,
    chunks
  };
}

export function contentRangeFor(chunk, fileSize) {
  return `bytes ${chunk.start}-${chunk.end}/${fileSize}`;
}

export async function uploadFileInChunks(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const plan = options.plan || createChunkPlan(options.fileSize, options.chunkSize);
  const signal = options.signal;
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
  const retryBaseMs = Math.max(0, Number(options.retryBaseMs ?? 500));
  const startedAt = Date.now();
  let bytesSent = 0;
  let retryCount = 0;
  const file = await open(options.filePath, 'r');
  try {
    for (const chunk of plan.chunks) {
      throwIfAborted(signal);
      const buffer = Buffer.allocUnsafe(chunk.length);
      const { bytesRead } = await file.read(buffer, 0, chunk.length, chunk.start);
      if (bytesRead !== chunk.length) throw new Error('Upload source changed or became unreadable.');
      let attempt = 0;
      while (true) {
        throwIfAborted(signal);
        try {
          const response = await fetchImpl(options.uploadUrl, {
            method: 'PUT',
            headers: {
              'content-type': options.contentType,
              'content-length': String(chunk.length),
              'content-range': contentRangeFor(chunk, plan.fileSize)
            },
            body: buffer,
            signal
          });
          if (response.ok || response.status === 206) break;
          if (response.status >= 500 && attempt < maxRetries) {
            attempt += 1;
            retryCount += 1;
            report('retrying');
            await delay(retryBaseMs * (2 ** (attempt - 1)), signal);
            continue;
          }
          const code = response.status === 403 ? 'upload_url_expired' : `upload_http_${response.status}`;
          const error = new Error(response.status === 403 ? 'TikTok upload URL expired. Start a new upload.' : `TikTok chunk upload failed with HTTP ${response.status}.`);
          error.code = code;
          error.status = response.status;
          throw error;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw cancelledError();
          if (error?.status || attempt >= maxRetries) throw error;
          attempt += 1;
          retryCount += 1;
          report('retrying');
          await delay(retryBaseMs * (2 ** (attempt - 1)), signal);
        }
      }
      bytesSent += chunk.length;
      report('uploading');
    }
  } finally {
    await file.close();
  }
  return progressSnapshot('uploaded');

  function report(status) {
    options.onProgress?.(progressSnapshot(status));
  }

  function progressSnapshot(status) {
    const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const bytesPerSecond = bytesSent / elapsedSeconds;
    return {
      status,
      bytesSent,
      totalBytes: plan.fileSize,
      progress: bytesSent / plan.fileSize,
      bytesPerSecond,
      etaSeconds: bytesPerSecond > 0 ? (plan.fileSize - bytesSent) / bytesPerSecond : null,
      retryCount
    };
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      reject(cancelledError());
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

function cancelledError() {
  const error = new Error('TikTok upload cancelled.');
  error.name = 'AbortError';
  error.code = 'cancelled';
  return error;
}
