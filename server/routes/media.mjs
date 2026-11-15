import express from 'express';
import path from 'node:path';
import { isLinkPath } from '../lib/links.mjs';
import { resolveRelative, safeStat } from '../lib/paths.mjs';

const MIME = {
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.stl': 'model/stl',
  '.3mf': 'model/3mf',
  '.f3d': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

function sendPng(res, image, maxAge = 3600) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(image);
}

/** Datei aus `?path=` auflösen; liefert null und sendet 400, wenn ungültig. */
async function requireFile(ctx, req, res) {
  const root = await ctx.config.requireLibraryRoot();
  const rel = String(req.query.path || '');
  if (!rel || isLinkPath(rel)) {
    res.status(400).json({ error: 'Kein gültiger Dateipfad.' });
    return null;
  }
  const { absolutePath, relativePath } = resolveRelative(root, rel);
  const st = await safeStat(absolutePath);
  if (!st) {
    res.status(404).json({ error: 'Datei nicht gefunden.' });
    return null;
  }
  if (!st.isFile()) {
    res.status(400).json({ error: 'Kein gültiger Dateipfad.' });
    return null;
  }
  return { absolutePath, relativePath };
}

/** Rohdaten, Vorschaubilder und Downloads. */
export function registerMediaRoutes(app, ctx) {
  app.get('/api/media', async (req, res) => {
    const file = await requireFile(ctx, req, res);
    if (!file) return;
    const ext = path.extname(file.absolutePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Range-Requests (206) für flüssiges Spulen in Videos.
    res.sendFile(file.absolutePath, { acceptRanges: true });
  });

  app.get('/api/preview', async (req, res) => {
    const file = await requireFile(ctx, req, res);
    if (!file) return;
    const ext = path.extname(file.absolutePath).toLowerCase();
    const maxWidth = Math.min(Math.max(Number(req.query.width) || 320, 64), 1024);
    if (ext === '.f3d') {
      const variant = req.query.variant === 'large' ? 'large' : 'thumb';
      sendPng(res, await ctx.previews.f3d(file.absolutePath, file.relativePath, variant));
    } else if (ext === '.pdf') {
      sendPng(res, await ctx.previews.pdf(file.absolutePath, file.relativePath, maxWidth));
    } else {
      res.status(400).json({ error: 'Vorschau nur für F3D- und PDF-Dateien verfügbar.' });
    }
  });

  /** STL/3MF-Thumbnails: werden im Renderer erzeugt und hier gecacht. */
  app.get('/api/thumb', async (req, res) => {
    const file = await requireFile(ctx, req, res);
    if (!file) return;
    const image = await ctx.previews.readThumb(file.absolutePath, file.relativePath);
    if (!image) {
      res.status(404).json({ error: 'Noch kein Thumbnail.', code: 'NO_THUMB' });
      return;
    }
    sendPng(res, image, 86400);
  });

  app.put('/api/thumb', express.raw({ type: 'image/png', limit: '4mb' }), async (req, res) => {
    const file = await requireFile(ctx, req, res);
    if (!file) return;
    await ctx.previews.writeThumb(file.absolutePath, file.relativePath, req.body);
    res.status(204).end();
  });

  app.get('/api/download', async (req, res) => {
    const file = await requireFile(ctx, req, res);
    if (!file) return;
    res.download(file.absolutePath, path.basename(file.absolutePath));
  });
}
