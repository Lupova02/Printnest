import { LibraryEntry, SLICER_EXTENSIONS, SlicerInfo } from '../../core/services/library.service';
import { ThemeId } from '../../core/services/theme.service';
import { LibraryView, ViewSort } from './dashboard.types';

/** Dateigröße lesbar formatieren (B / KB / MB / GB). */
export function formatSize(size: number | null): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
}

/**
 * Treffer, wenn irgendein Wort mit dem Suchbegriff beginnt
 * (z. B. „Kal“ → „Test Kalibration“).
 */
export function matchesWordPrefix(text: string, query: string): boolean {
  if (!text) return false;
  const words = text.toLowerCase().split(/[^a-z0-9äöüáéíóúàèìòùâêîôûãõçß]+/i);
  return words.some((word) => word.length > 0 && word.startsWith(query));
}

const byName = (a: LibraryEntry, b: LibraryEntry) =>
  a.name.localeCompare(b.name, 'de', { numeric: true });

const folderFirst = (a: LibraryEntry, b: LibraryEntry) => {
  if (a.type === 'folder' && b.type !== 'folder') return -1;
  if (a.type !== 'folder' && b.type === 'folder') return 1;
  return 0;
};

export interface EntryFilterOptions {
  query?: string;
  sort: ViewSort;
  /** Mindestbewertung (0 = alle). */
  minRating?: number;
  /** Suche lief serverseitig → nicht erneut filtern. */
  skipClientFilter?: boolean;
}

/** Einträge filtern (Wortpräfix, Bewertung) und sortieren. */
export function filterAndSortEntries(source: LibraryEntry[], options: EntryFilterOptions): LibraryEntry[] {
  const normalized = (options.query ?? '').trim().toLowerCase();
  const minRating = options.minRating ?? 0;

  const items = source.filter((item) => {
    if (minRating > 0 && (item.rating ?? 0) < minRating) return false;
    if (options.skipClientFilter || !normalized) return true;
    return (
      matchesWordPrefix(item.name, normalized) ||
      matchesWordPrefix(item.parentLabel ?? '', normalized) ||
      matchesWordPrefix((item.parentPath ?? '').replaceAll('/', ' '), normalized)
    );
  });

  const sorted = [...items];
  switch (options.sort) {
    case 'path':
      sorted.sort(
        (a, b) =>
          (a.parentPath ?? '').localeCompare(b.parentPath ?? '', 'de') ||
          folderFirst(a, b) ||
          (a.kind ?? '').localeCompare(b.kind ?? '', 'de') ||
          byName(a, b),
      );
      break;
    case 'rating':
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || folderFirst(a, b) || byName(a, b));
      break;
    case 'date':
      sorted.sort(
        (a, b) =>
          folderFirst(a, b) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || byName(a, b),
      );
      break;
    default:
      sorted.sort((a, b) => folderFirst(a, b) || byName(a, b));
  }
  return sorted;
}

/** Trennlinie zwischen Ordnergruppen bei Sortierung „Nach Ordner“. */
export function showsFolderBreak(items: LibraryEntry[], index: number, sort: ViewSort): boolean {
  if (sort !== 'path' || index <= 0) return false;
  const prev = items[index - 1];
  const curr = items[index];
  if (!prev || !curr) return false;
  return (prev.parentPath ?? '') !== (curr.parentPath ?? '');
}

export function isLinkEntry(entry: LibraryEntry): boolean {
  return entry.type === 'link' || entry.kind === 'link';
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Datei ist grundsätzlich ein Slicer-Format (STL, 3MF, OBJ, STEP …). */
export function canOpenInSlicer(entry: LibraryEntry): boolean {
  return entry.type === 'file' && SLICER_EXTENSIONS.includes(extensionOf(entry.name));
}

/** Der gewählte Slicer kann genau diese Datei öffnen (z. B. Resin-Slicer nur STL/OBJ). */
export function slicerSupports(slicer: SlicerInfo | null, entry: LibraryEntry): boolean {
  return !!slicer && canOpenInSlicer(entry) && slicer.extensions.includes(extensionOf(entry.name));
}

/** Datei hat eine eingebaute Vorschau (Quick Look). */
export function canPreview(entry: LibraryEntry): boolean {
  return entry.type === 'file' && !!entry.kind;
}

/** Videos bekommen keine Sterne und kein Druckdatum, nur eine Notiz. */
export function canRate(entry: LibraryEntry): boolean {
  return entry.kind !== 'mp4';
}

/** Kurzer Typname für Listen und Raster. */
export function kindLabel(entry: LibraryEntry): string {
  if (entry.type === 'folder') return 'Ordner';
  if (isLinkEntry(entry)) return 'Link';
  if (entry.kind === 'img') return extensionOf(entry.name).toUpperCase() || 'Bild';
  if (entry.kind === 'mp4') return 'Video';
  return entry.kind ? entry.kind.toUpperCase() : extensionOf(entry.name).toUpperCase() || 'Datei';
}

/**
 * Farbprofil der Ansicht: aktiver Typfilter → Typ-Theme, „Gut bewertet“ → Bewertung.
 * Ordner, Suche und gemischte Ansichten bleiben Blau (Home).
 */
export function themeForView(view: LibraryView): ThemeId {
  if (view.type === 'kind') return view.kind;
  if (view.type === 'rated') return 'rated';
  return 'home';
}
