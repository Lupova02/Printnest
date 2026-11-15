import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { LibraryEntry, LibraryService } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';

/** Dialog: Eintrag in einen anderen Ordner verschieben (Ordner-Browser). */
@Component({
  selector: 'app-move-dialog',
  imports: [DialogDirective],
  templateUrl: './move-dialog.html',
  styleUrl: './move-dialog.scss',
})
export class MoveDialog implements OnInit {
  readonly entry = input.required<LibraryEntry>();
  readonly busy = input(false);

  readonly closed = output<void>();
  readonly moved = output<string>();

  private readonly library = inject(LibraryService);

  protected readonly browsePath = signal('');
  protected readonly folders = signal<LibraryEntry[]>([]);
  protected readonly breadcrumbs = signal<{ name: string; relativePath: string }[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly destinationLabel = computed(() => {
    const crumbs = this.breadcrumbs();
    if (crumbs.length <= 1) return 'Bibliothek';
    return crumbs.map((c) => c.name).join(' / ');
  });

  protected readonly alreadyHere = computed(() => {
    const entry = this.entry();
    const dest = this.browsePath();
    const currentParent = entry.parentPath || '';
    return currentParent === dest;
  });

  ngOnInit(): void {
    const start = this.entry().parentPath || '';
    void this.loadFolders(start);
  }

  protected openFolder(relativePath: string): void {
    void this.loadFolders(relativePath);
  }

  protected confirm(): void {
    if (this.alreadyHere() || this.busy() || this.loading()) return;
    this.moved.emit(this.browsePath());
  }

  private async loadFolders(relativePath: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.library.getLibrary(relativePath).subscribe({
      next: (res) => {
        const moving = this.entry();
        const folders = (res.entries || []).filter((item) => {
          if (item.type !== 'folder') return false;
          // Ordner nicht in sich selbst / eigenen Unterordner navigierbar machen
          if (moving.type === 'folder') {
            const src = moving.relativePath;
            if (item.relativePath === src || item.relativePath.startsWith(`${src}/`)) {
              return false;
            }
          }
          return true;
        });
        this.folders.set(folders);
        this.breadcrumbs.set(res.breadcrumbs || [{ name: 'Home', relativePath: '' }]);
        this.browsePath.set(res.relativePath || '');
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Ordner konnten nicht geladen werden.');
        this.loading.set(false);
      },
    });
  }
}
