import { Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { read3mfMeta } from '../../../../core/three/model-parse';
import { NameAssistService } from '../../naming/name-assist.service';
import { applySchema, cleanFileName, guessSchema, nameSimilarity, parseFileName, withExtension } from '../../naming/name-cleanup';
import { FileKind, LibraryEntry, LibraryService } from '../../../../core/services/library.service';
import {
  AnalyzedItem,
  NameSuggestion,
  SortScheme,
  analyzeFile,
  analyzeLink,
  buildSortSchemes,
  kindDisplayLabel,
} from '../../name-suggestions';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';

export type NameAssistAction =
  | { type: 'create-folder'; name: string }
  | { type: 'create-link'; name: string; url: string }
  | { type: 'upload'; file: File; fileName: string; folderName?: string };

/** Dialog: Datei/Link einfügen, Typ erkennen, Namensvorschläge. */
@Component({
  selector: 'app-name-assist-dialog',
  imports: [DialogDirective],
  templateUrl: './name-assist-dialog.html',
  styleUrl: './name-assist-dialog.scss',
})
export class NameAssistDialog {
  readonly busy = input(false);
  /** Aktueller Ordner (Schema, Kontext) und seine Einträge (Geschwister). */
  readonly folder = input('');
  readonly siblings = input<LibraryEntry[]>([]);
  readonly closed = output<void>();
  readonly action = output<NameAssistAction>();

  private readonly library = inject(LibraryService);
  private readonly assist = inject(NameAssistService);

  constructor() {
    void this.assist.load();
  }

  /**
   * Zusätzliche, lokale Vorschläge: bereinigter Name mit Tags, Titel/Designer aus 3MF-Metadaten,
   * Ordner-Schema (gespeichert oder aus Geschwistern erraten), Ordnerkontext und ähnliche
   * Geschwisterdateien. Sortiert nach gelernter Gewichtung (angenommen/abgelehnt).
   */
  private async enrich(item: AnalyzedItem): Promise<AnalyzedItem> {
    const hints = this.assist.hints();
    const parsed = parseFileName(item.originalName, hints);
    const extra: NameSuggestion[] = [];
    const tags = parsed.tags;
    extra.push({
      id: 'clean',
      kind: 'file',
      label: 'Datei',
      value: cleanFileName(item.originalName, hints),
      reason: tags.length ? `Bereinigt · Tags: ${tags.join(', ')}` : 'Bereinigt (Unterstriche, Versionen, Kopie-Zähler)',
      source: 'clean',
      tags,
    });
    if (item.url) {
      try {
        const { preview } = await firstValueFrom(this.library.linkPreview(item.url));
        if (preview.suggestedName) {
          extra.unshift({
            id: 'link-title',
            kind: 'file',
            label: 'Link',
            value: preview.suggestedName,
            reason: [preview.portalLabel, preview.creator && `von ${preview.creator}`].filter(Boolean).join(' · ') || 'Titel der Seite',
            source: 'link-title',
          });
        }
      } catch {
        // Ohne Seitentitel weiter.
      }
    }
    if (item.file && item.extension === '3mf') {
      try {
        const meta = read3mfMeta(new Uint8Array(await item.file.arrayBuffer()));
        if (meta.title) {
          extra.push({
            id: '3mf-title',
            kind: 'file',
            label: 'Datei',
            value: withExtension([meta.title.replace(/[/\\:]/g, '-'), parsed.variant].filter(Boolean).join(' – '), parsed.extension),
            reason: `Titel aus 3MF${meta.designer ? ` · Designer: ${meta.designer}` : ''}${meta.plates.length ? ` · Platten: ${meta.plates.slice(0, 3).join(', ')}` : ''}`,
            source: '3mf-title',
          });
          extra.push({ id: '3mf-folder', kind: 'folder', label: 'Ordner', value: meta.title.replace(/[/\\:]/g, '-'), reason: 'Ordner nach 3MF-Titel', source: '3mf-title' });
        }
      } catch {
        // Keine lesbaren Metadaten.
      }
    }
    const siblingFiles = this.siblings().filter((e) => e.type === 'file');
    const schema = this.assist.schemaFor(this.folder()) ?? guessSchema(siblingFiles.map((e) => e.name));
    if (schema) {
      extra.push({
        id: 'schema',
        kind: 'file',
        label: 'Datei',
        value: applySchema(parsed, schema),
        reason: this.assist.schemaFor(this.folder()) ? 'Gespeichertes Ordner-Schema' : 'Schema wie die anderen Dateien im Ordner',
        source: 'schema',
      });
    }
    const folderName = this.folder().split('/').filter(Boolean).pop();
    if (folderName && nameSimilarity(folderName, item.originalName) >= 0.5 && parsed.variant) {
      extra.push({
        id: 'folder-context',
        kind: 'file',
        label: 'Datei',
        value: withExtension(`${folderName} – ${parsed.variant}`, parsed.extension),
        reason: `Passt zum Ordner „${folderName}“`,
        source: 'folder',
      });
    }
    const sibling = siblingFiles
      .map((e) => ({ e, score: nameSimilarity(e.name, item.originalName) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)[0];
    if (sibling) {
      const sp = parseFileName(sibling.e.name);
      extra.push({
        id: 'sibling',
        kind: 'variant',
        label: 'Variante',
        value: withExtension([sp.model, parsed.variant ?? parsed.version ?? 'Variante 2'].filter(Boolean).join(' – '), parsed.extension),
        reason: `Ähnlich zu „${sibling.e.name}“ im Ordner`,
        source: 'sibling',
      });
    }
    const merged: NameSuggestion[] = [];
    for (const suggestion of [...extra, ...item.suggestions]) {
      if (!merged.some((m) => m.kind === suggestion.kind && m.value.toLowerCase() === suggestion.value.toLowerCase())) merged.push(suggestion);
    }
    const weight = (s: NameSuggestion) => (s.source ? this.assist.weight(s.source) : 0.45);
    merged.sort((a, b) => weight(b) - weight(a));
    return { ...item, suggestions: merged.slice(0, 12) };
  }

  protected readonly items = signal<AnalyzedItem[]>([]);
  protected readonly analyzing = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly pasteDraft = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly kindDisplayLabel = kindDisplayLabel;

  protected readonly showSortSchemes = signal(false);
  protected readonly sortSchemes = signal<SortScheme[]>([]);
  protected readonly sortContextLabel = signal('');
  private lastSimilarNames: string[] = [];

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
    if (files.length) void this.ingestFiles(files);
  }

  protected onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (files.length) void this.ingestFiles(files);
  }

  protected addFromPaste(): void {
    const raw = this.pasteDraft().trim();
    if (!raw) return;
    if (/^https?:\/\//i.test(raw)) {
      void this.ingestLink(raw);
      this.pasteDraft.set('');
      return;
    }
    this.error.set('Bitte eine http(s)-URL einfügen oder Dateien per Drop wählen.');
  }

  protected clearItems(): void {
    this.items.set([]);
    this.error.set(null);
    this.sortSchemes.set([]);
    this.sortContextLabel.set('');
    this.lastSimilarNames = [];
  }

  protected removeItem(id: string): void {
    // Verworfen: alle Vorschlagsquellen dieses Eintrags leicht abwerten.
    const item = this.items().find((i) => i.id === id);
    for (const source of new Set(item?.suggestions.map((s) => s.source).filter((x): x is string => !!x))) {
      this.assist.feedback(source, false);
    }
    this.items.update((list) => list.filter((entry) => entry.id !== id));
  }

  protected async toggleSortSchemes(): Promise<void> {
    if (this.showSortSchemes()) {
      this.showSortSchemes.set(false);
      return;
    }
    this.showSortSchemes.set(true);
    await this.refreshSortSchemes();
  }

  protected useFolder(item: AnalyzedItem, suggestion: NameSuggestion): void {
    this.learn(suggestion);
    this.action.emit({ type: 'create-folder', name: suggestion.value });
  }

  /** Angenommene Vorschläge stärken ihre Quelle (lokal gespeichert). */
  private learn(suggestion: NameSuggestion): void {
    if (suggestion.source) this.assist.feedback(suggestion.source, true);
  }

  protected useFileUpload(item: AnalyzedItem, suggestion: NameSuggestion, withFolder: boolean): void {
    if (!item.file) return;
    this.learn(suggestion);
    const renamed = new File([item.file], suggestion.value, { type: item.file.type });
    this.action.emit({
      type: 'upload',
      file: renamed,
      fileName: suggestion.value,
      folderName: withFolder ? item.baseTitle || undefined : undefined,
    });
  }

  protected useLink(item: AnalyzedItem, suggestion: NameSuggestion): void {
    if (!item.url) return;
    this.learn(suggestion);
    this.action.emit({ type: 'create-link', name: suggestion.value, url: item.url });
  }

  protected copyValue(value: string): void {
    void navigator.clipboard?.writeText(value);
  }

  protected copyScheme(scheme: SortScheme): void {
    void navigator.clipboard?.writeText(scheme.examples.join('\n'));
  }

  private async refreshSortSchemes(): Promise<void> {
    const items = this.items();
    if (!items.length) {
      this.sortSchemes.set([]);
      this.sortContextLabel.set('');
      this.error.set('Zuerst eine Datei oder einen Link einfügen.');
      return;
    }

    this.error.set(null);
    this.analyzing.set(true);

    // Bevorzugt das Item mit den meisten ähnlichen Treffern
    const focus = [...items].sort((a, b) => b.similarCount - a.similarCount)[0];
    let similarNames = this.lastSimilarNames;
    if (!similarNames.length || focus.similarCount > 0) {
      const similar = await this.fetchSimilar(focus.originalName, focus.fileKind);
      similarNames = similar.filter((e) => e.type === 'file').map((e) => e.name);
      this.lastSimilarNames = similarNames;
    }

    const count = Math.max(focus.similarCount + 1, items.length, 3);
    const schemes = buildSortSchemes({
      baseTitle: focus.baseTitle || focus.originalName,
      extension: focus.extension,
      similarNames,
      count,
    });

    this.sortContextLabel.set(focus.baseTitle || focus.originalName);
    this.sortSchemes.set(schemes);
    this.analyzing.set(false);
  }

  private async ingestFiles(files: File[]): Promise<void> {
    this.analyzing.set(true);
    this.error.set(null);
    const next: AnalyzedItem[] = [];
    for (const file of files) {
      const similar = await this.fetchSimilar(file.name, detectKindSafe(file.name));
      this.lastSimilarNames = similar.filter((e) => e.type === 'file').map((e) => e.name);
      next.push(await this.enrich(analyzeFile(file, similar)));
    }
    this.items.update((prev) => [...next, ...prev]);
    this.analyzing.set(false);
    if (this.showSortSchemes()) await this.refreshSortSchemes();
  }

  private async ingestLink(url: string): Promise<void> {
    this.analyzing.set(true);
    this.error.set(null);
    try {
      new URL(url);
    } catch {
      this.error.set('Ungültige URL.');
      this.analyzing.set(false);
      return;
    }
    const similar = await this.fetchSimilar(url, 'link');
    this.lastSimilarNames = similar.filter((e) => e.type === 'file' || e.type === 'link').map((e) => e.name);
    const item = await this.enrich(analyzeLink(url, similar));
    this.items.update((prev) => [item, ...prev]);
    this.analyzing.set(false);
    if (this.showSortSchemes()) await this.refreshSortSchemes();
  }

  private fetchSimilar(nameOrUrl: string, kind: FileKind | null): Promise<LibraryEntry[]> {
    return new Promise((resolve) => {
      const tokens = nameOrUrl
        .split(/[^a-zA-Z0-9äöüÄÖÜß]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
        .slice(0, 2);

      if (kind && kind !== 'link') {
        this.library.searchByKind(kind, 'name').subscribe({
          next: (res) => {
            const entries = res.entries || [];
            if (!tokens.length) {
              resolve(entries.slice(0, 80));
              return;
            }
            const filtered = entries.filter((e) =>
              tokens.some((t) => e.name.toLowerCase().includes(t.toLowerCase())),
            );
            resolve(filtered.length ? filtered : entries.slice(0, 40));
          },
          error: () => resolve([]),
        });
        return;
      }

      const q = tokens[0];
      if (!q) {
        resolve([]);
        return;
      }
      this.library.findEntries(q, 'name').subscribe({
        next: (res) => resolve(res.entries || []),
        error: () => resolve([]),
      });
    });
  }
}

function detectKindSafe(name: string): FileKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, FileKind> = {
    stl: 'stl',
    '3mf': '3mf',
    f3d: 'f3d',
    pdf: 'pdf',
    mp4: 'mp4',
    png: 'img',
    jpg: 'img',
    jpeg: 'img',
    webp: 'img',
    gif: 'img',
    bmp: 'img',
  };
  return map[ext] ?? null;
}
