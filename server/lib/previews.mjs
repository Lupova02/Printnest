import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractF3dPreviewBytes } from '../f3d-preview.mjs';
import { renderPdfPreviewPng } from '../pdf-preview.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPngBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Vorschau-Cache im Datenordner (Schlüssel: Pfad + mtime + Größe). */
export function createPreviewCache(cacheDir) {
  function keyFor(prefix, relativePath, st, extra = '') {
    return createHash('sha256')
      .update(`${prefix}:${relativePath}:${st.mtimeMs}:${st.size}:${extra}`)
      .digest('hex');
  }

  async function cached(key, produce) {
    const file = path.join(cacheDir, `${key}.png`);
    try {
      return await fs.readFile(file);
    } catch {
      // Cache-Miss
    }
    const image = await produce();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, image);
    return image;
  }

  return {
    /** Erste PDF-Seite als PNG. */
    async pdf(absolutePath, relativePath, maxWidth) {
      const st = await fs.stat(absolutePath);
      return cached(keyFor('pdf', relativePath, st, maxWidth), () =>
        renderPdfPreviewPng(absolutePath, { maxWidth }),
      );
    },
    /** Eingebettete Vorschau aus F3D (Fusion 360); `variant` 'large' = höchste Auflösung. */
    async f3d(absolutePath, relativePath, variant = 'thumb') {
      const st = await fs.stat(absolutePath);
      return cached(keyFor('f3d', relativePath, st, variant), async () => {
        const previewBytes = extractF3dPreviewBytes(await fs.readFile(absolutePath), { variant });
        if (!previewBytes?.length) {
          throw Object.assign(new Error('Keine eingebettete F3D-Vorschau gefunden.'), { status: 404 });
        }
        return Buffer.from(previewBytes);
      });
    },
    /** Clientseitig gerenderte STL/3MF-Thumbnails lesen (null = noch nicht vorhanden). */
    async readThumb(absolutePath, relativePath) {
      const st = await fs.stat(absolutePath);
      try {
        return await fs.readFile(path.join(cacheDir, `${keyFor('thumb', relativePath, st)}.png`));
      } catch {
        return null;
      }
    },
    async writeThumb(absolutePath, relativePath, png) {
      if (!isPngBuffer(png)) {
        throw Object.assign(new Error('Thumbnail muss ein PNG sein.'), { status: 400 });
      }
      const st = await fs.stat(absolutePath);
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, `${keyFor('thumb', relativePath, st)}.png`), png);
    },
  };
}
