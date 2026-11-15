import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { LibraryEntry } from '../../../core/services/library.service';
import { Icon } from '../../../shared/icon/icon';
import { StarRating } from '../../../shared/star-rating/star-rating';
import { ViewLayout, ViewSort } from '../dashboard.types';
import { canRate, formatSize, isLinkEntry, kindLabel, showsFolderBreak } from '../dashboard.utils';
import { EntryThumb } from '../entry-thumb/entry-thumb';
import {
  GRID_GAP,
  LIST_BREAK_GAP,
  LIST_ROW_HEIGHT,
  LIST_ROW_HEIGHT_ORIGIN,
  OVERSCAN_ROWS,
  cardHeight,
  gridColumns,
  rowOffsets,
  scrollToReveal,
  visibleRows,
} from './virtual-layout';

export const ENTRY_DRAG_TYPE = 'application/x-printnest-entry';

export interface EntryContextRequest {
  entry: LibraryEntry;
  x: number;
  y: number;
}

/** Auswahlart: ersetzen, umschalten (⌘-Klick) oder Bereich (⇧-Klick / ⇧-Pfeil). */
export type SelectionMode = 'replace' | 'toggle' | 'range';

export interface EntrySelection {
  entry: LibraryEntry;
  mode: SelectionMode;
}

/** Fallback-Höhe, solange der Scroll-Container noch nicht gemessen ist (z. B. in Tests). */
const FALLBACK_VIEWPORT = 800;

/**
 * Einträge als Liste oder Raster – virtualisiert: Nur sichtbare Zeilen plus kleiner Puffer
 * stehen im DOM, der Rest wird über Abstandshalter simuliert (Raster als Zeilen-Virtualisierung).
 * Auswahl per Klick/Pfeiltasten (Roving-Focus, ⌘/⇧ für Mehrfachauswahl), Doppelklick/↩ öffnet,
 * Rechtsklick öffnet das Kontextmenü, Ziehen auf einen Ordner verschiebt.
 */
