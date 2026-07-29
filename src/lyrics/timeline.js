import {
  normalizeLyricsDocument,
  toRenderableLyricsCues
} from '../lyrics-editor/schema.js';

export function parseAlignedLyrics(input) {
  return toRenderableLyricsCues(normalizeLyricsDocument(input).cues);
}

export function findCurrentLyric(cues, time) {
  const safeTime = Number(time || 0);
  const lines = getRenderableLyricCues(cues);
  const active = lines.find((cue) => safeTime >= cue.start && safeTime <= cue.end);
  if (active) return active;

  let previous = null;
  for (const cue of lines) {
    if (cue.start <= safeTime) previous = cue;
    if (cue.start > safeTime) break;
  }
  return previous && safeTime - previous.end <= 2.5 ? previous : null;
}

export function getRenderableLyricCues(cues) {
  return (cues || []).filter((cue) => cue.kind === 'line' && cue.text && !isSectionLabel(cue.text));
}

export function extractLyricSections(rawLyrics) {
  const sections = [];
  const seen = new Set();
  for (const line of String(rawLyrics || '').split(/\r?\n/)) {
    const label = parseSectionName(line);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push(label);
  }
  return sections;
}

export function deriveMetadataLyricScenes(rawLyrics, cues, duration = 0) {
  const sections = parseMetadataSectionAnchors(rawLyrics);
  if (!sections.length) return [];

  const safeDuration = Math.max(0, Number(duration || 0));
  let minimumStart = 0;
  const timedSections = sections.map((section, index) => {
    const start = findSectionStart(section, cues, index === 0 ? 0 : undefined, minimumStart);
    if (start !== undefined) minimumStart = start + 1;
    return {
      id: `metadata_${slugify(section.name)}_${index}`,
      name: section.name,
      start: start ?? 0,
      end: safeDuration
    };
  });

  for (let index = 0; index < timedSections.length; index += 1) {
    const next = timedSections[index + 1];
    timedSections[index].end = next ? next.start : safeDuration || findLastCueEnd(cues);
  }

  return timedSections
    .filter((scene, index) => index === 0 || scene.start > 0)
    .filter((scene) => scene.end > scene.start);
}

export function deriveLyricScenes(cues, duration = 0) {
  const safeDuration = Math.max(0, Number(duration || 0));
  const sections = (cues || [])
    .filter((cue) => cue.kind === 'section')
    .map((cue) => ({ name: parseSectionName(cue.text), start: cue.start }))
    .filter((section) => section.name);

  if (!sections.length) return [];

  const scenes = [];
  const firstStart = sections[0].start;
  if (firstStart > 1) {
    scenes.push({ id: 'derived_intro', name: 'Intro', start: 0, end: firstStart });
  }

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const next = sections[index + 1];
    const end = next ? next.start : safeDuration || findLastCueEnd(cues);
    scenes.push({
      id: `derived_${slugify(section.name)}_${index}`,
      name: section.name,
      start: section.start,
      end: Math.max(section.start, end)
    });
  }

  return scenes.filter((scene) => scene.end > scene.start);
}

export function parseSectionName(text) {
  const match = String(text || '').trim().match(/^\[([^\]]+)\]$/);
  if (!match) return '';
  const label = normalizeLyricText(match[1]).trim();
  if (!label) return '';
  if (/^(dark|heavy|cold|tension|explosive|fast|half|full)/i.test(label)) return '';
  return label;
}

export function normalizeLyricText(value) {
  return String(value || '')
    .replace(/[\u200B\u200E\u200F\u2060\uFEFF]/g, '')
    .replaceAll('â€™', "'")
    .replaceAll('â€œ', '"')
    .replaceAll('â€\u009d', '"')
    .replaceAll('â€¦', '...')
    .replace(/'\s+/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isSectionLabel(text) {
  return Boolean(parseSectionName(text));
}

function parseMetadataSectionAnchors(rawLyrics) {
  const sections = [];
  let current = null;

  for (const line of String(rawLyrics || '').split(/\r?\n/)) {
    const text = normalizeLyricText(line);
    if (!text) continue;

    const label = parseSectionName(text);
    if (label) {
      current = { name: label, anchors: [] };
      sections.push(current);
      continue;
    }

    if (!current) continue;
    if (isDirectionLine(text)) {
      if (current.anchors.length === 0) current.anchors.push(text);
      continue;
    }
    if (text.length < 8 && current.anchors.length > 0) continue;
    current.anchors.push(text);
  }

  return sections;
}

function findSectionStart(section, cues, fallbackStart, minimumStart = 0) {
  if (isInstrumentalSection(section.name)) {
    const labelMatch = findCueBySectionLabel(section.name, cues, minimumStart);
    if (labelMatch) return labelMatch.start;
  }

  for (const anchor of section.anchors.slice(0, 8)) {
    const match = findCueByText(anchor, cues, minimumStart);
    if (match) return match.start;
  }

  const labelMatch = findCueBySectionLabel(section.name, cues, minimumStart);
  if (labelMatch) return labelMatch.start;
  return fallbackStart;
}

function findCueBySectionLabel(sectionName, cues, minimumStart = 0) {
  const target = comparableText(sectionName);
  return (cues || []).find((cue) => {
    if (Number(cue.start || 0) < minimumStart) return false;
    return comparableText(parseSectionName(cue.text)) === target;
  }) || null;
}

function findCueByText(anchor, cues, minimumStart = 0) {
  const normalizedAnchor = comparableText(anchor);
  if (!normalizedAnchor) return null;

  let best = null;
  let bestScore = 0;
  for (const cue of cues || []) {
    if (cue.kind === 'section') continue;
    if (Number(cue.start || 0) < minimumStart) continue;
    const normalizedCue = comparableText(cue.rawText || cue.text);
    if (!normalizedCue) continue;

    const score = scoreTextMatch(normalizedAnchor, normalizedCue);
    if (score > bestScore) {
      best = cue;
      bestScore = score;
    }
  }

  return bestScore >= 0.72 ? best : null;
}

function scoreTextMatch(anchor, cue) {
  if (cue.includes(anchor) || anchor.includes(cue)) {
    return Math.min(anchor.length, cue.length) / Math.max(anchor.length, cue.length);
  }

  const anchorWords = new Set(anchor.split(' ').filter(Boolean));
  const cueWords = new Set(cue.split(' ').filter(Boolean));
  let common = 0;
  for (const word of anchorWords) {
    if (cueWords.has(word)) common += 1;
  }
  return common / Math.max(1, Math.min(anchorWords.size, cueWords.size));
}

function comparableText(value) {
  return normalizeLyricText(value)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDirectionLine(text) {
  return /^\(.+\)?$/.test(text);
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

  return {
    text: normalizeLyricText(output),
    parenDepth
  };
}

function isInstrumentalSection(name) {
  return /\b(instrumental|solo|interlude)\b/i.test(String(name || ''));
}

function readTime(line, primary, fallback) {
  const value = line?.[primary] ?? line?.[fallback];
  return Number(value);
}

function findLastCueEnd(cues) {
  return (cues || []).reduce((max, cue) => Math.max(max, Number(cue.end || 0)), 0);
}

function slugify(value) {
  return String(value || 'scene')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'scene';
}
