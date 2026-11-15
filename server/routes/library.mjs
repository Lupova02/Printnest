import path from 'node:path';
import { pickFolderNative } from '../lib/folder-picker.mjs';
import { listDirectory } from '../lib/listing.mjs';
import { readMeta } from '../lib/meta.mjs';

const KIND_FILTERS = ['stl', '3mf', 'f3d', 'pdf', 'mp4', 'img', 'link'];

function sortParam(req) {
  return String(req.query.sort || 'name') === 'path' ? 'path' : 'name';
}

/** Listing, Suche, Statistik und Wahl des Bibliotheksordners. */
export function registerLibraryRoutes(app, ctx) {
  const notConfigured = { configured: false, entries: [], signature: null };

  /** Root holen oder `null` + Antwort „nicht konfiguriert“ senden. */
  async function rootOrEmpty(res, extra = {}) {
    const root = await ctx.config.getLibraryRoot();
    if (!root) {
      res.json({ ...notConfigured, ...extra });
      return null;
    }
    await ctx.ensureSeeded(root);
    return root;
  }

  app.get('/api/library', async (req, res) => {
    const root = await rootOrEmpty(res, { root: null, relativePath: '', breadcrumbs: [] });
    if (!root) return;
    const meta = await readMeta(root);
    res.json(await listDirectory(root, String(req.query.path ?? ''), meta));
  });

  app.get('/api/library/search', async (req, res) => {
    const kind = String(req.query.kind || '').toLowerCase();
    if (!KIND_FILTERS.includes(kind)) {
      res.status(400).json({ error: 'Ungültiger Dateityp-Filter.' });
      return;
    }
    const root = await rootOrEmpty(res);
    if (!root) return;
    const result = await ctx.index.searchByKind(root, kind, sortParam(req), await readMeta(root));
    res.json({ configured: true, root, ...result });
  });

  app.get('/api/library/find', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Suchbegriff fehlt.' });
      return;
    }
    const root = await rootOrEmpty(res);
    if (!root) return;
    const result = await ctx.index.searchByQuery(root, query, sortParam(req), await readMeta(root));
    res.json({ configured: true, root, ...result });
  });

  app.get('/api/library/rated', async (req, res) => {
    const min = Math.min(Math.max(Number(req.query.min) || 4, 1), 5);
    const root = await rootOrEmpty(res);
    if (!root) return;
    res.json({ configured: true, root, ...(await ctx.index.rated(root, min, await readMeta(root))) });
  });

  app.get('/api/library/recent', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
    const root = await rootOrEmpty(res);
    if (!root) return;
    res.json({ configured: true, root, ...(await ctx.index.recent(root, limit, await readMeta(root))) });
  });

  app.get('/api/library/stats', async (_req, res) => {
    const root = await ctx.config.getLibraryRoot();
    if (!root) {
      res.json({ configured: false, counts: {} });
      return;
    }
    res.json({ configured: true, counts: await ctx.index.stats(root) });
  });

  async function switchLibrary(res, selected) {
    const root = await ctx.config.setLibraryRoot(selected);
    await ctx.ensureSeeded(root);
    ctx.libraryChanged(root);
    res.json({ configured: true, root });
  }

  app.post('/api/library/pick', async (_req, res) => {
    await switchLibrary(res, await pickFolderNative());
  });

  app.put('/api/library/path', async (req, res) => {
    const nextPath = String(req.body?.path || '').trim();
    if (!nextPath || !path.isAbsolute(nextPath)) {
      res.status(400).json({ error: 'Absoluter Pfad erforderlich.' });
      return;
    }
    await switchLibrary(res, nextPath);
  });
}
