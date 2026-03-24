/**
 * Timeline — canvas-based timeline renderer with zoom and a playback cursor.
 * Reads from InputStore directly; call render() to refresh.
 */
export class Timeline {
  constructor(canvas, store) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d');
    this._store   = store;

    this._viewStart   = 0;    // first visible frame
    this._viewEnd     = null; // last visible frame (null = totalFrames)
    this._cursor      = -1;   // current playback frame, -1 = hidden
    this._markers     = [];   // [{frame, frameEnd?, label, color}]
    this._previewSeg  = null; // transient preview overlay
    this._editingId   = null;

    this.onSeek = null; // (frame) => void — fired on click

    // Zoom via wheel
    canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    canvas.addEventListener('click', e => this._onClick(e));

    const ro = new ResizeObserver(() => this._resize());
    ro.observe(canvas.parentElement);
    setTimeout(() => this._resize(), 80);
  }

  static TRACK_ORDER = ['up', 'left', 'right', 'down'];
  static KEY_COLORS  = { up: '#39ff85', down: '#ff3a5c', left: '#3a9eff', right: '#ff9c3a' };
  static KEY_LABELS  = { up: '↑', down: '↓', left: '←', right: '→' };

  // ── Public API ────────────────────────────────────────────────────────────

  setCursor(frame)      { this._cursor = frame;    this.render(); }
  setPreview(seg)       { this._previewSeg = seg;  this.render(); }
  clearPreview()        { this._previewSeg = null; this.render(); }
  setEditingId(id)      { this._editingId = id;    this.render(); }
  setMarkers(markers)   { this._markers = markers; this.render(); }

  resetZoom() {
    this._viewStart = 0;
    this._viewEnd   = null;
    this.render();
  }

  render() {
    const dpr      = window.devicePixelRatio || 1;
    const W        = this._canvas.width;
    const H        = this._canvas.height;
    const ctx      = this._ctx;
    const total    = this._store.totalFrames;
    const vStart   = this._viewStart;
    const vEnd     = this._viewEnd !== null ? this._viewEnd : total;
    const viewSpan = vEnd - vStart;

    const LW = 18 * dpr; // label gutter width
    const TH = (H - 14 * dpr) / Timeline.TRACK_ORDER.length;

    ctx.clearRect(0, 0, W, H);

    // Track backgrounds + labels
    Timeline.TRACK_ORDER.forEach((key, i) => {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, i * TH, W, TH);
      ctx.fillStyle = Timeline.KEY_COLORS[key];
      ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(Timeline.KEY_LABELS[key], 2 * dpr, i * TH + TH / 2);
    });

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    for (let i = 1; i < 10; i++) {
      const x = LW + (i / 10) * (W - LW);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14 * dpr); ctx.stroke();
    }

    // Frame → x helper (clamped to view window)
    const toX = f => LW + ((f - vStart) / viewSpan) * (W - LW);

    // Segments
    const segs = [...this._store.getSegments(), ...(this._previewSeg ? [this._previewSeg] : [])];
    for (const seg of segs) {
      if (!seg.keys.length) continue;
      const x1 = toX(seg.start);
      const x2 = toX(seg.end);
      if (x2 < LW || x1 > W) continue; // out of view
      const w  = Math.max(x2 - Math.max(x1, LW), 2);
      const rx = Math.max(x1, LW);
      const isPreview = seg.id === 'preview';
      const isEditing = seg.id === this._editingId;

      for (const key of seg.keys) {
        const i = Timeline.TRACK_ORDER.indexOf(key);
        if (i === -1) continue;
        ctx.globalAlpha = isPreview ? 0.4 : isEditing ? 1 : 0.72;
        ctx.fillStyle   = Timeline.KEY_COLORS[key];
        ctx.fillRect(rx, i * TH + TH * 0.1, w, TH * 0.8);
        if (isEditing || isPreview) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
          ctx.strokeRect(rx, i * TH + TH * 0.1, w, TH * 0.8);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Markers
    for (const m of this._markers) {
      const x = toX(m.frame);
      if (x < LW || x > W) continue;
      ctx.strokeStyle = m.color || '#FFD60A';
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14 * dpr); ctx.stroke();
      if (m.label) {
        ctx.fillStyle = m.color || '#FFD60A';
        ctx.font = `${8 * dpr}px JetBrains Mono, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(m.label, x + 2, 2);
      }
    }
    ctx.globalAlpha = 1;

    // Playback cursor
    if (this._cursor >= 0) {
      const x = toX(this._cursor);
      if (x >= LW && x <= W) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14 * dpr); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // Time labels
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = `${7 * dpr}px JetBrains Mono, monospace`;
    ctx.textBaseline = 'bottom';
    const fps = (this._store.fps || 60);
    for (let i = 0; i <= 5; i++) {
      const f = vStart + (i / 5) * viewSpan;
      const t = (f / fps).toFixed(1) + 's';
      const x = LW + (i / 5) * (W - LW);
      ctx.textAlign = i === 5 ? 'right' : i === 0 ? 'left' : 'center';
      ctx.fillText(t, x, H - 1);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this._canvas.parentElement.getBoundingClientRect();
    const cssW = rect.width - 20;
    this._canvas.style.width  = cssW + 'px';
    this._canvas.style.height = '76px';
    this._canvas.width  = cssW * dpr;
    this._canvas.height = 76 * dpr;
    this.render();
  }

  _frameAtX(clientX) {
    const rect    = this._canvas.getBoundingClientRect();
    const LW      = 18;
    const x       = clientX - rect.left - LW;
    const trackW  = rect.width - LW;
    const total   = this._store.totalFrames;
    const vStart  = this._viewStart;
    const vEnd    = this._viewEnd !== null ? this._viewEnd : total;
    return Math.max(0, Math.min(total, Math.round(vStart + (x / trackW) * (vEnd - vStart))));
  }

  _onClick(e) {
    const frame = this._frameAtX(e.clientX);
    if (this.onSeek) this.onSeek(frame, e.shiftKey);
  }

  _onWheel(e) {
    e.preventDefault();
    const total  = this._store.totalFrames;
    const vStart = this._viewStart;
    const vEnd   = this._viewEnd !== null ? this._viewEnd : total;
    const vSpan  = vEnd - vStart;

    const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
    const newSpan    = Math.min(total, Math.max(60, vSpan * zoomFactor));

    // Zoom around cursor position
    const rect    = this._canvas.getBoundingClientRect();
    const frac    = Math.max(0, Math.min(1, (e.clientX - rect.left - 18) / (rect.width - 18)));
    const anchor  = vStart + frac * vSpan;
    let   newStart = anchor - frac * newSpan;
    let   newEnd   = newStart + newSpan;

    if (newStart < 0)      { newStart = 0; newEnd = newSpan; }
    if (newEnd   > total)  { newEnd = total; newStart = total - newSpan; }

    this._viewStart = Math.max(0, newStart);
    this._viewEnd   = Math.min(total, newEnd);
    this.render();
  }

  frameAtX(clientX) { return this._frameAtX(clientX); }
  get viewStart()    { return this._viewStart; }
  get viewEnd()      { return this._viewEnd !== null ? this._viewEnd : this._store.totalFrames; }
}
