export const LYRICS_DOCUMENT_VERSION = 1;

export function normalizeLyricsDocument(input) {
  const source = typeof input === 'string' ? JSON.parse(input) : (input || {});
  const document = clone(source);
  const lines = Array.isArray(source?.lines) ? source.lines : [];
  const cues = [];
  let parenDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] && typeof lines[index] === 'object' ? lines[index] : {};
    const rawText = normalizeLyricText(line.text);
    if (!rawText && line.text === undefined) continue;
    const start = readRequiredTime(line, ['startSeconds', 'start']);
    const end = readOptionalTime(line, ['endSeconds', 'end']);

    let cueText = rawText;
    let source = clone(line);
    if (rawText === '[' && lines[index + 1]) {
      const next = lines[index + 1] || {};
      const nextText = normalizeLyricText(next.text);
      if (nextText.endsWith(']')) {
        cueText = `[${nextText}`;
        source = { ...clone(next), ...source };
        if (end === undefined) source.endSeconds = readOptionalTime(next, ['endSeconds', 'end']);
        index += 1;
      }
    }

    const cleaned = stripLyricDirections(cueText, parenDepth);
    parenDepth = cleaned.parenDepth;
    const section = parseSectionName(cueText);
    const text = section ? cueText : cleaned.text;
    const id = normalizeCueId(line.id) || createLegacyCueId({
      index: cues.length,
      start,
      end,
      text: cueText
    });

    cues.push({
      id,
      index: cues.length,
      start,
      ...(end !== undefined ? { end } : {}),
      text,
      rawText: cueText,
      kind: section ? 'section' : text ? 'line' : 'direction',
      ...(section ? { section } : {}),
      source
    });
  }

  return {
    document: {
      ...document,
      kr8LyricsVersion: Number(document.kr8LyricsVersion || LYRICS_DOCUMENT_VERSION),
      lines: cues.map((cue, index) => cueToSourceLine(cue, index))
    },
    cues
  };
}

export function serializeLyricsDocument(baseDocument, cues) {
  const base = clone(baseDocument || {});
  return {
    ...base,
    kr8LyricsVersion: LYRICS_DOCUMENT_VERSION,
    lines: (cues || []).map((cue, index) => cueToSourceLine(cue, index))
  };
}

export function createLegacyCueId(cue) {
  const fingerprint = [
    cue.index ?? '',
    finiteOrEmpty(cue.start),
    finiteOrEmpty(cue.end),
    String(cue.text || '')
  ].join('\u0000');
  return `lyric_${fnv1a(fingerprint)}`;
}

export function createNewCueId() {
  if (globalThis.crypto?.randomUUID) {
    return `lyric_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `lyric_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveCueEnd(cues, index, defaultDuration = 2.5) {
  const cue = cues?.[index];
  if (!cue) return 0;
  if (Number.isFinite(cue.end)) return Math.max(cue.start, cue.end);
  const nextStart = Number(cues?.[index + 1]?.start);
  return Number.isFinite(nextStart) && nextStart > cue.start
    ? nextStart
    : cue.start + Math.max(0.1, Number(defaultDuration || 2.5));
}

export function toRenderableLyricsCues(cues, defaultDuration = 2.5) {
  return (cues || [])
    .map((cue, index) => ({
      ...cue,
      index,
      end: deriveCueEnd(cues, index, defaultDuration)
    }))
    .sort((left, right) => left.start - right.start || left.index - right.index);
}

export function parseSectionName(text) {
  const match = String(text || '').trim().match(/^\[([^\]]+)\]$/);
  if (!match) return '';
  const label = normalizeLyricText(match[1]);
  if (!label || /^(dark|heavy|cold|tension|explosive|fast|half|full)/i.test(label)) return '';
  return label;
}

export function normalizeLyricText(value) {
  return String(value ?? '')
    .replace(/[\u200B\u200E\u200F\u2060\uFEFF]/g, '')
    .replaceAll('\u00e2\u20ac\u2122', "'")
    .replaceAll('\u00e2\u20ac\u0153', '"')
    .replaceAll('\u00e2\u20ac\u009d', '"')
    .replaceAll('\u00e2\u20ac\u00a6', '...')
    .replaceAll('Ã¢â‚¬â„¢', "'")
    .replaceAll('Ã¢â‚¬Å“', '"')
    .replaceAll('Ã¢â‚¬\u009d', '"')
    .replaceAll('Ã¢â‚¬Â¦', '...')
    .replace(/'\s+/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cueToSourceLine(cue, index) {
  const source = cue?.source && typeof cue.source === 'object' ? clone(cue.source) : {};
  const line = {
    ...source,
    id: normalizeCueId(cue?.id) || createLegacyCueId({ ...cue, index }),
    index: index + 1,
    startSeconds: Number(cue?.start),
    text: String(cue?.rawText ?? cue?.text ?? '')
  };
  delete line.start;
  delete line.end;
  if (Number.isFinite(cue?.end)) line.endSeconds = Number(cue.end);
  else delete line.endSeconds;
  return line;
}

function readRequiredTime(line, keys) {
  for (const key of keys) {
    if (line?.[key] === undefined) continue;
    const value = Number(line[key]);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return Number.NaN;
}

function readOptionalTime(line, keys) {
  for (const key of keys) {
    if (line?.[key] === undefined || line?.[key] === null || line?.[key] === '') continue;
    const value = Number(line[key]);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return undefined;
}

function stripLyricDirections(text, initialParenDepth = 0) {
  let parenDepth = Math.max(0, Number(initialParenDepth || 0));
  let bracketDepth = 0;
  let output = '';
  for (const char of String(text || '')) {
    if (char === '[' && parenDepth === 0) {
      bracketDepth += 1;
      continue;
    }
    if (char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (char === '(' && bracketDepth === 0) {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0) output += char;
  }
  return { text: normalizeLyricText(output), parenDepth };
}

function normalizeCueId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function finiteOrEmpty(value) {
  return Number.isFinite(Number(value)) ? Number(value) : '';
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
