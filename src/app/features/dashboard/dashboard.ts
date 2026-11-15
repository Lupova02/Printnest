import { ApplicationRef, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DesktopService, MenuAction } from '../../core/services/desktop.service';
import { BatchOp, LibraryEntry } from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { Icon } from '../../shared/icon/icon';
import { ContextMenu, MenuItem } from './context-menu/context-menu';
import { ThemeService } from '../../core/services/theme.service';
import { canOpenInSlicer, canPreview, canRate, isLinkEntry, slicerSupports, themeForView } from './dashboard.utils';
import { BatchRenameDialog } from './dialogs/batch-rename-dialog/batch-rename-dialog';
import { DeleteDialog } from './dialogs/delete-dialog/delete-dialog';
import { FolderDialog } from './dialogs/folder-dialog/folder-dialog';
import { LinkDialog, LinkDialogResult, isHttpUrl } from './dialogs/link-dialog/link-dialog';
import { MoveDialog } from './dialogs/move-dialog/move-dialog';
import { NameAssistAction, NameAssistDialog } from './dialogs/name-assist-dialog/name-assist-dialog';
import { PathDialog } from './dialogs/path-dialog/path-dialog';
import { PreviewDialog } from './dialogs/preview-dialog/preview-dialog';
import { RenameDialog } from './dialogs/rename-dialog/rename-dialog';
import { SettingsDialog } from './dialogs/settings-dialog/settings-dialog';
import { ShortcutsDialog } from './dialogs/shortcuts-dialog/shortcuts-dialog';
import { EmptyState } from './empty-state/empty-state';
import { ENTRY_DRAG_TYPE, EntryContextRequest, EntryList } from './entry-list/entry-list';
import { LibraryStore } from './library.store';
import { Sidebar } from './sidebar/sidebar';
import { Toolbar, ToolbarAction } from './toolbar/toolbar';
import { PreviewDirection, nextPreviewIndex, previewPosition } from './preview-navigation';

type DialogState =
  | { type: 'folder' | 'path' | 'settings' | 'shortcuts' | 'name-assist' }
  | { type: 'link'; url?: string; edit?: LibraryEntry }
  | { type: 'rename' | 'move' | 'delete'; entry: LibraryEntry }
  | { type: 'batch-rename'; entries: LibraryEntry[] }
  | null;

const ACCEPT = '.stl,.3mf,.f3d,.pdf,.mp4,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff';

