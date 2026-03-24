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
const isDesktopApp = typeof window !== 'undefined' && !!window.PolyTASDesktop;
let extPort = null;
let attachState = 'detached';

// Desktop preview + game panel
let livePreviewEnabled = true;
let previewTargetFrame = 0;
let previewTimer = null;
let gameUrl = '';
let gameBoundsTimer = null;

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
  scheduleLivePreview(0);
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
  if (isDesktopApp) {
    showToast('PiP is not available in desktop mode.');
    return;
  }
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
  if (isDesktopApp && window.PolyTASDesktop) {
    setAttachState('pending');
    window.PolyTASDesktop.sendMessage({ type: 'ATTACH_GAME' });
    return;
  }
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
      showToast(isDesktopApp ? 'Connected to game view.' : 'Attached to game tab.');
      setGameStatus('Game connected.');
      setGamePlaceholderVisible(false);
    } else {
      setAttachState('detached');
      showToast(msg.error || 'Attach failed.');
      setGameStatus(msg.error || 'Game not connected.');
      setGamePlaceholderVisible(true);
    }
  }
  if (msg.type === 'REPLAY_DONE') setGameStatus('Preview complete.');
  if (msg.type === 'FAST_FORWARD_DONE') setGameStatus('Preview ready.');
}

function initExtensionBridge() {
  if (isDesktopApp && window.PolyTASDesktop) {
    initDesktopBridge();
    return;
  }
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
// DESKTOP BRIDGE
// ================================================================
function initDesktopBridge() {
  const btn = document.getElementById('attachBtn');
  if (btn) {
    btn.textContent = 'CONNECT GAME';
    btn.disabled = false;
    btn.title = 'Connect key capture to the embedded game view';
  }
  const pipBtn = document.getElementById('pipBtn');
  if (pipBtn) pipBtn.style.display = 'none';
  window.PolyTASDesktop.onMessage(handleExtensionMessage);
}

function setGameStatus(text) {
  const el = document.getElementById('gameStatus');
  if (el) el.textContent = text;
}

function setGamePlaceholderVisible(visible) {
  const el = document.getElementById('gamePlaceholder');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function updateGameBounds() {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  if (!gameUrl) {
    window.PolyTASDesktop.setGameBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  const viewport = document.getElementById('gameViewport');
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  window.PolyTASDesktop.setGameBounds({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  });
}

function scheduleGameBoundsUpdate() {
  if (gameBoundsTimer) clearTimeout(gameBoundsTimer);
  gameBoundsTimer = setTimeout(updateGameBounds, 50);
}

function updateGameUrlUI() {
  const display = document.getElementById('gameUrlDisplay');
  const editWrap = document.getElementById('gameUrlEdit');
  const changeBtn = document.getElementById('gameUrlChangeBtn');
  const setBtn = document.getElementById('gameUrlSetBtn');
  if (!display || !editWrap || !changeBtn || !setBtn) return;

  if (!gameUrl) {
    display.textContent = 'Not set';
    editWrap.style.display = 'flex';
    changeBtn.style.display = 'none';
    setBtn.textContent = 'SET URL';
    setGamePlaceholderVisible(true);
  } else {
    display.textContent = gameUrl;
    editWrap.style.display = 'none';
    changeBtn.style.display = '';
  }
}

function initGamePanel() {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  document.body.classList.add('desktop-app');

  const notice = document.querySelector('.notice');
  if (notice) {
    notice.innerHTML =
      '<strong>Ctrl+Shift+.</strong> &mdash; toggle recording from anywhere.<br>' +
      '<strong>Game Preview</strong> &mdash; set a URL to load the embedded Polytrack view.<br>' +
      '<strong>Frame Editor</strong> &mdash; edit individual key presses per frame.';
  }

  const input = document.getElementById('gameUrlInput');
  const setBtn = document.getElementById('gameUrlSetBtn');
  const changeBtn = document.getElementById('gameUrlChangeBtn');
  const liveBtn = document.getElementById('livePreviewBtn');

  changeBtn?.addEventListener('click', () => {
    const editWrap = document.getElementById('gameUrlEdit');
    if (editWrap) editWrap.style.display = 'flex';
    if (input) {
      input.value = gameUrl;
      input.focus();
    }
    if (changeBtn) changeBtn.style.display = 'none';
  });

  setBtn?.addEventListener('click', async () => {
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) { showToast('Enter a game URL first.'); return; }
    const normalized = await window.PolyTASDesktop.setGameUrl(raw);
    gameUrl = normalized || raw;
    updateGameUrlUI();
    setGameStatus('Loading game...');
    setGamePlaceholderVisible(false);
    window.PolyTASDesktop.sendMessage({ type: 'ATTACH_GAME' });
    scheduleGameBoundsUpdate();
  });

  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') setBtn?.click();
  });

  liveBtn?.addEventListener('click', () => {
    livePreviewEnabled = !livePreviewEnabled;
    liveBtn.textContent = 'LIVE PREVIEW: ' + (livePreviewEnabled ? 'ON' : 'OFF');
    if (!livePreviewEnabled) {
      window.PolyTASDesktop.sendMessage({ type: 'REPLAY_STOP' });
      setGameStatus('Live preview paused.');
    } else {
      scheduleLivePreview(previewTargetFrame);
    }
  });

  window.addEventListener('resize', scheduleGameBoundsUpdate);
  const viewport = document.getElementById('gameViewport');
  if (viewport && window.ResizeObserver) {
    const ro = new ResizeObserver(scheduleGameBoundsUpdate);
    ro.observe(viewport);
  }

  window.PolyTASDesktop.getGameUrl().then(url => {
    gameUrl = url || '';
    updateGameUrlUI();
    if (gameUrl) {
      setGameStatus('Loading game...');
      setGamePlaceholderVisible(false);
      scheduleGameBoundsUpdate();
      window.PolyTASDesktop.sendMessage({ type: 'ATTACH_GAME' });
    }
  });
}

