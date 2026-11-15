import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, firstValueFrom } from 'rxjs';
import { DesktopService } from '../../core/services/desktop.service';
import { LibraryEventsService } from '../../core/services/library-events.service';
import {
  BatchOp,
  Breadcrumb,
  FileKind,
  KindCounts,
  LibraryEntry,
  LibraryService,
  LinkMetaInput,
  SearchResponse,
  SlicerInfo,
  SlicerResponse,
} from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { KIND_OPTIONS, LibraryView, UiState, ViewLayout, ViewSort } from './dashboard.types';
import { filterAndSortEntries, isLinkEntry } from './dashboard.utils';
import { SelectionMode } from './entry-list/entry-list';

const SEARCH_DEBOUNCE_MS = 220;
const LIVE_REFRESH_DEBOUNCE_MS = 250;
const UI_STATE_DEBOUNCE_MS = 600;
const UNDO_LIMIT = 30;

/** Ein rückgängig machbarer Schritt: Beschreibung + Gegenoperationen. */
export interface UndoStep {
  label: string;
  inverse: BatchOp[];
}

/**
 * Zustand und Aktionen der Bibliothek (Signals). Die Dashboard-Komponente
 * kümmert sich nur noch um Layout, Tastatur und Dialoge.
 */
@Injectable()
export class LibraryStore {
  private readonly api = inject(LibraryService);
  private readonly desktop = inject(DesktopService);
  private readonly events = inject(LibraryEventsService);
  private readonly toasts = inject(ToastService);
  private readonly appRef = inject(ApplicationRef);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private uiStateTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSub: Subscription | null = null;
  private eventsSub: Subscription | null = null;
  /** Ordner, zu dem nach dem Leeren der Suche zurückgekehrt wird. */
  private folderBeforeSearch = '';

