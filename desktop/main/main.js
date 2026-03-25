const { app, BrowserWindow, BrowserView, ipcMain, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let gameView = null;
let config = { gameUrl: '' };
let isQuitting = false;
let gameReady = false;
let pendingScripts = [];
let osReplayActive = false;
let osReplayInputs = null;
let osReplayFrame = 0;
let osReplayTimer = null;
let osReplayBits = 0;
let osReplayDelayTimer = null;
let osReplayStarting = false;       // mutex: true while startOsReplay is pending
let osReplayTickInFlight = null;   // Promise of the currently-running tick, if any
let nut = null;
let nutKeyboard = null;
let nutKey = null;

const iconSvgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const iconPngPath = path.join(__dirname, '..', 'assets', 'icon.png');
const iconImage = (() => {
  const img = nativeImage.createFromPath(iconSvgPath);
  if (img && !img.isEmpty()) return img;
  const fallback = nativeImage.createFromPath(iconPngPath);
  return fallback && !fallback.isEmpty() ? fallback : null;
})();

const BIT_KEYS = [
  { bit: 1, name: 'up' },
  { bit: 2, name: 'down' },
  { bit: 4, name: 'left' },
  { bit: 8, name: 'right' },
];

const KEY_MAP = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    config = JSON.parse(raw);
  } catch {
    config = { gameUrl: '' };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.warn('Failed to save config:', err);
  }
}

function normalizeUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function sendToRenderer(msg) {
  if (!mainWindow || !mainWindow.webContents) return;
  mainWindow.webContents.send('polytas:game-event', msg);
}

function loadGameUrl(url) {
  if (!gameView || isQuitting) return;
  gameReady = false;
  if (!url) {
    gameView.webContents.loadURL('about:blank');
    return;
  }
  gameView.webContents.loadURL(url);
}

function attachGame() {
  if (!gameView) return;
  gameView.webContents.send('polytas:to-game', { type: 'SET_CAPTURE', enabled: true });
  sendToRenderer({ type: 'ATTACH_STATUS', status: 'attached' });
}

function createWindow() {
  loadConfig();

  app.setName('PolyTAS');
  app.setAppUserModelId('com.polytas.desktop');
  if (process.platform === 'darwin' && app.dock && iconImage) {
    app.dock.setIcon(iconImage);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#07070d',
    icon: iconImage || iconPngPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  gameView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'game-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.setBrowserView(gameView);
  gameView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  gameView.setAutoResize({ width: false, height: false });
  mainWindow.webContents.setBackgroundThrottling(false);
  gameView.webContents.setBackgroundThrottling(false);

  gameView.webContents.on('did-finish-load', () => {
    gameReady = true;
    sendToRenderer({ type: 'ATTACH_STATUS', status: 'attached' });
    flushPendingScripts();
  });

  gameView.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
    gameReady = false;
    pendingScripts = [];
    sendToRenderer({
      type: 'ATTACH_STATUS',
      status: 'detached',
      error: `Failed to load ${url || 'game URL'}.`,
    });
  });

  gameView.webContents.on('before-input-event', (_event, input) => {
    if (isQuitting) return;
    if (!input || !input.type) return;
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
    sendToRenderer({
      type: input.type === 'keyDown' ? 'KEY_DOWN' : 'KEY_UP',
      key: input.key,
      code: input.code,
      ctrlKey: !!input.control,
      shiftKey: !!input.shift,
      altKey: !!input.alt,
      metaKey: !!input.meta,
      repeat: !!input.isAutoRepeat,
    });
  });

  if (config.gameUrl) {
    loadGameUrl(config.gameUrl);
  }

  mainWindow.on('close', () => {
    isQuitting = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (gameView) {
      gameView.webContents.removeAllListeners();
    }
    gameView = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (pendingScripts.length) {
    const err = new Error('App is quitting.');
    pendingScripts.forEach(item => item.reject(err));
    pendingScripts = [];
  }
  stopOsReplay();
  // Force-close any remaining windows so the process doesn't hang.
  BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch {} });
  setTimeout(() => app.exit(0), 800);
});

