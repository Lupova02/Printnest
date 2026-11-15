import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { DesktopService } from '../../../../core/services/desktop.service';
import { LibraryEntry, LibraryService, LinkMetaInput, LinkPreviewResponse } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { Icon } from '../../../../shared/icon/icon';
import { nameSimilarity } from '../../naming/name-cleanup';

const PREVIEW_DEBOUNCE_MS = 400;
/** Ab dieser Wortähnlichkeit gilt eine Datei als „gehört zu …“. */
const RELATED_MIN = 0.34;

export interface LinkDialogResult {
  name: string;
  url: string;
  meta: LinkMetaInput;
  allowDuplicate: boolean;
  edit: LibraryEntry | null;
}

/** Ist der Text eine http(s)-URL? */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Link-Assistent: URL einfügen genügt – der Server holt Titel, Beschreibung und Bild,
 * erkennt 3D-Portale und Duplikate; passende Dateien im Ordner werden als „gehört zu …“ gezeigt.
 * Im Bearbeiten-Modus lassen sich Name/URL ändern und die Erreichbarkeit prüfen.
 */
@Component({
  selector: 'app-link-dialog',
  imports: [DialogDirective, Icon],
  templateUrl: './link-dialog.html',
  styleUrl: './link-dialog.scss',
})
export class LinkDialog {
  private readonly api = inject(LibraryService);
  private readonly desktop = inject(DesktopService);

  readonly locationLabel = input.required<string>();
  readonly busy = input(false);
  /** Vorbelegte URL (Drag & Drop einer URL ins Fenster). */
  readonly initialUrl = input<string | null>(null);
  /** Bestehender Link → Bearbeiten-Modus. */
  readonly editEntry = input<LibraryEntry | null>(null);
  /** Einträge des aktuellen Ordners (für „gehört zu …“). */
  readonly siblings = input<LibraryEntry[]>([]);
  readonly closed = output<void>();
  readonly saved = output<LinkDialogResult>();
  readonly checkStatus = output<LibraryEntry>();

  protected readonly name = signal('');
  protected readonly url = signal('');
  protected readonly nameTouched = signal(false);
  protected readonly loading = signal(false);
  protected readonly result = signal<LinkPreviewResponse | null>(null);
  protected readonly allowDuplicate = signal(false);
  protected readonly clipboardError = signal<string | null>(null);
  protected readonly imageFailed = signal(false);

  protected readonly urlValid = computed(() => isHttpUrl(this.url()));
  protected readonly preview = computed(() => this.result()?.preview ?? null);
  protected readonly duplicates = computed(() => this.result()?.duplicates ?? []);
  protected readonly isEdit = computed(() => !!this.editEntry());

  /** Dateien im Ordner, die zum Link passen (ähnlicher Name). */
  protected readonly related = computed(() => {
    const p = this.preview();
    const reference = this.name().trim() || p?.title || '';
    if (!reference) return [];
    return this.siblings()
      .filter((e) => e.type === 'file')
      .map((e) => ({ entry: e, score: nameSimilarity(reference, e.name) }))
      .filter((r) => r.score >= RELATED_MIN)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.entry);
  });

  protected readonly canSave = computed(
    () => !!this.name().trim() && this.urlValid() && !this.busy() && (!this.duplicates().length || this.allowDuplicate()),
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  private sub: Subscription | null = null;

  constructor() {
    // Vorbelegen (Bearbeiten oder per Drag & Drop übergebene URL).
    effect(() => {
      const edit = this.editEntry();
      const initial = this.initialUrl();
      untracked(() => {
        if (edit) {
          this.name.set(edit.name);
          this.nameTouched.set(true);
          this.setUrl(edit.url ?? '');
        } else if (initial) {
          this.setUrl(initial);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      this.sub?.unsubscribe();
    });
  }

  protected onUrlInput(value: string): void {
    this.setUrl(value);
  }

  protected onNameInput(value: string): void {
    this.name.set(value);
    this.nameTouched.set(true);
  }

  /** Zwischenablage nur nach ausdrücklichem Klick lesen. */
  protected async pasteFromClipboard(): Promise<void> {
    this.clipboardError.set(null);
    try {
      const text = (await this.desktop.readClipboardText()).trim();
      if (isHttpUrl(text)) this.setUrl(text);
      else this.clipboardError.set('In der Zwischenablage ist keine http(s)-URL.');
    } catch {
      this.clipboardError.set('Zwischenablage nicht lesbar.');
    }
  }

  private setUrl(value: string): void {
    this.url.set(value);
    this.allowDuplicate.set(false);
    this.imageFailed.set(false);
    if (this.timer) clearTimeout(this.timer);
    this.sub?.unsubscribe();
    if (!isHttpUrl(value)) {
      this.result.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.timer = setTimeout(() => this.fetchPreview(value.trim()), PREVIEW_DEBOUNCE_MS);
  }

  private fetchPreview(url: string): void {
    this.sub = this.api.linkPreview(url, this.editEntry()?.relativePath).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.result.set(res);
        if (!this.nameTouched() && res.preview.suggestedName) this.name.set(res.preview.suggestedName);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loading.set(false);
        this.result.set({
          preview: {
            url,
            normalizedUrl: null,
            portal: null,
            portalLabel: null,
            title: null,
            creator: null,
            description: null,
            image: null,
            suggestedName: null,
            error: err?.error?.error ?? 'Vorschau nicht verfügbar.',
          },
          duplicates: [],
        });
      },
    });
  }

  protected submit(): void {
    if (!this.canSave()) return;
    const p = this.preview();
    this.saved.emit({
      name: this.name().trim(),
      url: p?.url && p.url !== this.url().trim() && !this.isEdit() ? p.url : this.url().trim(),
      meta: p
        ? { portal: p.portal, portalLabel: p.portalLabel, title: p.title, creator: p.creator, description: p.description, image: p.image }
        : {},
      allowDuplicate: this.allowDuplicate(),
      edit: this.editEntry(),
    });
  }

  protected folderLabel(path: string): string {
    return path ? path.split('/').join(' / ') : 'Bibliothek';
  }
}
