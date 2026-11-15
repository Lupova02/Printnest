import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { readLinks, toLinkEntry } from './links.mjs';
import { ratingOf } from './meta.mjs';
import {
  FILE_KINDS,
  IMAGE_EXTENSIONS,
  extensionToKind,
  mapLimit,
  parentInfo,
  parseRelative,
  safeStat,
  toRelative,
} from './paths.mjs';

const execFileAsync = promisify(execFile);
const INDEX_TTL_MS = 5 * 60 * 1000;
const FIND_OPTIONS = { maxBuffer: 64 * 1024 * 1024, timeout: 180000 };

/** `find` relativ zum Root ausführen, damit versteckte Elternordner des Roots nicht stören. */
async function runFind(root, args) {
  try {
    const result = await execFileAsync('find', ['.', ...args], { ...FIND_OPTIONS, cwd: root });
    return result.stdout || '';
  } catch (error) {
    // `find` meldet gesperrte Unterordner mit Exit-Code 1, liefert aber trotzdem Treffer.
    const stdout = error?.stdout || '';
    if (!stdout && error?.killed) {
      throw Object.assign(new Error('Indexierung der Bibliothek hat zu lange gedauert.'), {
        status: 504,
      });
    }
    return stdout;
  }
}

function relativeParts(line) {
  if (!line.startsWith('./')) return null;
  const parts = parseRelative(line.slice(2));
  if (parts.length === 0) return null;
  // Versteckte Ordner/Dateien (z. B. .preview-cache, .git) nie indexieren.
  if (parts.some((part) => part.startsWith('.'))) return null;
  return parts;
}

/** Volle Bibliotheksliste per `find` (Dateien + Ordner), ohne versteckte Pfade. */
export async function buildFileIndex(root) {
  const byKind = Object.fromEntries(FILE_KINDS.map((k) => [k, []]));
  const patterns = [
    ...['stl', '3mf', 'f3d', 'pdf', 'mp4'],
    ...IMAGE_EXTENSIONS.map((e) => e.slice(1)),
  ].flatMap((ext, i) => (i === 0 ? ['-iname', `*.${ext}`] : ['-o', '-iname', `*.${ext}`]));

  const toRows = (out) =>
    out
      .split('\n')
      .map((line) => relativeParts(line.trim()))
      .filter(Boolean)
      .map((parts) => ({ absolute: path.join(root, ...parts), parts }));

  const fileRows = toRows(
    await runFind(root, ['-not', '-path', '*/.*', '-type', 'f', '(', ...patterns, ')', '-print']),
  );

  const files = await mapLimit(fileRows, 32, async ({ absolute, parts }) => {
    const kind = extensionToKind(path.extname(parts[parts.length - 1]));
    if (!kind) return null;
    const st = await safeStat(absolute);
    if (!st) return null;
    const parent = parentInfo(parts);
    const rel = toRelative(parts);
    return {
      id: rel,
      name: parts[parts.length - 1],
      type: 'file',
      relativePath: rel,
      parentPath: parent.parentPath,
      parentLabel: parent.parentLabel,
      kind,
      kinds: [kind],
      size: st.size,
      childCount: null,
      updatedAt: new Date(st.mtimeMs).toISOString(),
    };
  });
  for (const file of files) {
    if (file) byKind[file.kind].push(file);
  }

  const dirRows = toRows(await runFind(root, ['-type', 'd', '-not', '-path', '*/.*', '-print']));

  const folders = (
    await mapLimit(dirRows, 32, async ({ absolute, parts }) => {
      const st = await safeStat(absolute);
      if (!st) return null;
      const parent = parentInfo(parts);
      const rel = toRelative(parts);
      return {
        id: rel,
        name: parts[parts.length - 1],
        type: 'folder',
        relativePath: rel,
        parentPath: parent.parentPath,
        parentLabel: parent.parentLabel,
        kind: null,
        kinds: [],
        size: null,
        childCount: null,
        updatedAt: new Date(st.mtimeMs).toISOString(),
      };
    })
  ).filter(Boolean);

  return { root, byKind, folders, builtAt: Date.now() };
}

export function matchesWordPrefix(text, query) {
  if (!text || !query) return false;
  const words = String(text)
    .toLowerCase()
    .split(/[^a-z0-9äöüáéíóúàèìòùâêîôûãõçß]+/i);
  return words.some((word) => word.length > 0 && word.startsWith(query));
}

