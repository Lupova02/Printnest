import { LibraryEntry } from '../../core/services/library.service';
import { canOpenInSlicer, filterAndSortEntries, formatSize, kindLabel } from './dashboard.utils';

function entry(partial: Partial<LibraryEntry> & { name: string }): LibraryEntry {
  return {
    id: partial.name,
    type: 'file',
    relativePath: partial.name,
    kind: 'stl',
    kinds: ['stl'],
    size: 10,
    childCount: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    rating: null,
    ...partial,
  };
}

const sample = [
  entry({ name: 'b.stl', rating: 3, updatedAt: '2026-03-01T00:00:00.000Z' }),
  entry({ name: 'a.stl', rating: 5, updatedAt: '2026-01-01T00:00:00.000Z' }),
  entry({ name: 'Ordner', type: 'folder', kind: null, kinds: [], rating: 4 }),
  entry({ name: 'c 10.3mf', kind: '3mf', updatedAt: '2026-05-01T00:00:00.000Z' }),
  entry({ name: 'c 9.3mf', kind: '3mf' }),
];

describe('filterAndSortEntries', () => {
  it('sortiert nach Name mit Ordnern zuerst und natürlicher Zahlenfolge', () => {
    const names = filterAndSortEntries(sample, { sort: 'name' }).map((e) => e.name);
    expect(names).toEqual(['Ordner', 'a.stl', 'b.stl', 'c 9.3mf', 'c 10.3mf']);
  });

  it('filtert nach Mindestbewertung', () => {
    const names = filterAndSortEntries(sample, { sort: 'name', minRating: 4 }).map((e) => e.name);
    expect(names).toEqual(['Ordner', 'a.stl']);
  });

  it('sortiert nach Bewertung absteigend', () => {
    const names = filterAndSortEntries(sample, { sort: 'rating' }).map((e) => e.name);
    expect(names.slice(0, 3)).toEqual(['a.stl', 'Ordner', 'b.stl']);
  });

  it('sortiert nach Änderungsdatum (neueste zuerst, Ordner oben)', () => {
    const names = filterAndSortEntries(sample, { sort: 'date' }).map((e) => e.name);
    expect(names).toEqual(['Ordner', 'c 10.3mf', 'b.stl', 'a.stl', 'c 9.3mf']);
  });

  it('filtert per Wortpräfix, außer die Suche lief schon serverseitig', () => {
    expect(filterAndSortEntries(sample, { sort: 'name', query: 'c' }).map((e) => e.name)).toEqual([
      'c 9.3mf',
      'c 10.3mf',
    ]);
    expect(filterAndSortEntries(sample, { sort: 'name', query: 'zzz', skipClientFilter: true })).toHaveLength(5);
  });
});

describe('Hilfsfunktionen', () => {
  it('formatiert Größen deutsch', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5,0 MB');
    expect(formatSize(null)).toBe('');
  });

  it('erkennt Slicer-Dateien', () => {
    expect(canOpenInSlicer(entry({ name: 'x.STL' }))).toBe(true);
    expect(canOpenInSlicer(entry({ name: 'x.step', kind: null, kinds: [] }))).toBe(true);
    expect(canOpenInSlicer(entry({ name: 'x.pdf', kind: 'pdf' }))).toBe(false);
    expect(canOpenInSlicer(entry({ name: 'Ordner.stl', type: 'folder' }))).toBe(false);
  });

  it('liefert Typbezeichnungen', () => {
    expect(kindLabel(entry({ name: 'x.stl' }))).toBe('STL');
    expect(kindLabel(entry({ name: 'x.mp4', kind: 'mp4' }))).toBe('Video');
    expect(kindLabel(entry({ name: 'x', type: 'link', kind: 'link' }))).toBe('Link');
  });
});