@Component({
  selector: 'app-entry-list',
  imports: [DatePipe, EntryThumb, Icon, StarRating],
  templateUrl: './entry-list.html',
  styleUrl: './entry-list.scss',
})
export class EntryList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly entries = input.required<LibraryEntry[]>();
  readonly layout = input<ViewLayout>('list');
  readonly sort = input<ViewSort>('name');
  readonly selectedId = input<string | null>(null);
  /** Mehrfachauswahl (enthält immer auch `selectedId`). */
  readonly selectedIds = input<ReadonlySet<string>>(new Set());
  /** Herkunftsordner anzeigen (Suche, Typfilter, Bewertet …). */
  readonly showOrigin = input(false);
  /** Scroll-Container (Standard: nächstes `.content`-Element). */
  readonly scroller = input<HTMLElement | null>(null);

  readonly selectEntry = output<EntrySelection>();
  readonly openEntry = output<LibraryEntry>();
  readonly openParent = output<LibraryEntry>();
  readonly contextMenu = output<EntryContextRequest>();
  readonly rate = output<{ entry: LibraryEntry; rating: number }>();
  readonly dropOnFolder = output<{ entryId: string; destination: string }>();

  protected readonly formatSize = formatSize;
  protected readonly kindLabel = kindLabel;
  protected readonly isLink = isLinkEntry;
  protected readonly canRate = canRate;
  protected readonly dropTarget = signal<string | null>(null);
  /** Einblend-Animation nur direkt nach dem Laden, nicht beim Scrollen. */
  protected readonly animateIn = signal(true);
  private dragging: LibraryEntry | null = null;

  // --- Virtualisierung ---
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(0);
  private readonly width = signal(0);
  /** Abstand der Liste zur Oberkante des Scroll-Inhalts (Padding des Containers). */
  private listOffset = 0;
  private scrollEl: HTMLElement | null = null;
  private scrollFrame = 0;

  readonly columns = computed(() => (this.layout() === 'grid' ? gridColumns(this.width()) : 1));
  protected readonly cardHeight = computed(() => cardHeight(this.width(), this.columns(), this.showOrigin()));

  /** Zeilenhöhen: Liste je Eintrag (inkl. Ordner-Trenner), Raster je Kartenzeile. */
  private readonly offsets = computed(() => {
    const list = this.entries();
    if (this.layout() === 'grid') {
      const cols = this.columns();
      const rows = Math.ceil(list.length / cols);
      const height = this.cardHeight() + GRID_GAP;
      return rowOffsets(new Array(rows).fill(height));
    }
    const sort = this.sort();
    const origin = this.showOrigin();
    return rowOffsets(
      list.map((e, i) => {
        const base = origin && e.type !== 'folder' ? LIST_ROW_HEIGHT_ORIGIN : LIST_ROW_HEIGHT;
        return base + (showsFolderBreak(list, i, sort) ? LIST_BREAK_GAP : 0);
      }),
    );
  });

  protected readonly totalHeight = computed(() => {
    const offsets = this.offsets();
    return offsets[offsets.length - 1] ?? 0;
  });

  private readonly rowRange = computed(() =>
    visibleRows(
      this.offsets(),
      this.scrollTop() - this.listOffset,
      this.viewportHeight() || FALLBACK_VIEWPORT,
      OVERSCAN_ROWS[this.layout()],
    ),
  );

  /** Gerenderte Einträge mit ihrem Index in der Gesamtliste. */
  protected readonly windowItems = computed(() => {
    const { start, end } = this.rowRange();
    const cols = this.columns();
    const list = this.entries();
    const from = start * cols;
    const to = Math.min(list.length, end * cols);
    const items: { entry: LibraryEntry; index: number }[] = [];
    for (let i = from; i < to; i++) items.push({ entry: list[i], index: i });
    return items;
  });

  protected readonly windowOffset = computed(() => this.offsets()[this.rowRange().start] ?? 0);

  /** Fokussierbares Element: Auswahl oder erster Eintrag. */
  protected readonly focusId = computed(() => {
    const selected = this.selectedId();
    const list = this.entries();
    return selected && list.some((e) => e.id === selected) ? selected : (list[0]?.id ?? null);
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.scrollEl = this.scroller() ?? this.host.nativeElement.closest<HTMLElement>('.content') ?? this.host.nativeElement;
      const onScroll = () => {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          this.syncScroll();
        });
      };
      this.scrollEl.addEventListener('scroll', onScroll, { passive: true });
      const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.measure()) : null;
      resize?.observe(this.host.nativeElement);
      if (this.scrollEl !== this.host.nativeElement) resize?.observe(this.scrollEl);
      this.measure();
      destroyRef.onDestroy(() => {
        this.scrollEl?.removeEventListener('scroll', onScroll);
        resize?.disconnect();
        if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
      });
    });

    // Neue Einträge → kurz animieren, danach statisch (sonst flackert jede nachgeladene Zeile).
    effect((onCleanup) => {
      this.entries();
      untracked(() => this.animateIn.set(true));
      const timer = setTimeout(() => this.animateIn.set(false), 600);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private measure(): void {
    const el = this.scrollEl;
    if (!el) return;
    this.width.set(this.host.nativeElement.clientWidth);
    this.viewportHeight.set(el.clientHeight);
    const hostRect = this.host.nativeElement.getBoundingClientRect();
    const scrollRect = el.getBoundingClientRect();
    this.listOffset = el === this.host.nativeElement ? 0 : hostRect.top - scrollRect.top + el.scrollTop;
    this.syncScroll();
  }

  private syncScroll(): void {
    if (this.scrollEl) this.scrollTop.set(this.scrollEl.scrollTop);
  }

  protected folderBreak(index: number): boolean {
    return this.layout() === 'list' && showsFolderBreak(this.entries(), index, this.sort());
  }

  /** Auswahl per Pfeiltasten verschieben (dx: Spalten, dy: Zeilen); ⇧ erweitert den Bereich. */
  moveSelection(dx: number, dy: number, extend = false): LibraryEntry | null {
    const list = this.entries();
    if (!list.length) return null;
    const current = list.findIndex((e) => e.id === this.selectedId());
    const columns = this.columns();
    let next: number;
    if (current < 0) next = 0;
    else if (this.layout() === 'grid') next = current + dx + dy * columns;
    else next = current + (dy || dx);
    next = Math.min(Math.max(next, 0), list.length - 1);
    const entry = list[next];
    this.selectEntry.emit({ entry, mode: extend ? 'range' : 'replace' });
    this.focusEntry(entry.id);
    return entry;
  }

  selectEdge(edge: 'first' | 'last'): void {
    const list = this.entries();
    const entry = edge === 'first' ? list[0] : list[list.length - 1];
    if (!entry) return;
    this.selectEntry.emit({ entry, mode: 'replace' });
    this.focusEntry(entry.id);
  }

  /** Eintrag in den Sichtbereich scrollen und fokussieren. */
  focusEntry(id: string | null): void {
    this.revealEntry(id, true);
  }

  /** Eintrag sichtbar machen (z. B. wenn die Vorschau weiterblättert), optional fokussieren. */
  revealEntry(id: string | null, focus = false): void {
    if (!id) return;
    const index = this.entries().findIndex((e) => e.id === id);
    if (index < 0) return;
    const el = this.scrollEl;
    if (el) {
      const row = Math.floor(index / this.columns());
      const offsets = this.offsets();
      const top = this.listOffset + (offsets[row] ?? 0);
      const bottom = this.listOffset + (offsets[row + 1] ?? top);
      const next = scrollToReveal(top, bottom, el.scrollTop, el.clientHeight || FALLBACK_VIEWPORT);
      if (next !== null) {
        el.scrollTop = next;
        this.syncScroll();
      }
    }
    if (!focus) return;
    // Nach dem Rendern des neuen Fensters fokussieren.
    let tries = 0;
    const attempt = () => {
      const target = this.host.nativeElement.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
      if (target) target.focus({ preventScroll: true });
      else if (tries++ < 5) requestAnimationFrame(attempt);
    };
    setTimeout(attempt);
  }

  protected isSelected(id: string): boolean {
    return id === this.selectedId() || this.selectedIds().has(id);
  }

  protected onClick(entry: LibraryEntry, event: MouseEvent): void {
    const mode: SelectionMode = event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
    this.selectEntry.emit({ entry, mode });
  }

  protected onContextMenu(entry: LibraryEntry, event: MouseEvent): void {
    event.preventDefault();
    if (!this.isSelected(entry.id)) this.selectEntry.emit({ entry, mode: 'replace' });
    this.contextMenu.emit({ entry, x: event.clientX, y: event.clientY });
  }

  /** Kontextmenü per Tastatur (Kontextmenü-Taste, ⇧F10) oder „…“-Knopf. */
  protected openMenuFrom(entry: LibraryEntry, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!this.isSelected(entry.id)) this.selectEntry.emit({ entry, mode: 'replace' });
    this.contextMenu.emit({ entry, x: rect.left + Math.min(rect.width, 40), y: rect.bottom - 4 });
  }

  // --- Drag & Drop innerhalb der App ---

  protected onDragStart(entry: LibraryEntry, event: DragEvent): void {
    this.dragging = entry;
    event.dataTransfer?.setData(ENTRY_DRAG_TYPE, entry.id);
    event.dataTransfer?.setData('text/plain', entry.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragEnd(): void {
    this.dragging = null;
    this.dropTarget.set(null);
  }

  private canDropOn(folder: LibraryEntry): boolean {
    const src = this.dragging;
    if (!src || folder.type !== 'folder' || src.id === folder.id) return false;
    if (src.type === 'folder' && folder.relativePath.startsWith(`${src.relativePath}/`)) return false;
    return (src.parentPath ?? '') !== folder.relativePath;
  }

  protected onDragOver(entry: LibraryEntry, event: DragEvent): void {
    if (!this.canDropOn(entry)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(entry.id);
  }

  protected onDragLeave(entry: LibraryEntry): void {
    if (this.dropTarget() === entry.id) this.dropTarget.set(null);
  }

  protected onDrop(entry: LibraryEntry, event: DragEvent): void {
    if (!this.canDropOn(entry) || !this.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropOnFolder.emit({ entryId: this.dragging.id, destination: entry.relativePath });
    this.onDragEnd();
  }
}
