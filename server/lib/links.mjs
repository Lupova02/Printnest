import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, withFileLock, writeJsonAtomic } from './json-file.mjs';
import { normalizeUrl } from './link-meta.mjs';
import { isSameOrInside, parentInfo, parseRelative, remapPath } from './paths.mjs';

export const LINKS_FILE = '.printnest-links.json';

export function linksFilePath(root) {
  return path.join(root, LINKS_FILE);
}

export function isLinkPath(rel) {
  return String(rel).startsWith('link/');
}

export function linkIdFromPath(rel) {
  return String(rel).slice('link/'.length);
}

export function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function readLinks(root) {
  const parsed = await readJson(linksFilePath(root), { links: [] });
  return Array.isArray(parsed?.links) ? parsed.links : [];
}

export async function writeLinks(root, links) {
  await writeJsonAtomic(linksFilePath(root), { links });
}

/** Links lesen, ändern (fn liefert true bei Änderung) und atomar zurückschreiben. */
export function updateLinks(root, fn) {
  return withFileLock(linksFilePath(root), async () => {
    const links = await readLinks(root);
    const result = await fn(links);
    if (result?.changed) await writeLinks(root, result.links ?? links);
    return result;
  });
}

/**
 * Aktualisiert parentPath von Links, wenn ein Ordner umbenannt/verschoben wurde.
 * Betrifft den Ordner selbst und alle Unterpfade.
 */
export function remapLinksForMovedFolder(links, fromPrefix, toPrefix) {
  if (!fromPrefix || fromPrefix === toPrefix) return false;
  let changed = false;
  const now = new Date().toISOString();
  for (const link of links) {
    const nextParent = remapPath(link.parentPath || '', fromPrefix, toPrefix);
    if (nextParent === null) continue;
    link.parentPath = nextParent;
    link.updatedAt = now;
    changed = true;
  }
  return changed;
}

/** Links entfernen, die im gelöschten Ordner (oder darunter) lagen. */
export function removeLinksUnder(links, prefix) {
  return links.filter((link) => !isSameOrInside(link.parentPath || '', prefix));
}

/** Zusatzdaten eines Links für die UI (ohne Bild-URL – das Bild kommt über /api/link-image). */
export function linkMetaOf(link) {
  if (!link.portal && !link.title && !link.creator && !link.status && !link.image) return null;
  return {
    portal: link.portal ?? null,
    portalLabel: link.portalLabel ?? null,
    creator: link.creator ?? null,
    title: link.title ?? null,
    description: link.description ?? null,
    hasImage: !!link.image,
    status: link.status ?? null,
    httpStatus: link.httpStatus ?? null,
    checkedAt: link.checkedAt ?? null,
  };
}

/** Links mit gleicher normalisierter URL (Duplikate) finden. */
export function findDuplicateLinks(links, normalized, excludeId = null) {
  if (!normalized) return [];
  return links.filter((l) => l.id !== excludeId && normalizeUrl(l.url) === normalized);
}

export function toLinkEntry(link, rating = null) {
  const parentParts = parseRelative(link.parentPath || '');
  const parent = parentInfo([...parentParts, link.name || 'link']);
  return {
    id: `link/${link.id}`,
    name: link.name,
    type: 'link',
    relativePath: `link/${link.id}`,
    parentPath: link.parentPath || '',
    parentLabel: parent.parentLabel,
    kind: 'link',
    kinds: ['link'],
    url: link.url,
    size: null,
    childCount: null,
    updatedAt: link.updatedAt || link.createdAt || null,
    rating,
    linkMeta: linkMetaOf(link),
  };
}

/** Seed-Links (z. B. aus Electron) in die Bibliothek mergen, ohne bestehende zu überschreiben. */
export async function ensureSeedLinks(root, seedLinksPath) {
  if (!root || !seedLinksPath) return { added: 0 };
  let seedLinks = [];
  try {
    const parsed = JSON.parse(await fs.readFile(seedLinksPath, 'utf8'));
    seedLinks = Array.isArray(parsed.links) ? parsed.links : [];
  } catch {
    return { added: 0 };
  }
  if (!seedLinks.length) return { added: 0 };

  const result = await updateLinks(root, (links) => {
    const byId = new Set(links.map((l) => l.id));
    const byUrlParent = new Set(links.map((l) => `${l.url}||${l.parentPath || ''}`));
    let added = 0;
    const now = new Date().toISOString();
    for (const seed of seedLinks) {
      if (!seed?.id || !seed?.name || !seed?.url) continue;
      const key = `${seed.url}||${seed.parentPath || ''}`;
      if (byId.has(seed.id) || byUrlParent.has(key)) continue;
      links.push({
        id: seed.id,
        name: seed.name,
        url: seed.url,
        parentPath: seed.parentPath || '',
        createdAt: seed.createdAt || now,
        updatedAt: seed.updatedAt || now,
      });
      byId.add(seed.id);
      byUrlParent.add(key);
      added += 1;
    }
    return { changed: added > 0, added };
  });
  return { added: result?.added ?? 0 };
}
