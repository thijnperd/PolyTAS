// ================================================================
// STATE
// ================================================================
let segments = [];
let nextId = 1;
let totalFrames = 3600;
let fps = 60;
let editingId = null;
let formKeys = new Set();
let previewSeg = null;
let currentTab = 'segments';
const isPipWindow = new URLSearchParams(window.location.search).has('pip');
let extPort = null;
let attachState = 'detached';

// Recording
let isRecording = false;
let recordingStartFrame = 0;
let recordedFrames = [];
let recordHeldKeys = 0;
let recordFrameCount = 0;
let recordInterval = null;

// Splice
let spliceKeys = new Set();

// Frame grid drag
let fgDragBit = null;
let fgDragOn  = null;

// ================================================================
// SETTINGS
// ================================================================
function onSettingsChange() {
  totalFrames = parseInt(document.getElementById('totalFrames').value) || 3600;
  fps = parseInt(document.getElementById('fps').value) || 60;
  document.getElementById('durDisplay').textContent = (totalFrames / fps).toFixed(2) + 's';
  updateStats();
  drawTimeline();
}

// ================================================================
// TABS
// ================================================================
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabSegments').classList.toggle('active', tab === 'segments');
  document.getElementById('tabFrames').classList.toggle('active', tab === 'frames');
  document.getElementById('segList').style.display = tab === 'segments' ? '' : 'none';
  document.getElementById('frameGridPanel').classList.toggle('active', tab === 'frames');
  if (tab === 'frames') renderFrameGrid();
}

// ================================================================
// PiP WINDOW
// ================================================================
function getAppUrl(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

async function openPip() {
  if (isPipWindow) {
    showToast('Already in PiP window.');
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    alert('Picture-in-Picture is not available in this Chrome build.');
    return;
  }
  try {
    const pipWindow = await documentPictureInPicture.requestWindow({ width: 380, height: 900 });
    pipWindow.document.body.style.margin = '0';
    const iframe = pipWindow.document.createElement('iframe');
    iframe.src = getAppUrl('polytas.html?pip=1');
    iframe.style.cssText = 'border:0;width:100%;height:100%;';
    pipWindow.document.body.appendChild(iframe);
  } catch (err) {
    alert('Failed to open PiP window: ' + err.message);
  }
}

function initPipUI() {
  if (!isPipWindow) return;
  document.body.classList.add('pip-window');
  const pipBtn = document.getElementById('pipBtn');
  if (pipBtn) pipBtn.style.display = 'none';
}

// ================================================================
// EXTENSION BRIDGE
// ================================================================
function setAttachState(state) {
  attachState = state;
  const btn = document.getElementById('attachBtn');
  if (!btn) return;
  if (state === 'attached') {
    btn.textContent = 'GAME ATTACHED';
    btn.classList.add('btn-attached');
  } else if (state === 'pending') {
    btn.textContent = 'ATTACHING...';
    btn.classList.remove('btn-attached');
  } else {
    btn.textContent = 'ATTACH GAME';
    btn.classList.remove('btn-attached');
  }
}

function attachToGame() {
  if (!extPort) {
    showToast('Attach requires the Chrome extension.');
    return;
  }
  setAttachState('pending');
  extPort.postMessage({ type: 'ATTACH_GAME' });
}

function handleExtensionMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'KEY_DOWN') handleKeyDown(msg);
  if (msg.type === 'KEY_UP') handleKeyUp(msg);
  if (msg.type === 'TOGGLE_RECORDING') toggleRecording();
  if (msg.type === 'ATTACH_STATUS') {
    if (msg.status === 'attached') {
      setAttachState('attached');
      showToast('Attached to game tab.');
    } else {
      setAttachState('detached');
      showToast(msg.error || 'Attach failed.');
    }
  }
}

function initExtensionBridge() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) {
    const btn = document.getElementById('attachBtn');
    if (btn) {
      btn.textContent = 'EXTENSION ONLY';
      btn.disabled = true;
    }
    return;
  }
  extPort = chrome.runtime.connect({ name: 'polytas' });
  extPort.onMessage.addListener(handleExtensionMessage);
  extPort.onDisconnect.addListener(() => {
    extPort = null;
    setAttachState('detached');
  });
}

