/**
 * InputStore — canonical segment storage with cached frame array.
 * All mutations go through this class so dirty-tracking is correct.
 */
export class InputStore {
  constructor() {
    this._segments   = [];
    this._nextId     = 1;
    this._dirty      = true;
    this._cache      = null;
    this.totalFrames = 3600;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getSegments() { return this._segments; }

  /** Returns a cached Uint8Array bitmask per frame. O(1) when clean. */
  getFrameArray() {
    if (!this._dirty && this._cache) return this._cache;
    const arr    = new Uint8Array(this.totalFrames);
    const sorted = [...this._segments].sort((a, b) => a.start - b.start);
    for (const seg of sorted) {
      let bits = 0;
      if (seg.keys.includes('up'))    bits |= 1;
      if (seg.keys.includes('down'))  bits |= 2;
      if (seg.keys.includes('left'))  bits |= 4;
      if (seg.keys.includes('right')) bits |= 8;
      const end = Math.min(seg.end, this.totalFrames);
      for (let f = seg.start; f < end; f++) arr[f] |= bits;
    }
    this._cache = arr;
    this._dirty = false;
    return arr;
  }

  // ── Static codec ──────────────────────────────────────────────────────────

  static rleEncode(arr) {
    const out = [];
    let i = 0;
    while (i < arr.length) {
      const v = arr[i];
      let c = 1;
      while (i + c < arr.length && arr[i + c] === v && c < 65535) c++;
      out.push([v, c]);
      i += c;
    }
    return out;
  }

  static rleDecode(rle, totalFrames) {
    const arr = new Uint8Array(totalFrames);
    let f = 0;
    for (const [v, c] of rle) {
      arr.fill(v, f, Math.min(f + c, totalFrames));
      f += c;
      if (f >= totalFrames) break;
    }
    return arr;
  }

  static frameArrayToSegments(arr, startId = 1) {
    const segs = [];
    let id = startId, i = 0;
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
      segs.push({ id: id++, start: i, end: j, keys });
      i = j;
    }
    return { segs, nextId: id };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  setSegments(segs) {
    const prev     = this._snapshot();
    this._segments = segs.map(s => ({ ...s, keys: [...s.keys] }));
    this._nextId   = segs.length ? Math.max(...segs.map(s => s.id)) + 1 : 1;
    this._dirty    = true;
    return prev;
  }

  addSegment(seg) {
    const s = { ...seg, id: this._nextId++, keys: [...seg.keys] };
    this._segments.push(s);
    this._dirty = true;
    return s;
  }

  updateSegment(id, patch) {
    const seg = this._segments.find(s => s.id === id);
    if (!seg) return false;
    Object.assign(seg, patch);
    if (patch.keys) seg.keys = [...patch.keys];
    this._dirty = true;
    return true;
  }

  deleteSegment(id) {
    const idx = this._segments.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this._segments.splice(idx, 1);
    this._dirty = true;
    return true;
  }

  clearAll() { this._segments = []; this._dirty = true; }

  applyFrameArray(arr) {
    const { segs, nextId } = InputStore.frameArrayToSegments(arr, this._nextId);
    this._segments = segs;
    this._nextId   = nextId;
    this._dirty    = true;
  }

  mergeAdjacent() {
    const sorted = [...this._segments].sort((a, b) => a.start - b.start);
    const merged = [];
    for (const seg of sorted) {
      const prev  = merged[merged.length - 1];
      const sKeys = [...seg.keys].sort().join(',');
      const pKeys = prev ? [...prev.keys].sort().join(',') : null;
      if (prev && prev.end === seg.start && pKeys === sKeys) {
        prev.end = seg.end;
      } else {
        merged.push({ ...seg, keys: [...seg.keys] });
      }
    }
    this._segments = merged;
    this._dirty    = true;
  }

  allocId()  { return this._nextId++; }
  nextId()   { return this._nextId; }

  // ── Snapshot / clone ──────────────────────────────────────────────────────

  _snapshot() {
    return {
      segments: this._segments.map(s => ({ ...s, keys: [...s.keys] })),
      nextId:   this._nextId,
    };
  }

  restoreSnapshot(snap) {
    this._segments = snap.segments.map(s => ({ ...s, keys: [...s.keys] }));
    this._nextId   = snap.nextId;
    this._dirty    = true;
  }

  clone() {
    const c        = new InputStore();
    c._segments    = this._segments.map(s => ({ ...s, keys: [...s.keys] }));
    c._nextId      = this._nextId;
    c.totalFrames  = this.totalFrames;
    c._dirty       = true;
    return c;
  }

  /** Export clean object (no circular refs) for JSON serialization. */
  toJSON() {
    return {
      segments:    this._segments.map(s => ({ ...s, keys: [...s.keys] })),
      nextId:      this._nextId,
      totalFrames: this.totalFrames,
    };
  }

  static fromJSON(obj) {
    const s        = new InputStore();
    s._segments    = (obj.segments || []).map(seg => ({ ...seg, keys: [...seg.keys] }));
    s._nextId      = obj.nextId || (s._segments.length ? Math.max(...s._segments.map(x => x.id)) + 1 : 1);
    s.totalFrames  = obj.totalFrames || 3600;
    s._dirty       = true;
    return s;
  }
}
