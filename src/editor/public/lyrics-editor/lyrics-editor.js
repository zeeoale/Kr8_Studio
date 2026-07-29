import { LyricsEditorSession } from '/core/lyrics-editor/editorState.js';
import {
  exportLrc,
  exportSrt,
  exportTimestampedText,
  importLrc,
  importSrt
} from '/core/lyrics-editor/importExport.js';
import {
  addCue,
  deleteCues,
  duplicateCue,
  mergeCueWithNext,
  moveCues,
  shiftCues,
  splitCue,
  updateCue
} from '/core/lyrics-editor/operations.js';
import {
  normalizeLyricsDocument,
  serializeLyricsDocument
} from '/core/lyrics-editor/schema.js';
import { formatTimecode, parseTimecode } from '/core/lyrics-editor/timecode.js';
import { validateLyricsCues } from '/core/lyrics-editor/validation.js';

export function createLyricsEditorController(options) {
  const elements = collectElements();
  let session = new LyricsEditorSession();
  let baseDocument = { lines: [] };
  let filter = '';
  let activeCueId = '';
  let importMode = '';
  let animationId = 0;
  let busy = false;
  let textEditSnapshot = null;
  let textEditCueId = '';

  const selectedCue = () => {
    if (session.selectedIds.size !== 1) return null;
    const id = [...session.selectedIds][0];
    return session.cues.find((cue) => cue.id === id) || null;
  };

  function open() {
    const normalized = normalizeLyricsDocument(options.getLyricsDocument?.() || {
      lines: options.getCues?.() || []
    });
    baseDocument = normalized.document;
    session = new LyricsEditorSession(normalized.cues);
    filter = '';
    activeCueId = '';
    elements.search.value = '';
    elements.panel.hidden = false;
    document.body.classList.add('lyrics-editor-open');
    renderAll();
    elements.cueList.scrollTop = 0;
    elements.inspector.scrollTop = 0;
    startTicker();
    elements.search.focus();
  }

  function isOpen() {
    return !elements.panel.hidden;
  }

  function close(force = false) {
    if (!isOpen()) return true;
    if (!force && session.modified && !window.confirm('Discard unapplied Lyrics Editor changes?')) return false;
    if (session.modified) options.onPreviewChange?.(session.baseline);
    elements.panel.hidden = true;
    document.body.classList.remove('lyrics-editor-open');
    stopTicker();
    return true;
  }

  function commit(nextCues, message = 'Lyrics updated') {
    finalizeTextEdit();
    session.commit(nextCues);
    options.onPreviewChange?.(session.cues);
    setMessage(message);
    renderAll();
  }

  function beginTextEdit() {
    const cue = selectedCue();
    if (!cue || textEditSnapshot) return;
    textEditSnapshot = JSON.parse(JSON.stringify(session.cues));
    textEditCueId = cue.id;
  }

  function previewTextEdit(value) {
    const cue = session.cues.find((item) => item.id === textEditCueId);
    if (!cue) return;
    session.cues = updateCue(session.cues, cue.id, { text: value });
    options.onPreviewChange?.(session.cues);
    const rowText = elements.cueList.querySelector(`[data-cue-id="${CSS.escape(cue.id)}"] [data-field="text"]`);
    if (rowText && rowText !== document.activeElement) rowText.value = value;
    renderHistoryState();
    renderValidation();
    setMessage('Cue text preview updated');
  }

  function finalizeTextEdit() {
    if (!textEditSnapshot) return;
    if (JSON.stringify(textEditSnapshot) !== JSON.stringify(session.cues)) {
      session.undoStack.push(textEditSnapshot);
      if (session.undoStack.length > session.limit) session.undoStack.shift();
      session.redoStack = [];
    }
    textEditSnapshot = null;
    textEditCueId = '';
    renderAll();
  }

  function renderAll() {
    renderList();
    renderInspector();
    renderValidation();
    renderHistoryState();
    renderWaveform();
    updateTransport();
  }

  function renderList() {
    const query = filter.toLowerCase();
    const validation = validateLyricsCues(session.cues, { duration: getAudio().duration });
    const errorIds = new Set(validation.errors.map((item) => item.cueId).filter(Boolean));
    const warningIds = new Set(validation.warnings.flatMap((item) => item.cueIds || (item.cueId ? [item.cueId] : [])));
    const filtered = session.cues.filter((cue) =>
      !query || String(cue.rawText ?? cue.text ?? '').toLowerCase().includes(query)
    );
    elements.cueList.replaceChildren(...filtered.map((cue) => createCueRow(cue, {
      error: errorIds.has(cue.id),
      warning: warningIds.has(cue.id)
    })));
    elements.counter.textContent = `${session.cues.length} cues · ${formatTimecode(getAudio().duration)}`;
  }

  function createCueRow(cue, issues = {}) {
    const row = document.createElement('div');
    row.className = [
      'lyrics-editor-cue-row',
      session.selectedIds.has(cue.id) ? 'is-selected' : '',
      activeCueId === cue.id ? 'is-active' : '',
      cue.kind === 'section' ? 'is-section' : '',
      issues.error ? 'has-error' : '',
      issues.warning ? 'has-warning' : ''
    ].filter(Boolean).join(' ');
    row.dataset.cueId = cue.id;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = session.selectedIds.has(cue.id);
    check.dataset.action = 'select';
    check.setAttribute('aria-label', `Select cue ${cue.index + 1}`);

    const index = document.createElement('span');
    index.className = 'lyrics-editor-row-index';
    index.textContent = String(cue.index + 1);

    const start = document.createElement('input');
    start.type = 'text';
    start.value = formatTimecode(cue.start);
    start.dataset.field = 'start';
    start.setAttribute('aria-label', `Cue ${cue.index + 1} start`);

    const end = document.createElement('input');
    end.type = 'text';
    end.value = Number.isFinite(cue.end) ? formatTimecode(cue.end) : '';
    end.placeholder = 'auto';
    end.dataset.field = 'end';
    end.setAttribute('aria-label', `Cue ${cue.index + 1} end`);

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'lyrics-editor-row-text';
    text.value = String(cue.rawText ?? cue.text ?? '');
    text.dataset.field = 'text';
    text.setAttribute('aria-label', `Cue ${cue.index + 1} text`);

    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = '▶';
    play.dataset.action = 'seek';
    play.title = 'Seek to cue';

    row.append(check, index, start, end, text, play);
    return row;
  }

  function renderInspector() {
    const cue = selectedCue();
    const enabled = Boolean(cue);
    for (const element of [elements.text, elements.start, elements.end, elements.setStart, elements.setEnd]) {
      element.disabled = !enabled || busy;
    }
    elements.text.value = cue ? String(cue.rawText ?? cue.text ?? '') : '';
    elements.start.value = cue ? formatTimecode(cue.start) : '';
    elements.end.value = cue && Number.isFinite(cue.end) ? formatTimecode(cue.end) : '';
    elements.kind.textContent = cue?.kind || '-';
    elements.id.textContent = cue?.id || '-';
    elements.selectionCount.textContent = `${session.selectedIds.size} selected`;
  }

  function renderValidation() {
    const validation = validateLyricsCues(session.cues, { duration: getAudio().duration });
    const summary = validation.summary;
    const parts = [
      `${summary.total} cues`,
      `${summary.sections} sections`,
      `${summary.emptyText} empty`,
      `${validation.errors.length} errors`,
      `${validation.warnings.length} warnings`
    ];
    const firstIssue = validation.errors[0]?.message || validation.warnings[0]?.message || 'Timeline is valid.';
    elements.validation.classList.toggle('has-errors', !validation.valid);
    elements.validation.textContent = `${parts.join(' · ')}\n${firstIssue}`;
    elements.apply.disabled = busy || !validation.valid || !session.modified;
    elements.save.disabled = busy || !validation.valid;
  }

  function renderHistoryState() {
    elements.modified.textContent = session.modified ? 'Unapplied changes' : 'Changes applied';
    elements.undo.disabled = busy || session.undoStack.length === 0;
    elements.redo.disabled = busy || session.redoStack.length === 0;
  }

  function renderWaveform() {
    const context = elements.waveform.getContext('2d');
    const width = elements.waveform.width;
    const height = elements.waveform.height;
    const peaks = getAudio().waveformPeaks;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b0d11';
    context.fillRect(0, 0, width, height);
    if (!peaks.length) return;
    context.fillStyle = '#c9b796';
    const center = height / 2;
    for (let x = 0; x < width; x += 1) {
      const peak = Number(peaks[Math.floor((x / width) * peaks.length)] || 0);
      const size = Math.max(1, peak * (height - 10));
      context.fillRect(x, center - size / 2, 1, size);
    }
    const audio = getAudio();
    const playheadX = audio.duration > 0 ? (audio.currentTime / audio.duration) * width : 0;
    context.fillStyle = '#df1833';
    context.fillRect(playheadX, 0, 2, height);
  }

  function updateTransport() {
    const audio = getAudio();
    elements.play.textContent = audio.playing ? 'Pause' : 'Play';
    elements.time.textContent = `${formatTimecode(audio.currentTime)} / ${formatTimecode(audio.duration)}`;
    elements.scrubber.max = String(audio.duration || 0);
    if (!elements.scrubber.matches(':active')) elements.scrubber.value = String(audio.currentTime || 0);
  }

  function startTicker() {
    stopTicker();
    const tick = () => {
      if (!isOpen()) return;
      const audio = getAudio();
      const active = session.cues.find((cue, index) => {
        const end = Number.isFinite(cue.end)
          ? cue.end
          : session.cues[index + 1]?.start ?? cue.start + 2.5;
        return audio.currentTime >= cue.start && audio.currentTime <= end;
      });
      if ((active?.id || '') !== activeCueId) {
        activeCueId = active?.id || '';
        for (const row of elements.cueList.querySelectorAll('.lyrics-editor-cue-row')) {
          row.classList.toggle('is-active', row.dataset.cueId === activeCueId);
        }
        if (active && audio.playing) {
          elements.cueList.querySelector(`[data-cue-id="${CSS.escape(active.id)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
      updateTransport();
      renderWaveform();
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
  }

  function stopTicker() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
  }

  async function apply() {
    if (busy) return false;
    const validation = validateLyricsCues(session.cues, { duration: getAudio().duration });
    if (!validation.valid) {
      setMessage(validation.errors[0]?.message || 'Fix validation errors before applying.', true);
      return false;
    }
    busy = true;
    renderAll();
    try {
      const documentValue = serializeLyricsDocument(baseDocument, session.cues);
      const result = await options.onApply?.(documentValue, session.cues);
      const normalized = normalizeLyricsDocument(result?.document || documentValue);
      baseDocument = normalized.document;
      session.cues = normalized.cues;
      session.markApplied();
      options.onPreviewChange?.(session.cues);
      setMessage('Lyrics applied to the project-local asset.');
      renderAll();
      return true;
    } catch (error) {
      setMessage(error.message || String(error), true);
      return false;
    } finally {
      busy = false;
      renderAll();
    }
  }

  async function save() {
    const applied = session.modified ? await apply() : true;
    if (!applied) return;
    busy = true;
    renderAll();
    try {
      await options.onSave?.();
      setMessage('Project and lyrics saved.');
    } catch (error) {
      setMessage(error.message || String(error), true);
    } finally {
      busy = false;
      renderAll();
    }
  }

  function undo() {
    if (!session.undo()) return;
    options.onPreviewChange?.(session.cues);
    setMessage('Undo');
    renderAll();
  }

  function redo() {
    if (!session.redo()) return;
    options.onPreviewChange?.(session.cues);
    setMessage('Redo');
    renderAll();
  }

  function add() {
    const cue = selectedCue();
    const afterIndex = cue ? session.cues.findIndex((item) => item.id === cue.id) : session.cues.length - 1;
    const playhead = getAudio().currentTime;
    const next = addCue(session.cues, { afterIndex, start: playhead, text: '' });
    commit(next, 'Cue added');
    session.select(next[afterIndex + 1].id);
    renderAll();
    elements.text.focus();
  }

  function duplicate() {
    const cue = selectedCue();
    if (!cue) return setMessage('Select one cue to duplicate.', true);
    const next = duplicateCue(session.cues, cue.id);
    commit(next, 'Cue duplicated');
    const index = next.findIndex((item) => item.id === cue.id);
    session.select(next[index + 1].id);
    renderAll();
  }

  function remove() {
    const ids = [...session.selectedIds];
    if (!ids.length) return setMessage('Select cues to delete.', true);
    if (!window.confirm(`Delete ${ids.length} selected cue${ids.length === 1 ? '' : 's'}?`)) return;
    commit(deleteCues(session.cues, ids), 'Cue deletion applied');
  }

  function move(direction) {
    if (!session.selectedIds.size) return setMessage('Select cues to move.', true);
    commit(moveCues(session.cues, [...session.selectedIds], direction), direction < 0 ? 'Moved up' : 'Moved down');
  }

  function split() {
    const cue = selectedCue();
    if (!cue) return setMessage('Select one cue to split.', true);
    try {
      const value = String(elements.text.value || '');
      const cursor = Number(elements.text.selectionStart);
      const position = cursor > 0 && cursor < value.length
        ? cursor
        : nearestWordBoundary(value, Math.floor(value.length / 2));
      const next = splitCue(session.cues, cue.id, {
        position,
        time: getAudio().currentTime
      });
      commit(next, 'Cue split');
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function merge() {
    const cue = selectedCue();
    if (!cue) return setMessage('Select one cue to merge.', true);
    try {
      commit(mergeCueWithNext(session.cues, cue.id), 'Cue merged with next');
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function shift(direction) {
    const amount = Number(elements.shiftAmount.value || 0) * direction;
    try {
      commit(shiftCues(session.cues, {
        amount,
        ids: [...session.selectedIds],
        mode: elements.shiftScope.value
      }), `Shifted ${Math.abs(amount).toFixed(3)}s ${direction < 0 ? 'earlier' : 'later'}`);
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function updateSelected(patch, message) {
    const cue = selectedCue();
    if (!cue) return;
    commit(updateCue(session.cues, cue.id, patch), message);
    session.select(cue.id);
    renderAll();
  }

  function updateTime(field, value) {
    try {
      if (field === 'end' && !String(value).trim()) updateSelected({ end: undefined }, 'Cue end set to automatic');
      else updateSelected({ [field]: parseTimecode(value) }, `Cue ${field} updated`);
    } catch (error) {
      setMessage(error.message, true);
      renderInspector();
    }
  }

  function chooseImport(mode) {
    importMode = mode;
    elements.importFile.accept = mode === 'srt' ? '.srt,text/plain' : '.lrc,text/plain';
    elements.importFile.value = '';
    elements.importFile.click();
  }

  async function importFile() {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const cues = importMode === 'srt' ? importSrt(text) : importLrc(text);
      if (!cues.length) throw new Error(`No timed lyrics found in ${file.name}.`);
      if (!window.confirm(`Replace the current timeline with ${cues.length} cues from ${file.name}?`)) return;
      commit(cues, `${file.name} imported`);
      session.clearSelection();
      renderAll();
    } catch (error) {
      setMessage(error.message || String(error), true);
    }
  }

  function download(format) {
    const exporters = {
      srt: [exportSrt, 'srt', 'application/x-subrip'],
      lrc: [exportLrc, 'lrc', 'text/plain'],
      text: [exportTimestampedText, 'txt', 'text/plain']
    };
    const [exporter, extension, type] = exporters[format];
    const blob = new Blob([exporter(session.cues)], { type: `${type};charset=utf-8` });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${safeFilename(options.getProjectName?.() || 'kr8-lyrics')}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setMessage(`${extension.toUpperCase()} exported`);
  }

  function setMessage(message, error = false) {
    elements.message.textContent = message;
    elements.message.style.color = error ? '#ff91a1' : '';
    options.onStatus?.(message, error);
  }

  function getAudio() {
    const value = options.getAudioState?.() || {};
    return {
      currentTime: Number(value.currentTime || 0),
      duration: Number(value.duration || 0),
      playing: Boolean(value.playing),
      waveformPeaks: Array.from(value.waveformPeaks || [])
    };
  }

  elements.close.addEventListener('click', () => close());
  elements.footerClose.addEventListener('click', () => close());
  elements.undo.addEventListener('click', undo);
  elements.redo.addEventListener('click', redo);
  elements.play.addEventListener('click', () => options.onPlayPause?.());
  elements.back.addEventListener('click', () => options.onSeek?.(Math.max(0, getAudio().currentTime - 5)));
  elements.forward.addEventListener('click', () => options.onSeek?.(Math.min(getAudio().duration, getAudio().currentTime + 5)));
  elements.scrubber.addEventListener('input', () => options.onSeek?.(Number(elements.scrubber.value)));
  elements.waveform.addEventListener('pointerdown', (event) => {
    const rect = elements.waveform.getBoundingClientRect();
    options.onSeek?.(((event.clientX - rect.left) / rect.width) * getAudio().duration);
  });
  elements.search.addEventListener('input', () => {
    filter = elements.search.value.trim();
    renderList();
  });
  elements.selectAll.addEventListener('click', () => {
    session.selectAll();
    renderAll();
  });
  elements.clearSelection.addEventListener('click', () => {
    session.clearSelection();
    renderAll();
  });
  elements.add.addEventListener('click', add);
  elements.duplicate.addEventListener('click', duplicate);
  elements.delete.addEventListener('click', remove);
  elements.moveUp.addEventListener('click', () => move(-1));
  elements.moveDown.addEventListener('click', () => move(1));
  elements.split.addEventListener('click', split);
  elements.merge.addEventListener('click', merge);
  elements.shiftEarlier.addEventListener('click', () => shift(-1));
  elements.shiftLater.addEventListener('click', () => shift(1));
  elements.apply.addEventListener('click', apply);
  elements.save.addEventListener('click', save);
  elements.text.addEventListener('focus', beginTextEdit);
  elements.text.addEventListener('input', () => previewTextEdit(elements.text.value));
  elements.text.addEventListener('change', finalizeTextEdit);
  elements.text.addEventListener('blur', finalizeTextEdit);
  elements.start.addEventListener('change', () => updateTime('start', elements.start.value));
  elements.end.addEventListener('change', () => updateTime('end', elements.end.value));
  elements.setStart.addEventListener('click', () => updateSelected({ start: getAudio().currentTime }, 'Cue start set from playhead'));
  elements.setEnd.addEventListener('click', () => updateSelected({ end: getAudio().currentTime }, 'Cue end set from playhead'));
  elements.importSrt.addEventListener('click', () => chooseImport('srt'));
  elements.importLrc.addEventListener('click', () => chooseImport('lrc'));
  elements.importFile.addEventListener('change', importFile);
  elements.exportSrt.addEventListener('click', () => download('srt'));
  elements.exportLrc.addEventListener('click', () => download('lrc'));
  elements.exportText.addEventListener('click', () => download('text'));

  elements.cueList.addEventListener('click', (event) => {
    const row = event.target.closest('.lyrics-editor-cue-row');
    if (!row) return;
    if (event.target.dataset.action === 'seek') {
      const cue = session.cues.find((item) => item.id === row.dataset.cueId);
      if (cue) options.onSeek?.(cue.start);
      return;
    }
    if (event.target.matches('input[data-field]')) return;
    session.select(row.dataset.cueId, {
      toggle: event.ctrlKey || event.metaKey || event.target.dataset.action === 'select',
      range: event.shiftKey
    });
    renderAll();
  });

  elements.cueList.addEventListener('change', (event) => {
    const row = event.target.closest('.lyrics-editor-cue-row');
    const field = event.target.dataset.field;
    if (!row || !field) return;
    session.select(row.dataset.cueId);
    if (field === 'text') updateSelected({ text: event.target.value }, 'Cue text updated');
    else updateTime(field, event.target.value);
  });

  window.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    } else if (!editing && event.code === 'Space') {
      event.preventDefault();
      options.onPlayPause?.();
    } else if (!editing && event.key === 'Enter') {
      event.preventDefault();
      event.shiftKey
        ? updateSelected({ end: getAudio().currentTime }, 'Cue end set from playhead')
        : updateSelected({ start: getAudio().currentTime }, 'Cue start set from playhead');
    } else if (!editing && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const current = selectedCue();
      const index = Math.max(0, session.cues.findIndex((cue) => cue.id === current?.id));
      const nextIndex = Math.max(0, Math.min(session.cues.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      if (session.cues[nextIndex]) {
        session.select(session.cues[nextIndex].id, { range: event.shiftKey });
        renderAll();
      }
    }
  });

  return { open, close, isOpen, apply, save };
}

function collectElements() {
  const byId = (id) => document.getElementById(id);
  return {
    panel: byId('lyricsEditorPanel'),
    close: byId('lyricsEditorClose'),
    footerClose: byId('lyricsEditorFooterClose'),
    modified: byId('lyricsEditorModified'),
    counter: byId('lyricsEditorCounter'),
    undo: byId('lyricsEditorUndo'),
    redo: byId('lyricsEditorRedo'),
    play: byId('lyricsEditorPlay'),
    back: byId('lyricsEditorBack'),
    forward: byId('lyricsEditorForward'),
    time: byId('lyricsEditorTime'),
    waveform: byId('lyricsEditorWaveform'),
    scrubber: byId('lyricsEditorScrubber'),
    search: byId('lyricsEditorSearch'),
    selectAll: byId('lyricsEditorSelectAll'),
    clearSelection: byId('lyricsEditorClearSelection'),
    add: byId('lyricsEditorAdd'),
    duplicate: byId('lyricsEditorDuplicate'),
    delete: byId('lyricsEditorDelete'),
    moveUp: byId('lyricsEditorMoveUp'),
    moveDown: byId('lyricsEditorMoveDown'),
    split: byId('lyricsEditorSplit'),
    merge: byId('lyricsEditorMerge'),
    cueList: byId('lyricsEditorCueList'),
    inspector: document.querySelector('.lyrics-editor-inspector'),
    selectionCount: byId('lyricsEditorSelectionCount'),
    text: byId('lyricsEditorText'),
    start: byId('lyricsEditorStart'),
    end: byId('lyricsEditorEnd'),
    setStart: byId('lyricsEditorSetStart'),
    setEnd: byId('lyricsEditorSetEnd'),
    kind: byId('lyricsEditorKind'),
    id: byId('lyricsEditorId'),
    shiftAmount: byId('lyricsEditorShiftAmount'),
    shiftScope: byId('lyricsEditorShiftScope'),
    shiftEarlier: byId('lyricsEditorShiftEarlier'),
    shiftLater: byId('lyricsEditorShiftLater'),
    validation: byId('lyricsEditorValidation'),
    importSrt: byId('lyricsEditorImportSrt'),
    importLrc: byId('lyricsEditorImportLrc'),
    importFile: byId('lyricsEditorImportFile'),
    exportSrt: byId('lyricsEditorExportSrt'),
    exportLrc: byId('lyricsEditorExportLrc'),
    exportText: byId('lyricsEditorExportText'),
    apply: byId('lyricsEditorApply'),
    save: byId('lyricsEditorSave'),
    message: byId('lyricsEditorMessage')
  };
}

function safeFilename(value) {
  return String(value || 'kr8-lyrics')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'kr8-lyrics';
}

function nearestWordBoundary(value, target) {
  const candidates = [...String(value || '').matchAll(/\s+/g)]
    .map((match) => match.index + match[0].length);
  if (!candidates.length) return target;
  return candidates.reduce((best, current) =>
    Math.abs(current - target) < Math.abs(best - target) ? current : best
  );
}
