import { isLinkPath, linkIdFromPath, readLinks } from '../lib/links.mjs';
import { applyMetaPatch, readMeta, updateMeta, validateMetaInput } from '../lib/meta.mjs';
import { read3mfMeta } from '../lib/model-meta.mjs';
import { resolveRelative, safeStat } from '../lib/paths.mjs';

/** Pfad normalisieren und prüfen, dass der Eintrag existiert. */
async function normalizeTarget(root, rawPath) {
  const rel = String(rawPath || '');
  if (!rel) throw Object.assign(new Error('Pfad fehlt.'), { status: 400 });
  if (isLinkPath(rel)) {
    const id = linkIdFromPath(rel);
    if (!(await readLinks(root)).some((link) => link.id === id)) {
      throw Object.assign(new Error('Link nicht gefunden.'), { status: 404 });
    }
    return rel;
  }
  const { relativePath, absolutePath } = resolveRelative(root, rel);
  if (!relativePath) throw Object.assign(new Error('Pfad fehlt.'), { status: 400 });
  if (!(await safeStat(absolutePath))) {
    throw Object.assign(new Error('Eintrag nicht gefunden.'), { status: 404 });
  }
  return relativePath;
}

/** Druck-Bewertung (1–5 Sterne), Notiz und Druckdatum je Eintrag. */
export function registerMetaRoutes(app, ctx) {
  app.get('/api/meta', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const rel = await normalizeTarget(root, req.query.path);
    const meta = await readMeta(root);
    res.json({ path: rel, meta: meta.entries[rel] ?? null });
  });

  app.put('/api/meta', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const rel = await normalizeTarget(root, req.body?.path);
    const patch = validateMetaInput(req.body);
    // Videos: nur Notiz – keine Sterne, kein Druckdatum.
    if (/\.mp4$/i.test(rel) && ((patch.rating ?? 0) > 0 || patch.printedAt)) {
      res.status(400).json({ error: 'Videos haben nur eine Notiz (keine Bewertung, kein Druckdatum).' });
      return;
    }
    const entry = await updateMeta(root, (meta) => {
      const next = applyMetaPatch(meta, rel, patch);
      return { changed: true, entry: next };
    });
    ctx.changed({ meta: true });
    res.json({ path: rel, meta: entry.entry });
  });
}

/** 3MF-Metadaten (Titel, Designer, Plates) und Lerndaten des Namens-Assistenten. */
export function registerNamingRoutes(app, ctx) {
  app.get('/api/model-meta', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const rel = String(req.query.path || '');
    if (!/\.3mf$/i.test(rel)) {
      res.json({ path: rel, meta: null });
      return;
    }
    const { absolutePath, relativePath } = resolveRelative(root, rel);
    try {
      res.json({ path: relativePath, meta: await read3mfMeta(absolutePath) });
    } catch (error) {
      if (error?.code === 'ENOENT') throw error;
      res.json({ path: relativePath, meta: null });
    }
  });

  app.get('/api/name-assist', async (_req, res) => {
    res.json(await ctx.nameAssist.read());
  });

  app.put('/api/name-assist/schema', async (req, res) => {
    res.json(await ctx.nameAssist.setSchema(req.body?.folder ?? '', req.body?.schema ?? null));
  });

  app.post('/api/name-assist/feedback', async (req, res) => {
    res.json(await ctx.nameAssist.recordFeedback(req.body ?? {}));
  });
}
