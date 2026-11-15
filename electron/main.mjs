import electron from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../server/index.mjs';
import { buildApplicationMenu } from './menu.mjs';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, shell } = electron;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let appOrigin = null;
const token = randomUUID();

// Nur eine Instanz: ein zweiter Start fokussiert das bestehende Fenster.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// --- Fensterzustand (Größe, Position) in userData merken ---

const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const fallback = { width: 1280, height: 860 };
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    const bounds = { x: state.x, y: state.y, width: state.width, height: state.height };
    if (![bounds.width, bounds.height].every(Number.isFinite)) return fallback;
    // Nur übernehmen, wenn das Fenster auf einem vorhandenen Bildschirm liegt.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      Number.isFinite(bounds.x) &&
      bounds.x < a.x + a.width - 80 &&
      bounds.x + bounds.width > a.x + 80 &&
      bounds.y >= a.y - 20 &&
      bounds.y < a.y + a.height - 80,
    );
    return { ...(visible ? bounds : { width: bounds.width, height: bounds.height }), isMaximized: !!state.isMaximized };
  } catch {
    return fallback;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify({ ...bounds, isMaximized: win.isMaximized() }, null, 2),
    );
  } catch {
    // nicht kritisch
  }
}

// --- IPC ---

function isTrustedSender(event) {
  const url = event.senderFrame?.url ?? '';
  return !!appOrigin && url.startsWith(`${appOrigin}/`);
}

ipcMain.handle('printnest:pick-folder', async (event) => {
  if (!isTrustedSender(event)) return null;
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    title: 'Bibliotheksordner wählen',
    buttonLabel: 'Auswählen',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('printnest:pick-app', async (event) => {
  if (!isTrustedSender(event)) return null;
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    title: 'Slicer-App wählen',
    buttonLabel: 'Auswählen',
    defaultPath: '/Applications',
    filters: [{ name: 'Programme', extensions: ['app'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

function sendMenuAction(action) {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  if (!win) return;
  win.webContents.send('printnest:menu', action);
}

// --- Start ---

async function ensureServer() {
  const dataDir = path.join(app.getPath('userData'), 'printnest-data');
  const appRoot = app.getAppPath();
  const { port } = await startServer({
    port: Number(process.env.PRINTNEST_API_PORT || 3847),
    portFallback: true,
    dataDir,
    staticDir: path.join(appRoot, 'dist', 'printnest', 'browser'),
    seedLinksPath: app.isPackaged
      ? path.join(process.resourcesPath, 'seed-links.json')
      : path.join(__dirname, 'seed-links.json'),
    bootstrapConfigPath: app.isPackaged
      ? path.join(process.resourcesPath, 'bootstrap-config.json')
      : path.join(__dirname, '../server/config.json'),
    token,
    dev: false,
    trash: (absolutePath) => shell.trashItem(absolutePath),
    openExternal: (url) => shell.openExternal(url),
  });
  appOrigin = `http://127.0.0.1:${port}`;
  return port;
}

async function createWindow() {
  const port = await ensureServer();
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 600,
    title: 'Printnest',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    icon: app.isPackaged ? undefined : path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`--printnest-token=${token}`],
    },
    show: false,
  });
  if (state.isMaximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Externe Links im Standardbrowser, keine Navigation weg von der App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(`${appOrigin}/`)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`${appOrigin}/`);
  return port;
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  Menu.setApplicationMenu(buildApplicationMenu(sendMenuAction));
  app.setAboutPanelOptions({
    applicationName: 'Printnest',
    applicationVersion: app.getVersion(),
    copyright: 'Lokale Bibliothek für 3D-Druck-Dateien',
  });

  createWindow().catch((error) => {
    console.error('Printnest konnte nicht starten:', error);
    dialog.showErrorBox(
      'Printnest konnte nicht starten',
      `${error?.message || error}\n\nBitte Printnest neu starten. Wenn das Problem bleibt, den Bibliotheksordner prüfen.`,
    );
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error) => dialog.showErrorBox('Printnest', String(error?.message || error)));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void stopServer();
});
