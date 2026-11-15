import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { FileKind, LibraryEntry } from '../../../core/services/library.service';
import { Icon } from '../../../shared/icon/icon';
import { KIND_OPTIONS } from '../dashboard.types';
import { LibraryStore } from '../library.store';

/** Seitenleiste: Bibliothek, oberste Ordner, Typfilter mit Anzahl, Bewertet, Zuletzt geändert. */
@Component({
  selector: 'app-sidebar',
  imports: [Icon, NgOptimizedImage],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  protected readonly store = inject(LibraryStore);
  protected readonly kinds = KIND_OPTIONS;

  /** Eintrag aus der Liste wurde auf einen Ordner der Seitenleiste gezogen. */
  readonly dropOnFolder = output<{ entryId: string; destination: string }>();
  readonly openSettings = output<void>();

  protected readonly dropTarget = signal<string | null>(null);

  protected readonly activeKey = computed(() => {
    const view = this.store.view();
    switch (view.type) {
      case 'folder':
        return `folder:${view.path.split('/')[0] ?? ''}`;
      case 'kind':
        return `kind:${view.kind}`;
      default:
        return view.type;
    }
  });

  /** Exakt die Bibliothekswurzel aktiv (nicht ein Unterordner). */
  protected readonly homeActive = computed(() => {
    const view = this.store.view();
    return view.type === 'folder' && view.path === '';
  });

  protected count(kind: FileKind): number | null {
    return this.store.counts()[kind] ?? null;
  }

  protected isFolderActive(folder: LibraryEntry): boolean {
    return this.activeKey() === `folder:${folder.relativePath}`;
  }

  protected onDragOver(destination: string, event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-printnest-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(destination);
  }

  protected onDrop(destination: string, event: DragEvent): void {
    const entryId = event.dataTransfer?.getData('application/x-printnest-entry');
    this.dropTarget.set(null);
    if (!entryId) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropOnFolder.emit({ entryId, destination });
  }
}
