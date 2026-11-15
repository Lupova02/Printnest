import { LibraryEntry } from '../../core/services/library.service';
import { nextPreviewIndex, previewDirectionForKey, previewPosition } from './preview-navigation';

function file(name: string): LibraryEntry {
  return { id: name, name, type: 'file', relativePath: name, kind: 'stl', kinds: ['stl'], size: 1, childCount: null, updatedAt: null };
}
function folder(name: string): LibraryEntry {
  return { id: name, name, type: 'folder', relativePath: name, kind: null, kinds: [], size: null, childCount: 0, updatedAt: null };
}
function link(name: string): LibraryEntry {
  return { id: `link/${name}`, name, type: 'link', relativePath: `link/${name}`, kind: 'link', kinds: ['link'], size: null, childCount: null, updatedAt: null };
}

describe('Quick-Look-Navigation', () => {
  it('Liste: ↑/↓ blättern zur vorherigen/nächsten Datei', () => {
    expect(previewDirectionForKey('ArrowDown', 'list')).toBe('next');
    expect(previewDirectionForKey('ArrowUp', 'list')).toBe('prev');
    expect(previewDirectionForKey('ArrowRight', 'list')).toBe('next');
    expect(previewDirectionForKey(' ', 'list')).toBeNull();
    const entries = [file('a'), file('b'), file('c')];
    expect(nextPreviewIndex(entries, 1, 'next')).toBe(2);
    expect(nextPreviewIndex(entries, 1, 'prev')).toBe(0);
    expect(nextPreviewIndex(entries, 2, 'next')).toBe(-1);
  });

  it('überspringt Ordner und Links', () => {
    const entries = [folder('F'), file('a'), link('L'), folder('G'), file('b')];
    expect(nextPreviewIndex(entries, 1, 'next')).toBe(4);
    expect(nextPreviewIndex(entries, 4, 'prev')).toBe(1);
    expect(nextPreviewIndex(entries, 1, 'prev')).toBe(-1);
    expect(previewPosition(entries, 'b')).toEqual({ index: 1, total: 2 });
  });

  it('Raster: ←/→ einzeln, ↑/↓ zeilenweise mit Spaltenzahl', () => {
    expect(previewDirectionForKey('ArrowUp', 'grid')).toBe('up');
    expect(previewDirectionForKey('ArrowDown', 'grid')).toBe('down');
    const entries = Array.from({ length: 12 }, (_, i) => file(`f${i}`));
    expect(nextPreviewIndex(entries, 5, 'down', 4)).toBe(9);
    expect(nextPreviewIndex(entries, 5, 'up', 4)).toBe(1);
    expect(nextPreviewIndex(entries, 1, 'up', 4)).toBe(-1);
    expect(nextPreviewIndex(entries, 5, 'next', 4)).toBe(6);
  });

  it('Raster: liegt unter der Datei ein Ordner, wird in Richtung weitergesucht', () => {
    const entries = [file('a'), file('b'), file('c'), folder('F'), file('d'), file('e')];
    expect(nextPreviewIndex(entries, 0, 'down', 3)).toBe(4);
  });
});
