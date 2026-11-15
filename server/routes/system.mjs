import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isLinkPath, isValidHttpUrl } from '../lib/links.mjs';
import { resolveRelative } from '../lib/paths.mjs';
import { pickAppNative } from '../lib/folder-picker.mjs';
import { normalizeCustomSlicer } from '../lib/slicers.mjs';

const execFileAsync = promisify(execFile);

/** Finder, Browser, Slicer, Einstellungen, UI-Zustand und Live-Events. */
export function registerSystemRoutes(app, ctx) {
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** Server-Sent Events: Änderungen in der Bibliothek. */
  app.get('/api/events', (req, res) => {
    ctx.events.attach(req, res);
  });

  app.post('/api/reveal', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const rel = String(req.body?.path || '');
    if (!rel || isLinkPath(rel)) {
      res.status(400).json({ error: 'Kein gültiger Dateipfad.' });
      return;
    }
    const { absolutePath } = resolveRelative(root, rel);
    await fs.access(absolutePath);
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-R', absolutePath]);
    } else if (process.platform === 'win32') {
      await execFileAsync('explorer.exe', [`/select,${absolutePath}`]);
    } else {
      await execFileAsync('xdg-open', [path.dirname(absolutePath)]);
    }
    res.json({ ok: true });
  });

  app.post('/api/open-url', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!isValidHttpUrl(url)) {
      res.status(400).json({ error: 'Ungültige URL.' });
      return;
    }
    if (ctx.openExternal) {
      await ctx.openExternal(url);
    } else if (process.platform === 'darwin') {
      await execFileAsync('open', [url]);
    } else if (process.platform === 'win32') {
      await execFileAsync('cmd', ['/c', 'start', '', url]);
    } else {
      await execFileAsync('xdg-open', [url]);
    }
    res.json({ ok: true });
  });

  /** Slicer-Liste für Einstellungen + gewählter Standard (nur dieser erscheint in der UI). */
  async function slicerState(force = false) {
    const settings = await ctx.config.getSettings();
    const all = await ctx.slicers.list(settings, { force });
    const view = all.map(({ id, name, installed, appPath, extensions, technology, verified, custom }) => ({
      id,
      name,
      installed,
      appPath: appPath ?? null,
      extensions: extensions.map((e) => e.slice(1)),
      technology,
      verified: !!verified,
      custom: !!custom,
    }));
    return {
      slicers: view,
      installed: view.filter((s) => s.installed).map(({ id, name }) => ({ id, name })),
      defaultSlicer: settings.slicer || null,
      selected: view.find((s) => s.id === settings.slicer) ?? null,
    };
  }

  app.get('/api/slicers', async (req, res) => {
    res.json(await slicerState(req.query.refresh === '1'));
  });

  /** Eigene Slicer-App hinzufügen (Pfad aus nativem Dialog) und als Standard wählen. */
  app.post('/api/slicers/custom', async (req, res) => {
    let appPath = typeof req.body?.appPath === 'string' ? req.body.appPath : null;
    if (!appPath) appPath = ctx.pickApp ? await ctx.pickApp() : await pickAppNative();
    if (!appPath) {
      res.status(400).json({ error: 'App-Auswahl abgebrochen.', code: 'CANCELLED' });
      return;
    }
    const custom = normalizeCustomSlicer({ appPath });
    const st = custom ? await fs.stat(custom.appPath).catch(() => null) : null;
    if (!custom || !st?.isDirectory()) {
      res.status(400).json({ error: 'Bitte eine macOS-App (.app) wählen.' });
      return;
    }
    await ctx.config.updateSettings((settings) => ({
      slicer: custom.id,
      customSlicers: [
        ...(settings.customSlicers ?? []).filter((s) => normalizeCustomSlicer(s)?.id !== custom.id),
        { name: custom.name, appPath: custom.appPath },
      ],
    }));
    res.status(201).json(await slicerState());
  });

  app.delete('/api/slicers/custom/:id', async (req, res) => {
    const id = String(req.params.id);
    await ctx.config.updateSettings((settings) => ({
      customSlicers: (settings.customSlicers ?? []).filter((s) => normalizeCustomSlicer(s)?.id !== id),
      slicer: settings.slicer === id ? null : settings.slicer,
    }));
    res.json(await slicerState());
  });

  app.post('/api/open-in-slicer', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const rel = String(req.body?.path || '');
    if (!rel || isLinkPath(rel)) {
      res.status(400).json({ error: 'Kein gültiger Dateipfad.' });
      return;
    }
    const settings = await ctx.config.getSettings();
    const slicerId = String(req.body?.slicer || settings.slicer || '');
    const { absolutePath } = resolveRelative(root, rel);
    await fs.access(absolutePath);
    const slicer = await ctx.slicers.open(slicerId, absolutePath, settings);
    res.json({ ok: true, slicer: slicer.name });
  });

  app.get('/api/settings', async (_req, res) => {
    res.json(await ctx.config.getSettings());
  });

  app.put('/api/settings', async (req, res) => {
    const patch = {};
    if (req.body && 'slicer' in req.body) {
      const slicer = req.body.slicer === null ? null : String(req.body.slicer);
      const known = (await ctx.slicers.list(await ctx.config.getSettings())).some((s) => s.id === slicer);
      if (slicer !== null && !known) {
        res.status(400).json({ error: 'Unbekannter Slicer.' });
        return;
      }
      patch.slicer = slicer;
    }
    res.json(await ctx.config.updateSettings(patch));
  });

  app.get('/api/ui-state', async (_req, res) => {
    res.json(await ctx.config.getUiState());
  });

  app.put('/api/ui-state', async (req, res) => {
    res.json(await ctx.config.setUiState(req.body));
  });
}
