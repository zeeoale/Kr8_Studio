import { createHash, randomUUID } from 'node:crypto';

export function createStableId(namespace, value) {
  const hash = createHash('sha256')
    .update(String(namespace))
    .update('\0')
    .update(String(value))
    .digest('hex')
    .slice(0, 16);

  return `kr8_${hash}`;
}

export function createRandomId(prefix = 'kr8') {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
