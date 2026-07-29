import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SENSITIVE_KEYS = /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|code_verifier)/i;
const TOKEN_PATTERN = /\b(?:act\.|rft\.|Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi;

export function createOAuthState(bytes = 32) {
  return randomBytes(Math.max(16, bytes)).toString('base64url');
}

export function createPkcePair(bytes = 64) {
  const verifier = randomBytes(Math.max(32, bytes)).toString('base64url').slice(0, 128);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function redactSensitive(value, secrets = []) {
  const secretValues = secrets.filter(Boolean).map(String).sort((a, b) => b.length - a.length);
  return redactValue(value, secretValues, new WeakSet());
}

export function safeErrorMessage(error, secrets = []) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return String(redactSensitive(message, secrets)).replace(/\s+/g, ' ').trim().slice(0, 700);
}

function redactValue(value, secrets, seen) {
  if (typeof value === 'string') {
    let output = value.replace(TOKEN_PATTERN, '[REDACTED]');
    for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
    return output;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactValue(item, secrets, seen)
  ]));
}
