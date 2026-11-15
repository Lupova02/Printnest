import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LibraryEntry, LibraryService } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { Icon } from '../../../../shared/icon/icon';
import { StarRating } from '../../../../shared/star-rating/star-rating';
import { FilePreview } from '../../../file-preview/file-preview';
import { ViewLayout } from '../../dashboard.types';
import { canRate, formatSize, kindLabel } from '../../dashboard.utils';
import { PreviewDirection, previewDirectionForKey } from '../../preview-navigation';

const NOTE_MAX = 500;
/** Notiz wird nach dieser Pause automatisch gespeichert. */
export const NOTE_AUTOSAVE_MS = 700;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Große Vorschau (Quick Look): Leertaste schließt (auch bei Video), Pfeiltasten blättern
 * (Liste ↑/↓, Raster ←/→ und ↑/↓ zeilenweise). Rechts: Bewertung, Druckdatum und Notiz –
 * bei Videos nur die Notiz.
 */
@Component({
  selector: 'app-preview-dialog',
  imports: [DialogDirective, FilePreview, Icon, StarRating],
  templateUrl: './preview-dialog.html',
  styleUrl: './preview-dialog.scss',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class PreviewDialog {
  private readonly api = inject(LibraryService);

  readonly entry = input.required<LibraryEntry>();
  readonly position = input('');
  readonly hasPrev = input(false);
  readonly hasNext = input(false);
  readonly layout = input<ViewLayout>('list');
  /** Name des gewählten Standard-Slicers (null = keiner gewählt/installiert). */
  readonly slicerName = input<string | null>(null);
  /** Slicer-Bereich zeigen (Datei ist ein Slicer-Format, das der gewählte Slicer kann). */
  readonly showSlicer = input(false);

  readonly closed = output<void>();
  readonly navigate = output<PreviewDirection>();
  readonly rate = output<number>();
  readonly openSlicer = output<void>();
  readonly chooseSlicer = output<void>();
  readonly reveal = output<void>();

  protected readonly noteMax = NOTE_MAX;
  protected readonly note = signal('');
  protected readonly printedAt = signal('');
  protected readonly saveState = signal<SaveState>('idle');

  protected readonly kindLabel = kindLabel;
  protected readonly formatSize = formatSize;
  protected readonly rateable = computed(() => canRate(this.entry()));
  protected readonly version = computed(() => `${this.entry().updatedAt ?? ''}:${this.entry().size ?? ''}`);

  private readonly preview = viewChild(FilePreview);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Pfad, zu dem die aktuell angezeigte Notiz gehört (beim Blättern wichtig). */
  private metaPath = '';
  private metaWithDate = true;
  private savedNote = '';
  private savedPrintedAt = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const path = this.entry().relativePath;
      untracked(() => {
        this.flush();
        void this.loadMeta(path);
      });
    });
    inject(DestroyRef).onDestroy(() => this.flush());
  }

  private async loadMeta(path: string): Promise<void> {
    this.metaPath = path;
    this.metaWithDate = this.rateable();
    this.note.set('');
    this.printedAt.set('');
    this.savedNote = '';
    this.savedPrintedAt = '';
    this.saveState.set('idle');
    try {
      const res = await firstValueFrom(this.api.getMeta(path));
      if (path !== this.metaPath) return;
      this.note.set(res.meta?.note ?? '');
      this.printedAt.set(res.meta?.printedAt ?? '');
      this.savedNote = res.meta?.note ?? '';
      this.savedPrintedAt = res.meta?.printedAt ?? '';
    } catch {
      // Ohne Meta weiterarbeiten.
    }
  }

  private isDirty(): boolean {
    return this.note().trim() !== this.savedNote || this.printedAt() !== this.savedPrintedAt;
  }

  protected onNoteInput(value: string): void {
    this.note.set(value);
    this.scheduleSave();
  }

  protected onDateInput(value: string): void {
    this.printedAt.set(value);
    this.flush();
  }

  protected today(): void {
    this.onDateInput(new Date().toISOString().slice(0, 10));
  }

  /** Autosave mit Debounce. */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveState.set(this.isDirty() ? 'dirty' : 'idle');
    this.saveTimer = setTimeout(() => this.flush(), NOTE_AUTOSAVE_MS);
  }

  /** Ausstehende Änderungen sofort speichern (für den Pfad, zu dem sie gehören). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.metaPath || !this.isDirty()) return;
    const path = this.metaPath;
    const note = this.note().trim();
    const printedAt = this.printedAt();
    // Videos haben kein Druckdatum.
    const patch = this.metaWithDate ? { note, printedAt } : { note };
    this.savedNote = note;
    this.savedPrintedAt = printedAt;
    this.saveState.set('saving');
    this.api.updateMeta(path, patch).subscribe({
      next: () => {
        if (path === this.metaPath) this.saveState.set('saved');
      },
      error: () => {
        if (path !== this.metaPath) return;
        // Als ungespeichert markieren, damit der nächste Flush es erneut versucht.
        this.savedNote = '';
        this.savedPrintedAt = '';
        this.saveState.set('error');
      },
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('input:not([type=range]), textarea, select')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === ' ') {
      // Quick Look: Leertaste schließt immer – auch bei Video und fokussierten Knöpfen.
      event.preventDefault();
      this.close();
      return;
    }
    if (this.preview()?.handleMediaKey(event)) {
      event.preventDefault();
      return;
    }
    if (target.closest('input[type=range]')) return;
    const direction = previewDirectionForKey(event.key, this.layout());
    if (direction) {
      event.preventDefault();
      this.flush();
      this.navigate.emit(direction);
      return;
    }
    if (/^[0-5]$/.test(event.key) && this.rateable()) {
      event.preventDefault();
      this.rate.emit(Number(event.key));
    }
  }

  /**
   * Fokus kann beim Blättern verloren gehen (z. B. wenn der fokussierte Stern-Knopf bei einem
   * Video verschwindet). Dann landen Tasten am Dokument – trotzdem wie im Dialog behandeln.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const dialog = this.host.nativeElement.querySelector<HTMLElement>('.preview-dialog');
    if (!dialog || event.defaultPrevented || dialog.contains(event.target as Node)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    this.onKeydown(event);
    if (event.defaultPrevented) dialog.focus();
  }

  protected step(direction: PreviewDirection): void {
    this.flush();
    this.navigate.emit(direction);
  }

  protected close(): void {
    this.flush();
    this.closed.emit();
  }
}
