import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readLinks, toLinkEntry } from './links.mjs';
import { ratingOf } from './meta.mjs';
import {
  extensionToKind,
  mapLimit,
  parentInfo,
  resolveRelative,
  safeStat,
  toRelative,
} from './paths.mjs';

const STAT_CONCURRENCY = 24;

async function readVisibleDir(folderPath) {
  try {
    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    return dirents.filter((entry) => !entry.name.startsWith('.'));
  } catch {
    return null;
  }
}

/** Anzahl sichtbarer Kinder (null, wenn nicht lesbar). */
export async function countChildren(folderPath) {
  const entries = await readVisibleDir(folderPath);
  return entries ? entries.length : null;
}

/** Jüngste Änderung der direkten Kinder — kein Deep-Scan, defekte Einträge werden übersprungen. */
export async function shallowActivityIso(folderPath, folderMtimeMs) {
  const entries = (await readVisibleDir(folderPath)) ?? [];
  const stats = await mapLimit(entries, 8, (entry) => safeStat(path.join(folderPath, entry.name)));
  let latest = folderMtimeMs;
  for (const st of stats) {
    if (st) latest = Math.max(latest, st.mtimeMs);
  }
  return new Date(latest).toISOString();
}

export function sortFolderFirst(entries) {
  return entries.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name, 'de');
  });
}

export function breadcrumbsFor(parts) {
  return [
    { name: 'Home', relativePath: '' },
    ...parts.map((name, index) => ({ name, relativePath: toRelative(parts.slice(0, index + 1)) })),
  ];
}

/** Inhalt eines Ordners (Dateien, Unterordner, Links) inkl. Bewertung. */
export async function listDirectory(root, relativePath, meta) {
  const { parts, relativePath: currentRel, absolutePath } = resolveRelative(root, relativePath);

  const stat = await safeStat(absolutePath);
  if (!stat) throw Object.assign(new Error('Ordner nicht gefunden.'), { status: 404 });
  if (!stat.isDirectory()) throw Object.assign(new Error('Pfad ist kein Ordner.'), { status: 400 });

  const dirents = await readVisibleDir(absolutePath);
  if (!dirents) {
    throw Object.assign(new Error('Ordner kann nicht gelesen werden (fehlende Rechte?).'), {
      status: 403,
    });
  }

  const rows = await mapLimit(dirents, STAT_CONCURRENCY, async (dirent) => {
    const fullPath = path.join(absolutePath, dirent.name);
    const entryStat = await safeStat(fullPath);
    if (!entryStat) return null; // kaputter Symlink / gesperrt
    const entryRel = toRelative([...parts, dirent.name]);
    const parent = parentInfo([...parts, dirent.name]);
    const signature = `${dirent.name}:${entryStat.mtimeMs}:${entryStat.size}`;

    if (entryStat.isDirectory()) {
      const [childCount, updatedAt] = await Promise.all([
        countChildren(fullPath),
        shallowActivityIso(fullPath, entryStat.mtimeMs),
      ]);
      return {
        signature,
        entry: {
          id: entryRel,
          name: dirent.name,
          type: 'folder',
          relativePath: entryRel,
          parentPath: parent.parentPath,
          parentLabel: parent.parentLabel,
          kind: null,
          kinds: [],
          size: null,
          childCount,
          updatedAt,
          rating: ratingOf(meta, entryRel),
        },
      };
    }
    if (!entryStat.isFile()) return null;
    const kind = extensionToKind(path.extname(dirent.name));
    return {
      signature,
      entry: {
        id: entryRel,
        name: dirent.name,
        type: 'file',
        relativePath: entryRel,
        parentPath: parent.parentPath,
        parentLabel: parent.parentLabel,
        kind,
        kinds: kind ? [kind] : [],
        size: entryStat.size,
        childCount: null,
        updatedAt: new Date(entryStat.mtimeMs).toISOString(),
        rating: ratingOf(meta, entryRel),
      },
    };
  });

  const entries = [];
  const signatureParts = [];
  for (const row of rows) {
    if (!row) continue;
    entries.push(row.entry);
    signatureParts.push(row.signature);
  }

  for (const link of await readLinks(root)) {
    if ((link.parentPath || '') !== currentRel) continue;
    const entry = toLinkEntry(link, ratingOf(meta, `link/${link.id}`));
    entries.push(entry);
    signatureParts.push(`${entry.id}:${entry.updatedAt}:${entry.url}`);
  }
  for (const entry of entries) {
    if (entry.rating) signatureParts.push(`r:${entry.id}:${entry.rating}`);
  }

  sortFolderFirst(entries);

  return {
    configured: true,
    root,
    relativePath: currentRel,
    breadcrumbs: breadcrumbsFor(parts),
    entries,
    signature: createHash('sha1').update(signatureParts.sort().join('|')).digest('hex'),
  };
}
