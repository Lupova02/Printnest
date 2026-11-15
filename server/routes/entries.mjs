import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { executeBatch, planBatch } from '../lib/batch.mjs';
import { importPaths } from '../lib/importer.mjs';
import { cleanUrl, normalizeUrl } from '../lib/link-meta.mjs';
import {
  findDuplicateLinks,
  isLinkPath,
  isValidHttpUrl,
  linkIdFromPath,
  remapLinksForMovedFolder,
  removeLinksUnder,
  toLinkEntry,
  updateLinks,
} from '../lib/links.mjs';
import { removeMetaKeys, remapMetaKeys, updateMeta } from '../lib/meta.mjs';
import {
  ALLOWED_EXTENSIONS,
  extensionToKind,
  isSafeName,
  resolveInsideRoot,
  resolveRelative,
  safeStat,
  sanitizeFileName,
  toRelative,
  uniqueName,
} from '../lib/paths.mjs';

/** Vom Client gelieferte Link-Metadaten (aus /api/link-preview) begrenzen und übernehmen. */
function pickLinkMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
  const image = text(meta.image, 1000);
  const out = {
    portal: text(meta.portal, 40),
    portalLabel: text(meta.portalLabel, 40),
    creator: text(meta.creator, 120),
    title: text(meta.title, 200),
    description: text(meta.description, 300),
    image: image && isValidHttpUrl(image) ? image : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Zielordner auflösen und prüfen. */
async function resolveFolder(root, rel) {
  const resolved = resolveRelative(root, rel);
  const st = await safeStat(resolved.absolutePath);
  if (!st) throw httpError(404, 'Zielordner nicht gefunden.');
  if (!st.isDirectory()) throw httpError(400, 'Ziel ist kein Ordner.');
  return resolved;
}

/** Anlegen, Hochladen/Importieren, Umbenennen/Verschieben und Löschen. */
export function registerEntryRoutes(app, ctx) {
  const upload = multer({
    // Dateinamen im Multipart-Header als UTF-8 lesen (Umlaute).
    defParamCharset: 'utf8',
    storage: multer.diskStorage({
      destination: async (req, _file, cb) => {
        try {
          const root = await ctx.config.requireLibraryRoot();
          const { absolutePath } = await resolveFolder(root, String(req.body.parent ?? ''));
          cb(null, absolutePath);
        } catch (error) {
          cb(error);
        }
      },
      filename: async (req, file, cb) => {
        try {
          // Ohne Überschreiben: bei Konflikt „Name (2).ext“ vergeben.
          req.printnestReserved ??= new Set();
          const root = await ctx.config.requireLibraryRoot();
          const { absolutePath } = resolveRelative(root, String(req.body.parent ?? ''));
          const wanted = sanitizeFileName(file.originalname);
          file.printnestWanted = wanted;
          cb(null, await uniqueName(absolutePath, wanted, req.printnestReserved));
        } catch (error) {
          cb(error);
        }
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(httpError(400, `Dateityp nicht erlaubt: ${ext || '(ohne)'}`));
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: 1024 * 1024 * 1024, files: 200 },
  });

  app.post('/api/folders', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!isSafeName(name)) {
      res.status(400).json({ error: 'Ungültiger Ordnername.' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const { parts } = await resolveFolder(root, String(req.body?.parent ?? ''));
    const folderPath = resolveInsideRoot(root, [...parts, name]);
    try {
      await fs.mkdir(folderPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        res.status(409).json({ error: 'Ein Eintrag mit diesem Namen existiert bereits.' });
        return;
      }
      throw error;
    }
    ctx.changed();
    res.status(201).json({ name, type: 'folder', relativePath: toRelative([...parts, name]) });
  });

  app.post('/api/links', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const url = cleanUrl(String(req.body?.url || '').trim());
    const parent = String(req.body?.parent ?? '');
    if (!isSafeName(name)) {
      res.status(400).json({ error: 'Ungültiger Name.' });
      return;
    }
    if (!isValidHttpUrl(url)) {
      res.status(400).json({ error: 'Ungültige URL (nur http/https).' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const { relativePath } = await resolveFolder(root, parent);
    const now = new Date().toISOString();
    const link = {
      id: randomUUID(),
      name,
      url,
      parentPath: relativePath,
      createdAt: now,
      updatedAt: now,
      ...pickLinkMeta(req.body?.meta),
    };
    const result = await updateLinks(root, (links) => {
      // Duplikat (gleiche normalisierte URL) nur mit ausdrücklicher Bestätigung.
      const duplicates = findDuplicateLinks(links, normalizeUrl(url));
      if (duplicates.length && !req.body?.allowDuplicate) return { changed: false, duplicates };
      links.push(link);
      return { changed: true };
    });
    if (result.duplicates) {
      res.status(409).json({
        error: 'Dieser Link ist bereits gespeichert.',
        code: 'DUPLICATE_LINK',
        duplicates: result.duplicates.map((d) => ({ id: `link/${d.id}`, name: d.name, parentPath: d.parentPath || '' })),
      });
      return;
    }
    ctx.changed();
    res.status(201).json(toLinkEntry(link));
  });

  app.post('/api/files', (req, res, next) => {
    upload.array('files')(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) error.status = 400;
        next(error);
        return;
      }
      const files = (req.files || []).map((file) => ({
        name: file.filename,
        originalName: file.printnestWanted ?? file.originalname,
        renamed: file.filename !== (file.printnestWanted ?? file.originalname),
        size: file.size,
        kind: extensionToKind(path.extname(file.filename)),
      }));
      ctx.changed();
      res.status(201).json({ parent: String(req.body.parent ?? ''), files });
    });
  });

  /** Echte Pfade (Electron-Drop aus dem Finder) serverseitig kopieren. */
  app.post('/api/import', async (req, res) => {
    const sources = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 500) : [];
    if (!sources.length) {
      res.status(400).json({ error: 'Keine Pfade übergeben.' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();
    const dest = await resolveFolder(root, String(req.body?.parent ?? ''));
    const report = await importPaths({
      sources,
      destAbs: dest.absolutePath,
      destParts: dest.parts,
    });
    ctx.changed();
    res.status(201).json({ parent: dest.relativePath, ...report });
  });

  app.patch('/api/entries', async (req, res) => {
    const body = req.body ?? {};
    const fromRel = String(body.path || '');
    if (!fromRel) {
      res.status(400).json({ error: 'Pfad fehlt.' });
      return;
    }
    const hasDestination = Object.hasOwn(body, 'destination');
    const hasName = Object.hasOwn(body, 'name');
    const hasUrl = Object.hasOwn(body, 'url') && isLinkPath(fromRel);
    const nextName = hasName ? String(body.name || '').trim() : null;
    const destination = hasDestination ? String(body.destination ?? '') : null;
    const nextUrl = hasUrl ? cleanUrl(String(body.url || '').trim()) : null;
    if (!hasName && !hasDestination && !hasUrl) {
      res.status(400).json({ error: 'Name oder Zielordner erforderlich.' });
      return;
    }
    if (hasUrl && !isValidHttpUrl(nextUrl)) {
      res.status(400).json({ error: 'Ungültige URL (nur http/https).' });
      return;
    }
    if (hasName && !isSafeName(nextName)) {
      res.status(400).json({ error: 'Ungültiger Name.' });
      return;
    }

    const root = await ctx.config.requireLibraryRoot();

    if (isLinkPath(fromRel)) {
      const id = linkIdFromPath(fromRel);
      const destRel = hasDestination ? (await resolveFolder(root, destination)).relativePath : null;
      const result = await updateLinks(root, (links) => {
        const link = links.find((item) => item.id === id);
        if (!link) return { changed: false, link: null };
        if (hasName) link.name = nextName;
        if (destRel !== null) link.parentPath = destRel;
        if (hasUrl && nextUrl !== link.url) {
          link.url = nextUrl;
          // Neue URL: alter Prüfstatus gilt nicht mehr.
          delete link.status;
          delete link.httpStatus;
          delete link.checkedAt;
          Object.assign(link, pickLinkMeta(body.meta));
        }
        link.updatedAt = new Date().toISOString();
        return { changed: true, link };
      });
      if (!result.link) {
        res.status(404).json({ error: 'Link nicht gefunden.' });
        return;
      }
      ctx.changed();
      res.json({ relativePath: fromRel, name: result.link.name, parentPath: result.link.parentPath || '', url: result.link.url });
      return;
    }

    const { parts, absolutePath: fromPath } = resolveRelative(root, fromRel);
    if (parts.length === 0) {
      res.status(400).json({ error: 'Die Bibliothekswurzel kann nicht umbenannt oder verschoben werden.' });
      return;
    }
    const fromStat = await safeStat(fromPath);
    if (!fromStat) {
      res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      return;
    }

    const fromPrefix = toRelative(parts);
    const finalName = hasName ? nextName : parts[parts.length - 1];
    let destParentParts = parts.slice(0, -1);
    if (hasDestination) {
      destParentParts = (await resolveFolder(root, destination)).parts;
      const destPath = toRelative(destParentParts);
      if (fromStat.isDirectory() && (destPath === fromPrefix || destPath.startsWith(`${fromPrefix}/`))) {
        res.status(400).json({ error: 'Ein Ordner kann nicht in sich selbst verschoben werden.' });
        return;
      }
    }

    const toRel = toRelative([...destParentParts, finalName]);
    const toPath = resolveInsideRoot(root, [...destParentParts, finalName]);
    const response = { relativePath: toRel, name: finalName, parentPath: toRelative(destParentParts) };
    if (fromPath === toPath) {
      res.json(response);
      return;
    }

    // Nur Groß-/Kleinschreibung geändert? Auf case-insensitiven Volumes ist das Ziel „vorhanden“.
    const caseOnly = fromPath.toLowerCase() === toPath.toLowerCase();
    if (!caseOnly && (await safeStat(toPath))) {
      res.status(409).json({ error: 'Ein Eintrag mit diesem Namen existiert bereits im Zielordner.' });
      return;
    }

    await fs.rename(fromPath, toPath);

    // Links (nur Ordner-Bezug) und Bewertungen (Datei oder Ordner) mitziehen.
    if (fromStat.isDirectory()) {
      await updateLinks(root, (links) => ({
        changed: remapLinksForMovedFolder(links, fromPrefix, toRel),
      }));
    }
    await updateMeta(root, (meta) => remapMetaKeys(meta, fromPrefix, toRel));

    ctx.changed();
    res.json(response);
  });

  /**
   * Stapel: mehrere Umbenennungen/Verschiebungen in einem Schritt (alles oder nichts).
   * `dryRun: true` prüft nur und meldet Konflikte. Grundlage für Stapelumbenennung und ⌘Z.
   */
  app.post('/api/entries/batch', async (req, res) => {
    const root = await ctx.config.requireLibraryRoot();
    const plan = await planBatch(root, req.body?.ops);
    if (req.body?.dryRun) {
      res.json({ ok: true, results: plan.steps.map((s) => ({ from: s.from, to: s.to })) });
      return;
    }
    const results = await executeBatch(root, plan);
    ctx.changed();
    res.json({ ok: true, results });
  });

  app.delete('/api/entries', async (req, res) => {
    const targetRel = String(req.body?.path || req.query?.path || '');
    if (!targetRel) {
      res.status(400).json({ error: 'Pfad fehlt.' });
      return;
    }
    const root = await ctx.config.requireLibraryRoot();

    if (isLinkPath(targetRel)) {
      const id = linkIdFromPath(targetRel);
      const result = await updateLinks(root, (links) => {
        const next = links.filter((item) => item.id !== id);
        return { changed: next.length !== links.length, links: next };
      });
      if (!result.changed) {
        res.status(404).json({ error: 'Link nicht gefunden.' });
        return;
      }
      await updateMeta(root, (meta) => removeMetaKeys(meta, targetRel));
      ctx.changed();
      res.json({ ok: true, relativePath: targetRel, trashed: false });
      return;
    }

    const { parts, absolutePath } = resolveRelative(root, targetRel);
    if (parts.length === 0) {
      res.status(400).json({ error: 'Die Bibliothekswurzel kann nicht gelöscht werden.' });
      return;
    }
    const stat = await safeStat(absolutePath);
    if (!stat) {
      res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      return;
    }

    // In den Papierkorb statt endgültig löschen (wiederherstellbar im Finder).
    await ctx.trash(absolutePath);

    const prefix = toRelative(parts);
    if (stat.isDirectory()) {
      await updateLinks(root, (links) => {
        const next = removeLinksUnder(links, prefix);
        return { changed: next.length !== links.length, links: next };
      });
    }
    await updateMeta(root, (meta) => removeMetaKeys(meta, prefix));

    ctx.changed();
    res.json({ ok: true, relativePath: targetRel, trashed: true });
  });
}
