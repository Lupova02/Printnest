import { Component, ElementRef, computed, inject, output, viewChild } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { SORT_OPTIONS, ViewSort } from '../dashboard.types';
import { slicerSupports } from '../dashboard.utils';
import { LibraryStore } from '../library.store';

export type ToolbarAction = 'new-folder' | 'new-link' | 'import' | 'name-assist' | 'open-slicer' | 'batch-rename' | 'undo';

/** Kopfzeile: Breadcrumbs, Suche, Bewertungsfilter, Sortierung, Ansicht und Aktionen. */
@Component({
  selector: 'app-toolbar',
  imports: [Icon],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class Toolbar {
  protected readonly store = inject(LibraryStore);
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly ratingOptions = [0, 1, 2, 3, 4, 5];

  readonly action = output<ToolbarAction>();

  /** „In <Slicer> öffnen“ – nur der gewählte Standard-Slicer. */
  protected readonly slicerTitle = computed(() => {
    const slicer = this.store.activeSlicer();
    return slicer ? `In ${slicer.name} öffnen (⇧⌘O)` : 'Slicer wählen (Einstellungen)';
  });
  protected readonly slicerEnabled = computed(() => {
    const selected = this.store.selected();
    const slicer = this.store.activeSlicer();
    return !!selected && (slicer ? slicerSupports(slicer, selected) : selected.type === 'file');
  });
  /** Eintrag wurde auf einen Breadcrumb gezogen. */
  readonly dropOnFolder = output<{ entryId: string; destination: string }>();

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  /** ⌘F: Suchfeld fokussieren. */
  focusSearch(): void {
    const input = this.searchInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.store.search()) {
      event.preventDefault();
      event.stopPropagation();
      this.store.setSearch('');
    }
  }

  protected onSort(value: string): void {
    this.store.setSort(value as ViewSort);
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-printnest-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  protected onDrop(destination: string, event: DragEvent): void {
    const entryId = event.dataTransfer?.getData('application/x-printnest-entry');
    if (!entryId) return;
    event.preventDefault();
    this.dropOnFolder.emit({ entryId, destination });
  }
}