ipcMain.on('polytas:editor-message', (_event, msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'ATTACH_GAME') {
    attachGame();
    return;
  }
  if (gameView && gameView.webContents) {
    gameView.webContents.send('polytas:to-game', msg);
  }
});

ipcMain.on('polytas:from-game', (_event, msg) => {
  if (!msg || !msg.type) return;
  sendToRenderer(msg);
});

ipcMain.on('polytas:set-game-bounds', (_event, bounds) => {
  if (!gameView || !bounds) return;
  const x = Math.max(0, Math.round(bounds.x || 0));
  const y = Math.max(0, Math.round(bounds.y || 0));
  const width = Math.max(0, Math.round(bounds.width || 0));
  const height = Math.max(0, Math.round(bounds.height || 0));
  gameView.setBounds({ x, y, width, height });
});

ipcMain.handle('polytas:get-game-url', () => config.gameUrl || '');

ipcMain.handle('polytas:set-game-url', (_event, url) => {
  if (isQuitting) return config.gameUrl || '';
  const normalized = normalizeUrl(url);
  config.gameUrl = normalized;
  saveConfig();
  loadGameUrl(normalized);
  return normalized;
});

ipcMain.handle('polytas:run-script', async (_event, script) => {
  if (!gameView || !gameView.webContents || isQuitting) {
    throw new Error('Game view is not ready.');
  }
  if (!script || typeof script !== 'string') {
    throw new Error('No script provided.');
  }
  if (!gameReady) {
    return new Promise((resolve, reject) => {
      pendingScripts.push({ script, resolve, reject });
    });
  }
  return executeScriptNow(script);
});

