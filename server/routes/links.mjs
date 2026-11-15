import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_MAX_BYTES, checkLinkStatus, fetchLinkPreview, normalizeUrl, safeFetch } from '../lib/link-meta.mjs';
import { findDuplicateLinks, isLinkPath, isValidHttpUrl, linkIdFromPath, readLinks, toLinkEntry, updateLinks } from '../lib/links.mjs';

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/i;

/** Link-Assistent: Vorschau (OpenGraph/oEmbed), Duplikate, Vorschaubild, Erreichbarkeit. */
export function registerLinkRoutes(app, ctx) {
  /** Metadaten holen (Server-seitig, SSRF-geschützt) und Duplikate in der Bibliothek melden. */
  app.get('/api/link-preview', async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!isValidHttpUrl(url)) {
      res.status(400).json({ error: 'Ungültige URL (nur http/https).' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const links = await readLinks(root);
    const exclude = req.query.exclude ? linkIdFromPath(String(req.query.exclude)) : null;
    const duplicates = findDuplicateLinks(links, normalizeUrl(url), exclude).map((d) => ({
      id: `link/${d.id}`,
      name: d.name,
      parentPath: d.parentPath || '',
    }));
    const preview = await fetchLinkPreview(url, ctx.linkFetchOptions);
    res.json({ preview, duplicates });
  });

  /** Vorschaubild eines gespeicherten Links (og:image), gecacht im Vorschau-Cache. */
  app.get('/api/link-image', async (req, res) => {
    const rel = String(req.query.path || '');
    if (!isLinkPath(rel)) {
      res.status(400).json({ error: 'Kein Link.' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const link = (await readLinks(root)).find((l) => l.id === linkIdFromPath(rel));
    if (!link?.image) {
      res.status(404).json({ error: 'Kein Vorschaubild.' });
      return;
    }
    const key = createHash('sha256').update(`link-image:${link.image}`).digest('hex');
    const file = path.join(ctx.previewDir, `${key}.img`);
    let body = await fs.readFile(file).catch(() => null);
    let type = body ? await fs.readFile(`${file}.type`, 'utf8').catch(() => 'image/jpeg') : null;
    if (!body) {
      const result = await safeFetch(link.image, { ...ctx.linkFetchOptions, maxBytes: IMAGE_MAX_BYTES, accept: 'image/*' });
      type = String(result.headers['content-type'] || '').split(';')[0].trim();
      if (result.status !== 200 || !IMAGE_TYPES.test(type) || result.truncated) {
        res.status(404).json({ error: 'Vorschaubild nicht verfügbar.' });
        return;
      }
      body = result.body;
      await fs.mkdir(ctx.previewDir, { recursive: true });
      await fs.writeFile(file, body);
      await fs.writeFile(`${file}.type`, type);
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  });

  /** Erreichbarkeit prüfen (manuell ausgelöst) und Ergebnis am Link speichern. */
  app.post('/api/links/status', async (req, res) => {
    const rel = String(req.body?.path || '');
    if (!isLinkPath(rel)) {
      res.status(400).json({ error: 'Kein Link.' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const id = linkIdFromPath(rel);
    const link = (await readLinks(root)).find((l) => l.id === id);
    if (!link) {
      res.status(404).json({ error: 'Link nicht gefunden.' });
      return;
    }
    const result = await checkLinkStatus(link.url, ctx.linkFetchOptions);
    const updated = await updateLinks(root, (links) => {
      const target = links.find((l) => l.id === id);
      if (!target) return { changed: false };
      Object.assign(target, { status: result.status, httpStatus: result.httpStatus, checkedAt: new Date().toISOString() });
      return { changed: true, link: target };
    });
    ctx.changed({ meta: true });
    res.json({ ...result, entry: updated.link ? toLinkEntry(updated.link) : null });
  });
}
