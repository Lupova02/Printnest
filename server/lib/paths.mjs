import fs from 'node:fs/promises';
import path from 'node:path';

/** Dateitypen, die importiert/hochgeladen werden dürfen. */
export const ALLOWED_EXTENSIONS = new Set([
  '.stl',
  '.3mf',
  '.f3d',
  '.pdf',
  '.mp4',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
]);

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'];
export const FILE_KINDS = ['stl', '3mf', 'f3d', 'pdf', 'mp4', 'img'];

export function extensionToKind(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.stl') return 'stl';
  if (normalized === '.3mf') return '3mf';
  if (normalized === '.f3d') return 'f3d';
  if (normalized === '.pdf') return 'pdf';
  if (normalized === '.mp4') return 'mp4';
  if (IMAGE_EXTENSIONS.includes(normalized)) return 'img';
  return null;
}

/**
 * Gültiger Datei-/Ordnername: nicht leer, max. 180 Zeichen, keine Pfadtrenner,
 * kein „:“ (unter macOS im Finder als „/“ dargestellt), keine Steuerzeichen,
 * nicht „.“ oder „..“ als Ganzes. Punkte im Namen (z. B. `v1..2.stl`) sind erlaubt.
 */
export function isSafeName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 180) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\:\u0000-\u001f\u007f]/.test(trimmed);
}

/** Relativen Pfad in Segmente zerlegen; „.“/„..“ und leere Segmente fallen weg. */
export function parseRelative(rel = '') {
  return String(rel)
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
}

export function toRelative(parts) {
  return parts.join('/');
}

/** Absoluten Pfad bilden und sicherstellen, dass er innerhalb der Bibliothek liegt. */
export function resolveInsideRoot(root, relativeParts = []) {
  const target = path.resolve(root, ...relativeParts);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw Object.assign(new Error('Pfad liegt außerhalb der Bibliothek.'), { status: 400 });
  }
  return target;
}

export function resolveRelative(root, relativePath = '') {
  const parts = parseRelative(relativePath);
  return {
    parts,
    relativePath: toRelative(parts),
    absolutePath: resolveInsideRoot(root, parts),
  };
}

export function parentInfo(parts) {
  const parentParts = parts.slice(0, -1);
  return {
    parentPath: toRelative(parentParts),
    parentLabel: parentParts.length ? parentParts.join(' / ') : 'Home',
  };
}

/** `rel` ist `prefix` selbst oder liegt darunter. */
export function isSameOrInside(rel, prefix) {
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

/** Pfad nach Umbenennen/Verschieben von `from` → `to` umschreiben (oder null, wenn nicht betroffen). */
export function remapPath(rel, from, to) {
  if (!from) return null;
  if (rel === from) return to;
  if (rel.startsWith(`${from}/`)) return `${to}${rel.slice(from.length)}`;
  return null;
}

/** Dateiname aus Upload/Import bereinigen (Pfadteile, Trenner, Steuerzeichen entfernen). */
export function sanitizeFileName(name) {
  const base = path.basename(String(name || '').replaceAll('\\', '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[/:\u0000-\u001f\u007f]+/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'Datei';
  return cleaned.slice(0, 180);
}

/** „Name (2).ext“-Variante für Namenskonflikte bilden. */
export function numberedName(name, n) {
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  return `${stem} (${n})${ext && ext !== name ? ext : ''}`;
}

async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Freien Namen im Ordner finden: `name`, sonst `name (2)`, `name (3)` …
 * `reserved` verhindert Doppelvergabe innerhalb eines Requests (Mehrfach-Upload).
 */
export async function uniqueName(dir, name, reserved = new Set()) {
  let candidate = name;
  for (let n = 2; n < 10000; n++) {
    const key = candidate.toLowerCase();
    // Synchron reservieren, bevor geprüft wird – parallele Aufrufe (Mehrfach-Upload)
    // dürfen nicht denselben Namen erhalten.
    if (!reserved.has(key)) {
      reserved.add(key);
      if (!(await exists(path.join(dir, candidate)))) return candidate;
    }
    candidate = numberedName(name, n);
  }
  throw Object.assign(new Error('Kein freier Dateiname gefunden.'), { status: 409 });
}

/** Einfache Nebenläufigkeitsbegrenzung für viele `fs.stat`-Aufrufe. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `fs.stat` ohne Ausnahme (kaputte Symlinks, fehlende Rechte → null). */
export async function safeStat(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}
