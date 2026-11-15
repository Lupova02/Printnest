import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { remapLinksForMovedFolder, removeLinksUnder } from '../lib/links.mjs';
import {
  META_FILE,
  applyMetaPatch,
  readMeta,
  remapMetaKeys,
  removeMetaKeys,
  updateMeta,
  validateMetaInput,
} from '../lib/meta.mjs';

describe('Link-Remapping', () => {
  it('zieht parentPath für Ordner und Unterordner mit', () => {
    const links = [
      { id: '1', parentPath: 'A' },
      { id: '2', parentPath: 'A/B' },
      { id: '3', parentPath: 'AB' },
      { id: '4', parentPath: '' },
    ];
    expect(remapLinksForMovedFolder(links, 'A', 'X/A')).toBe(true);
    expect(links.map((l) => l.parentPath)).toEqual(['X/A', 'X/A/B', 'AB', '']);
    expect(remapLinksForMovedFolder(links, 'Z', 'Y')).toBe(false);
  });

  it('entfernt Links unterhalb eines gelöschten Ordners', () => {
    const links = [{ parentPath: 'A' }, { parentPath: 'A/B' }, { parentPath: 'AB' }];
    expect(removeLinksUnder(links, 'A')).toEqual([{ parentPath: 'AB' }]);
  });
});

describe('Meta-Remapping', () => {
  it('zieht Datei- und Ordnerschlüssel mit', () => {
    const meta = {
      entries: { 'A/x.stl': { rating: 5 }, 'A/B/y.stl': { rating: 3 }, 'AB/z.stl': { rating: 1 }, A: { rating: 4 } },
    };
    remapMetaKeys(meta, 'A', 'Neu');
    expect(Object.keys(meta.entries).sort()).toEqual(['AB/z.stl', 'Neu', 'Neu/B/y.stl', 'Neu/x.stl']);
    remapMetaKeys(meta, 'Neu/x.stl', 'Neu/x2.stl');
    expect(meta.entries['Neu/x2.stl']).toEqual({ rating: 5 });
  });

  it('entfernt Schlüssel beim Löschen', () => {
    const meta = { entries: { 'A/x.stl': {}, A: {}, 'AB/y.stl': {} } };
    expect(removeMetaKeys(meta, 'A')).toBe(true);
    expect(Object.keys(meta.entries)).toEqual(['AB/y.stl']);
  });

  it('validiert Eingaben', () => {
    expect(validateMetaInput({ rating: 4, note: ' PLA ', printedAt: '2026-11-10' })).toEqual({
      rating: 4,
      note: 'PLA',
      printedAt: '2026-11-10',
    });
    expect(() => validateMetaInput({ rating: 6 })).toThrow();
    expect(() => validateMetaInput({ rating: 2.5 })).toThrow();
    expect(() => validateMetaInput({ note: 'x'.repeat(501) })).toThrow();
    expect(() => validateMetaInput({ printedAt: '10.11.2026' })).toThrow();
  });

  it('rating 0 entfernt die Bewertung, leere Einträge verschwinden', () => {
    const meta = { entries: {} };
    applyMetaPatch(meta, 'a.stl', { rating: 3, note: 'gut' }, 'T1');
    expect(meta.entries['a.stl']).toEqual({ rating: 3, note: 'gut', updatedAt: 'T1' });
    applyMetaPatch(meta, 'a.stl', { rating: 0 }, 'T2');
    expect(meta.entries['a.stl']).toEqual({ note: 'gut', updatedAt: 'T2' });
    expect(applyMetaPatch(meta, 'a.stl', { note: '' })).toBeNull();
    expect(meta.entries).toEqual({});
  });
});

describe('Meta-Datei', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pn-meta-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('schreibt atomar und verliert bei parallelen Updates nichts', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateMeta(root, (meta) => {
          applyMetaPatch(meta, `f${i}.stl`, { rating: (i % 5) + 1 });
          return true;
        }),
      ),
    );
    const meta = await readMeta(root);
    expect(Object.keys(meta.entries)).toHaveLength(20);
    const files = await fs.readdir(root);
    expect(files).toEqual([META_FILE]);
    expect(JSON.parse(await fs.readFile(path.join(root, META_FILE), 'utf8')).version).toBe(1);
  });
});
