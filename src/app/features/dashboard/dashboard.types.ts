import { FileKind } from '../../core/services/library.service';

/** Aktiver Typfilter inkl. „Alle“. */
export type FilterId = 'all' | FileKind;

/** Sortierung in der Oberfläche. */
export type ViewSort = 'name' | 'path' | 'rating' | 'date';

/** Darstellung des Hauptbereichs. */
export type ViewLayout = 'list' | 'grid';

/** Was der Hauptbereich gerade zeigt. */
export type LibraryView =
  | { type: 'folder'; path: string }
  | { type: 'kind'; kind: FileKind }
  | { type: 'search'; query: string }
  | { type: 'rated' }
  | { type: 'recent' };

/** Ein Eintrag in der Typfilterliste der Seitenleiste. */
export interface KindOption {
  id: FileKind;
  label: string;
}

export const KIND_OPTIONS: KindOption[] = [
  { id: 'stl', label: 'STL' },
  { id: '3mf', label: '3MF' },
  { id: 'f3d', label: 'F3D' },
  { id: 'pdf', label: 'PDF' },
  { id: 'mp4', label: 'Videos' },
  { id: 'img', label: 'Bilder' },
  { id: 'link', label: 'Links' },
];

export const SORT_OPTIONS: { id: ViewSort; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'path', label: 'Ordner' },
  { id: 'date', label: 'Änderungsdatum' },
  { id: 'rating', label: 'Bewertung' },
];

/** Persistierter UI-Zustand (Server: ui-state.json im Datenordner). */
export interface UiState {
  lastPath: string;
  layout: ViewLayout;
  sort: ViewSort;
  minRating: number;
}