// ================================================================
// RECORDING
// ================================================================
const KEY_TO_BIT = {
  ArrowUp: 1, w: 1, W: 1,
  ArrowDown: 2, s: 2, S: 2,
  ArrowLeft: 4, a: 4, A: 4,
  ArrowRight: 8, d: 8, D: 8
};

function handleKeyDown(e) {
  if (e && e.ctrlKey && e.shiftKey && (e.key === '.' || e.key === '>')) {
    if (e.preventDefault) e.preventDefault();
    toggleRecording();
    return;
  }
  if (isRecording) {
    const bit = KEY_TO_BIT[e.key];
    if (bit) recordHeldKeys |= bit;
  }
}

function handleKeyUp(e) {
  if (isRecording) {
    const bit = KEY_TO_BIT[e.key];
    if (bit) recordHeldKeys &= ~bit;
  }
}

function toggleRecording() {
  if (isRecording) stopRecording(); else startRecording();
}

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  recordedFrames = [];
  recordHeldKeys = 0;
  recordFrameCount = 0;
  recordingStartFrame = segments.length > 0 ? Math.max(...segments.map(s => s.end)) : 0;

  document.getElementById('recIndicator').classList.add('recording');
  document.getElementById('recLabel').textContent = 'REC â€¢ 0f';
  document.getElementById('recBtn').textContent = 'â¹ STOP';
  document.getElementById('recOverlay').classList.add('active');

  const frameDuration = 1000 / fps;
  recordInterval = setInterval(() => {
    recordedFrames.push(recordHeldKeys);
    recordFrameCount++;
    document.getElementById('recLabel').textContent = 'REC â€¢ ' + recordFrameCount + 'f';
  }, frameDuration);

  showToast('Recording â€” Ctrl+Shift+. to stop');
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(recordInterval);
  recordInterval = null;

  document.getElementById('recIndicator').classList.remove('recording');
  document.getElementById('recLabel').textContent = 'REC';
  document.getElementById('recBtn').textContent = 'âº REC';
  document.getElementById('recOverlay').classList.remove('active');

  if (recordedFrames.length === 0) {
    showToast('No frames recorded.');
    return;
  }

  const newSegs = rleToSegments(recordedFrames, recordingStartFrame);
  newSegs.forEach(s => segments.push({ id: nextId++, start: s.start, end: s.end, keys: s.keys, recorded: true }));
  renderSegments();
  showToast('Recorded ' + recordedFrames.length + 'f â†’ ' + newSegs.length + ' segment(s)');
}

// Convert raw bitmask array â†’ compressed segments
function rleToSegments(frames, offset) {
  const segs = [];
  let i = 0;
  while (i < frames.length) {
    const v = frames[i];
    if (v === 0) { i++; continue; }
    let j = i + 1;
    while (j < frames.length && frames[j] === v) j++;
    const keys = [];
    if (v & 1) keys.push('up');
    if (v & 2) keys.push('down');
    if (v & 4) keys.push('left');
    if (v & 8) keys.push('right');
    segs.push({ start: offset + i, end: offset + j, keys });
    i = j;
  }
  return segs;
}

// Global key listeners
document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

// ================================================================
// TIMELINE CANVAS
// ================================================================
const canvas = document.getElementById('timeline');
const ctx = canvas.getContext('2d');

const TRACK_ORDER = ['up', 'left', 'right', 'down'];
const KEY_COLORS  = { up: '#39ff85', down: '#ff3a5c', left: '#3a9eff', right: '#ff9c3a' };
const KEY_LABELS  = { up: 'â†‘', down: 'â†“', left: 'â†', right: 'â†’' };

function resizeCanvas() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const cssW = rect.width - 20;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = '76px';
  canvas.width  = cssW * dpr;
  canvas.height = 76 * dpr;
  drawTimeline();
}

function drawTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  const TH = H / TRACK_ORDER.length;
  const LW = 16 * dpr;

  ctx.clearRect(0, 0, W, H);

  TRACK_ORDER.forEach((key, i) => {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, i * TH, W, TH);
    ctx.fillStyle = KEY_COLORS[key];
    ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(KEY_LABELS[key], 2 * dpr, i * TH + TH / 2);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = LW + (i / 10) * (W - LW);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  [...segments, ...(previewSeg ? [previewSeg] : [])].forEach(seg => {
    if (!seg.keys.length) return;
    const x1 = LW + (seg.start / totalFrames) * (W - LW);
    const x2 = LW + (seg.end   / totalFrames) * (W - LW);
    const w  = Math.max(x2 - x1, 2);
    const isPreview = seg.id === 'preview';
    const isEditing = seg.id === editingId;

    seg.keys.forEach(key => {
      const i = TRACK_ORDER.indexOf(key);
      if (i === -1) return;
      ctx.globalAlpha = isPreview ? 0.4 : (isEditing ? 1 : 0.72);
      ctx.fillStyle = KEY_COLORS[key];
      ctx.fillRect(x1, i * TH + TH * 0.1, w, TH * 0.8);
      if (isEditing || isPreview) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
        ctx.strokeRect(x1, i * TH + TH * 0.1, w, TH * 0.8);
      }
    });
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = `${7 * dpr}px JetBrains Mono, monospace`;
  ctx.textBaseline = 'bottom';
  for (let i = 0; i <= 5; i++) {
    const t = ((i / 5) * totalFrames / fps).toFixed(1);
    const x = LW + (i / 5) * (W - LW);
    ctx.textAlign = i === 5 ? 'right' : i === 0 ? 'left' : 'center';
    ctx.fillText(t + 's', x, H - 1);
  }
}

canvas.addEventListener('click', function(e) {
  const rect = canvas.getBoundingClientRect();
  const LW = 16;
  const x = e.clientX - rect.left - LW;
  const trackW = rect.width - LW;
  const frame = Math.max(0, Math.round((x / trackW) * totalFrames));
  if (e.shiftKey) {
    document.getElementById('formEnd').value = Math.max(frame, parseInt(document.getElementById('formStart').value) + 1);
  } else {
    document.getElementById('formStart').value = frame;
    const curEnd = parseInt(document.getElementById('formEnd').value) || 120;
    if (frame >= curEnd) {
      document.getElementById('formEnd').value = frame + 60;
    }
  }
  previewSegment();
});

const ro = new ResizeObserver(resizeCanvas);
ro.observe(canvas.parentElement);
setTimeout(resizeCanvas, 80);

// ================================================================
// FRAME GRID
// ================================================================
function renderFrameGrid() {
  const start = parseInt(document.getElementById('fgStart').value) || 0;
  const end   = parseInt(document.getElementById('fgEnd').value)   || 120;
  const arr   = buildFrameArray();
  const tbody = document.getElementById('fgBody');
  const rows  = [];

  const limit = Math.min(end, totalFrames, start + 2000); // cap at 2000 rows for performance

  for (let f = start; f < limit; f++) {
    const m = arr[f];
    rows.push(
      `<tr>` +
      `<td>f${f}</td>` +
      `<td><div class="fg-cell${(m&1)?' on-up':''}" data-frame="${f}" data-bit="1" data-key="up"></div></td>` +
      `<td><div class="fg-cell${(m&2)?' on-down':''}" data-frame="${f}" data-bit="2" data-key="down"></div></td>` +
      `<td><div class="fg-cell${(m&4)?' on-left':''}" data-frame="${f}" data-bit="4" data-key="left"></div></td>` +
      `<td><div class="fg-cell${(m&8)?' on-right':''}" data-frame="${f}" data-bit="8" data-key="right"></div></td>` +
      `</tr>`
    );
  }

  tbody.innerHTML = rows.join('');

  tbody.querySelectorAll('.fg-cell').forEach(cell => {
    cell.addEventListener('mousedown', fgCellDown);
    cell.addEventListener('mouseenter', fgCellEnter);
  });
}

function fgCellDown(e) {
  const frame = parseInt(e.currentTarget.dataset.frame);
  const bit   = parseInt(e.currentTarget.dataset.bit);
  const key   = e.currentTarget.dataset.key;
  const arr   = buildFrameArray();
  fgDragBit = bit;
  fgDragOn  = !(arr[frame] & bit); // toggle direction
  fgApplyCell(frame, bit, fgDragOn, key);
  e.preventDefault();
}

function fgCellEnter(e) {
  if (fgDragBit === null || e.buttons === 0) { fgDragBit = null; return; }
  const bit = parseInt(e.currentTarget.dataset.bit);
  if (bit !== fgDragBit) return;
  const frame = parseInt(e.currentTarget.dataset.frame);
  const key   = e.currentTarget.dataset.key;
  fgApplyCell(frame, bit, fgDragOn, key);
}

document.addEventListener('mouseup', () => { fgDragBit = null; fgDragOn = null; });

function fgApplyCell(frame, bit, turnOn, key) {
  const segsOnFrame = segments.filter(s => s.start <= frame && s.end > frame);

  if (segsOnFrame.length === 0) {
    if (turnOn) segments.push({ id: nextId++, start: frame, end: frame + 1, keys: [key] });
  } else {
    segsOnFrame.forEach(seg => {
      const newSegs = [];
      if (seg.start < frame)
        newSegs.push({ id: nextId++, start: seg.start, end: frame, keys: [...seg.keys], recorded: seg.recorded });
      const newKeys = turnOn
        ? [...new Set([...seg.keys, key])]
        : seg.keys.filter(k => k !== key);
      if (newKeys.length > 0)
        newSegs.push({ id: nextId++, start: frame, end: frame + 1, keys: newKeys });
      if (seg.end > frame + 1)
        newSegs.push({ id: nextId++, start: frame + 1, end: seg.end, keys: [...seg.keys], recorded: seg.recorded });
      segments = segments.filter(s => s.id !== seg.id);
      segments.push(...newSegs);
    });
  }

  segments = mergeAdjacentSegments(segments);
  // Update just the affected row visually for performance
  const arr = buildFrameArray();
  const m = arr[frame];
  const row = document.querySelector(`[data-frame="${frame}"][data-bit="1"]`);
  if (row) {
    const tr = row.closest('tr');
    tr.querySelectorAll('.fg-cell').forEach(cell => {
      const b = parseInt(cell.dataset.bit);
      const k = cell.dataset.key;
      cell.className = 'fg-cell' + ((m & b) ? ` on-${k}` : '');
    });
  }
  updateStats();
  drawTimeline();
}

function mergeAdjacentSegments(segs) {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of sorted) {
    const prev = merged[merged.length - 1];
    const sKeys = [...seg.keys].sort().join(',');
    const pKeys = prev ? [...prev.keys].sort().join(',') : null;
    if (prev && prev.end === seg.start && pKeys === sKeys) {
      prev.end = seg.end;
    } else {
      merged.push({ ...seg, keys: [...seg.keys] });
    }
  }
  return merged;
}

