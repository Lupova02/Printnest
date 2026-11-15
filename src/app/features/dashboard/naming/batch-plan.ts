import { BatchOp, LibraryEntry } from '../../../core/services/library.service';

/** Eine Zeile der Stapelumbenennung (vorher → nachher). */
export interface BatchRow {
  entry: LibraryEntry;
  before: string;
  after: string;
  include: boolean;
}

/**
 * Konflikte finden (ohne Groß-/Kleinschreibung): doppelte Zielnamen im Stapel und Namen, die
 * im Ordner schon existieren und nicht selbst umbenannt werden. Liefert Grund je Eintrags-ID.
 */
export function detectConflicts(rows: BatchRow[], siblings: LibraryEntry[]): Map<string, string> {
  const conflicts = new Map<string, string>();
  const active = rows.filter((r) => r.include && r.after.trim() && r.after !== r.before);
  const movingAway = new Set(active.map((r) => `${r.entry.parentPath ?? ''}/${r.before}`.toLowerCase()));
  const existing = new Set(
    siblings.filter((s) => s.type !== 'link').map((s) => `${s.parentPath ?? ''}/${s.name}`.toLowerCase()),
  );
  const targets = new Map<string, string>();
  for (const row of rows.filter((r) => r.include)) {
    const name = row.after.trim();
    if (!name) {
      conflicts.set(row.entry.id, 'Name darf nicht leer sein.');
      continue;
    }
    if (/[/\\:]/.test(name)) {
      conflicts.set(row.entry.id, 'Name enthält unzulässige Zeichen (/ \\ :).');
      continue;
    }
    if (row.entry.type === 'link') continue;
    const key = `${row.entry.parentPath ?? ''}/${name}`.toLowerCase();
    const other = targets.get(key);
    if (other) {
      conflicts.set(row.entry.id, 'Gleicher Zielname wie ein anderer Eintrag.');
      conflicts.set(other, 'Gleicher Zielname wie ein anderer Eintrag.');
    }
    targets.set(key, row.entry.id);
    const ownKey = `${row.entry.parentPath ?? ''}/${row.before}`.toLowerCase();
    if (key !== ownKey && existing.has(key) && !movingAway.has(key)) {
      conflicts.set(row.entry.id, 'Ein Eintrag mit diesem Namen existiert bereits.');
    }
  }
  return conflicts;
}

/** Nur tatsächlich geänderte, eingeschlossene Zeilen als Stapel-Operationen. */
export function rowsToOps(rows: BatchRow[]): BatchOp[] {
  return rows
    .filter((r) => r.include && r.after.trim() && r.after.trim() !== r.before)
    .map((r) => ({ path: r.entry.relativePath, name: r.after.trim() }));
}
