export function parseTimecode(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Time must be a finite number.');
    return value;
  }

  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) throw new Error('Time is required.');
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isFinite(seconds)) throw new Error(`Invalid time: ${value}`);
    return seconds;
  }

  const parts = text.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`Use seconds, mm:ss.mmm or hh:mm:ss.mmm: ${value}`);
  }
  if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    throw new Error(`Invalid timecode: ${value}`);
  }

  const secondsPart = Number(parts.at(-1));
  const minutesPart = Number(parts.at(-2));
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0;
  if (secondsPart >= 60 || minutesPart >= 60 || ![secondsPart, minutesPart, hoursPart].every(Number.isFinite)) {
    throw new Error(`Invalid timecode: ${value}`);
  }
  return hoursPart * 3600 + minutesPart * 60 + secondsPart;
}

export function formatTimecode(value, options = {}) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '';
  const safe = Math.max(0, seconds);
  const precision = Math.max(0, Math.min(3, Number(options.precision ?? 3)));
  const factor = 10 ** precision;
  const rounded = Math.round(safe * factor) / factor;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const wholeSeconds = Math.floor(rounded % 60);
  const fraction = precision
    ? String(Math.round((rounded - Math.floor(rounded)) * factor)).padStart(precision, '0')
    : '';
  const time = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  return fraction ? `${time}.${fraction}` : time;
}

export function formatSrtTimecode(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '';
  const totalMilliseconds = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function formatLrcTimecode(value) {
  return formatTimecode(value, { precision: 2 });
}
