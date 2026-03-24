const { app, BrowserWindow, BrowserView, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let gameView = null;
let config = { gameUrl: '' };
let isQuitting = false;
let gameReady = false;
let pendingScripts = [];

const iconSvgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const iconPngPath = path.join(__dirname, '..', 'assets', 'icon.png');
const iconImage = (() => {
  const img = nativeImage.createFromPath(iconSvgPath);
  if (img && !img.isEmpty()) return img;
  const fallback = nativeImage.createFromPath(iconPngPath);
  return fallback && !fallback.isEmpty() ? fallback : null;
})();

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
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  gameView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'game-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setBrowserView(gameView);
  gameView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  gameView.setAutoResize({ width: false, height: false });

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
  if (process.platform !== 'darwin') app.quit();
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
