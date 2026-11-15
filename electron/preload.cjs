// Preload bleibt absichtlich schlank (Context Isolation, Sandbox).
const { clipboard, contextBridge, ipcRenderer, webUtils } = require('electron');

const TOKEN_PREFIX = '--printnest-token=';
const tokenArg = process.argv.find((arg) => arg.startsWith(TOKEN_PREFIX));

contextBridge.exposeInMainWorld('printnestDesktop', {
  isElectron: true,
  platform: process.platform,
  /** Zufälliges API-Token dieses App-Starts (X-Printnest-Token). */
  token: tokenArg ? tokenArg.slice(TOKEN_PREFIX.length) : null,
  /** Nativer Ordnerdialog; liefert den Pfad oder null bei Abbruch. */
  pickFolder: () => ipcRenderer.invoke('printnest:pick-folder'),
  /** Nativer Dialog für eine Slicer-App (.app); liefert den Pfad oder null. */
  pickApp: () => ipcRenderer.invoke('printnest:pick-app'),
  /** Text aus der Zwischenablage (nur nach Klick auf „Einfügen“ aufgerufen). */
  readClipboardText: () => clipboard.readText(),
  /** Menüaktionen (z. B. „new-folder“) abonnieren; liefert eine Abmeldefunktion. */
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('printnest:menu', listener);
    return () => ipcRenderer.removeListener('printnest:menu', listener);
  },
  /** Echter Dateipfad einer per Drag & Drop abgelegten Datei (Finder). */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
});
