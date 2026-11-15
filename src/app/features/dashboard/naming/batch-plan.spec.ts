import { LibraryEntry } from '../../../core/services/library.service';
import { BatchRow, detectConflicts, rowsToOps } from './batch-plan';

function file(name: string): LibraryEntry {
  return { id: `P/${name}`, name, type: 'file', relativePath: `P/${name}`, parentPath: 'P', kind: 'stl', kinds: ['stl'], size: 1, childCount: null, updatedAt: null };
}
const row = (entry: LibraryEntry, after: string, include = true): BatchRow => ({ entry, before: entry.name, after, include });

describe('Stapelumbenennung – Konflikte', () => {
  const a = file('a.stl');
  const b = file('b.stl');
  const c = file('c.stl');
  const siblings = [a, b, c];

  it('erkennt doppelte Ziele (ohne Groß-/Kleinschreibung)', () => {
    const conflicts = detectConflicts([row(a, 'X.stl'), row(b, 'x.STL')], siblings);
    expect(conflicts.size).toBe(2);
  });

  it('erkennt bestehende Namen, erlaubt aber Tauschen innerhalb des Stapels', () => {
    expect(detectConflicts([row(a, 'c.stl')], siblings).get(a.id)).toContain('existiert');
    expect(detectConflicts([row(a, 'b.stl'), row(b, 'a.stl')], siblings).size).toBe(0);
  });

  it('meldet leere/unzulässige Namen und ignoriert ausgeschlossene Zeilen', () => {
    expect(detectConflicts([row(a, '  ')], siblings).size).toBe(1);
    expect(detectConflicts([row(a, 'a/b.stl')], siblings).size).toBe(1);
    expect(detectConflicts([row(a, 'c.stl', false)], siblings).size).toBe(0);
  });

  it('erzeugt nur Operationen für geänderte, eingeschlossene Zeilen', () => {
    expect(rowsToOps([row(a, 'a.stl'), row(b, 'B neu.stl'), row(c, 'x.stl', false)])).toEqual([{ path: 'P/b.stl', name: 'B neu.stl' }]);
  });
});
