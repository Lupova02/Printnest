import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal } from '@angular/core';
import { LibraryEntry, LibraryService } from '../../../core/services/library.service';
import { ThumbRequest, ThumbnailService } from '../../../core/services/thumbnail.service';
import { Icon } from '../../../shared/icon/icon';
import { extensionOf, isLinkEntry } from '../dashboard.utils';

type ThumbMode = 'folder' | 'link' | 'image' | 'video' | 'model' | 'generic';

/** Priorität in der Thumbnail-Warteschlange. */
const PRIORITY_VISIBLE = 0;
const PRIORITY_BUFFER = 1;

/**
 * Vorschaubild für Liste/Raster. Die Liste ist virtualisiert – eine Kachel existiert nur im
 * Sichtbereich plus Puffer. Geladen wird über die Thumbnail-Warteschlange (max. 3 parallel,
 * sichtbare zuerst); verlässt die Kachel das DOM, wird ihr Request abgebrochen.
 */
@Component({
  selector: 'app-entry-thumb',
  imports: [Icon],
  templateUrl: './entry-thumb.html',
  styleUrl: './entry-thumb.scss',
  host: {
    '[attr.data-kind]': 'kindAttr()',
    '[class.is-card]': "size() === 'card'",
    '[class.is-loaded]': 'loaded()',
  },
})
export class EntryThumb {
  private readonly api = inject(LibraryService);
  private readonly thumbs = inject(ThumbnailService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly entry = input.required<LibraryEntry>();
  readonly size = input<'row' | 'card'>('row');

  /** Im Sichtbereich (nicht nur im Puffer). */
  protected readonly inView = signal(false);
  protected readonly src = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  private sourceKey = '';
  private abort: AbortController | null = null;
  private setPriority: ((priority: number) => void) | null = null;

  protected readonly mode = computed<ThumbMode>(() => {
    const entry = this.entry();
    if (entry.type === 'folder') return 'folder';
    if (isLinkEntry(entry)) return entry.linkMeta?.hasImage ? 'image' : 'link';
    switch (entry.kind) {
      case 'img':
      case 'pdf':
      case 'f3d':
        return 'image';
      case 'mp4':
        return 'video';
      case 'stl':
      case '3mf':
        return 'model';
      default:
        return 'generic';
    }
  });

  protected readonly kindAttr = computed(() => {
    const entry = this.entry();
    return entry.type === 'folder' ? 'folder' : (entry.kind ?? 'file');
  });

  protected readonly extLabel = computed(() => extensionOf(this.entry().name).toUpperCase() || 'DATEI');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.inView.set(true);
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        this.inView.set(visible);
        this.setPriority?.(visible ? PRIORITY_VISIBLE : PRIORITY_BUFFER);
      });
      observer.observe(this.host.nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => this.abort?.abort());

    // Quelle bestimmen, sobald die Kachel existiert bzw. wenn sich die Datei ändert.
    effect(() => {
      const entry = this.entry();
      const mode = this.mode();
      const version = `${entry.updatedAt ?? ''}:${entry.size ?? ''}`;
      const width = this.size() === 'card' ? 480 : 160;
      const key = `${mode}|${entry.relativePath}|${version}|${mode === 'image' && entry.kind !== 'img' ? width : ''}`;
      if (key === this.sourceKey) return;
      this.sourceKey = key;
      this.abort?.abort();
      this.abort = null;
      this.loaded.set(false);
      this.failed.set(false);
      this.src.set(null);

      if (mode === 'video') {
        this.src.set(`${this.api.mediaUrl(entry.relativePath)}#t=0.5`);
        return;
      }
      const request = this.requestFor(entry, mode, width, version, key);
      if (!request) return;
      const hit = this.thumbs.cached(key);
      if (hit) {
        this.src.set(hit);
        return;
      }
      const abort = new AbortController();
      this.abort = abort;
      const handle = this.thumbs.request(request, {
        priority: this.inView() ? PRIORITY_VISIBLE : PRIORITY_BUFFER,
        signal: abort.signal,
      });
      this.setPriority = handle.setPriority;
      handle.promise.then(
        (url) => {
          if (abort.signal.aborted) return;
          if (url) this.src.set(url);
          else this.failed.set(true);
        },
        () => {
          if (!abort.signal.aborted) this.failed.set(true);
        },
      );
    });
  }

  private requestFor(entry: LibraryEntry, mode: ThumbMode, width: number, version: string, key: string): ThumbRequest | null {
    const v = `&v=${encodeURIComponent(version)}`;
    if (mode === 'image') {
      if (isLinkEntry(entry)) return { key, url: this.api.linkImageUrl(entry.relativePath) };
      const url = entry.kind === 'img' ? this.api.mediaUrl(entry.relativePath) : this.api.previewUrl(entry.relativePath, width);
      return { key, url: `${url}${v}` };
    }
    if (mode === 'model') {
      return {
        key,
        url: `${this.api.thumbUrl(entry.relativePath)}${v}`,
        model: { relativePath: entry.relativePath, kind: entry.kind === '3mf' ? '3mf' : 'stl' },
      };
    }
    return null;
  }

  protected onLoad(): void {
    this.loaded.set(true);
  }

  protected onError(): void {
    this.failed.set(true);
  }
}
