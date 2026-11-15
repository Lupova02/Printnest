import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CMAP_URL = `${path.join(__dirname, '../node_modules/pdfjs-dist/cmaps/')}/`;
const STANDARD_FONT_DATA_URL = `${path.join(__dirname, '../node_modules/pdfjs-dist/standard_fonts/')}/`;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Rendert die erste PDF-Seite als PNG (für Thumbnails und Vorschau).
 */
export async function renderPdfPreviewPng(absolutePath, { maxWidth = 320 } = {}) {
  const data = new Uint8Array(await fs.readFile(absolutePath));
  const doc = await getDocument({
    data,
    CanvasFactory: NodeCanvasFactory,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;

  const page = await doc.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / baseViewport.width);
  const viewport = page.getViewport({ scale: Math.max(scale, 0.15) });

  const factory = new NodeCanvasFactory();
  const canvasAndContext = factory.create(viewport.width, viewport.height);
  await page.render({
    canvasContext: canvasAndContext.context,
    viewport,
    canvasFactory: factory,
  }).promise;

  return canvasAndContext.canvas.toBuffer('image/png');
}
