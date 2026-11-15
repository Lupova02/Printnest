import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, withFileLock, writeJsonAtomic } from './json-file.mjs';

/** `slicer`: genau ein Standard-Slicer (ID), `customSlicers`: selbst gewählte Apps. */
export const DEFAULT_SETTINGS = Object.freeze({ slicer: 'bambu', customSlicers: [] });
const UI_STATE_MAX_BYTES = 4096;

/**
 * Gerätespezifische Konfiguration (Bibliothekspfad, Einstellungen, UI-Zustand)
 * im Datenordner (Electron: userData/printnest-data).
 */
export function createConfigStore(dataDir) {
  const configPath = path.join(dataDir, 'config.json');
  const uiStatePath = path.join(dataDir, 'ui-state.json');

  async function read() {
    const parsed = await readJson(configPath, {});
    return {
      libraryRoot:
        typeof parsed?.libraryRoot === 'string' && parsed.libraryRoot.trim()
          ? parsed.libraryRoot.trim()
          : null,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed?.settings ?? {}),
        customSlicers: Array.isArray(parsed?.settings?.customSlicers) ? parsed.settings.customSlicers : [],
      },
    };
  }

  function update(fn) {
    return withFileLock(configPath, async () => {
      const current = await read();
      const next = fn(current) ?? current;
      await writeJsonAtomic(configPath, next);
      return next;
    });
  }

  return {
    configPath,
    read,
    async getLibraryRoot() {
      const config = await read();
      return config.libraryRoot ? path.resolve(config.libraryRoot) : null;
    },
    async requireLibraryRoot() {
      const root = await this.getLibraryRoot();
      if (!root) {
        throw Object.assign(
          new Error('Noch kein Bibliotheksordner gewählt. Bitte zuerst einen Ordner auswählen.'),
          { status: 400, code: 'NO_LIBRARY' },
        );
      }
      return root;
    },
    async setLibraryRoot(nextPath) {
      const resolved = path.resolve(nextPath);
      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        throw Object.assign(new Error('Ordner nicht gefunden.'), { status: 404 });
      }
      if (!stat.isDirectory()) {
        throw Object.assign(new Error('Der gewählte Pfad ist kein Ordner.'), { status: 400 });
      }
      await update((config) => ({ ...config, libraryRoot: resolved }));
      return resolved;
    },
    async getSettings() {
      return (await read()).settings;
    },
    /** Patch-Objekt oder Funktion (aktuelle Einstellungen → Patch) anwenden. */
    async updateSettings(patch) {
      const next = await update((config) => ({
        ...config,
        settings: { ...config.settings, ...(typeof patch === 'function' ? patch(config.settings) : patch) },
      }));
      return next.settings;
    },
    async getUiState() {
      const parsed = await readJson(uiStatePath, {});
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    },
    async setUiState(state) {
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw Object.assign(new Error('Ungültiger UI-Zustand.'), { status: 400 });
      }
      if (JSON.stringify(state).length > UI_STATE_MAX_BYTES) {
        throw Object.assign(new Error('UI-Zustand zu groß.'), { status: 413 });
      }
      await withFileLock(uiStatePath, () => writeJsonAtomic(uiStatePath, state));
      return state;
    },
    /** Bestehende Bibliothek aus Dev-/Bootstrap-Config übernehmen, falls noch keine gesetzt ist. */
    async adoptBootstrap(bootstrapConfigPath) {
      if (!bootstrapConfigPath) return;
      try {
        if (await this.getLibraryRoot()) return;
        const boot = JSON.parse(await fs.readFile(bootstrapConfigPath, 'utf8'));
        if (typeof boot.libraryRoot === 'string' && boot.libraryRoot.trim()) {
          await update((config) => ({ ...config, libraryRoot: boot.libraryRoot.trim() }));
        }
      } catch {
        // optional
      }
    },
  };
}
