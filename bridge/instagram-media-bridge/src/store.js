import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class BridgeStore {
  constructor(config, options = {}) {
    this.config = config;
    this.clock = options.clock || (() => Date.now());
    this.paths = Object.fromEntries(['tmp', 'media', 'meta', 'refs', 'tombstones'].map((name) => [name, path.join(config.dataDir, name)]));
  }

  async initialize() {
    await Promise.all(Object.values(this.paths).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
  }

  async receive(readable, options) {
    const id = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    const temporaryPath = path.join(this.paths.tmp, `${id}.part`);
    const mediaPath = path.join(this.paths.media, `${tokenHash}.bin`);
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    const hash = createHash('sha256');
    const meter = new Transform({ transform: (chunk, _encoding, callback) => {
      bytes += chunk.length;
      if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
      if (bytes > this.config.maxBytes) return callback(Object.assign(new Error('Upload exceeds configured size limit.'), { code: 'too_large' }));
      hash.update(chunk);
      callback(null, chunk);
    }});
    try {
      await pipeline(readable, meter, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
      if (bytes !== Number(options.size)) throw new Error('Upload size did not match Content-Length.');
      if (!isMp4(prefix)) throw Object.assign(new Error('Uploaded content is not an MP4 file.'), { code: 'unsupported_media' });
      const sha256 = hash.digest('hex');
      if (options.sha256 && sha256 !== options.sha256) throw new Error('Upload checksum mismatch.');
      await rename(temporaryPath, mediaPath);
      const metadata = {
        schemaVersion: 1, id, tokenHash, contentType: options.contentType, size: bytes, sha256,
        createdAt: this.clock(), expiresAt: this.clock() + this.config.ttlMs
      };
      await atomicJson(path.join(this.paths.meta, `${tokenHash}.json`), metadata);
      await atomicJson(path.join(this.paths.refs, `${id}.json`), { tokenHash });
      return { id, token, expiresAt: metadata.expiresAt };
    } catch (error) {
      await Promise.all([
        rm(temporaryPath, { force: true }), rm(mediaPath, { force: true }),
        rm(path.join(this.paths.meta, `${tokenHash}.json`), { force: true }),
        rm(path.join(this.paths.refs, `${id}.json`), { force: true })
      ]);
      throw error;
    }
  }

  async resolveToken(token) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(String(token || ''))) return { state: 'missing' };
    const tokenHash = digest(token);
    const metaPath = path.join(this.paths.meta, `${tokenHash}.json`);
    try {
      const metadata = JSON.parse(await readFile(metaPath, 'utf8'));
      if (metadata.expiresAt <= this.clock()) {
        await this.#deleteByHash(tokenHash, metadata);
        return { state: 'expired' };
      }
      const mediaPath = path.join(this.paths.media, `${tokenHash}.bin`);
      const info = await stat(mediaPath);
      return { state: 'available', metadata, mediaPath, size: info.size };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        const tombstone = JSON.parse(await readFile(path.join(this.paths.tombstones, `${tokenHash}.json`), 'utf8'));
        if (tombstone.deleteAfter > this.clock()) return { state: 'expired' };
      } catch {}
      return { state: 'missing' };
    }
  }

  async deleteById(id) {
    if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return false;
    try {
      const reference = JSON.parse(await readFile(path.join(this.paths.refs, `${id}.json`), 'utf8'));
      await this.#deleteByHash(reference.tokenHash, { id });
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async cleanupExpired() {
    const files = await readdir(this.paths.meta).catch(() => []);
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      try {
        const metadata = JSON.parse(await readFile(path.join(this.paths.meta, file), 'utf8'));
        if (metadata.expiresAt <= this.clock()) await this.#deleteByHash(metadata.tokenHash, metadata);
      } catch {}
    }
    const tombstones = await readdir(this.paths.tombstones).catch(() => []);
    for (const file of tombstones) {
      try {
        const record = JSON.parse(await readFile(path.join(this.paths.tombstones, file), 'utf8'));
        if (record.deleteAfter <= this.clock()) await rm(path.join(this.paths.tombstones, file), { force: true });
      } catch {}
    }
  }

  async #deleteByHash(tokenHash, metadata = {}) {
    if (!/^[a-f0-9]{64}$/.test(String(tokenHash || ''))) return;
    await Promise.all([
      rm(path.join(this.paths.media, `${tokenHash}.bin`), { force: true }),
      rm(path.join(this.paths.meta, `${tokenHash}.json`), { force: true }),
      metadata.id ? rm(path.join(this.paths.refs, `${metadata.id}.json`), { force: true }) : Promise.resolve()
    ]);
    await atomicJson(path.join(this.paths.tombstones, `${tokenHash}.json`), { deleteAfter: this.clock() + this.config.tombstoneTtlMs });
  }
}

export function createMediaReadStream(record, range = null) {
  return createReadStream(record.mediaPath, range ? { start: range.start, end: range.end } : undefined);
}

function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function isMp4(prefix) { return prefix.length >= 12 && prefix.subarray(4, 8).toString('ascii') === 'ftyp'; }
async function atomicJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}
