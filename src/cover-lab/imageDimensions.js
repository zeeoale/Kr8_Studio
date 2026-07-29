export function readImageDimensions(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  return readPngDimensions(buffer)
    || readJpegDimensions(buffer)
    || readWebpDimensions(buffer)
    || null;
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24
    || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a'
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) return null;
  return validDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return validDimensions(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3)
      );
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 25
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return validDimensions(
      1 + readUInt24LE(buffer, 24),
      1 + readUInt24LE(buffer, 27)
    );
  }
  if (
    chunk === 'VP8 '
    && buffer.length >= 30
    && buffer[23] === 0x9d
    && buffer[24] === 0x01
    && buffer[25] === 0x2a
  ) {
    return validDimensions(
      buffer.readUInt16LE(26) & 0x3fff,
      buffer.readUInt16LE(28) & 0x3fff
    );
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return validDimensions(
      1 + (bits & 0x3fff),
      1 + ((bits >>> 14) & 0x3fff)
    );
  }
  return null;
}

function isJpegStartOfFrame(marker) {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf
  ].includes(marker);
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function validDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  return { width, height };
}
