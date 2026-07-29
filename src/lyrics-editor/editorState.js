export class LyricsEditorSession {
  constructor(cues = [], options = {}) {
    this.limit = Math.max(1, Number(options.historyLimit || 100));
    this.cues = clone(cues);
    this.baseline = clone(cues);
    this.selectedIds = new Set();
    this.anchorId = '';
    this.undoStack = [];
    this.redoStack = [];
  }

  get modified() {
    return JSON.stringify(this.cues) !== JSON.stringify(this.baseline);
  }

  commit(nextCues) {
    this.undoStack.push(clone(this.cues));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.cues = clone(nextCues);
    this.redoStack = [];
    this.pruneSelection();
    return this.cues;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(clone(this.cues));
    this.cues = this.undoStack.pop();
    this.pruneSelection();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(clone(this.cues));
    this.cues = this.redoStack.pop();
    this.pruneSelection();
    return true;
  }

  markApplied() {
    this.baseline = clone(this.cues);
  }

  select(cueId, options = {}) {
    const ids = this.cues.map((cue) => cue.id);
    if (!ids.includes(cueId)) return;
    if (options.range && this.anchorId && ids.includes(this.anchorId)) {
      const start = Math.min(ids.indexOf(this.anchorId), ids.indexOf(cueId));
      const end = Math.max(ids.indexOf(this.anchorId), ids.indexOf(cueId));
      this.selectedIds = new Set(ids.slice(start, end + 1));
    } else if (options.toggle) {
      if (this.selectedIds.has(cueId)) this.selectedIds.delete(cueId);
      else this.selectedIds.add(cueId);
      this.anchorId = cueId;
    } else {
      this.selectedIds = new Set([cueId]);
      this.anchorId = cueId;
    }
  }

  selectAll() {
    this.selectedIds = new Set(this.cues.map((cue) => cue.id));
    this.anchorId = this.cues[0]?.id || '';
  }

  clearSelection() {
    this.selectedIds.clear();
    this.anchorId = '';
  }

  pruneSelection() {
    const valid = new Set(this.cues.map((cue) => cue.id));
    this.selectedIds = new Set([...this.selectedIds].filter((id) => valid.has(id)));
    if (!valid.has(this.anchorId)) this.anchorId = [...this.selectedIds][0] || '';
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || []));
}
