import { LibraryEntry } from '../../core/services/library.service';
import { ViewLayout } from './dashboard.types';
import { canPreview } from './dashboard.utils';

/** Richtung beim Blättern in der offenen Vorschau. */
export type PreviewDirection = 'prev' | 'next' | 'up' | 'down';

/**
 * Pfeiltaste → Richtung (Quick Look wie im Finder).
 * Liste: ↑/↓ (und ←/→) = vorherige/nächste Datei.
 * Raster: ←/→ = vorherige/nächste, ↑/↓ = Zeile darüber/darunter.
 */
export function previewDirectionForKey(key: string, layout: ViewLayout): PreviewDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'ArrowUp':
      return layout === 'grid' ? 'up' : 'prev';
    case 'ArrowDown':
      return layout === 'grid' ? 'down' : 'next';
    default:
      return null;
  }
}

/**
 * Index der nächsten Datei mit Vorschau in `entries` (Reihenfolge wie angezeigt) oder -1.
 * Ordner und Links werden übersprungen. Im Raster springt ↑/↓ um `columns`; liegt dort
 * keine Datei mit Vorschau, wird in derselben Richtung weitergesucht.
 */
export function nextPreviewIndex(
  entries: LibraryEntry[],
  current: number,
  direction: PreviewDirection,
  columns = 1,
): number {
  if (current < 0 || current >= entries.length) return -1;
  const step = direction === 'prev' || direction === 'up' ? -1 : 1;
  let index = direction === 'up' || direction === 'down' ? current + step * Math.max(1, columns) : current + step;
  while (index >= 0 && index < entries.length) {
    if (canPreview(entries[index])) return index;
    index += step;
  }
  return -1;
}

/** Position „n von m“ unter den Dateien mit Vorschau. */
export function previewPosition(entries: LibraryEntry[], id: string): { index: number; total: number } {
  let index = -1;
  let total = 0;
  for (const entry of entries) {
    if (!canPreview(entry)) continue;
    if (entry.id === id) index = total;
    total += 1;
  }
  return { index, total };
}
