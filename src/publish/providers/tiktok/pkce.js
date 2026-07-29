import { createHash, randomBytes } from 'node:crypto';

export function createTikTokPkcePair(bytes = 64) {
  const verifier = randomBytes(Math.max(32, bytes)).toString('base64url').slice(0, 128);
  const challenge = createHash('sha256').update(verifier).digest('hex');
  return { verifier, challenge, method: 'S256' };
}
