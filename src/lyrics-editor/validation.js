export function validateLyricsCues(cues, options = {}) {
  const duration = Number(options.duration || 0);
  const errors = [];
  const warnings = [];
  const duplicateStarts = new Map();
  let emptyText = 0;
  let sections = 0;

  for (let index = 0; index < (cues || []).length; index += 1) {
    const cue = cues[index] || {};
    const label = `Cue ${String(index + 1).padStart(3, '0')}`;
    if (!Number.isFinite(cue.start)) errors.push({ code: 'invalid-start', cueId: cue.id, message: `${label} has an invalid start.` });
    else {
      if (cue.start < 0) errors.push({ code: 'negative-start', cueId: cue.id, message: `${label} starts before 0.` });
      if (duration > 0 && cue.start > duration) errors.push({ code: 'beyond-duration', cueId: cue.id, message: `${label} starts beyond the audio duration.` });
      const key = cue.start.toFixed(6);
      duplicateStarts.set(key, [...(duplicateStarts.get(key) || []), cue]);
    }
    if (cue.end !== undefined) {
      if (!Number.isFinite(cue.end)) errors.push({ code: 'invalid-end', cueId: cue.id, message: `${label} has an invalid end.` });
      else {
        if (cue.end < cue.start) errors.push({ code: 'end-before-start', cueId: cue.id, message: `${label} ends before it starts.` });
        if (duration > 0 && cue.end > duration) errors.push({ code: 'beyond-duration', cueId: cue.id, message: `${label} ends beyond the audio duration.` });
      }
    }
    if (index > 0 && Number.isFinite(cue.start) && Number.isFinite(cues[index - 1]?.start) && cue.start < cues[index - 1].start) {
      errors.push({ code: 'out-of-order', cueId: cue.id, message: `${label} is earlier than the preceding cue.` });
    }
    if (!String(cue.rawText ?? cue.text ?? '').trim()) emptyText += 1;
    if (cue.kind === 'section') sections += 1;
  }

  for (const group of duplicateStarts.values()) {
    if (group.length < 2) continue;
    warnings.push({
      code: 'duplicate-start',
      cueIds: group.map((cue) => cue.id),
      message: `${group.length} cues share timestamp ${group[0].start.toFixed(3)}s.`
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total: (cues || []).length,
      emptyText,
      duplicateStarts: warnings.filter((warning) => warning.code === 'duplicate-start').length,
      outOfOrder: errors.filter((error) => error.code === 'out-of-order').length,
      negativeStarts: errors.filter((error) => error.code === 'negative-start').length,
      invalidEnds: errors.filter((error) => ['invalid-end', 'end-before-start'].includes(error.code)).length,
      beyondDuration: errors.filter((error) => error.code === 'beyond-duration').length,
      sections
    }
  };
}
