const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let gameView = null;
let config = { gameUrl: '' };

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
  if (!gameView) return;
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

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#07070d',
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
    sendToRenderer({ type: 'ATTACH_STATUS', status: 'attached' });
  });

  gameView.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
    sendToRenderer({
      type: 'ATTACH_STATUS',
      status: 'detached',
      error: `Failed to load ${url || 'game URL'}.`,
    });
  });

  if (config.gameUrl) {
    loadGameUrl(config.gameUrl);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
  const normalized = normalizeUrl(url);
  config.gameUrl = normalized;
  saveConfig();
  loadGameUrl(normalized);
  return normalized;
});