ipcMain.handle('polytas:copy-text', (_event, text) => {
  if (!text || typeof text !== 'string') return false;
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('polytas:os-replay-start', async (_event, payload) => {
  if (isQuitting) return false;
  // Prevent double-start if the user clicks RUN REPLAY rapidly.
  if (osReplayStarting) return false;
  osReplayStarting = true;
  try {
    await startOsReplay(payload);
    return true;
  } catch (err) {
    console.warn('OS replay failed:', err);
    throw err;
  } finally {
    osReplayStarting = false;
  }
});

ipcMain.handle('polytas:os-replay-stop', () => {
  stopOsReplay();
  return true;
});

async function ensureNut() {
  if (nut && nutKeyboard && nutKey) return;
  const mod = await import('@nut-tree-fork/nut-js');
  nut = mod;
  nutKeyboard = mod.keyboard;
  nutKey = mod.Key;
  // Lower delays for real-time input.
  if (nutKeyboard) {
    nutKeyboard.config.autoDelayMs = 0;
  }
}

function decodeRLE(rle, totalFrames) {
  const arr = new Uint8Array(totalFrames || 0);
  let f = 0;
  (rle || []).forEach(([v, c]) => {
    const end = Math.min(f + c, arr.length);
    arr.fill(v, f, end);
    f += c;
  });
  return arr;
}

async function tapKey(key) {
  if (!nutKeyboard || !nutKey) return;
  await nutKeyboard.pressKey(key);
  await sleep(120);
  await nutKeyboard.releaseKey(key);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startOsReplay(payload) {
  if (!payload || !payload.rle) throw new Error('Missing replay data.');
  await ensureNut();
  stopOsReplay();

  const fps = Math.max(1, payload.fps || 60);
  const totalFrames = payload.totalFrames || 0;
  osReplayInputs = decodeRLE(payload.rle, totalFrames);
  osReplayFrame = 0;
  osReplayBits = 0;
  osReplayActive = true;

  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (gameView && gameView.webContents) {
    gameView.webContents.focus();
  }

  const delayMs = Math.max(0, payload.delayMs || 0);
  if (delayMs > 0) {
    osReplayDelayTimer = setTimeout(async () => {
      osReplayDelayTimer = null;
      await beginOsReplay(fps);
    }, delayMs);
  } else {
    await beginOsReplay(fps);
  }
}

function stopOsReplay() {
  osReplayActive = false;
  if (osReplayTimer) clearTimeout(osReplayTimer);
  osReplayTimer = null;
  if (osReplayDelayTimer) clearTimeout(osReplayDelayTimer);
  osReplayDelayTimer = null;
  // Wait for any in-flight tick to finish before releasing keys so we
  // don't release while a pressKey() is still mid-await (causing stuck keys).
  const tickDone = osReplayTickInFlight || Promise.resolve();
  tickDone.catch(() => {}).then(() => releaseAllOsKeys().catch(() => {}));
}

function scheduleOsReplayTick(frameDuration, replayStartTime) {
  if (!osReplayActive) return;
  // Calculate when this frame *should* fire relative to the replay start,
  // compensating for any drift accumulated from previous frames.
  const expectedTime = replayStartTime + osReplayFrame * frameDuration;
  const delay = Math.max(0, expectedTime - Date.now());

  osReplayTimer = setTimeout(() => {
    if (!osReplayActive) return;
    const nb = osReplayInputs && osReplayFrame < osReplayInputs.length
      ? osReplayInputs[osReplayFrame]
      : 0;
    // Track the in-flight promise so stopOsReplay can wait for it before
    // releasing keys — preventing the stuck-key race condition.
    osReplayTickInFlight = applyBitmaskOs(nb);
    osReplayTickInFlight
      .then(() => {
        osReplayTickInFlight = null;
        if (!osReplayActive) return;
        osReplayFrame++;
        if (osReplayInputs && osReplayFrame < osReplayInputs.length) {
          scheduleOsReplayTick(frameDuration, replayStartTime);
        } else {
          stopOsReplay();
        }
      })
      .catch(err => {
        osReplayTickInFlight = null;
        console.warn('OS replay tick failed:', err);
        stopOsReplay();
      });
  }, delay);
}

async function applyBitmaskOs(nb) {
  if (!nutKeyboard || !nutKey) return;
  const changed = osReplayBits ^ nb;
  if (!changed) return;
  // Press/release all changed keys in parallel so multiple key changes
  // in a single frame don't accumulate latency sequentially.
  const ops = [];
  for (const item of BIT_KEYS) {
    if (!(changed & item.bit)) continue;
    const keyName = KEY_MAP[item.name];
    const key = nutKey[keyName];
    if (!key) continue;
    if (nb & item.bit) {
      ops.push(nutKeyboard.pressKey(key));
    } else {
      ops.push(nutKeyboard.releaseKey(key));
    }
  }
  await Promise.all(ops);
  osReplayBits = nb;
}

async function releaseAllOsKeys() {
  if (!nutKeyboard || !nutKey) return;
  for (const item of BIT_KEYS) {
    const keyName = KEY_MAP[item.name];
    const key = nutKey[keyName];
    if (key) await nutKeyboard.releaseKey(key);
  }
  osReplayBits = 0;
}

async function beginOsReplay(fps) {
  if (!osReplayActive) return;
  // Restart run (same as script behavior).
  if (nutKey?.R) {
    await tapKey(nutKey.R);
    await sleep(700);
  }
  // Capture start time *after* the restart delay so drift compensation
  // is anchored to when frame 0 is actually meant to fire.
  const replayStartTime = Date.now();
  scheduleOsReplayTick(1000 / fps, replayStartTime);
}

function executeScriptNow(script) {
  if (!gameView || !gameView.webContents) {
    return Promise.reject(new Error('Game view is not ready.'));
  }
  if (mainWindow) mainWindow.focus();
  gameView.webContents.focus();
  gameView.webContents.executeJavaScript('window.focus();', true).catch(() => {});
  return gameView.webContents.executeJavaScript(script, true);
}

function flushPendingScripts() {
  if (!pendingScripts.length) return;
  const queue = pendingScripts.slice();
  pendingScripts = [];
  queue.forEach(item => {
    executeScriptNow(item.script).then(item.resolve).catch(item.reject);
  });
}
