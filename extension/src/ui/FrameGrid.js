/**
 * FrameGrid — virtualized frame-by-frame input editor.
 *
 * Renders only the rows visible in the scroll viewport plus a buffer,
 * so even 72000-frame runs are performant.
 *
 * Each cell can be clicked or dragged to toggle a key on/off for that frame.
 * All mutations go through UndoManager.
 */
export class FrameGrid {
  constructor(container, store, undoManager) {
    this._container   = container;
    this._store       = store;
    this._undo        = undoManager;

    this._rangeStart  = 0;
    this._rangeEnd    = 120;

    this._dragBit     = null;
    this._dragOn      = null;
    this._pendingEdit = null; // accumulate drag edits into one undo

    this.ROW_H = 20; // px per row

    this._buildDOM();
    this._bindScroll();
    this._bindMouse();
  }

  static KEY_ORDER = ['up', 'down', 'left', 'right'];
  static BIT       = { up: 1, down: 2, left: 4, right: 8 };
  static LABEL     = { up: '↑', down: '↓', left: '←', right: '→' };
  static COLOR_CLS = { up: 'on-up', down: 'on-down', left: 'on-left', right: 'on-right' };

  // ── Public API ────────────────────────────────────────────────────────────

  setRange(start, end) {
    this._rangeStart = start;
    this._rangeEnd   = end;
    this.refresh();
  }

  /** Full re-render from scratch (call after store mutations). */
  refresh() { this._renderVisible(); }

  // ── DOM setup ─────────────────────────────────────────────────────────────

  _buildDOM() {
    this._container.innerHTML = '';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'fg-header';
    hdr.innerHTML =
      '<span class="fg-hcell fg-hframe">FRAME</span>' +
      FrameGrid.KEY_ORDER.map(k =>
        `<span class="fg-hcell fg-th-${k}">${FrameGrid.LABEL[k]}</span>`
      ).join('');
    this._container.appendChild(hdr);

    // Scroll shell: spacer-top + table + spacer-bottom
    this._scroll = document.createElement('div');
    this._scroll.className = 'fg-scroll';
    this._container.appendChild(this._scroll);

    this._topSpacer = document.createElement('div');
    this._topSpacer.className = 'fg-spacer';
    this._scroll.appendChild(this._topSpacer);

    this._tbody = document.createElement('div');
    this._tbody.className = 'fg-tbody';
    this._scroll.appendChild(this._tbody);

    this._botSpacer = document.createElement('div');
    this._botSpacer.className = 'fg-spacer';
    this._scroll.appendChild(this._botSpacer);

    this._renderStart = this._rangeStart;
    this._renderEnd   = this._rangeStart;
  }

  _bindScroll() {
    this._scroll.addEventListener('scroll', () => {
      const top    = this._scroll.scrollTop;
      const height = this._scroll.clientHeight;
      const BUFFER = 100;
      const newStart = Math.max(this._rangeStart, this._rangeStart + Math.floor(top / this.ROW_H) - BUFFER);
      const newEnd   = Math.min(this._rangeEnd, newStart + Math.ceil(height / this.ROW_H) + BUFFER * 2);

      if (Math.abs(newStart - this._renderStart) > 20 || newEnd !== this._renderEnd) {
        this._renderRange(newStart, newEnd);
      }
    }, { passive: true });
  }

  _bindMouse() {
    this._tbody.addEventListener('mousedown', e => {
      const cell = e.target.closest('.fg-cell');
      if (!cell) return;
      const frame = +cell.dataset.frame;
      const key   = cell.dataset.key;
      const arr   = this._store.getFrameArray();
      this._dragBit = FrameGrid.BIT[key];
      this._dragOn  = !(arr[frame] & this._dragBit);
      this._pendingEdit = this._store._snapshot();
      this._applyCell(frame, key, this._dragOn);
      e.preventDefault();
    });

    this._tbody.addEventListener('mouseenter', e => {
      if (this._dragBit === null || !e.buttons) { this._finishDrag(); return; }
      const cell = e.target.closest('.fg-cell');
      if (!cell) return;
      if (FrameGrid.BIT[cell.dataset.key] !== this._dragBit) return;
      this._applyCell(+cell.dataset.frame, cell.dataset.key, this._dragOn);
    }, true);

    document.addEventListener('mouseup', () => this._finishDrag());
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _renderVisible() {
    const top    = this._scroll.scrollTop;
    const height = this._scroll.clientHeight || 300;
    const BUFFER = 100;
    const start  = Math.max(this._rangeStart, this._rangeStart + Math.floor(top / this.ROW_H) - BUFFER);
    const end    = Math.min(this._rangeEnd, start + Math.ceil(height / this.ROW_H) + BUFFER * 2);
    this._renderRange(start, end);
  }

  _renderRange(start, end) {
    this._renderStart = start;
    this._renderEnd   = end;

    const totalRows = this._rangeEnd - this._rangeStart;
    const preRows   = start - this._rangeStart;
    const postRows  = this._rangeEnd - end;

    this._topSpacer.style.height = (preRows  * this.ROW_H) + 'px';
    this._botSpacer.style.height = (postRows * this.ROW_H) + 'px';

    const arr  = this._store.getFrameArray();
    const frag = document.createDocumentFragment();

    for (let f = start; f < end; f++) {
      const m   = arr[f] || 0;
      const row = document.createElement('div');
      row.className = 'fg-row';

      const lbl = document.createElement('span');
      lbl.className = 'fg-frame';
      lbl.textContent = 'f' + f;
      row.appendChild(lbl);

      for (const key of FrameGrid.KEY_ORDER) {
        const bit  = FrameGrid.BIT[key];
        const cell = document.createElement('span');
        cell.className = 'fg-cell' + ((m & bit) ? ' ' + FrameGrid.COLOR_CLS[key] : '');
        cell.dataset.frame = f;
        cell.dataset.key   = key;
        row.appendChild(cell);
      }
      frag.appendChild(row);
    }

    this._tbody.innerHTML = '';
    this._tbody.appendChild(frag);
  }

  _updateRow(frame) {
    const arr  = this._store.getFrameArray();
    const m    = arr[frame] || 0;
    const row  = this._tbody.querySelector(`[data-frame="${frame}"]`);
    if (!row) return;
    const tr = row.closest('.fg-row') || row.parentElement;
    tr.querySelectorAll('.fg-cell').forEach(cell => {
      const key = cell.dataset.key;
      const bit = FrameGrid.BIT[key];
      cell.className = 'fg-cell' + ((m & bit) ? ' ' + FrameGrid.COLOR_CLS[key] : '');
    });
  }

  // ── Cell edit ─────────────────────────────────────────────────────────────

  _applyCell(frame, key, turnOn) {
    // Modify the frame array directly then rebuild segments
    const arr = new Uint8Array(this._store.getFrameArray()); // copy
    const bit = FrameGrid.BIT[key];
    if (turnOn) arr[frame] |= bit;
    else        arr[frame] &= ~bit;

    // Write back without going through undo yet (drag accumulates)
    this._store.applyFrameArray(arr);
    this._updateRow(frame);
    this._store.mergeAdjacent();
  }

  _finishDrag() {
    if (this._dragBit === null) return;
    this._dragBit = null;
    this._dragOn  = null;

    if (this._pendingEdit) {
      const prevSnap = this._pendingEdit;
      const newSnap  = this._store._snapshot();
      this._undo.execute({
        label: 'Frame grid edit',
        apply: () => this._store.restoreSnapshot(newSnap),
        undo:  () => { this._store.restoreSnapshot(prevSnap); this.refresh(); },
      });
      this._pendingEdit = null;
    }
  }
}
