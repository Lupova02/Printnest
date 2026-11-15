import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isSafeName,
  numberedName,
  parseRelative,
  remapPath,
  resolveInsideRoot,
  resolveRelative,
  sanitizeFileName,
  uniqueName,
} from '../lib/paths.mjs';

describe('isSafeName', () => {
  it('erlaubt normale Namen und Punkte im Namen', () => {
    expect(isSafeName('Würfel.stl')).toBe(true);
    expect(isSafeName('v1..2.stl')).toBe(true);
    expect(isSafeName('...test')).toBe(true);
    expect(isSafeName('Benchy (2).3mf')).toBe(true);
  });

  it('verbietet leere Namen, . / .. und Pfadtrenner', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a\u0000b', 'x'.repeat(181)]) {
      expect(isSafeName(bad), bad).toBe(false);
    }
    expect(isSafeName(42)).toBe(false);
  });
});

describe('Pfadauflösung', () => {
  const root = path.resolve('/tmp/printnest-lib');

  it('entfernt . und .. Segmente (kein Path-Traversal)', () => {
    expect(parseRelative('../../etc/passwd')).toEqual(['etc', 'passwd']);
    expect(parseRelative('a/./b/../c')).toEqual(['a', 'b', 'c']);
    expect(parseRelative('a\\b')).toEqual(['a', 'b']);
    expect(resolveRelative(root, '../../etc').absolutePath).toBe(path.join(root, 'etc'));
  });

  it('lehnt Ziele außerhalb der Bibliothek ab', () => {
    expect(() => resolveInsideRoot(root, ['..', 'x'])).toThrow(/außerhalb/);
    expect(() => resolveInsideRoot(root, ['/etc'])).toThrow(/außerhalb/);
    expect(resolveInsideRoot(root, [])).toBe(root);
  });

  it('schreibt Pfade beim Verschieben um', () => {
    expect(remapPath('A/B/c.stl', 'A/B', 'X')).toBe('X/c.stl');
    expect(remapPath('A/B', 'A/B', 'X/B')).toBe('X/B');
    expect(remapPath('A/BC/c.stl', 'A/B', 'X')).toBeNull();
  });
});

describe('Namenskonflikte', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pn-names-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('nummeriert vor der Endung', () => {
    expect(numberedName('teil.stl', 2)).toBe('teil (2).stl');
    expect(numberedName('Ordner', 3)).toBe('Ordner (3)');
    expect(numberedName('.hidden', 2)).toBe('.hidden (2)');
  });

  it('vergibt freie Namen und reserviert innerhalb eines Requests', async () => {
    await fs.writeFile(path.join(dir, 'teil.stl'), 'x');
    await fs.writeFile(path.join(dir, 'teil (2).stl'), 'x');
    const reserved = new Set();
    expect(await uniqueName(dir, 'teil.stl', reserved)).toBe('teil (3).stl');
    expect(await uniqueName(dir, 'teil.stl', reserved)).toBe('teil (4).stl');
    expect(await uniqueName(dir, 'neu.stl', reserved)).toBe('neu.stl');
  });

  it('bereinigt Upload-Namen', () => {
    expect(sanitizeFileName('../../böse:name.stl')).toBe('böse_name.stl');
    expect(sanitizeFileName('..')).toBe('Datei');
    expect(sanitizeFileName('C:\\Users\\x\\teil.3mf')).toBe('teil.3mf');
  });
});