function fgSelectAll() {
  document.getElementById('fgStart').value = 0;
  document.getElementById('fgEnd').value = totalFrames;
  renderFrameGrid();
}

// ================================================================
// FORM
// ================================================================
function toggleKey(key) {
  formKeys.has(key) ? formKeys.delete(key) : formKeys.add(key);
  document.querySelectorAll('.key-btn').forEach(btn => {
    btn.classList.toggle('active', formKeys.has(btn.dataset.key));
  });
  previewSegment();
}

function previewSegment() {
  const start = parseInt(document.getElementById('formStart').value) || 0;
  const end   = parseInt(document.getElementById('formEnd').value)   || 0;
  const dur   = Math.max(0, end - start);
  document.getElementById('segDurHint').textContent =
    'Duration: ' + dur + ' frames Â· ' + (dur / fps).toFixed(2) + 's';
  previewSeg = { id: 'preview', start, end, keys: [...formKeys] };
  drawTimeline();
}

function resetForm() {
  document.getElementById('formStart').value = 0;
  document.getElementById('formEnd').value = 120;
  formKeys.clear();
  document.querySelectorAll('.key-btn').forEach(b => b.classList.remove('active'));
  previewSeg = null;
  document.getElementById('formTitle').textContent = 'ADD SEGMENT';
  document.getElementById('saveBtn').textContent = '+ ADD SEGMENT';
  document.getElementById('cancelBtn').style.display = 'none';
  editingId = null;
  previewSegment();
}

