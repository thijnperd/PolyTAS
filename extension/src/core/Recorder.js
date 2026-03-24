/**
 * Recorder — rAF-locked frame-accurate input recording.
 *
 * Frame ticks come from GAME_TICK messages sent by content_capture.js
 * (which intercepts the game's requestAnimationFrame). This ensures the
 * recorded frame count matches the game's actual frame counter exactly,
 * not wall-clock time.
 */
export class Recorder {
  constructor(store, undoManager) {
    this._store         = store;
    this._undo          = undoManager;
    this._recording     = false;
    this._startFrame    = 0;
    this._heldBits      = 0;
    this._frames        = [];   // Uint8 bitmask per game tick
    this._onTick        = null; // bound handler

    this.onStateChange  = null; // (isRecording, frameCount) => void
    this.onFrameTick    = null; // (frameCount) => void — for UI counter
  }

  // KEY_TO_BIT shared constant
  static KEY_TO_BIT = {
    ArrowUp:    1, w: 1, W: 1,
    ArrowDown:  2, s: 2, S: 2,
    ArrowLeft:  4, a: 4, A: 4,
    ArrowRight: 8, d: 8, D: 8,
  };

  get isRecording() { return this._recording; }
  get frameCount()  { return this._frames.length; }

  start(startFrame = null) {
    if (this._recording) return;
    this._recording  = true;
    this._heldBits   = 0;
    this._frames     = [];
    this._startFrame = startFrame !== null
      ? startFrame
      : (this._store.getSegments().length
          ? Math.max(...this._store.getSegments().map(s => s.end))
          : 0);
    this._notifyState();
  }

  stop() {
    if (!this._recording) return;
    this._recording = false;
    this._flushToStore();
    this._notifyState();
  }

  toggle(startFrame = null) {
    this._recording ? this.stop() : this.start(startFrame);
  }

  /** Called by bridge when a GAME_TICK arrives. */
  onGameTick() {
    if (!this._recording) return;
    this._frames.push(this._heldBits);
    if (this.onFrameTick) this.onFrameTick(this._frames.length);
  }

  /** Called by bridge on KEY_DOWN from the game tab. */
  onKeyDown(key) {
    const bit = Recorder.KEY_TO_BIT[key];
    if (bit) this._heldBits |= bit;
  }

  /** Called by bridge on KEY_UP from the game tab. */
  onKeyUp(key) {
    const bit = Recorder.KEY_TO_BIT[key];
    if (bit) this._heldBits &= ~bit;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _flushToStore() {
    if (!this._frames.length) return;

    // Convert bitmask array → segments via RLE
    const { InputStore } = window.__polytas_modules || {};
    const newSegs = [];
    const arr     = new Uint8Array(this._frames);
    let i = 0;
    while (i < arr.length) {
      const v = arr[i];
      if (v === 0) { i++; continue; }
      let j = i + 1;
      while (j < arr.length && arr[j] === v) j++;
      const keys = [];
      if (v & 1) keys.push('up');
      if (v & 2) keys.push('down');
      if (v & 4) keys.push('left');
      if (v & 8) keys.push('right');
      newSegs.push({
        start:    this._startFrame + i,
        end:      this._startFrame + j,
        keys,
        recorded: true,
      });
      i = j;
    }

    const prevSnap = this._store._snapshot();
    this._undo.execute({
      label: `Record ${this._frames.length} frames`,
      apply: () => {
        for (const seg of newSegs) this._store.addSegment(seg);
        this._store.mergeAdjacent();
      },
      undo: () => this._store.restoreSnapshot(prevSnap),
    });
  }

  _notifyState() {
    if (this.onStateChange) this.onStateChange(this._recording, this._frames.length);
  }
}