/**
 * Hauptfenster: Seitenleiste, Toolbar und Inhalt. Zustand liegt im LibraryStore;
 * hier werden Tastatur, Menüaktionen, Drag & Drop und Dialoge koordiniert.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    BatchRenameDialog,
    ContextMenu,
    DeleteDialog,
    EmptyState,
    EntryList,
    FolderDialog,
    Icon,
    LinkDialog,
    MoveDialog,
    NameAssistDialog,
    PathDialog,
    PreviewDialog,
    RenameDialog,
    SettingsDialog,
    ShortcutsDialog,
    Sidebar,
    Toolbar,
  ],
  providers: [LibraryStore],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(window:dragenter)': 'onWindowDragEnter($event)',
    '(window:dragover)': 'onWindowDragOver($event)',
    '(window:dragleave)': 'onWindowDragLeave($event)',
    '(window:drop)': 'onWindowDrop($event)',
  },
})
export class Dashboard {
  protected readonly store = inject(LibraryStore);
  private readonly desktop = inject(DesktopService);
  private readonly toasts = inject(ToastService);
  private readonly appRef = inject(ApplicationRef);

  protected readonly accept = ACCEPT;
  protected readonly dialog = signal<DialogState>(null);
  protected readonly previewId = signal<string | null>(null);
  protected readonly menu = signal<EntryContextRequest | null>(null);
  protected readonly dropActive = signal(false);
  private dragDepth = 0;

  private readonly list = viewChild(EntryList);
  private readonly toolbar = viewChild(Toolbar);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly linkDialogUrl = computed(() => {
    const d = this.dialog();
    return d?.type === 'link' ? (d.url ?? null) : null;
  });

  protected readonly linkDialogEdit = computed(() => {
    const d = this.dialog();
    return d?.type === 'link' ? (d.edit ?? null) : null;
  });

  protected readonly batchEntries = computed(() => {
    const d = this.dialog();
    return d?.type === 'batch-rename' ? d.entries : null;
  });

  protected readonly dialogEntry = computed(() => {
    const d = this.dialog();
    return d && 'entry' in d ? d.entry : null;
  });

  protected readonly previewEntry = computed(() => {
    const id = this.previewId();
    return id ? (this.store.visibleEntries().find((e) => e.id === id && canPreview(e)) ?? null) : null;
  });

  /** Index der Vorschau-Datei in der angezeigten Liste (inkl. Ordner/Links). */
  private readonly previewListIndex = computed(() =>
    this.store.visibleEntries().findIndex((e) => e.id === this.previewId()),
  );

  protected readonly previewLabel = computed(() => {
    const id = this.previewId();
    if (!id) return '';
    const { index, total } = previewPosition(this.store.visibleEntries(), id);
    return index >= 0 ? `${index + 1} von ${total}` : '';
  });

  protected readonly previewHasPrev = computed(
    () => nextPreviewIndex(this.store.visibleEntries(), this.previewListIndex(), 'prev') >= 0,
  );
  protected readonly previewHasNext = computed(
    () => nextPreviewIndex(this.store.visibleEntries(), this.previewListIndex(), 'next') >= 0,
  );

  /** Name des gewählten Slicers, falls er die Vorschau-Datei öffnen kann. */
  protected readonly previewSlicer = computed(() => {
    const entry = this.previewEntry();
    const slicer = this.store.activeSlicer();
    if (!entry || !canOpenInSlicer(entry)) return { show: false, name: null };
    if (!slicer) return { show: true, name: null };
    return { show: slicerSupports(slicer, entry), name: slicer.name };
  });

  protected readonly menuItems = computed<MenuItem[]>(() => {
    const target = this.menu()?.entry;
    return target ? this.buildMenu(target) : [];
  });

  constructor() {
    void this.store.init();
    const unsubscribe = this.desktop.onMenuAction((action) => this.runAction(action));
    inject(DestroyRef).onDestroy(unsubscribe);

    effect(() => {
      document.title = this.store.configured() ? `${this.store.title()} – Printnest` : 'Printnest';
    });
    // Farbprofil folgt dem aktiven Typfilter.
    const themes = inject(ThemeService);
    effect(() => themes.apply(themeForView(this.store.view())));
  }

  // --- Aktionen (Menüleiste, Tastatur, Toolbar) ---

  protected runAction(action: MenuAction | ToolbarAction): void {
    const selected = this.store.selected();
    const needsLibrary = !['settings', 'shortcuts', 'pick-library'].includes(action);
    if (needsLibrary && !this.store.configured()) return;

    switch (action) {
      case 'settings':
        this.openDialog({ type: 'settings' });
        break;
      case 'shortcuts':
        this.openDialog({ type: 'shortcuts' });
        break;
      case 'pick-library':
        this.openDialog({ type: 'path' });
        break;
      case 'new-folder':
        if (this.ensureFolderView()) this.openDialog({ type: 'folder' });
        break;
      case 'new-link':
        if (this.ensureFolderView()) this.openDialog({ type: 'link' });
        break;
      case 'name-assist':
        if (this.ensureFolderView()) this.openDialog({ type: 'name-assist' });
        break;
      case 'import':
        if (this.ensureFolderView()) this.fileInput()?.nativeElement.click();
        break;
      case 'find':
        this.toolbar()?.focusSearch();
        break;
      case 'view-list':
        this.store.setLayout('list');
        break;
      case 'view-grid':
        this.store.setLayout('grid');
        break;
      case 'reload':
        this.store.refresh(true);
        this.store.loadSidebar();
        break;
      case 'reveal':
        if (selected) this.store.reveal(selected);
        break;
      case 'open-slicer':
        if (selected && canOpenInSlicer(selected)) this.openInSlicer(selected);
        break;
      case 'batch-rename':
        this.openBatchRename();
        break;
      case 'undo':
        void this.store.undo();
        break;
      case 'rename':
        if (selected) this.openDialog({ type: 'rename', entry: selected });
        break;
      case 'move':
        if (selected) this.openDialog({ type: 'move', entry: selected });
        break;
      case 'trash':
        if (selected) this.openDialog({ type: 'delete', entry: selected });
        break;
    }
  }

  /** Nur der gewählte Standard-Slicer; ohne Auswahl Hinweis + Einstellungen öffnen. */
  protected openInSlicer(entry: LibraryEntry): void {
    const slicer = this.store.activeSlicer();
    if (!slicer) {
      this.toasts.show('Kein Slicer gewählt oder installiert.', 'info', 'Bitte in den Einstellungen festlegen.');
      this.openDialog({ type: 'settings' });
      return;
    }
    if (!slicerSupports(slicer, entry)) {
      this.toasts.error(`${slicer.name} kann diesen Dateityp nicht öffnen.`);
      return;
    }
    this.store.openInSlicer(entry);
  }

  /** Stapelumbenennung: Auswahl (≥ 2) oder alle Dateien der Ansicht. */
  protected openBatchRename(): void {
    const selected = this.store.selectedEntries().filter((e) => e.type !== 'folder');
    const entries = selected.length >= 2 ? selected : this.store.visibleEntries().filter((e) => e.type === 'file');
    if (!entries.length) {
      this.toasts.show('Keine Dateien zum Umbenennen.');
      return;
    }
    this.openDialog({ type: 'batch-rename', entries });
  }

  protected async batchRename(ops: BatchOp[]): Promise<void> {
    if (!ops.length) {
      this.closeDialog();
      return;
    }
    if (await this.store.batchRename(ops)) this.closeDialog();
  }

  private ensureFolderView(): boolean {
    if (this.store.isFolderView()) return true;
    this.toasts.show('Bitte zuerst einen Ordner öffnen.');
    return false;
  }

  protected openDialog(state: DialogState): void {
    this.menu.set(null);
    this.dialog.set(state);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
    this.list()?.focusEntry(this.store.selectedId());
  }

  protected openEntry(entry: LibraryEntry): void {
    if (entry.type === 'folder') this.store.openFolder(entry.relativePath);
    else if (isLinkEntry(entry)) this.store.openLink(entry);
    else if (canPreview(entry)) this.previewId.set(entry.id);
    else this.store.reveal(entry);
  }

  protected closePreview(): void {
    const id = this.previewId();
    this.previewId.set(null);
    if (id) {
      this.store.select(id);
      this.list()?.focusEntry(id);
    }
  }

  /** Quick Look blättern: Vorschau ersetzen (nicht stapeln), Auswahl wandert sichtbar mit. */
  protected stepPreview(direction: PreviewDirection): void {
    const entries = this.store.visibleEntries();
    const columns = this.store.layout() === 'grid' ? (this.list()?.columns() ?? 1) : 1;
    const index = nextPreviewIndex(entries, this.previewListIndex(), direction, columns);
    if (index < 0) return;
    const next = entries[index];
    const apply = () => {
      this.previewId.set(next.id);
      this.store.select(next.id);
    };
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (doc.startViewTransition && !reduced) {
      // Crossfade ≤ 150 ms (Dauer über html.is-preview-step in styles.scss).
      document.documentElement.classList.add('is-preview-step');
      const transition = doc.startViewTransition(() => {
        apply();
        this.appRef.tick();
      });
      void transition.finished.finally(() => document.documentElement.classList.remove('is-preview-step'));
    } else {
      apply();
    }
    this.list()?.revealEntry(next.id);
  }

  // --- Dialog-Ergebnisse ---

  protected async createFolder(name: string): Promise<void> {
    if (await this.store.createFolder(name)) this.closeDialog();
  }

  protected async saveLink(value: LinkDialogResult): Promise<void> {
    const ok = value.edit
      ? await this.store.updateLink(value.edit, {
          name: value.name !== value.edit.name ? value.name : undefined,
          url: value.url !== value.edit.url ? value.url : undefined,
          meta: value.url !== value.edit.url ? value.meta : undefined,
        })
      : await this.store.createLink(value.name, value.url, { meta: value.meta, allowDuplicate: value.allowDuplicate });
    if (ok) this.closeDialog();
  }

  protected async rename(entry: LibraryEntry, name: string): Promise<void> {
    if (await this.store.rename(entry, name)) this.closeDialog();
  }

  protected async move(entry: LibraryEntry, destination: string): Promise<void> {
    if (await this.store.move(entry, destination)) this.closeDialog();
  }

  protected async trash(entry: LibraryEntry): Promise<void> {
    if (await this.store.trash(entry)) this.closeDialog();
  }

  protected async pickLibrary(): Promise<void> {
    if (await this.store.pickLibrary()) this.dialog.set(null);
  }

  protected async saveLibraryPath(path: string): Promise<void> {
    if (await this.store.setLibraryPath(path)) this.dialog.set(null);
  }

  protected onNameAssist(action: NameAssistAction): void {
    if (action.type === 'create-folder') void this.store.createFolder(action.name);
    else if (action.type === 'create-link') void this.store.createLink(action.name, action.url);
    else void this.uploadViaAssist(action.file, action.folderName);
  }

  private async uploadViaAssist(file: File, folderName?: string): Promise<void> {
    let parent = this.store.currentFolder();
    if (folderName) {
      await this.store.createFolder(folderName);
      parent = parent ? `${parent}/${folderName}` : folderName;
    }
    await this.store.uploadFiles([file], parent);
  }

  protected onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (files.length) void this.importFiles(files);
  }

  /** In Electron echte Pfade kopieren (inkl. Ordner), sonst Upload. */
  private importFiles(files: File[]): Promise<boolean> {
    const paths = files.map((file) => this.desktop.pathForFile(file));
    if (this.desktop.isElectron && paths.every((p): p is string => !!p)) {
      return this.store.importPaths(paths);
    }
    return this.store.uploadFiles(files);
  }

  /** Eintrag (per ID aus Drag & Drop) in einen Ordner verschieben. */
  protected dropMove(value: { entryId: string; destination: string }): void {
    const entry =
      this.store.visibleEntries().find((e) => e.id === value.entryId) ??
      this.store.entries().find((e) => e.id === value.entryId);
    if (entry) void this.store.move(entry, value.destination);
  }

  // --- Kontextmenü ---

  private buildMenu(entry: LibraryEntry): MenuItem[] {
    const items: MenuItem[] = [];
    const link = isLinkEntry(entry);
    if (entry.type === 'folder') items.push({ id: 'open', label: 'Öffnen', icon: 'folder', shortcut: '↩' });
    else if (link) items.push({ id: 'open', label: 'Im Browser öffnen', icon: 'external', shortcut: '↩' });
    else if (canPreview(entry)) items.push({ id: 'preview', label: 'Vorschau', icon: 'eye', shortcut: '␣' });

    if (canOpenInSlicer(entry)) {
      const slicer = this.store.activeSlicer();
      if (!slicer) items.push({ id: 'choose-slicer', label: 'Slicer wählen …', icon: 'settings' });
      else if (slicerSupports(slicer, entry)) {
        items.push({ id: 'slicer', label: `In ${slicer.name} öffnen`, icon: 'cube', shortcut: '⇧⌘O' });
      }
    }
    if (!link) items.push({ id: 'reveal', label: 'Im Finder zeigen', icon: 'finder', shortcut: '⌥⌘R' });
    items.push({ id: 'copy', label: link ? 'URL kopieren' : 'Pfad kopieren', icon: 'copy' });
    if (link) {
      items.push({ id: 'edit-link', label: 'Link bearbeiten …', icon: 'edit' });
      items.push({ id: 'check-link', label: 'Erreichbarkeit prüfen', icon: 'refresh' });
    }

    items.push({ id: 'rename', label: 'Umbenennen …', icon: 'edit', shortcut: '⇧↩', separatorBefore: true });
    items.push({ id: 'move', label: 'Verschieben …', icon: 'move' });
    const multi = this.store.selectedEntries().filter((e) => e.type !== 'folder').length;
    items.push({ id: 'batch-rename', label: multi >= 2 ? `${multi} Einträge umbenennen …` : 'Stapelumbenennung …', icon: 'wand', shortcut: '⇧⌘R' });

    if (canRate(entry)) {
      for (const n of [5, 4, 3, 2, 1]) {
        items.push({
          id: `rate:${n}`,
          label: `Bewerten: ${'★'.repeat(n)}${'☆'.repeat(5 - n)}`,
          shortcut: String(n),
          separatorBefore: n === 5,
        });
      }
      if (entry.rating) items.push({ id: 'rate:0', label: 'Bewertung entfernen', shortcut: '0' });
    }

    items.push({
      id: 'trash',
      label: link ? 'Link entfernen' : 'In den Papierkorb',
      icon: 'trash',
      shortcut: '⌘⌫',
      danger: true,
      separatorBefore: true,
    });
    return items;
  }

  protected onMenuSelected(id: string): void {
    const entry = this.menu()?.entry;
    this.menu.set(null);
    if (!entry) return;
    if (id === 'slicer') {
      this.openInSlicer(entry);
    } else if (id === 'choose-slicer') {
      this.openDialog({ type: 'settings' });
    } else if (id.startsWith('rate:')) {
      void this.store.setRating(entry, Number(id.slice(5)));
    } else if (id === 'open' || id === 'preview') {
      this.openEntry(entry);
    } else if (id === 'reveal') {
      this.store.reveal(entry);
    } else if (id === 'copy') {
      this.store.copyPath(entry);
    } else if (id === 'edit-link') {
      this.openDialog({ type: 'link', edit: entry });
    } else if (id === 'check-link') {
      this.store.checkLink(entry);
    } else if (id === 'batch-rename') {
      this.openBatchRename();
    } else if (id === 'rename' || id === 'move') {
      this.openDialog({ type: id, entry });
    } else if (id === 'trash') {
      this.openDialog({ type: 'delete', entry });
    }
    if (!this.dialog() && !this.previewId()) this.list()?.focusEntry(entry.id);
  }

  protected closeMenu(): void {
    const id = this.menu()?.entry.id ?? null;
    this.menu.set(null);
    this.list()?.focusEntry(id);
  }

  // --- Tastatur ---

  protected onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.dialog() || this.previewId() || this.menu()) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;

    if (mod) {
      const action = this.shortcutFor(event);
      if (action) {
        // In Textfeldern ⌘⌫, ⌘↑ und ⌘Z dem Feld überlassen.
        if (typing && (action === 'trash' || action === 'undo' || key === 'ArrowUp')) return;
        event.preventDefault();
        if (action === 'up') this.store.goUp();
        else if (action === 'open') this.openSelected();
        else this.runAction(action);
      }
      return;
    }
    if (typing || !this.store.configured()) return;

    const list = this.list();
    const selected = this.store.selected();
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        list?.moveSelection(0, 1, event.shiftKey);
        return;
      case 'ArrowUp':
        event.preventDefault();
        list?.moveSelection(0, -1, event.shiftKey);
        return;
      case 'ArrowRight':
        if (this.store.layout() !== 'grid') return;
        event.preventDefault();
        list?.moveSelection(1, 0, event.shiftKey);
        return;
      case 'ArrowLeft':
        if (this.store.layout() !== 'grid') return;
        event.preventDefault();
        list?.moveSelection(-1, 0, event.shiftKey);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        list?.selectEdge(key === 'Home' ? 'first' : 'last');
        return;
      case 'Enter':
        if (!selected || target?.closest('button:not([role="option"])')) return;
        event.preventDefault();
        if (event.shiftKey) this.runAction('rename');
        else this.openEntry(selected);
        return;
      case ' ':
        // Quick Look: Leertaste öffnet, erneute Leertaste (im Vorschaudialog) schließt.
        if (!selected || target?.closest('button')) return;
        event.preventDefault();
        if (canPreview(selected)) this.previewId.set(selected.id);
        else if (selected.type === 'folder') this.store.openFolder(selected.relativePath);
        return;
      case 'Escape':
        if (this.store.search()) {
          this.store.setSearch('');
        } else if (selected) {
          this.store.select(null);
        }
        return;
    }
    if (/^[0-5]$/.test(key) && selected && canRate(selected) && !event.altKey) {
      event.preventDefault();
      void this.store.setRating(selected, Number(key));
    }
  }

  private openSelected(): void {
    const selected = this.store.selected();
    if (selected) this.openEntry(selected);
  }

  /** ⌘-Kürzel → Aktion (entspricht electron/menu.mjs). */
  private shortcutFor(event: KeyboardEvent): MenuAction | 'up' | 'open' | null {
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowUp') return 'up';
    if (event.key === 'ArrowDown') return 'open';
    if (event.key === 'Backspace') return 'trash';
    if (event.altKey && (key === 'r' || event.code === 'KeyR')) return 'reveal';
    if (event.shiftKey && key === 'n') return 'new-folder';
    if (event.shiftKey && key === 'o') return 'open-slicer';
    if (event.shiftKey && key === 'r') return 'batch-rename';
    if (event.shiftKey && key === 'a') return 'name-assist';
    if (!event.shiftKey && key === 'z') return 'undo';
    const map: Record<string, MenuAction> = {
      f: 'find',
      '1': 'view-list',
      '2': 'view-grid',
      r: 'reload',
      l: 'new-link',
      o: 'import',
      ',': 'settings',
      // ⌘E bleibt als Alias für ⇧⌘O erhalten.
      e: 'open-slicer',
      '/': 'shortcuts',
    };
    return event.shiftKey ? null : (map[key] ?? null);
  }

  // --- Drag & Drop aus dem Finder ---

  private isFinderDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types ?? [];
    return types.includes('Files') && !types.includes(ENTRY_DRAG_TYPE);
  }

  /** URL aus dem Browser ins Fenster gezogen → Link-Assistent. */
  private isUrlDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types ?? [];
    return types.includes('text/uri-list') && !types.includes('Files') && !types.includes(ENTRY_DRAG_TYPE);
  }

  protected onWindowDragEnter(event: DragEvent): void {
    if (!this.isFinderDrag(event) || !this.store.configured() || this.dialog()) return;
    this.dragDepth += 1;
    this.dropActive.set(true);
  }

  protected onWindowDragOver(event: DragEvent): void {
    if (this.isUrlDrag(event) && this.store.configured() && !this.dialog()) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
      return;
    }
    if (!this.isFinderDrag(event) || !this.dropActive()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onWindowDragLeave(event: DragEvent): void {
    if (!this.isFinderDrag(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dropActive.set(false);
  }

  protected onWindowDrop(event: DragEvent): void {
    if (this.isUrlDrag(event)) {
      const url = (event.dataTransfer?.getData('text/uri-list') ?? '')
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith('#'));
      if (!url || !isHttpUrl(url) || this.dialog() || !this.store.configured()) return;
      event.preventDefault();
      if (this.ensureFolderView()) this.openDialog({ type: 'link', url: url.trim() });
      return;
    }
    if (!this.isFinderDrag(event)) return;
    event.preventDefault();
    const wasActive = this.dropActive();
    this.dragDepth = 0;
    this.dropActive.set(false);
    if (!wasActive) return;
    const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
    if (files.length) void this.importFiles(files);
  }
}