function saveSegment() {
  const start = parseInt(document.getElementById('formStart').value);
  const end   = parseInt(document.getElementById('formEnd').value);
  const keys  = [...formKeys];

  if (isNaN(start) || isNaN(end) || end <= start) {
    flash(document.getElementById('formEnd'), '#ff3a5c'); return;
  }
  if (!keys.length) {
    document.querySelectorAll('.key-btn').forEach(b => {
      b.style.borderColor = '#ff3a5c';
      setTimeout(() => b.style.borderColor = '', 500);
    });
    return;
  }

  if (editingId !== null) {
    const seg = segments.find(s => s.id === editingId);
    if (seg) { seg.start = start; seg.end = end; seg.keys = keys; delete seg.recorded; }
  } else {
    segments.push({ id: nextId++, start, end, keys });
  }

  resetForm();
  renderSegments();
}

function cancelEdit() { resetForm(); renderSegments(); }

function editSegment(id) {
  const seg = segments.find(s => s.id === id);
  if (!seg) return;
  editingId = id;
  document.getElementById('formStart').value = seg.start;
  document.getElementById('formEnd').value   = seg.end;
  formKeys = new Set(seg.keys);
  document.querySelectorAll('.key-btn').forEach(btn => {
    btn.classList.toggle('active', formKeys.has(btn.dataset.key));
  });
  document.getElementById('formTitle').textContent = 'EDIT SEG #' + seg.id;
  document.getElementById('saveBtn').textContent = 'âœ“ SAVE CHANGES';
  document.getElementById('cancelBtn').style.display = '';
  previewSegment();
  renderSegments();
}

function deleteSegment(id) {
  segments = segments.filter(s => s.id !== id);
  if (editingId === id) resetForm();
  renderSegments();
}

function clearAll() {
  if (!segments.length) return;
  if (!confirm('Clear all segments?')) return;
  segments = [];
  resetForm();
  renderSegments();
}

// ================================================================
// SPLICE
// ================================================================
function toggleSpliceKey(key) {
  spliceKeys.has(key) ? spliceKeys.delete(key) : spliceKeys.add(key);
  document.querySelectorAll('.splice-key-btn').forEach(btn => {
    btn.classList.toggle('active', spliceKeys.has(btn.dataset.key));
  });
}

function openSpliceModal() {
  spliceKeys.clear();
  document.querySelectorAll('.splice-key-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('spliceStart').value = 0;
  document.getElementById('spliceEnd').value = 60;
  document.getElementById('spliceModal').classList.add('open');
}

function closeSpliceModal() {
  document.getElementById('spliceModal').classList.remove('open');
}

function applySplice() {
  const start = parseInt(document.getElementById('spliceStart').value);
  const end   = parseInt(document.getElementById('spliceEnd').value);
  if (isNaN(start) || isNaN(end) || end <= start) { showToast('Invalid range!'); return; }
  const keys = [...spliceKeys];

  const surviving = [];
  segments.forEach(seg => {
    if (seg.end <= start || seg.start >= end) { surviving.push(seg); return; }
    if (seg.start < start) surviving.push({ ...seg, id: nextId++, end: start,   keys: [...seg.keys] });
    if (seg.end   > end)   surviving.push({ ...seg, id: nextId++, start: end,   keys: [...seg.keys] });
  });

  if (keys.length > 0) surviving.push({ id: nextId++, start, end, keys });
  segments = surviving.sort((a, b) => a.start - b.start);
  closeSpliceModal();
  renderSegments();
  showToast('Spliced f' + start + 'â†’f' + end);
}

// ================================================================
// RENDER SEGMENTS
// ================================================================
function renderSegments() {
  const list   = document.getElementById('segList');
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">No segments yet.<br>Add one with the panel â†’ or hit âº REC to record live.</div>';
    updateStats(); drawTimeline(); return;
  }

  list.innerHTML = sorted.map((seg, i) => {
    const dur    = seg.end - seg.start;
    const badges = seg.keys.map(k => '<span class="kbadge ' + k + '">' + KEY_LABELS[k] + '</span>').join('');
    const isEdit = seg.id === editingId;
    const recB   = seg.recorded ? '<span class="seg-rec-badge">REC</span>' : '';
    return '<div class="seg-card" style="' + (isEdit ? 'border-color:var(--accent)' : '') + '">' +
      '<div class="seg-index">' + (i+1) + '</div>' +
      '<div class="seg-range">f' + seg.start + 'â†’' + seg.end + '</div>' +
      '<div class="seg-dur">' + dur + 'f</div>' +
      '<div class="seg-keys">' + badges + '</div>' +
      recB +
      '<div class="seg-actions">' +
        '<button class="btn" onclick="editSegment(' + seg.id + ')">EDIT</button>' +
        '<button class="btn btn-danger" onclick="deleteSegment(' + seg.id + ')">âœ•</button>' +
      '</div></div>';
  }).join('');

  updateStats();
  drawTimeline();
}

