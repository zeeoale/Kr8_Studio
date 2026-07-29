import { deriveCueEnd } from './schema.js';
import { formatLrcTimecode, formatSrtTimecode, formatTimecode, parseTimecode } from './timecode.js';

export function exportSrt(cues, options = {}) {
  const defaultDuration = Number(options.defaultDuration || 2.5);
  return (cues || []).map((cue, index) => [
    index + 1,
    `${formatSrtTimecode(cue.start)} --> ${formatSrtTimecode(deriveCueEnd(cues, index, defaultDuration))}`,
    String(cue.rawText ?? cue.text ?? ''),
    ''
  ].join('\n')).join('\n');
}

export function exportLrc(cues) {
  return (cues || [])
    .map((cue) => `[${formatLrcTimecode(cue.start)}]${String(cue.rawText ?? cue.text ?? '')}`)
    .join('\n') + ((cues || []).length ? '\n' : '');
}

export function exportTimestampedText(cues) {
  return (cues || [])
    .map((cue) => `${formatTimecode(cue.start)}${Number.isFinite(cue.end) ? ` --> ${formatTimecode(cue.end)}` : ''} | ${String(cue.rawText ?? cue.text ?? '')}`)
    .join('\n') + ((cues || []).length ? '\n' : '');
}

export function importSrt(text, options = {}) {
  const blocks = String(text || '').replace(/\r/g, '').trim().split(/\n{2,}/);
  return blocks.filter(Boolean).map((block, index) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const timing = lines.shift()?.match(/^(.+?)\s*-->\s*(.+)$/);
    if (!timing) throw new Error(`Invalid SRT timing in block ${index + 1}.`);
    const value = lines.join('\n').trim();
    return {
      id: options.createId?.(index) || `lyric_import_srt_${index + 1}`,
      index,
      start: parseTimecode(timing[1]),
      end: parseTimecode(timing[2]),
      text: value,
      rawText: value,
      kind: /^\[[^\]]+\]$/.test(value) ? 'section' : 'line',
      source: {}
    };
  });
}

export function importLrc(text, options = {}) {
  const cues = [];
  for (const [lineIndex, line] of String(text || '').replace(/\r/g, '').split('\n').entries()) {
    if (!line.trim()) continue;
    const matches = [...line.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!matches.length) continue;
    const lyric = line.slice(matches.at(-1).index + matches.at(-1)[0].length).trim();
    for (const match of matches) {
      const start = parseTimecode(match[1].replace(/:(\d{1,3})$/, '.$1'));
      cues.push({
        id: options.createId?.(cues.length) || `lyric_import_lrc_${lineIndex + 1}_${cues.length + 1}`,
        index: cues.length,
        start,
        text: lyric,
        rawText: lyric,
        kind: /^\[[^\]]+\]$/.test(lyric) ? 'section' : 'line',
        source: {}
      });
    }
  }
  return cues.sort((left, right) => left.start - right.start || left.index - right.index)
    .map((cue, index) => ({ ...cue, index }));
}
