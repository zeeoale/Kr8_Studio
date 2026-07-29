export function findMatchingFontFaces(fontFamily, faces = []) {
  const requested = String(fontFamily || '').trim();
  if (!requested) return [];
  const exact = faces.filter((face) =>
    String(face?.family || '').trim().toLowerCase() === requested.toLowerCase()
  );
  if (exact.length) return exact;

  const requestedFingerprint = normalizeFontFamilyFingerprint(requested);
  if (requestedFingerprint.length < 8) return [];
  let best = null;
  for (const face of faces) {
    const fingerprint = normalizeFontFamilyFingerprint(face?.family);
    if (!fingerprint) continue;
    const distance = levenshteinDistance(requestedFingerprint, fingerprint);
    const similarity = 1 - distance / Math.max(requestedFingerprint.length, fingerprint.length);
    if (similarity < 0.84) continue;
    if (!best || similarity > best.similarity) best = { face, similarity };
  }
  if (!best) return [];
  return faces.filter((face) =>
    normalizeFontFamilyFingerprint(face?.family) === normalizeFontFamilyFingerprint(best.face.family)
  );
}

export function normalizeFontFamilyFingerprint(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