function updateStats() {
  const arr = buildFrameArray();
  let active = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]) active++;
  document.getElementById('segCount').textContent = segments.length;
  document.getElementById('frameCount').textContent = active;
}

// ================================================================
// FRAME ARRAY
// ================================================================
function buildFrameArray() {
  const arr = new Uint8Array(totalFrames);
  segments.forEach(seg => {
    for (let f = seg.start; f < seg.end && f < totalFrames; f++) {
      if (seg.keys.includes('up'))    arr[f] |= 1;
      if (seg.keys.includes('down'))  arr[f] |= 2;
      if (seg.keys.includes('left'))  arr[f] |= 4;
      if (seg.keys.includes('right')) arr[f] |= 8;
    }
  });
  return arr;
}

function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    let v = arr[i], c = 1;
    while (i + c < arr.length && arr[i+c] === v && c < 65535) c++;
    out.push([v, c]);
    i += c;
  }
  return out;
}

// ================================================================
// IMPORT / EXPORT
// ================================================================
function exportTAS() {
  const data = {
    version: 2, fps, totalFrames,
    segments: segments.map(({ start, end, keys, recorded }) => ({ start, end, keys, recorded: !!recorded }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'polytas.json' });
  a.click(); URL.revokeObjectURL(a.href);
}

function importTAS() { document.getElementById('fileInput').click(); }

function handleFileImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      fps = d.fps || 60; totalFrames = d.totalFrames || 3600;
      document.getElementById('fps').value = fps;
      document.getElementById('totalFrames').value = totalFrames;
      segments = (d.segments || []).map(s => ({
        id: nextId++, start: s.start, end: s.end, keys: s.keys, recorded: !!s.recorded
      }));
      onSettingsChange(); resetForm(); renderSegments();
    } catch(err) { alert('Invalid TAS file: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ================================================================
// REPLAY SCRIPT
// ================================================================
function generateScript() {
  if (!segments.length) { alert('Add at least one segment first.'); return; }
  const arr  = buildFrameArray();
  const rle  = rleEncode(arr);
  const date = new Date().toISOString();

  const script =
'// PolyTAS Replay Script â€” ' + date + '\n' +
'// ' + segments.length + ' segments | ' + totalFrames + 'f @ ' + fps + 'fps\n' +
'(function(){\n' +
'  \'use strict\';\n' +
'  const RLE=' + JSON.stringify(rle) + ';\n' +
'  const inp=[];\n' +
'  RLE.forEach(([v,c])=>{for(let i=0;i<c;i++)inp.push(v);});\n' +
'  const FT=1000/' + fps + ';\n' +
'  const KM={up:[\'ArrowUp\',\'w\'],down:[\'ArrowDown\',\'s\'],left:[\'ArrowLeft\',\'a\'],right:[\'ArrowRight\',\'d\']};\n' +
'  const BIT={up:1,down:2,left:4,right:8};\n' +
'  function dk(k,t){document.dispatchEvent(new KeyboardEvent(t,{key:k,bubbles:true,cancelable:true}));}\n' +
'  let cur=0,frame=0,st=null;\n' +
'  function upd(nb){\n' +
'    const ch=cur^nb;\n' +
'    if(!ch)return;\n' +
'    Object.keys(BIT).forEach(k=>{\n' +
'      if(ch&BIT[k])KM[k].forEach(key=>dk(key,(nb&BIT[k])?\'keydown\':\'keyup\'));\n' +
'    });\n' +
'    cur=nb;\n' +
'  }\n' +
'  function loop(ts){\n' +
'    if(!st)st=ts;\n' +
'    const tf=Math.min(Math.floor((ts-st)/FT),inp.length-1);\n' +
'    while(frame<=tf)upd(inp[frame++]);\n' +
'    if(frame<inp.length)requestAnimationFrame(loop);\n' +
'    else{upd(0);console.log(\'%c[PolyTAS] Done! ðŸ\',\'color:#FFD60A;font-weight:bold\');}\n' +
'  }\n' +
'  window.polyTASStop=()=>{upd(0);frame=inp.length;console.log(\'[PolyTAS] Stopped.\');};\n' +
'  console.log(\'%c[PolyTAS] Restarting...\',\'color:#39ff85\');\n' +
'  dk(\'r\',\'keydown\');setTimeout(()=>{dk(\'r\',\'keyup\');\n' +
'  setTimeout(()=>{\n' +
'    console.log(\'%c[PolyTAS] Replaying ' + totalFrames + 'f @ ' + fps + 'fps â€” polyTASStop() to abort\',\'color:#3a9eff\');\n' +
'    requestAnimationFrame(loop);\n' +
'  },700);},120);\n' +
'})();';

  const preview = script.split('\n').slice(0, 5).join('\n') + '\n// ...';

  showModal(
    'â–¶ REPLAY SCRIPT READY',
    '<strong>' + rle.length + '</strong> RLE blocks Â· ' + totalFrames + ' frames.<br><br>' +
    'Open Polytrack â†’ F12 â†’ Console â†’ paste. Type <strong>polyTASStop()</strong> to abort.',
    preview,
    [
      { label: 'ðŸ“‹ COPY', cls: 'btn-script', action: () => {
        navigator.clipboard.writeText(script).catch(() => {
          const ta = Object.assign(document.createElement('textarea'), { value: script });
          document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        });
        closeModal(); showToast('Script copied!');
      }},
      { label: 'CLOSE', cls: 'btn-ghost', action: closeModal }
    ]
  );
}

// ================================================================
// MODAL
// ================================================================
function showModal(title, desc, preview, actions) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalDesc').innerHTML = desc;
  const sp = document.getElementById('scriptPreview');
  sp.textContent = preview;
  sp.style.display = preview ? '' : 'none';
  document.getElementById('modalActions').innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.cls || '');
    btn.textContent = a.label;
    btn.onclick = a.action;
    document.getElementById('modalActions').appendChild(btn);
  });
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});
document.getElementById('spliceModal').addEventListener('click', e => {
  if (e.target === document.getElementById('spliceModal')) closeSpliceModal();
});