function scheduleLivePreview(frame) {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  if (!gameUrl) return;
  if (!livePreviewEnabled || isRecording) return;
  if (typeof frame === 'number') previewTargetFrame = Math.max(0, Math.min(frame, totalFrames - 1));
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(runLivePreview, 160);
}

function runLivePreview() {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  if (!gameUrl) return;
  const arr = buildFrameArray();
  const rle = rleEncode(arr);
  window.PolyTASDesktop.sendMessage({
    type: 'PREVIEW',
    rle,
    totalFrames: arr.length,
    targetFrame: previewTargetFrame || 0,
  });
  setGameStatus('Previewing...');
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
  document.getElementById('recLabel').textContent = 'REC \u2022 0f';
  document.getElementById('recBtn').textContent = '\u23F9 STOP';
  document.getElementById('recOverlay').classList.add('active');

  const frameDuration = 1000 / fps;
  recordInterval = setInterval(() => {
    recordedFrames.push(recordHeldKeys);
    recordFrameCount++;
    document.getElementById('recLabel').textContent = 'REC \u2022 ' + recordFrameCount + 'f';
  }, frameDuration);

  showToast('Recording \u2014 Ctrl+Shift+. to stop');
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(recordInterval);
  recordInterval = null;

  document.getElementById('recIndicator').classList.remove('recording');
  document.getElementById('recLabel').textContent = 'REC';
  document.getElementById('recBtn').textContent = '\u25CF REC';
  document.getElementById('recOverlay').classList.remove('active');

  if (recordedFrames.length === 0) {
    showToast('No frames recorded.');
    return;
  }

  const newSegs = rleToSegments(recordedFrames, recordingStartFrame);
  newSegs.forEach(s => segments.push({ id: nextId++, start: s.start, end: s.end, keys: s.keys, recorded: true }));
  renderSegments();
  scheduleLivePreview(recordingStartFrame);
  showToast('Recorded ' + recordedFrames.length + 'f \u2192 ' + newSegs.length + ' segment(s)');
}

// Convert raw bitmask array -> compressed segments
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
const KEY_LABELS  = { up: '\u2191', down: '\u2193', left: '\u2190', right: '\u2192' };

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
  scheduleLivePreview(frame);
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
    'Duration: ' + dur + ' frames \u00B7 ' + (dur / fps).toFixed(2) + 's';
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
  document.getElementById('cancelBtn').classList.add('is-hidden');
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
  scheduleLivePreview(start);
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
  document.getElementById('saveBtn').textContent = '\u2714 SAVE CHANGES';
  document.getElementById('cancelBtn').classList.remove('is-hidden');
  previewSegment();
  renderSegments();
}

function deleteSegment(id) {
  segments = segments.filter(s => s.id !== id);
  if (editingId === id) resetForm();
  renderSegments();
  scheduleLivePreview(0);
}

function clearAll() {
  if (!segments.length) return;
  if (!confirm('Clear all segments?')) return;
  segments = [];
  resetForm();
  renderSegments();
  scheduleLivePreview(0);
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
  scheduleLivePreview(start);
  showToast('Spliced f' + start + '\u2192f' + end);
}

