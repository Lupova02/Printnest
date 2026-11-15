import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { withToken } from './api-token';
import { DesktopService } from './desktop.service';

export type FileKind = 'stl' | '3mf' | 'f3d' | 'pdf' | 'mp4' | 'img' | 'link';
export type EntryType = 'folder' | 'file' | 'link';
/** Serverseitige Sortierung (Suche/Typfilter). */
export type SortMode = 'name' | 'path';

export interface LibraryEntry {
  id: string;
  name: string;
  type: EntryType;
  relativePath: string;
  parentPath?: string;
  parentLabel?: string;
  kind: FileKind | null;
  kinds: FileKind[];
  url?: string | null;
  size: number | null;
  childCount: number | null;
  updatedAt: string | null;
  /** Druck-Bewertung 1–5 (null = unbewertet). */
  rating?: number | null;
  /** Nur Links: erkannte Portal-/Metadaten. */
  linkMeta?: LinkMeta | null;
}

/** Zusatzdaten eines Links (Portal, Ersteller, Erreichbarkeit). */
export interface LinkMeta {
  portal?: string | null;
  portalLabel?: string | null;
  creator?: string | null;
  title?: string | null;
  description?: string | null;
  hasImage?: boolean;
  /** Ergebnis der letzten Erreichbarkeitsprüfung. */
  status?: 'ok' | 'not-found' | 'error' | 'blocked' | null;
  httpStatus?: number | null;
  checkedAt?: string | null;
}

export interface Breadcrumb {
  name: string;
  relativePath: string;
}

export interface LibraryResponse {
  configured: boolean;
  root: string | null;
  relativePath: string;
  breadcrumbs: Breadcrumb[];
  entries: LibraryEntry[];
  signature: string | null;
}

export interface SearchResponse {
  configured: boolean;
  root?: string;
  kind?: FileKind;
  query?: string;
  sort: SortMode;
  entries: LibraryEntry[];
  signature: string | null;
}

export interface PathResponse {
  configured: boolean;
  root: string;
}

export interface UploadResponse {
  parent: string;
  files: {
    name: string;
    originalName: string;
    renamed: boolean;
    size: number;
    kind: FileKind | null;
  }[];
}

export interface ImportResponse {
  parent: string;
  imported: { name: string; type: 'file' | 'folder'; relativePath: string }[];
  skipped: { name: string; reason: string }[];
  renamed: { from: string; to: string }[];
  fileCount: number;
}

export interface EntryMeta {
  rating?: number;
  note?: string;
  printedAt?: string;
  updatedAt?: string;
}

export interface MetaResponse {
  path: string;
  meta: EntryMeta | null;
}

export interface MetaPatch {
  rating?: number;
  note?: string;
  printedAt?: string;
}

export type KindCounts = Partial<Record<FileKind, number>>;

export interface SlicerInfo {
  id: string;
  name: string;
  installed: boolean;
  appPath: string | null;
  /** Dateiendungen ohne Punkt, die dieser Slicer öffnen kann. */
  extensions: string[];
  technology: 'fdm' | 'resin' | 'custom';
  /** Bundle-ID per Recherche belegt (sonst Erkennung nur über App-Namen). */
  verified: boolean;
  custom: boolean;
}

export interface SlicerResponse {
  slicers: SlicerInfo[];
  installed: Pick<SlicerInfo, 'id' | 'name'>[];
  defaultSlicer: string | null;
  selected: SlicerInfo | null;
}

export interface AppSettings {
  slicer: string | null;
}

/** Dateiendungen, die irgendein Slicer öffnen kann. */
export const SLICER_EXTENSIONS = ['stl', '3mf', 'step', 'stp', 'obj', 'amf'];

/** Ergebnis von /api/link-preview (Server holt OpenGraph/oEmbed, SSRF-geschützt). */
export interface LinkPreview {
  url: string;
  normalizedUrl: string | null;
  portal: string | null;
  portalLabel: string | null;
  title: string | null;
  creator: string | null;
  description: string | null;
  image: string | null;
  suggestedName: string | null;
  error: string | null;
}

export interface LinkPreviewResponse {
  preview: LinkPreview;
  duplicates: { id: string; name: string; parentPath: string }[];
}

