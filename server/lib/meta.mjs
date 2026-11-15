import path from 'node:path';
import { readJson, withFileLock, writeJsonAtomic } from './json-file.mjs';
import { isSameOrInside, remapPath } from './paths.mjs';

/** Bewertungen/Notizen liegen im Bibliotheksroot und wandern mit der Bibliothek. */
export const META_FILE = '.printnest-meta.json';
export const NOTE_MAX_LENGTH = 500;

export function metaFilePath(root) {
  return path.join(root, META_FILE);
}

function emptyMeta() {
  return { version: 1, entries: {} };
}

export async function readMeta(root) {
  const parsed = await readJson(metaFilePath(root), emptyMeta());
  const entries =
    parsed && typeof parsed.entries === 'object' && parsed.entries !== null ? parsed.entries : {};
  return { version: 1, entries };
}

/** Meta lesen, ändern (fn liefert true bei Änderung) und atomar zurückschreiben. */
export function updateMeta(root, fn) {
  return withFileLock(metaFilePath(root), async () => {
    const meta = await readMeta(root);
    const result = await fn(meta);
    const changed = typeof result === 'object' && result !== null ? result.changed : result;
    if (changed) await writeJsonAtomic(metaFilePath(root), meta);
    return result;
  });
}

/** Schlüssel nach Umbenennen/Verschieben (Datei oder Ordner inkl. Unterpfade) mitziehen. */
export function remapMetaKeys(meta, from, to) {
  if (!from || from === to) return false;
  let changed = false;
  for (const key of Object.keys(meta.entries)) {
    const next = remapPath(key, from, to);
    if (next === null) continue;
    meta.entries[next] = meta.entries[key];
    delete meta.entries[key];
    changed = true;
  }
  return changed;
}

/** Schlüssel des gelöschten Eintrags (und bei Ordnern aller Unterpfade) entfernen. */
export function removeMetaKeys(meta, prefix) {
  let changed = false;
  for (const key of Object.keys(meta.entries)) {
    if (!isSameOrInside(key, prefix)) continue;
    delete meta.entries[key];
    changed = true;
  }
  return changed;
}

export function ratingOf(meta, rel) {
  const rating = meta.entries[rel]?.rating;
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

/**
 * Eingabe für PUT /api/meta prüfen. Felder sind optional; nur übergebene werden geändert.
 * rating: 0–5 (0 = entfernen), note: max. 500 Zeichen, printedAt: YYYY-MM-DD oder leer.
 */
export function validateMetaInput(body) {
  const input = body ?? {};
  const patch = {};
  if ('rating' in input) {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      throw Object.assign(new Error('Bewertung muss zwischen 0 und 5 liegen.'), { status: 400 });
    }
    patch.rating = rating;
  }
  if ('note' in input) {
    const note = input.note == null ? '' : String(input.note).trim();
    if (note.length > NOTE_MAX_LENGTH) {
      throw Object.assign(new Error(`Notiz darf höchstens ${NOTE_MAX_LENGTH} Zeichen haben.`), {
        status: 400,
      });
    }
    patch.note = note;
  }
  if ('printedAt' in input) {
    const printedAt = input.printedAt == null ? '' : String(input.printedAt).trim();
    if (printedAt && !/^\d{4}-\d{2}-\d{2}$/.test(printedAt)) {
      throw Object.assign(new Error('Druckdatum im Format JJJJ-MM-TT angeben.'), { status: 400 });
    }
    patch.printedAt = printedAt;
  }
  return patch;
}

/** Patch auf einen Eintrag anwenden; leere Einträge werden gelöscht. Liefert den neuen Stand. */
export function applyMetaPatch(meta, rel, patch, now = new Date().toISOString()) {
  const current = { ...(meta.entries[rel] ?? {}) };
  if ('rating' in patch) {
    if (patch.rating === 0) delete current.rating;
    else current.rating = patch.rating;
  }
  if ('note' in patch) {
    if (patch.note) current.note = patch.note;
    else delete current.note;
  }
  if ('printedAt' in patch) {
    if (patch.printedAt) current.printedAt = patch.printedAt;
    else delete current.printedAt;
  }
  const hasContent = current.rating || current.note || current.printedAt;
  if (!hasContent) {
    delete meta.entries[rel];
    return null;
  }
  current.updatedAt = now;
  meta.entries[rel] = current;
  return current;
}