// ================================================================
// RENDER SEGMENTS
// ================================================================
function renderSegments() {
  const list   = document.getElementById('segList');
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">No segments yet.<br>Add one with the panel &rarr; or hit &#9679; REC to record live.</div>';
    updateStats(); drawTimeline(); return;
  }

  list.innerHTML = sorted.map((seg, i) => {
    const dur    = seg.end - seg.start;
    const badges = seg.keys.map(k => '<span class="kbadge ' + k + '">' + KEY_LABELS[k] + '</span>').join('');
    const isEdit = seg.id === editingId;
    const recB   = seg.recorded ? '<span class="seg-rec-badge">REC</span>' : '';
    return '<div class="seg-card" style="' + (isEdit ? 'border-color:var(--accent)' : '') + '">' +
      '<div class="seg-index">' + (i+1) + '</div>' +
      '<div class="seg-range">f' + seg.start + '\u2192' + seg.end + '</div>' +
      '<div class="seg-dur">' + dur + 'f</div>' +
      '<div class="seg-keys">' + badges + '</div>' +
      recB +
      '<div class="seg-actions">' +
        '<button class="btn" onclick="editSegment(' + seg.id + ')">EDIT</button>' +
        '<button class="btn btn-danger" onclick="deleteSegment(' + seg.id + ')">\u00D7</button>' +
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
      scheduleLivePreview(0);
    } catch(err) { alert('Invalid TAS file: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ================================================================
// REPLAY (NATIVE INPUTS)
// ================================================================
function runReplay() {
  if (!segments.length) { alert('Add at least one segment first.'); return; }
  const arr = buildFrameArray();
  const rle = rleEncode(arr);
  if (isDesktopApp && window.PolyTASDesktop) {
    runNativeReplay(rle, arr.length);
    return;
  }
  alert('Replay requires the desktop app.');
}

// Backwards compatibility (old button hookup)
function generateScript() {
  runReplay();
}

// ================================================================
// MODAL
// ================================================================
function showModal(title, desc, preview, actions) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalDesc').innerHTML = desc;
  const sp = document.getElementById('scriptPreview');
  sp.textContent = preview;
  sp.classList.toggle('is-hidden', !preview);
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

async function copyText(text) {
  if (!text) return false;
  if (isDesktopApp && window.PolyTASDesktop?.copyText) {
    try {
      return await window.PolyTASDesktop.copyText(text);
    } catch {
      return false;
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function runNativeReplay(rle, total) {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  if (!gameUrl) {
    showToast('Set a game URL first.');
    return;
  }
  if (!Array.isArray(rle)) {
    showToast('No replay data available.');
    return;
  }
  setGameStatus('Starting replay in 5 seconds...');
  window.PolyTASDesktop.startOsReplay({
    rle,
    totalFrames: total || totalFrames,
    fps,
    delayMs: 5000,
  })
    .then(ok => {
      if (ok) {
        closeModal();
        showToast('Replay scheduled (5s delay).');
      } else {
        setGameStatus('OS replay failed.');
        showToast('OS replay failed.');
      }
    })
    .catch(() => {
      setGameStatus('OS replay failed.');
      showToast('OS replay failed.');
    });
}

function stopReplay() {
  if (!isDesktopApp || !window.PolyTASDesktop) return;
  window.PolyTASDesktop.stopOsReplay()
    .then(() => {
      setGameStatus('Replay stopped.');
      showToast('Replay stopped.');
    })
    .catch(() => {
      setGameStatus('Replay stop failed.');
      showToast('Replay stop failed.');
    });
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
  const attachLine = isDesktopApp
    ? '<strong>CONNECT GAME</strong> &mdash; Link the editor to the embedded game view for live capture.<br><br>'
    : '<strong>ATTACH GAME</strong> &mdash; Link key capture to the Polytrack tab.<br><br>';
  const pipLine = isDesktopApp
    ? '<strong>GAME PREVIEW</strong> &mdash; Set the game URL to see a live replay preview.<br><br>'
    : '<strong>OPEN PiP</strong> &mdash; Opens a Chrome Picture-in-Picture window so PolyTAS stays on top while you play.<br><br>';
  showModal('HOW TO USE POLYTAS',
    '<strong>&#9679; REC / Ctrl+Shift+.</strong> &mdash; Start/stop recording. ' +
    (isDesktopApp ? 'Recording uses the embedded game view.' : 'Use <strong>ATTACH GAME</strong> so key capture comes from the Polytrack tab.') +
    '<br><br>' +
    attachLine +
    pipLine +
    '<strong>FRAME EDITOR tab</strong> &mdash; Scrollable grid where each row is one frame and each column is a key. Click or drag cells to toggle individual key presses.<br><br>' +
    '<strong>&#9986; SPLICE</strong> &mdash; Replace any frame range with a specific set of keys, or erase it entirely.<br><br>' +
    '<strong>Timeline</strong> &mdash; Click = set start frame, Shift+click = set end.<br><br>' +
    '<strong>&#9654; RUN REPLAY</strong> &mdash; Replays the inputs directly in the embedded game.',
    '',
    [{ label: 'GOT IT', cls: 'btn-accent', action: closeModal }]
  );
}

// ================================================================
// TOAST / FLASH
// ================================================================
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = '\u2714 ' + msg;
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
initGamePanel();
onSettingsChange();
previewSegment();
renderSegments();
