import { createNewCueId, parseSectionName } from './schema.js';

export function addCue(cues, options = {}) {
  const next = cloneCues(cues);
  const afterIndex = Math.max(-1, Math.min(next.length - 1, Number(options.afterIndex ?? next.length - 1)));
  const start = Number(options.start ?? 0);
  const cue = normalizeEditedCue({
    id: options.id || createNewCueId(),
    start,
    ...(Number.isFinite(options.end) ? { end: Number(options.end) } : {}),
    text: String(options.text || ''),
    rawText: String(options.text || ''),
    kind: 'line',
    source: {}
  });
  next.splice(afterIndex + 1, 0, cue);
  return reindex(next);
}

export function updateCue(cues, cueId, patch = {}) {
  return reindex((cues || []).map((cue) => {
    if (cue.id !== cueId) return cloneCue(cue);
    return normalizeEditedCue({
      ...cloneCue(cue),
      ...patch,
      ...(patch.text !== undefined ? { rawText: patch.text } : {})
    });
  }));
}

export function deleteCues(cues, ids) {
  const selected = new Set(ids || []);
  return reindex((cues || []).filter((cue) => !selected.has(cue.id)).map(cloneCue));
}

export function duplicateCue(cues, cueId, options = {}) {
  const index = (cues || []).findIndex((cue) => cue.id === cueId);
  if (index < 0) return cloneCues(cues);
  const source = cloneCue(cues[index]);
  const offset = Number(options.offset ?? 0.25);
  const duplicate = {
    ...source,
    id: options.id || createNewCueId(),
    start: source.start + offset,
    ...(Number.isFinite(source.end) ? { end: source.end + offset } : {}),
    source: {}
  };
  const next = cloneCues(cues);
  next.splice(index + 1, 0, duplicate);
  return reindex(next);
}

export function moveCues(cues, ids, direction) {
  const next = cloneCues(cues);
  const selected = new Set(ids || []);
  if (direction < 0) {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
    }
  } else {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  }
  return reindex(next);
}

export function splitCue(cues, cueId, options = {}) {
  const index = (cues || []).findIndex((cue) => cue.id === cueId);
  if (index < 0) throw new Error('Select a cue to split.');
  const cue = cloneCue(cues[index]);
  const text = String(cue.rawText ?? cue.text ?? '');
  const position = Math.max(0, Math.min(text.length, Number(options.position ?? Math.floor(text.length / 2))));
  const leftText = text.slice(0, position).trimEnd();
  const rightText = text.slice(position).trimStart();
  if (!leftText || !rightText) throw new Error('Place the text cursor between two non-empty parts.');

  const derivedEnd = Number.isFinite(cue.end) ? cue.end : cue.start + 2.5;
  const requested = Number(options.time);
  const splitTime = Number.isFinite(requested) && requested > cue.start && requested < derivedEnd
    ? requested
    : cue.start + (derivedEnd - cue.start) / 2;
  const first = normalizeEditedCue({ ...cue, text: leftText, rawText: leftText, end: splitTime });
  const second = normalizeEditedCue({
    ...cue,
    id: options.id || createNewCueId(),
    start: splitTime,
    ...(Number.isFinite(cue.end) ? { end: cue.end } : {}),
    text: rightText,
    rawText: rightText,
    source: {}
  });
  const next = cloneCues(cues);
  next.splice(index, 1, first, second);
  return reindex(next);
}

export function mergeCueWithNext(cues, cueId) {
  const index = (cues || []).findIndex((cue) => cue.id === cueId);
  if (index < 0 || index >= cues.length - 1) throw new Error('The selected cue has no following cue.');
  const first = cloneCue(cues[index]);
  const second = cloneCue(cues[index + 1]);
  const joinedText = [first.rawText ?? first.text, second.rawText ?? second.text]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const merged = normalizeEditedCue({
    ...first,
    text: joinedText,
    rawText: joinedText,
    ...(Number.isFinite(second.end) ? { end: second.end } : {})
  });
  const next = cloneCues(cues);
  next.splice(index, 2, merged);
  return reindex(next);
}

export function shiftCues(cues, options = {}) {
  const amount = Number(options.amount);
  if (!Number.isFinite(amount) || amount === 0) return cloneCues(cues);
  const selected = new Set(options.ids || []);
  const mode = options.mode || 'selected';
  const selectedIndexes = [...selected]
    .map((id) => (cues || []).findIndex((cue) => cue.id === id))
    .filter((index) => index >= 0);
  const firstSelected = selectedIndexes.length ? Math.min(...selectedIndexes) : -1;

  const shouldShift = (cue, index) => (
    mode === 'all'
    || (mode === 'following' && firstSelected >= 0 && index >= firstSelected)
    || (mode === 'selected' && selected.has(cue.id))
  );
  const next = (cues || []).map((cue, index) => {
    const copy = cloneCue(cue);
    if (!shouldShift(copy, index)) return copy;
    const start = copy.start + amount;
    const end = Number.isFinite(copy.end) ? copy.end + amount : undefined;
    if (start < 0 || (end !== undefined && end < 0)) {
      throw new Error('Shift would create a negative timestamp.');
    }
    copy.start = start;
    if (end !== undefined) copy.end = end;
    return copy;
  });
  return reindex(next);
}

function normalizeEditedCue(cue) {
  const rawText = String(cue.rawText ?? cue.text ?? '');
  const section = parseSectionName(rawText);
  const direction = !section && /^\s*[\[(].*[\])]\s*$/.test(rawText);
  return {
    ...cue,
    text: section ? rawText.trim() : rawText.trim(),
    rawText,
    kind: section ? 'section' : direction ? 'direction' : 'line',
    ...(section ? { section } : {})
  };
}

function reindex(cues) {
  return cues.map((cue, index) => ({ ...cue, index }));
}

function cloneCue(cue) {
  return JSON.parse(JSON.stringify(cue));
}

function cloneCues(cues) {
  return (cues || []).map(cloneCue);
}
