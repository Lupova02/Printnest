import express from 'express';
import path from 'node:path';
import { createConfigStore } from './lib/config.mjs';
import { FileIndex } from './lib/file-index.mjs';
import { createNameAssistStore } from './lib/name-assist.mjs';
import { ensureSeedLinks } from './lib/links.mjs';
import { createPreviewCache } from './lib/previews.mjs';
import { createSecurityMiddleware } from './lib/security.mjs';
import { createSlicerService } from './lib/slicers.mjs';
import { defaultTrash } from './lib/trash.mjs';
import { createEventHub, createLibraryWatcher } from './lib/watcher.mjs';
import { registerEntryRoutes } from './routes/entries.mjs';
import { registerLibraryRoutes } from './routes/library.mjs';
import { registerLinkRoutes } from './routes/links.mjs';
import { registerMediaRoutes } from './routes/media.mjs';
import { registerMetaRoutes, registerNamingRoutes } from './routes/meta.mjs';
import { registerSystemRoutes } from './routes/system.mjs';

/**
 * Laufzeitkontext des Servers: Konfiguration, Index, Events, Watcher und
 * injizierbare Systemfunktionen (Papierkorb, Browser öffnen).
 */
export function createContext(options) {
  const config = createConfigStore(options.dataDir);
  const index = new FileIndex();
  const events = createEventHub();
  const seeded = new Set();

  const watcher = createLibraryWatcher({
    onChange: ({ paths }) => {
      index.invalidate();
      events.broadcast('change', { paths, source: 'fs' });
    },
  });

  return {
    config,
    index,
    events,
    watcher,
    previews: createPreviewCache(path.join(options.dataDir, '.preview-cache')),
    previewDir: path.join(options.dataDir, '.preview-cache'),
    /** Optionen für ausgehende Abrufe (Tests: eigener DNS-Resolver). */
    linkFetchOptions: options.linkFetchOptions ?? {},
    trash: options.trash ?? defaultTrash,
    openExternal: options.openExternal ?? null,
    nameAssist: createNameAssistStore(options.dataDir),
    /** Slicer-Erkennung/-Start (in Tests mit Fake-Ordnern und Fake-`open`). */
    slicers: options.slicers ?? createSlicerService(),
    /** Optionaler App-Dialog (Electron); sonst AppleScript-Fallback. */
    pickApp: options.pickApp ?? null,
    /** Nach eigenen Änderungen: Index verwerfen und UI benachrichtigen. */
    changed(detail = {}) {
      if (!detail.meta) index.invalidate();
      events.broadcast('change', { source: 'api', ...detail });
    },
    /** Neue Bibliothek gewählt: Index verwerfen, Watcher umhängen. */
    libraryChanged(root) {
      index.invalidate();
      watcher.watch(root);
      events.broadcast('library', { root });
    },
    async ensureSeeded(root) {
      if (seeded.has(root)) return;
      seeded.add(root);
      const { added } = await ensureSeedLinks(root, options.seedLinksPath);
      if (added > 0) index.invalidate();
    },
  };
}

/** Express-App: Schutz → API → 404 für /api → statische UI + SPA-Fallback → Fehlerbehandlung. */
export function createApp(ctx, { token, getPort, dev = false, requireTokenInDev = false, staticDir = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(createSecurityMiddleware({ token, getPort, dev, requireTokenInDev }));
  app.use('/api', express.json({ limit: '1mb' }));

  registerSystemRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerEntryRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  registerMetaRoutes(app, ctx);
  registerNamingRoutes(app, ctx);
  registerLinkRoutes(app, ctx);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unbekannte API-Route.', code: 'NOT_FOUND' });
  });

  if (staticDir) {
    app.use(express.static(staticDir, { index: false, fallthrough: true }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Fehlerbehandlung immer zuletzt registrieren.
  app.use((error, _req, res, _next) => {
    let status = error.status || error.statusCode || 500;
    if (error.code === 'ENOENT') status = 404;
    if (error.code === 'EACCES' || error.code === 'EPERM') status = 403;
    if (status >= 500) console.error(error);
    res.status(status).json({
      error:
        status === 404 && error.code === 'ENOENT'
          ? 'Datei oder Ordner nicht gefunden.'
          : status === 403 && !error.status
            ? 'Keine Berechtigung für diese Datei.'
            : error.message || 'Unbekannter Serverfehler.',
      code: typeof error.code === 'string' ? error.code : undefined,
      ...(Array.isArray(error.conflicts) ? { conflicts: error.conflicts } : {}),
    });
  });

  return app;
}
