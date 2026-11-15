import { Service } from '@angular/core';

/** Menüaktionen aus der nativen Menüleiste (electron/menu.mjs) bzw. Tastaturkürzeln. */
export type MenuAction =
  | 'settings'
  | 'new-folder'
  | 'new-link'
  | 'import'
  | 'reveal'
  | 'open-slicer'
  | 'pick-library'
  | 'rename'
  | 'move'
  | 'trash'
  | 'find'
  | 'view-list'
  | 'view-grid'
  | 'reload'
  | 'shortcuts'
  | 'batch-rename'
  | 'name-assist'
  | 'undo';

/** Vom Electron-Preload bereitgestellte Brücke (electron/preload.cjs). */
export interface PrintnestDesktopBridge {
  isElectron: boolean;
  platform: string;
  token: string | null;
  pickFolder(): Promise<string | null>;
  onMenuAction(callback: (action: MenuAction) => void): () => void;
  getPathForFile(file: File): string | null;
  pickApp?(): Promise<string | null>;
  readClipboardText?(): string;
}

declare global {
  interface Window {
    printnestDesktop?: PrintnestDesktopBridge;
  }
}

/** Zugriff auf die Desktop-Brücke; im Browser-Dev-Modus mit sinnvollen Fallbacks. */
@Service()
export class DesktopService {
  private readonly bridge: PrintnestDesktopBridge | null =
    typeof window !== 'undefined' ? (window.printnestDesktop ?? null) : null;

  readonly isElectron = !!this.bridge?.isElectron;
  readonly isMac =
    this.bridge?.platform === 'darwin' ||
    (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent));

  get token(): string | null {
    return this.bridge?.token ?? null;
  }

  /** Nativer Ordnerdialog (Electron); `undefined` = nicht verfügbar → Server-Fallback nutzen. */
  async pickFolder(): Promise<string | null | undefined> {
    if (!this.bridge) return undefined;
    return this.bridge.pickFolder();
  }

  onMenuAction(callback: (action: MenuAction) => void): () => void {
    return this.bridge?.onMenuAction(callback) ?? (() => {});
  }

  /** Nativer App-Dialog (Electron); `undefined` = nicht verfügbar → Server-Fallback. */
  async pickApp(): Promise<string | null | undefined> {
    if (!this.bridge?.pickApp) return undefined;
    return this.bridge.pickApp();
  }

  /** Zwischenablage lesen (Electron-Brücke, sonst Clipboard-API). */
  async readClipboardText(): Promise<string> {
    if (this.bridge?.readClipboardText) return this.bridge.readClipboardText();
    return (await navigator.clipboard?.readText?.()) ?? '';
  }

  pathForFile(file: File): string | null {
    return this.bridge?.getPathForFile(file) ?? null;
  }
}
