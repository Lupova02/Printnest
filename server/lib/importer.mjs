import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ALLOWED_EXTENSIONS, sanitizeFileName, toRelative, uniqueName } from './paths.mjs';

const MAX_ENTRIES = 5000;

/**
 * Dateien/Ordner (echte Pfade aus dem Finder) in einen Bibliotheksordner kopieren.
 * Ordner werden rekursiv übernommen, versteckte Einträge und nicht erlaubte Typen übersprungen.
 * Namenskonflikte → „Name (2).ext“.
 */
export async function importPaths({ sources, destAbs, destParts }) {
  const report = { imported: [], skipped: [], renamed: [] };
  let budget = MAX_ENTRIES;

  async function copyEntry(sourceAbs, targetDirAbs, targetParts, reserved) {
    if (budget-- <= 0) {
      report.skipped.push({ name: path.basename(sourceAbs), reason: 'Zu viele Einträge' });
      return 0;
    }
    const baseName = path.basename(sourceAbs);
    if (baseName.startsWith('.')) return 0;

    let st;
    try {
      st = await fs.stat(sourceAbs);
    } catch {
      report.skipped.push({ name: baseName, reason: 'Nicht lesbar' });
      return 0;
    }

    const wanted = sanitizeFileName(baseName);
    if (st.isDirectory()) {
      const destResolved = path.resolve(targetDirAbs);
      const srcResolved = path.resolve(sourceAbs);
      if (destResolved === srcResolved || destResolved.startsWith(`${srcResolved}${path.sep}`)) {
        report.skipped.push({ name: baseName, reason: 'Ordner kann nicht in sich selbst kopiert werden' });
        return 0;
      }
      const folderName = await uniqueName(targetDirAbs, wanted, reserved);
      const folderAbs = path.join(targetDirAbs, folderName);
      await fs.mkdir(folderAbs);
      let children;
      try {
        children = await fs.readdir(sourceAbs);
      } catch {
        children = [];
      }
      let copied = 0;
      const childReserved = new Set();
      for (const child of children.sort((a, b) => a.localeCompare(b, 'de'))) {
        copied += await copyEntry(
          path.join(sourceAbs, child),
          folderAbs,
          [...targetParts, folderName],
          childReserved,
        );
      }
      if (copied === 0) {
        // Nur leere Ordner/unerlaubte Typen → keinen leeren Ordner hinterlassen.
        await fs.rmdir(folderAbs).catch(() => {});
        report.skipped.push({ name: baseName, reason: 'Keine unterstützten Dateien' });
        return 0;
      }
      if (folderName !== wanted) report.renamed.push({ from: baseName, to: folderName });
      report.imported.push({ name: folderName, type: 'folder', relativePath: toRelative([...targetParts, folderName]) });
      return copied;
    }

    if (!st.isFile()) return 0;
    const ext = path.extname(baseName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      report.skipped.push({ name: baseName, reason: `Dateityp nicht erlaubt: ${ext || '(ohne)'}` });
      return 0;
    }
    const fileName = await uniqueName(targetDirAbs, wanted, reserved);
    await fs.copyFile(sourceAbs, path.join(targetDirAbs, fileName), constants.COPYFILE_EXCL);
    if (fileName !== wanted) report.renamed.push({ from: baseName, to: fileName });
    if (targetParts.length === destParts.length) {
      report.imported.push({ name: fileName, type: 'file', relativePath: toRelative([...targetParts, fileName]) });
    }
    return 1;
  }

  const reserved = new Set();
  let fileCount = 0;
  for (const source of sources) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) {
      report.skipped.push({ name: String(source), reason: 'Ungültiger Pfad' });
      continue;
    }
    fileCount += await copyEntry(source, destAbs, destParts, reserved);
  }
  return { ...report, fileCount };
}
