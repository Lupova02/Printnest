import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { BatchOp, LibraryEntry } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { Icon } from '../../../../shared/icon/icon';
import { BatchRow, detectConflicts, rowsToOps } from '../../naming/batch-plan';
import { NameAssistService } from '../../naming/name-assist.service';
import {
  FIELD_LABELS,
  NameSchema,
  SCHEMA_PRESETS,
  applySchema,
  cleanFileName,
  diffNames,
  guessSchema,
  parseFileName,
} from '../../naming/name-cleanup';

export type BatchMode = 'clean' | 'schema' | 'replace';

/**
 * Stapelumbenennung: mehrere Einträge mit Vorher/Nachher-Diff, Konflikterkennung und
 * Anwenden in einem Schritt (⌘Z macht alles auf einmal rückgängig).
 */
@Component({
  selector: 'app-batch-rename-dialog',
  imports: [DialogDirective, Icon],
  templateUrl: './batch-rename-dialog.html',
  styleUrl: './batch-rename-dialog.scss',
})
export class BatchRenameDialog {
  private readonly assist = inject(NameAssistService);

  readonly entries = input.required<LibraryEntry[]>();
  /** Alle Einträge des Ordners (für Konflikte mit bestehenden Namen). */
  readonly siblings = input<LibraryEntry[]>([]);
  readonly folder = input('');
  readonly folderLabel = input('Bibliothek');
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly apply = output<BatchOp[]>();

  protected readonly presets = SCHEMA_PRESETS;
  protected readonly fieldLabels = FIELD_LABELS;
  protected readonly mode = signal<BatchMode>('clean');
  protected readonly presetId = signal<string>('folder');
  protected readonly rememberSchema = signal(true);
  protected readonly find = signal('');
  protected readonly replaceWith = signal('');
  protected readonly use3mfTitle = signal(false);
  private readonly titles = signal<Record<string, string>>({});
  /** Manuell bearbeitete Zielnamen (überschreiben Vorschläge). */
  protected readonly manual = signal<Record<string, string>>({});
  private readonly excluded = signal<ReadonlySet<string>>(new Set());

  protected readonly has3mf = computed(() => this.entries().some((e) => e.kind === '3mf'));

  /** Gespeichertes oder aus Geschwistern erratenes Ordner-Schema. */
  protected readonly folderSchema = computed<NameSchema | null>(
    () => this.assist.schemaFor(this.folder()) ?? guessSchema(this.siblings().filter((s) => s.type === 'file').map((s) => s.name)),
  );

  protected readonly schema = computed<NameSchema>(() => {
    if (this.presetId() === 'folder' && this.folderSchema()) return this.folderSchema()!;
    return (this.presets.find((p) => p.id === this.presetId()) ?? this.presets[1]).schema;
  });

  protected readonly schemaLabel = computed(() =>
    this.schema()
      .fields.map((f) => this.fieldLabels[f])
      .join(this.schema().separator),
  );

  /** Vorschlag je Eintrag nach Modus. */
  private suggest(entry: LibraryEntry): string {
    const hints = this.assist.hints();
    const title = this.use3mfTitle() ? this.titles()[entry.relativePath] : undefined;
    switch (this.mode()) {
      case 'clean': {
        if (title) return applySchema(parseFileName(entry.name, hints), { fields: ['model', 'variant', 'version'], separator: ' – ' }, { model: title });
        return cleanFileName(entry.name, hints);
      }
      case 'schema':
        return applySchema(parseFileName(entry.name, hints), this.schema(), title ? { model: title } : {});
      case 'replace': {
        const needle = this.find();
        if (!needle) return entry.name;
        const dot = entry.name.lastIndexOf('.');
        const base = dot > 0 && entry.type === 'file' ? entry.name.slice(0, dot) : entry.name;
        const ext = dot > 0 && entry.type === 'file' ? entry.name.slice(dot) : '';
        return base.split(needle).join(this.replaceWith()) + ext;
      }
    }
  }

  protected readonly rows = computed<BatchRow[]>(() => {
    const manual = this.manual();
    const excluded = this.excluded();
    return this.entries().map((entry) => ({
      entry,
      before: entry.name,
      after: manual[entry.id] ?? this.suggest(entry),
      include: !excluded.has(entry.id),
    }));
  });

  protected readonly conflicts = computed(() => detectConflicts(this.rows(), this.siblings()));
  protected readonly ops = computed(() => rowsToOps(this.rows()));
  protected readonly canApply = computed(() => this.ops().length > 0 && !this.conflicts().size && !this.busy());

  protected readonly diff = diffNames;
  protected tagsFor(name: string): string[] {
    return parseFileName(name).tags;
  }

  constructor() {
    void this.assist.load().then(() => {
      if (!this.folderSchema()) this.presetId.set('full');
    });
    // 3MF-Titel erst laden, wenn gewünscht.
    effect(() => {
      if (!this.use3mfTitle()) return;
      const paths = this.entries().filter((e) => e.kind === '3mf').map((e) => e.relativePath);
      untracked(() => {
        for (const path of paths) {
          if (path in this.titles()) continue;
          void this.assist.modelMeta(path).then((meta) => {
            const title = meta?.title?.trim();
            if (title) this.titles.update((t) => ({ ...t, [path]: title }));
          });
        }
      });
    });
  }

  protected setMode(mode: BatchMode): void {
    this.mode.set(mode);
    this.manual.set({});
  }

  protected edit(entry: LibraryEntry, value: string): void {
    this.manual.update((m) => ({ ...m, [entry.id]: value }));
  }

  protected toggle(entry: LibraryEntry, include: boolean): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (include) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  }

  protected submit(): void {
    if (!this.canApply()) return;
    const source = this.mode() === 'schema' ? 'schema' : this.mode() === 'clean' ? 'clean' : 'replace';
    // Lernen: übernommene Vorschläge stärken, Korrekturen merken.
    for (const row of this.rows().filter((r) => r.include && r.after !== r.before)) {
      const suggested = this.suggest(row.entry);
      if (row.after === suggested) this.assist.feedback(source, true);
      else this.assist.feedback(source, false, { original: row.before, suggested, final: row.after });
    }
    if (this.mode() === 'schema' && this.rememberSchema()) void this.assist.saveSchema(this.folder(), this.schema());
    this.apply.emit(this.ops());
  }
}