/** Metadaten, die beim Speichern eines Links mitgeschickt werden. */
export type LinkMetaInput = Partial<Pick<LinkPreview, 'portal' | 'portalLabel' | 'title' | 'creator' | 'description' | 'image'>>;

/** Eine Änderung im Stapel (Umbenennen und/oder Verschieben). */
export interface BatchOp {
  path: string;
  name?: string;
  destination?: string;
}

export interface BatchResult {
  ok: boolean;
  results: { from: string; to: string; name?: string | null }[];
}

export interface BatchConflict {
  path: string;
  target: string;
  reason: string;
}

/** HTTP-Client für die lokale Printnest-API. */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly http = inject(HttpClient);
  private readonly desktop = inject(DesktopService);

  getLibrary(relativePath = ''): Observable<LibraryResponse> {
    let params = new HttpParams();
    if (relativePath) params = params.set('path', relativePath);
    return this.http.get<LibraryResponse>('/api/library', { params });
  }

  searchByKind(kind: FileKind, sort: SortMode = 'name'): Observable<SearchResponse> {
    const params = new HttpParams().set('kind', kind).set('sort', sort);
    return this.http.get<SearchResponse>('/api/library/search', { params });
  }

  findEntries(query: string, sort: SortMode = 'name'): Observable<SearchResponse> {
    const params = new HttpParams().set('q', query).set('sort', sort);
    return this.http.get<SearchResponse>('/api/library/find', { params });
  }

  ratedEntries(min = 4): Observable<SearchResponse> {
    return this.http.get<SearchResponse>('/api/library/rated', { params: { min } });
  }

  recentEntries(limit = 60): Observable<SearchResponse> {
    return this.http.get<SearchResponse>('/api/library/recent', { params: { limit } });
  }

  stats(): Observable<{ configured: boolean; counts: KindCounts }> {
    return this.http.get<{ configured: boolean; counts: KindCounts }>('/api/library/stats');
  }

  mediaUrl(relativePath: string): string {
    return withToken(`/api/media?path=${encodeURIComponent(relativePath)}`, this.desktop.token);
  }

  /** Serverseitige PNG-Vorschau (F3D eingebettet, PDF erste Seite); `large` = größtes F3D-Vorschaubild. */
  previewUrl(relativePath: string, width?: number, variant: 'thumb' | 'large' = 'thumb'): string {
    const size = width ? `&width=${width}` : '';
    const large = variant === 'large' ? '&variant=large' : '';
    return withToken(`/api/preview?path=${encodeURIComponent(relativePath)}${size}${large}`, this.desktop.token);
  }

  thumbUrl(relativePath: string): string {
    return withToken(`/api/thumb?path=${encodeURIComponent(relativePath)}`, this.desktop.token);
  }

  /** Vorschaubild eines Links (Server holt og:image mit SSRF-Schutz und cacht es). */
  linkImageUrl(linkPath: string): string {
    return withToken(`/api/link-image?path=${encodeURIComponent(linkPath)}`, this.desktop.token);
  }

  saveThumb(relativePath: string, png: Blob): Observable<void> {
    return this.http.put<void>(`/api/thumb?path=${encodeURIComponent(relativePath)}`, png, {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  downloadUrl(relativePath: string): string {
    return withToken(`/api/download?path=${encodeURIComponent(relativePath)}`, this.desktop.token);
  }

  eventsUrl(): string {
    return withToken('/api/events', this.desktop.token);
  }

  pickLibraryFolder(): Observable<PathResponse> {
    return this.http.post<PathResponse>('/api/library/pick', {});
  }

  setLibraryPath(nextPath: string): Observable<PathResponse> {
    return this.http.put<PathResponse>('/api/library/path', { path: nextPath });
  }

  createFolder(name: string, parent = ''): Observable<{ name: string; relativePath: string }> {
    return this.http.post<{ name: string; relativePath: string }>('/api/folders', { name, parent });
  }

  createLink(
    name: string,
    url: string,
    parent = '',
    options: { meta?: LinkMetaInput; allowDuplicate?: boolean } = {},
  ): Observable<LibraryEntry> {
    return this.http.post<LibraryEntry>('/api/links', { name, url, parent, ...options });
  }

  linkPreview(url: string, exclude?: string): Observable<LinkPreviewResponse> {
    return this.http.get<LinkPreviewResponse>('/api/link-preview', { params: exclude ? { url, exclude } : { url } });
  }

  /** Link bearbeiten (Name/URL). */
  updateLink(pathValue: string, patch: { name?: string; url?: string; meta?: LinkMetaInput }): Observable<{ relativePath: string; name: string; url: string }> {
    return this.http.patch<{ relativePath: string; name: string; url: string }>('/api/entries', { path: pathValue, ...patch });
  }

  checkLinkStatus(pathValue: string): Observable<{ status: string; httpStatus: number | null; entry: LibraryEntry | null }> {
    return this.http.post<{ status: string; httpStatus: number | null; entry: LibraryEntry | null }>('/api/links/status', {
      path: pathValue,
    });
  }

  uploadFiles(parent: string, files: File[]): Observable<UploadResponse> {
    const body = new FormData();
    body.append('parent', parent);
    for (const file of files) body.append('files', file, file.name);
    return this.http.post<UploadResponse>('/api/files', body);
  }

  /** Echte Dateipfade (Finder-Drop in Electron) serverseitig kopieren. */
  importPaths(parent: string, paths: string[]): Observable<ImportResponse> {
    return this.http.post<ImportResponse>('/api/import', { parent, paths });
  }

  renameEntry(pathValue: string, name: string): Observable<{ relativePath: string; name: string }> {
    return this.http.patch<{ relativePath: string; name: string }>('/api/entries', {
      path: pathValue,
      name,
    });
  }

  moveEntry(
    pathValue: string,
    destination: string,
  ): Observable<{ relativePath: string; name: string; parentPath?: string }> {
    return this.http.patch<{ relativePath: string; name: string; parentPath?: string }>(
      '/api/entries',
      { path: pathValue, destination },
    );
  }

  /** Mehrere Umbenennungen/Verschiebungen atomar (alles oder nichts); `dryRun` prüft nur. */
  batch(ops: BatchOp[], dryRun = false): Observable<BatchResult> {
    return this.http.post<BatchResult>('/api/entries/batch', { ops, dryRun });
  }

  /** In den Papierkorb legen (Links werden aus der Linkliste entfernt). */
  deleteEntry(pathValue: string): Observable<{ ok: boolean; trashed: boolean }> {
    return this.http.request<{ ok: boolean; trashed: boolean }>('DELETE', '/api/entries', {
      body: { path: pathValue },
    });
  }

  getMeta(pathValue: string): Observable<MetaResponse> {
    return this.http.get<MetaResponse>('/api/meta', { params: { path: pathValue } });
  }

  updateMeta(pathValue: string, patch: MetaPatch): Observable<MetaResponse> {
    return this.http.put<MetaResponse>('/api/meta', { path: pathValue, ...patch });
  }

  revealInFinder(pathValue: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/reveal', { path: pathValue });
  }

  openUrl(url: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/open-url', { url });
  }

  slicers(refresh = false): Observable<SlicerResponse> {
    return this.http.get<SlicerResponse>('/api/slicers', { params: refresh ? { refresh: 1 } : {} });
  }

  openInSlicer(pathValue: string, slicer?: string): Observable<{ ok: boolean; slicer: string }> {
    return this.http.post<{ ok: boolean; slicer: string }>('/api/open-in-slicer', {
      path: pathValue,
      ...(slicer ? { slicer } : {}),
    });
  }

  /** Eigene Slicer-App hinzufügen (ohne Pfad: Server-Dialog) – wird Standard. */
  addCustomSlicer(appPath?: string): Observable<SlicerResponse> {
    return this.http.post<SlicerResponse>('/api/slicers/custom', appPath ? { appPath } : {});
  }

  removeCustomSlicer(id: string): Observable<SlicerResponse> {
    return this.http.delete<SlicerResponse>(`/api/slicers/custom/${encodeURIComponent(id)}`);
  }

  updateSettings(patch: Partial<AppSettings>): Observable<AppSettings> {
    return this.http.put<AppSettings>('/api/settings', patch);
  }

  getUiState<T extends object>(): Observable<Partial<T>> {
    return this.http.get<Partial<T>>('/api/ui-state');
  }

  saveUiState<T extends object>(state: T): Observable<T> {
    return this.http.put<T>('/api/ui-state', state);
  }
}
