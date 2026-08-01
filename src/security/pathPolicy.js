import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export class PathSecurityError extends Error {
  constructor(message = 'The requested path is not allowed.', statusCode = 400) {
    super(message);
    this.name = 'PathSecurityError';
    this.statusCode = statusCode;
  }
}

export function decodeUntrustedPath(value) {
  let decoded = String(value ?? '').trim();
  if (!decoded) throw new PathSecurityError('A path identifier is required.');
  if (decoded.includes('\0')) throw new PathSecurityError();

  for (let pass = 0; pass < 3 && /%[0-9a-f]{2}/i.test(decoded); pass += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new PathSecurityError('The path identifier is malformed.');
    }
    if (next === decoded) break;
    decoded = next;
    if (decoded.includes('\0')) throw new PathSecurityError();
  }

  if (/%(?:2e|2f|5c|25)/i.test(decoded)) {
    throw new PathSecurityError('The path identifier contains unsupported encoding.');
  }
  return decoded;
}

export function resolveRelativePathWithinRoot(root, untrustedPath, options = {}) {
  const normalized = normalizeRelativeIdentifier(untrustedPath);
  const segments = normalized.split('/');

  const resolvedRoot = path.resolve(String(root || ''));
  const candidate = path.resolve(resolvedRoot, ...segments);
  assertCanonicalContainment(candidate, resolvedRoot, options);
  return candidate;
}

export function normalizeRelativeIdentifier(value, options = {}) {
  if (options.allowEmpty && !String(value ?? '').trim()) return '';
  const decoded = decodeUntrustedPath(value);
  assertRelativePath(decoded);
  const segments = decoded.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) throw new PathSecurityError();
  return segments.filter((segment) => segment && segment !== '.').join('/');
}

export function assertAbsolutePathWithinRoot(root, candidatePath, options = {}) {
  const resolvedRoot = path.resolve(String(root || ''));
  const candidate = path.resolve(String(candidatePath || ''));
  assertCanonicalContainment(candidate, resolvedRoot, options);
  return candidate;
}

export function relativePathIdentifier(root, candidatePath) {
  const candidate = assertAbsolutePathWithinRoot(root, candidatePath, { mustExist: true });
  const relative = path.relative(path.resolve(root), candidate);
  return relative.split(path.sep).join('/');
}

export function isCanonicalPathInside(candidatePath, root) {
  try {
    assertCanonicalContainment(path.resolve(candidatePath), path.resolve(root), {});
    return true;
  } catch {
    return false;
  }
}

function assertRelativePath(value) {
  if (
    path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || /^[a-z]:/i.test(value)
    || /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/.test(value)
  ) {
    throw new PathSecurityError('Absolute and network paths are not accepted.');
  }
}

function assertCanonicalContainment(candidate, root, options) {
  if (!isLexicallyInside(candidate, root)) throw new PathSecurityError();
  if (options.mustExist && !existsSync(candidate)) {
    throw new PathSecurityError('The requested item does not exist.', 404);
  }

  const canonicalRoot = canonicalExistingPath(root);
  const canonicalCandidate = canonicalPathWithExistingAncestor(candidate);
  if (!isLexicallyInside(canonicalCandidate, canonicalRoot)) throw new PathSecurityError();
}

function canonicalExistingPath(value) {
  if (!existsSync(value)) throw new PathSecurityError('The approved path root does not exist.', 500);
  return path.resolve(realpathSync.native(value));
}

function canonicalPathWithExistingAncestor(value) {
  let cursor = path.resolve(value);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new PathSecurityError();
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(realpathSync.native(cursor), ...suffix);
}

function isLexicallyInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