// ================================================================
// HELP
// ================================================================
function showHelp() {
  showModal('HOW TO USE POLYTAS',
    '<strong>âº REC / Ctrl+Shift+.</strong> â€” Start/stop recording. Use <strong>ATTACH GAME</strong> so key capture comes from the Polytrack tab.<br><br>' +
    '<strong>OPEN PiP</strong> â€” Opens a Chrome Picture-in-Picture window so PolyTAS stays on top while you play.<br><br>' +
    '<strong>FRAME EDITOR tab</strong> â€” Scrollable grid where each row is one frame and each column is a key. Click or drag cells to toggle individual key presses.<br><br>' +
    '<strong>âœ‚ SPLICE</strong> â€” Replace any frame range with a specific set of keys, or erase it entirely.<br><br>' +
    '<strong>Timeline</strong> â€” Click = set start frame, Shift+click = set end.<br><br>' +
    '<strong>â–¶ COPY SCRIPT</strong> â€” Paste into Polytrack console (F12 â†’ Console). Type <strong>polyTASStop()</strong> to abort replay.',
    '',
    [{ label: 'GOT IT', cls: 'btn-accent', action: closeModal }]
  );
}

// ================================================================
// TOAST / FLASH
// ================================================================
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#39ff85;color:#07070d;padding:7px 16px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;z-index:99999;pointer-events:none;animation:fadeup 2.1s forwards';
  t.textContent = 'âœ“ ' + msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function flash(el, color) {
  el.style.borderColor = color;
  el.style.boxShadow = '0 0 0 2px ' + color + '40';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 600);
}

// ================================================================
// INIT
// ================================================================
initPipUI();
initExtensionBridge();
onSettingsChange();
previewSegment();
renderSegments();