function signatureOf(entries) {
  return createHash('sha1')
    .update(
      entries
        .map((item) => `${item.relativePath}:${item.updatedAt}:${item.size}:${item.url || ''}:${item.rating || ''}`)
        .join('|'),
    )
    .digest('hex');
}

function sortEntries(entries, sort) {
  const folderFirst = (a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return 0;
  };
  if (sort === 'path') {
    entries.sort(
      (a, b) =>
        (a.parentPath || '').localeCompare(b.parentPath || '', 'de') ||
        folderFirst(a, b) ||
        a.name.localeCompare(b.name, 'de'),
    );
  } else {
    entries.sort((a, b) => folderFirst(a, b) || a.name.localeCompare(b.name, 'de'));
  }
  return entries;
}

/** Index mit Cache; wird vom Watcher bei Dateisystemänderungen invalidiert. */
export class FileIndex {
  #index = null;
  #pending = null;
  #generation = 0;

  invalidate() {
    this.#index = null;
    this.#pending = null;
    this.#generation += 1;
  }

  async ensure(root) {
    const idx = this.#index;
    if (idx && idx.root === root && Date.now() - idx.builtAt < INDEX_TTL_MS) return idx;
    if (this.#pending) return this.#pending;
    const generation = this.#generation;
    const pending = buildFileIndex(root).then((built) => {
      if (generation === this.#generation) this.#index = built;
      return built;
    });
    this.#pending = pending;
    void pending.finally(() => {
      if (this.#pending === pending) this.#pending = null;
    }).catch(() => {});
    return pending;
  }

  static withRatings(entries, meta) {
    return entries.map((entry) => ({ ...entry, rating: ratingOf(meta, entry.relativePath) }));
  }

  async searchByKind(root, kind, sort, meta) {
    let entries;
    if (kind === 'link') {
      entries = (await readLinks(root)).map((link) => toLinkEntry(link, ratingOf(meta, `link/${link.id}`)));
    } else {
      const index = await this.ensure(root);
      entries = FileIndex.withRatings(index.byKind[kind] || [], meta);
    }
    sortEntries(entries, sort);
    return { entries, signature: signatureOf(entries), kind, sort };
  }

  async searchByQuery(root, query, sort, meta) {
    const normalized = String(query || '').trim().toLowerCase();
    const index = await this.ensure(root);
    const links = (await readLinks(root)).map((link) => toLinkEntry(link, ratingOf(meta, `link/${link.id}`)));
    const pool = [...index.folders, ...Object.values(index.byKind).flat()];
    const entries = [
      ...FileIndex.withRatings(pool, meta),
      ...links,
    ].filter(
      (item) =>
        matchesWordPrefix(item.name, normalized) ||
        matchesWordPrefix(item.parentLabel || '', normalized) ||
        matchesWordPrefix(String(item.parentPath || '').replaceAll('/', ' '), normalized),
    );
    sortEntries(entries, sort);
    return { entries, signature: signatureOf(entries), query: normalized, sort };
  }

  /** Alle bewerteten Einträge mit Mindestbewertung (über Meta-Datei, nur existierende). */
  async rated(root, minRating, meta) {
    const index = await this.ensure(root);
    const links = (await readLinks(root)).map((link) => toLinkEntry(link, ratingOf(meta, `link/${link.id}`)));
    const pool = [...index.folders, ...Object.values(index.byKind).flat()];
    const entries = [...FileIndex.withRatings(pool, meta), ...links].filter(
      (entry) => (entry.rating ?? 0) >= minRating,
    );
    entries.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name, 'de'));
    return { entries, signature: signatureOf(entries), sort: 'name' };
  }

  /** Zuletzt geänderte Dateien (ohne Ordner). */
  async recent(root, limit, meta) {
    const index = await this.ensure(root);
    const files = Object.values(index.byKind).flat();
    const entries = FileIndex.withRatings(
      [...files].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit),
      meta,
    );
    return { entries, signature: signatureOf(entries), sort: 'name' };
  }

  /** Anzahl je Typ für die Seitenleiste. */
  async stats(root) {
    const index = await this.ensure(root);
    const counts = Object.fromEntries(FILE_KINDS.map((k) => [k, index.byKind[k]?.length ?? 0]));
    counts.link = (await readLinks(root)).length;
    return counts;
  }
}