  // --- Zustand ---
  readonly ready = signal(false);
  readonly configured = signal(false);
  readonly root = signal<string | null>(null);
  readonly view = signal<LibraryView>({ type: 'folder', path: '' });
  readonly breadcrumbs = signal<Breadcrumb[]>([]);
  readonly entries = signal<LibraryEntry[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly search = signal('');
  readonly sort = signal<ViewSort>('name');
  readonly layout = signal<ViewLayout>('list');
  readonly minRating = signal(0);
  /** Primäre Auswahl (Fokus, Vorschau, Einzelaktionen). */
  readonly selectedId = signal<string | null>(null);
  /** Mehrfachauswahl (⌘-/⇧-Klick), enthält auch `selectedId`. */
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  private anchorId: string | null = null;
  readonly counts = signal<KindCounts>({});
  readonly topFolders = signal<LibraryEntry[]>([]);
  /** Alle bekannten + eigenen Slicer mit Installationsstatus. */
  readonly slicers = signal<SlicerInfo[]>([]);
  /** Gewählter Standard-Slicer (ID; null = keiner). */
  readonly defaultSlicer = signal<string | null>('bambu');
  readonly slicersLoading = signal(false);
  /** Undo-Stack für Umbenennen/Verschieben (⌘Z). */
  readonly undoStack = signal<UndoStep[]>([]);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  /** Wird erhöht, wenn sich Inhalte ändern (z. B. für die Vorschau). */
  readonly revision = signal(0);

  // --- Abgeleitet ---
  readonly currentFolder = computed(() => {
    const view = this.view();
    return view.type === 'folder' ? view.path : '';
  });

  readonly isFolderView = computed(() => this.view().type === 'folder');

  readonly visibleEntries = computed(() => {
    const view = this.view();
    return filterAndSortEntries(this.entries(), {
      query: view.type === 'kind' || view.type === 'rated' || view.type === 'recent' ? this.search() : '',
      sort: this.sort(),
      minRating: this.minRating(),
      skipClientFilter: view.type === 'search' || view.type === 'folder',
    });
  });

  readonly selected = computed(
    () => this.visibleEntries().find((entry) => entry.id === this.selectedId()) ?? null,
  );

  /** Alle ausgewählten Einträge in Anzeigereihenfolge. */
  readonly selectedEntries = computed(() => {
    const ids = this.selectedIds();
    const primary = this.selectedId();
    return this.visibleEntries().filter((entry) => ids.has(entry.id) || entry.id === primary);
  });

  /** Titel des Hauptbereichs (Toolbar/Fenstertitel). */
  readonly title = computed(() => {
    const view = this.view();
    switch (view.type) {
      case 'folder': {
        const crumbs = this.breadcrumbs();
        return crumbs.length > 1 ? crumbs[crumbs.length - 1].name : 'Bibliothek';
      }
      case 'kind':
        return KIND_OPTIONS.find((k) => k.id === view.kind)?.label ?? view.kind.toUpperCase();
      case 'search':
        return `Suche „${view.query}“`;
      case 'rated':
        return 'Gut bewertet';
      case 'recent':
        return 'Zuletzt geändert';
    }
  });

  /** Kurzer Ortsname für Dialogtexte (z. B. „Wird in … erstellt“). */
  readonly locationLabel = computed(() => {
    const crumbs = this.breadcrumbs();
    if (!this.isFolderView() || crumbs.length <= 1) return 'Bibliothek';
    return crumbs[crumbs.length - 1]?.name ?? 'Bibliothek';
  });

  /** Der gewählte und installierte Slicer – nur dieser erscheint in Toolbar, Menü und Vorschau. */
  readonly activeSlicer = computed(
    () => this.slicers().find((s) => s.id === this.defaultSlicer() && s.installed) ?? null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const timer of [this.searchTimer, this.liveTimer, this.uiStateTimer]) {
        if (timer) clearTimeout(timer);
      }
      this.loadSub?.unsubscribe();
      this.eventsSub?.unsubscribe();
      this.events.disconnect();
    });
  }

  // --- Start ---

  async init(): Promise<void> {
    try {
      const state = await firstValueFrom(this.api.getUiState<UiState>());
      if (state.layout === 'grid' || state.layout === 'list') this.layout.set(state.layout);
      if (state.sort && ['name', 'path', 'rating', 'date'].includes(state.sort)) this.sort.set(state.sort);
      if (Number.isInteger(state.minRating)) this.minRating.set(Math.min(Math.max(state.minRating ?? 0, 0), 5));
      if (typeof state.lastPath === 'string') this.view.set({ type: 'folder', path: state.lastPath });
    } catch {
      // Ohne gespeicherten Zustand starten.
    }
    this.ready.set(true);
    this.refresh(true);
    this.loadSidebar();
    this.loadSlicers();

    this.events.connect();
    this.eventsSub = this.events.changes.subscribe(() => {
      if (this.liveTimer) clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => {
        this.refresh(false);
        this.loadSidebar();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    });
  }

  // --- Navigation ---

  openFolder(path: string): void {
    this.search.set('');
    this.navigate({ type: 'folder', path });
  }

  showKind(kind: FileKind): void {
    this.search.set('');
    this.navigate({ type: 'kind', kind });
  }

  showRated(): void {
    this.search.set('');
    this.navigate({ type: 'rated' });
  }

  showRecent(): void {
    this.search.set('');
    this.navigate({ type: 'recent' });
  }

  /** Eine Ebene hoch (⌘↑). */
  goUp(): void {
    const view = this.view();
    if (view.type !== 'folder') {
      this.openFolder(this.folderBeforeSearch);
      return;
    }
    if (!view.path) return;
    const parts = view.path.split('/');
    parts.pop();
    this.openFolder(parts.join('/'));
  }

  setSearch(value: string): void {
    this.search.set(value);
    const view = this.view();
    // In Typ-/Bewertungsansichten wird clientseitig gefiltert.
    if (view.type === 'kind' || view.type === 'rated' || view.type === 'recent') return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const query = this.search().trim();
      if (!query) {
        if (this.view().type === 'search') this.navigate({ type: 'folder', path: this.folderBeforeSearch });
        return;
      }
      if (this.view().type === 'folder') this.folderBeforeSearch = this.currentFolder();
      this.navigate({ type: 'search', query }, false);
    }, SEARCH_DEBOUNCE_MS);
  }

  setSort(sort: ViewSort): void {
    this.sort.set(sort);
    this.persistUiState();
  }

  setLayout(layout: ViewLayout): void {
    this.layout.set(layout);
    this.persistUiState();
  }

  setMinRating(value: number): void {
    this.minRating.set(value);
    this.persistUiState();
  }

  /** Auswahl setzen: ersetzen, umschalten (⌘) oder Bereich ab Anker (⇧). */
  select(id: string | null, mode: SelectionMode = 'replace'): void {
    if (!id) {
      this.selectedId.set(null);
      this.selectedIds.set(new Set());
      this.anchorId = null;
      return;
    }
    if (mode === 'toggle') {
      const next = new Set(this.selectedIds());
      if (this.selectedId()) next.add(this.selectedId()!);
      if (next.has(id)) {
        next.delete(id);
        this.selectedIds.set(next);
        this.selectedId.set(next.size ? [...next][next.size - 1] : null);
      } else {
        next.add(id);
        this.selectedIds.set(next);
        this.selectedId.set(id);
      }
      this.anchorId = id;
      return;
    }
    if (mode === 'range' && this.anchorId) {
      const list = this.visibleEntries();
      const a = list.findIndex((e) => e.id === this.anchorId);
      const b = list.findIndex((e) => e.id === id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        this.selectedIds.set(new Set(list.slice(from, to + 1).map((e) => e.id)));
        this.selectedId.set(id);
        return;
      }
    }
    this.selectedId.set(id);
    this.selectedIds.set(new Set([id]));
    this.anchorId = id;
  }

  private navigate(view: LibraryView, animate = true): void {
    const apply = () => {
      this.view.set(view);
      this.select(null);
      this.refresh(true);
      this.persistUiState();
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && doc.startViewTransition && !reduced) {
      doc.startViewTransition(() => {
        apply();
        this.appRef.tick();
      });
    } else {
      apply();
    }
  }

  // --- Laden ---

  refresh(showLoading = false): void {
    if (showLoading) this.loading.set(true);
    const view = this.view();
    this.loadSub?.unsubscribe();

    if (view.type === 'folder') {
      this.loadSub = this.api.getLibrary(view.path).subscribe({
        next: (res) => {
          this.configured.set(!!res.configured);
          this.root.set(res.root);
          this.breadcrumbs.set(res.breadcrumbs ?? []);
          this.applyEntries(res.entries ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          // Gespeicherter Ordner existiert nicht mehr → zurück zur Bibliothek.
          if (err instanceof HttpErrorResponse && err.status === 404 && view.path) {
            this.openFolder('');
            return;
          }
          if (showLoading) this.toasts.error(this.readError(err, 'Bibliothek konnte nicht geladen werden.'));
        },
      });
      return;
    }

    let request: Observable<SearchResponse>;
    const serverSort = this.sort() === 'path' ? 'path' : 'name';
    if (view.type === 'kind') request = this.api.searchByKind(view.kind, serverSort);
    else if (view.type === 'search') request = this.api.findEntries(view.query, serverSort);
    else if (view.type === 'rated') request = this.api.ratedEntries(Math.max(this.minRating(), 4));
    else request = this.api.recentEntries(80);

    this.loadSub = request.subscribe({
      next: (res) => {
        this.configured.set(!!res.configured);
        if (res.root) this.root.set(res.root);
        this.breadcrumbs.set([{ name: 'Bibliothek', relativePath: '' }]);
        this.applyEntries(res.entries ?? []);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (showLoading) this.toasts.error(this.readError(err, 'Suche fehlgeschlagen.'));
      },
    });
  }

  private applyEntries(entries: LibraryEntry[]): void {
    this.entries.set(entries);
    this.revision.update((n) => n + 1);
    const ids = new Set(entries.map((entry) => entry.id));
    const selected = this.selectedId();
    if (selected && !ids.has(selected)) this.selectedId.set(null);
    const multi = this.selectedIds();
    if ([...multi].some((id) => !ids.has(id))) this.selectedIds.set(new Set([...multi].filter((id) => ids.has(id))));
  }

  loadSidebar(): void {
    this.api.stats().subscribe({
      next: (res) => this.counts.set(res.counts ?? {}),
      error: () => {},
    });
    this.api.getLibrary('').subscribe({
      next: (res) => {
        this.configured.set(!!res.configured);
        this.root.set(res.root);
        this.topFolders.set((res.entries ?? []).filter((entry) => entry.type === 'folder'));
      },
      error: () => {},
    });
  }

  loadSlicers(refresh = false): void {
    this.slicersLoading.set(true);
    this.api.slicers(refresh).subscribe({
      next: (res) => this.applySlicers(res),
      error: () => {
        this.slicers.set([]);
        this.slicersLoading.set(false);
      },
    });
  }

  private applySlicers(res: SlicerResponse): void {
    this.slicers.set(res.slicers ?? []);
    this.defaultSlicer.set(res.defaultSlicer ?? null);
    this.slicersLoading.set(false);
  }

  /** „Andere App wählen …“: nativer Dialog (Electron) bzw. Server-Dialog. */
  async addCustomSlicer(): Promise<void> {
    try {
      const picked = await this.desktop.pickApp();
      if (picked === null) return;
      const res = await firstValueFrom(this.api.addCustomSlicer(picked ?? undefined));
      this.applySlicers(res);
      this.toasts.success(`${res.selected?.name ?? 'App'} ist jetzt Standard-Slicer.`);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.error?.code === 'CANCELLED') return;
      this.toasts.error(this.readError(err, 'App konnte nicht hinzugefügt werden.'));
    }
  }

  removeCustomSlicer(id: string): void {
    this.api.removeCustomSlicer(id).subscribe({
      next: (res) => this.applySlicers(res),
      error: (err: unknown) => this.toasts.error(this.readError(err, 'App konnte nicht entfernt werden.')),
    });
  }

  private persistUiState(): void {
    if (!this.ready()) return;
    if (this.uiStateTimer) clearTimeout(this.uiStateTimer);
    this.uiStateTimer = setTimeout(() => {
      const state: UiState = {
        lastPath: this.isFolderView() ? this.currentFolder() : this.folderBeforeSearch,
        layout: this.layout(),
        sort: this.sort(),
        minRating: this.minRating(),
      };
      this.api.saveUiState(state).subscribe({ error: () => {} });
    }, UI_STATE_DEBOUNCE_MS);
  }

  // --- Bibliotheksordner ---

  async pickLibrary(): Promise<boolean> {
    this.busy.set(true);
    try {
      const nativePath = await this.desktop.pickFolder();
      if (nativePath === null) return false; // abgebrochen
      const res = await firstValueFrom(
        nativePath === undefined ? this.api.pickLibraryFolder() : this.api.setLibraryPath(nativePath),
      );
      this.afterLibrarySwitch(res.root);
      return true;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.error?.code === 'CANCELLED') return false;
      this.toasts.error(this.readError(err, 'Ordner konnte nicht ausgewählt werden.'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async setLibraryPath(path: string): Promise<boolean> {
    return this.run(async () => {
      const res = await firstValueFrom(this.api.setLibraryPath(path));
      this.afterLibrarySwitch(res.root);
    }, 'Pfad konnte nicht gesetzt werden.');
  }

  private afterLibrarySwitch(root: string): void {
    this.configured.set(true);
    this.root.set(root);
    this.folderBeforeSearch = '';
    this.toasts.success('Bibliotheksordner gespeichert.', root);
    this.openFolder('');
    this.loadSidebar();
  }

  // --- Mutationen ---

  /** Hilfsfunktion: busy setzen, Fehler als Toast melden, Erfolg als boolean liefern. */
  private async run(task: () => Promise<void>, fallbackError: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await task();
      return true;
    } catch (err) {
      this.toasts.error(this.readError(err, fallbackError));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  createFolder(name: string): Promise<boolean> {
    return this.run(async () => {
      const folder = await firstValueFrom(this.api.createFolder(name, this.currentFolder()));
      this.toasts.success(`Ordner „${folder.name}“ angelegt.`);
      this.refresh(false);
      this.select(folder.relativePath);
    }, 'Ordner konnte nicht angelegt werden.');
  }

  createLink(name: string, url: string, options: { meta?: LinkMetaInput; allowDuplicate?: boolean } = {}): Promise<boolean> {
    return this.run(async () => {
      const link = await firstValueFrom(this.api.createLink(name, url, this.currentFolder(), options));
      this.toasts.success(`Link „${link.name}“ gespeichert.`);
      this.refresh(false);
      this.select(link.id);
    }, 'Link konnte nicht gespeichert werden.');
  }

  updateLink(entry: LibraryEntry, patch: { name?: string; url?: string; meta?: LinkMetaInput }): Promise<boolean> {
    return this.run(async () => {
      await firstValueFrom(this.api.updateLink(entry.relativePath, patch));
      if (patch.name && patch.name !== entry.name) {
        this.pushUndo({ label: `„${entry.name}“ umbenannt`, inverse: [{ path: entry.relativePath, name: entry.name }] });
      }
      this.toasts.success('Link gespeichert.');
      this.refresh(false);
    }, 'Link konnte nicht gespeichert werden.');
  }

  /** Erreichbarkeit eines Links prüfen (manuell). */
  checkLink(entry: LibraryEntry): void {
    this.api.checkLinkStatus(entry.relativePath).subscribe({
      next: (res) => {
        const label =
          res.status === 'ok'
            ? 'erreichbar'
            : res.status === 'not-found'
              ? 'nicht gefunden (404)'
              : res.status === 'blocked'
                ? 'nicht prüfbar (lokale/private Adresse)'
                : `nicht erreichbar${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''}`;
        if (res.status === 'ok') this.toasts.success(`„${entry.name}“ ist ${label}.`);
        else this.toasts.error(`„${entry.name}“ ist ${label}.`);
        this.refresh(false);
      },
      error: (err: unknown) => this.toasts.error(this.readError(err, 'Prüfung fehlgeschlagen.')),
    });
  }

  private pushUndo(step: UndoStep): void {
    this.undoStack.update((stack) => [...stack, step].slice(-UNDO_LIMIT));
  }

  /** Letztes Umbenennen/Verschieben (auch Stapel) in einem Schritt rückgängig machen. */
  async undo(): Promise<boolean> {
    const step = this.undoStack().at(-1);
    if (!step) {
      this.toasts.show('Nichts zum Widerrufen.');
      return false;
    }
    return this.run(async () => {
      await firstValueFrom(this.api.batch(step.inverse));
      this.undoStack.update((stack) => stack.slice(0, -1));
      this.toasts.success(`Widerrufen: ${step.label}`);
      this.refresh(false);
      this.loadSidebar();
    }, 'Widerrufen fehlgeschlagen.');
  }

  /** Stapelumbenennung (alles oder nichts) mit Undo-Eintrag. */
  async batchRename(ops: BatchOp[]): Promise<boolean> {
    if (!ops.length) return false;
    return this.run(async () => {
      const res = await firstValueFrom(this.api.batch(ops));
      const byFrom = new Map(ops.map((op) => [op.path, op]));
      const inverse: BatchOp[] = res.results.map((r) => {
        const original = r.from.split('/').pop() ?? r.from;
        // Links behalten ihren Pfad; Rückbenennung über den alten Namen.
        const linkOld = byFrom.get(r.from) && r.from.startsWith('link/') ? this.entries().find((e) => e.id === r.from)?.name : null;
        return { path: r.to, name: linkOld ?? original };
      });
      this.pushUndo({ label: `${res.results.length} ${res.results.length === 1 ? 'Eintrag' : 'Einträge'} umbenannt`, inverse });
      this.toasts.success(`${res.results.length} ${res.results.length === 1 ? 'Eintrag' : 'Einträge'} umbenannt.`, 'Mit ⌘Z rückgängig machen.');
      this.select(null);
      this.refresh(false);
      this.loadSidebar();
    }, 'Stapelumbenennung fehlgeschlagen.');
  }

  rename(entry: LibraryEntry, name: string): Promise<boolean> {
    return this.run(async () => {
      const res = await firstValueFrom(this.api.renameEntry(entry.relativePath, name));
      this.pushUndo({ label: `„${entry.name}“ umbenannt`, inverse: [{ path: isLinkEntry(entry) ? entry.relativePath : res.relativePath, name: entry.name }] });
      this.toasts.success(`Umbenannt in „${res.name}“.`);
      this.select(isLinkEntry(entry) ? entry.id : res.relativePath);
      this.refresh(false);
      this.loadSidebar();
    }, 'Umbenennen fehlgeschlagen.');
  }

  move(entry: LibraryEntry, destination: string): Promise<boolean> {
    if ((entry.parentPath ?? '') === destination) {
      this.toasts.show('Der Eintrag liegt bereits in diesem Ordner.');
      return Promise.resolve(false);
    }
    return this.run(async () => {
      const res = await firstValueFrom(this.api.moveEntry(entry.relativePath, destination));
      this.pushUndo({
        label: `„${entry.name}“ verschoben`,
        inverse: [{ path: isLinkEntry(entry) ? entry.relativePath : res.relativePath, destination: entry.parentPath ?? '' }],
      });
      const where = destination ? destination.split('/').join(' / ') : 'Bibliothek';
      this.toasts.success(`„${entry.name}“ nach „${where}“ verschoben.`);
      this.refresh(false);
      this.loadSidebar();
    }, 'Verschieben fehlgeschlagen.');
  }

  trash(entry: LibraryEntry): Promise<boolean> {
    return this.run(async () => {
      const res = await firstValueFrom(this.api.deleteEntry(entry.relativePath));
      this.toasts.success(
        res.trashed ? `„${entry.name}“ in den Papierkorb gelegt.` : `Link „${entry.name}“ entfernt.`,
      );
      this.refresh(false);
      this.loadSidebar();
    }, 'Löschen fehlgeschlagen.');
  }

  /** Bewertung setzen (0 = entfernen) – optimistisch, bei Fehler zurückrollen. */
  async setRating(entry: LibraryEntry, rating: number): Promise<void> {
    const previous = entry.rating ?? null;
    const next = rating > 0 ? rating : null;
    const patch = (value: number | null) =>
      this.entries.update((list) =>
        list.map((item) => (item.id === entry.id ? { ...item, rating: value } : item)),
      );
    patch(next);
    try {
      await firstValueFrom(this.api.updateMeta(entry.relativePath, { rating }));
    } catch (err) {
      patch(previous);
      this.toasts.error(this.readError(err, 'Bewertung konnte nicht gespeichert werden.'));
    }
  }

  uploadFiles(files: File[], parent = this.currentFolder()): Promise<boolean> {
    return this.run(async () => {
      const res = await firstValueFrom(this.api.uploadFiles(parent, files));
      const renamed = res.files.filter((file) => file.renamed);
      this.toasts.success(
        `${res.files.length} ${res.files.length === 1 ? 'Datei' : 'Dateien'} importiert.`,
        renamed.length
          ? `Umbenannt wegen Namenskonflikt: ${renamed.map((f) => f.name).join(', ')}`
          : undefined,
      );
      this.refresh(false);
      this.loadSidebar();
    }, 'Dateien konnten nicht importiert werden.');
  }

  importPaths(paths: string[]): Promise<boolean> {
    return this.run(async () => {
      const res = await firstValueFrom(this.api.importPaths(this.currentFolder(), paths));
      const details: string[] = [];
      if (res.renamed.length) details.push(`Umbenannt: ${res.renamed.map((r) => r.to).join(', ')}`);
      if (res.skipped.length) {
        details.push(`Übersprungen: ${res.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`);
      }
      const message = res.fileCount
        ? `${res.fileCount} ${res.fileCount === 1 ? 'Datei' : 'Dateien'} nach „${this.locationLabel()}“ importiert.`
        : 'Keine unterstützten Dateien gefunden.';
      if (res.fileCount) this.toasts.success(message, details.join(' · ') || undefined);
      else this.toasts.error(message, details.join(' · ') || undefined);
      this.refresh(false);
      this.loadSidebar();
    }, 'Import fehlgeschlagen.');
  }

  reveal(entry: LibraryEntry): void {
    if (isLinkEntry(entry)) return;
    this.api.revealInFinder(entry.relativePath).subscribe({
      error: (err: unknown) => this.toasts.error(this.readError(err, 'Finder konnte nicht geöffnet werden.')),
    });
  }

  openLink(entry: LibraryEntry): void {
    const url = entry.url?.trim();
    if (!url) {
      this.toasts.error('Link hat keine gültige URL.');
      return;
    }
    this.api.openUrl(url).subscribe({
      error: () => window.open(url, '_blank', 'noopener,noreferrer'),
    });
  }

  /** Im gewählten Standard-Slicer öffnen (Server prüft Installation und Dateityp). */
  openInSlicer(entry: LibraryEntry): void {
    const slicer = this.activeSlicer();
    this.api.openInSlicer(entry.relativePath, slicer?.id).subscribe({
      next: (res) => this.toasts.show(`Wird in ${res.slicer} geöffnet …`),
      error: (err: unknown) => this.toasts.error(this.readError(err, 'Slicer konnte nicht geöffnet werden.')),
    });
  }

  setDefaultSlicer(id: string | null): void {
    this.api.updateSettings({ slicer: id }).subscribe({
      next: (settings) => this.defaultSlicer.set(settings.slicer),
      error: (err: unknown) => this.toasts.error(this.readError(err, 'Einstellung konnte nicht gespeichert werden.')),
    });
  }

  copyPath(entry: LibraryEntry): void {
    const root = this.root();
    const value = isLinkEntry(entry) ? (entry.url ?? '') : root ? `${root}/${entry.relativePath}` : entry.relativePath;
    void navigator.clipboard
      ?.writeText(value)
      .then(() => this.toasts.show(isLinkEntry(entry) ? 'URL kopiert.' : 'Pfad kopiert.'))
      .catch(() => this.toasts.error('Kopieren nicht möglich.'));
  }

  readError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message = err.error?.error;
      if (typeof message === 'string' && message.trim()) return message;
      if (err.status === 0) return 'Lokale API nicht erreichbar. Im Dev-Modus `npm start` verwenden.';
      if (err.status === 401) return 'Nicht autorisiert – bitte Printnest neu starten.';
    }
    return fallback;
  }
}
