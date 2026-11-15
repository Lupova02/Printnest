/**
 * Reine Berechnungen für die Virtualisierung von Liste und Raster
 * (getrennt von der Komponente, damit sie ohne Layout-Engine testbar sind).
 */

export const LIST_ROW_HEIGHT = 48;
/** Dreizeilige Zeilen (mit Herkunftsordner in Suche/Filtern). */
export const LIST_ROW_HEIGHT_ORIGIN = 64;
export const LIST_BREAK_GAP = 14;
export const GRID_MIN_CARD = 176;
export const GRID_GAP = 14;
/** Zusätzlich gerenderte Zeilen über/unter dem Sichtbereich. */
export const OVERSCAN_ROWS = { list: 8, grid: 2 } as const;

/** Spaltenzahl des Rasters für eine Containerbreite (entspricht `repeat(auto-fill, minmax(176px, 1fr))`). */
export function gridColumns(width: number): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_CARD + GRID_GAP)));
}

/** Feste Textzone unter dem Kartenbild (Name, Typ, Sterne; mit Herkunftsordner höher). */
export const CARD_INFO_HEIGHT = 74;
export const CARD_INFO_HEIGHT_ORIGIN = 92;

/** Kartenhöhe: Bild 4:3 + feste Textzone – wird als `grid-auto-rows` gesetzt, damit Rechnung und Layout übereinstimmen. */
export function cardHeight(width: number, columns: number, withOrigin = false): number {
  const cardWidth = (Math.max(width, GRID_MIN_CARD) - GRID_GAP * (columns - 1)) / columns;
  return Math.round(cardWidth * 0.75 + (withOrigin ? CARD_INFO_HEIGHT_ORIGIN : CARD_INFO_HEIGHT));
}

/** Startpositionen aller Zeilen (Prefix-Summe) inkl. Gesamthöhe als letztes Element. */
export function rowOffsets(rowHeights: number[]): number[] {
  const offsets = new Array<number>(rowHeights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < rowHeights.length; i++) offsets[i + 1] = offsets[i] + rowHeights[i];
  return offsets;
}

/** Erste Zeile, deren Unterkante unterhalb von `y` liegt (binäre Suche). */
export function rowAt(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sichtbarer Zeilenbereich [start, end) inkl. Puffer. */
export function visibleRows(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  const rows = offsets.length - 1;
  if (rows <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = rowAt(offsets, top);
  const last = rowAt(offsets, top + Math.max(viewportHeight, 1));
  return { start: Math.max(0, first - overscan), end: Math.min(rows, last + 1 + overscan) };
}

/** Neue scrollTop, damit eine Zeile ganz sichtbar ist („nearest“); null = schon sichtbar. */
export function scrollToReveal(
  rowTop: number,
  rowBottom: number,
  scrollTop: number,
  viewportHeight: number,
  margin = 8,
): number | null {
  if (rowTop - margin < scrollTop) return Math.max(0, rowTop - margin);
  if (rowBottom + margin > scrollTop + viewportHeight) return rowBottom + margin - viewportHeight;
  return null;
}
