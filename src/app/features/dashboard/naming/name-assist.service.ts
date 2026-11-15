import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CleanupHints, NameSchema, learnFromCorrection } from './name-cleanup';

export interface ModelMeta {
  title?: string;
  designer?: string;
  description?: string;
  plates: string[];
  objects: string[];
}

interface NameAssistData {
  schemas: Record<string, NameSchema>;
  sources: Record<string, { accepted: number; rejected: number }>;
  keep: Record<string, number>;
  drop: Record<string, number>;
}

/** Ab dieser Häufigkeit gilt eine Korrektur als gelernt. */
const LEARN_THRESHOLD = 1;

/**
 * Lokale Lerndaten des Namens-Assistenten (userData, keine Cloud): Ordner-Schemata,
 * angenommene/abgelehnte Vorschlagsquellen und Wörter, die behalten bzw. entfernt werden sollen.
 */
@Injectable({ providedIn: 'root' })
export class NameAssistService {
  private readonly http = inject(HttpClient);
  private readonly data = signal<NameAssistData>({ schemas: {}, sources: {}, keep: {}, drop: {} });
  private loaded: Promise<void> | null = null;

  readonly hints = computed<CleanupHints>(() => {
    const { keep, drop } = this.data();
    const pick = (counts: Record<string, number>) =>
      new Set(Object.entries(counts).filter(([, n]) => n >= LEARN_THRESHOLD).map(([w]) => w));
    return { keep: pick(keep), drop: pick(drop) };
  });

  load(force = false): Promise<void> {
    if (this.loaded && !force) return this.loaded;
    this.loaded = firstValueFrom(this.http.get<Partial<NameAssistData>>('/api/name-assist'))
      .then((data) =>
        this.data.set({ schemas: data.schemas ?? {}, sources: data.sources ?? {}, keep: data.keep ?? {}, drop: data.drop ?? {} }),
      )
      .catch(() => {});
    return this.loaded;
  }

  schemaFor(folder: string): NameSchema | null {
    return this.data().schemas[folder] ?? null;
  }

  async saveSchema(folder: string, schema: NameSchema | null): Promise<void> {
    const data = await firstValueFrom(this.http.put<NameAssistData>('/api/name-assist/schema', { folder, schema }));
    this.data.set(data);
  }

  /** Gewicht einer Vorschlagsquelle (Laplace-geglättet, 0–1; unbekannt = 0,5). */
  weight(source: string): number {
    const s = this.data().sources[source];
    return s ? (s.accepted + 1) / (s.accepted + s.rejected + 2) : 0.5;
  }

  /** Annahme/Ablehnung und ggf. Korrektur des Nutzers zurückmelden. */
  feedback(source: string, accepted: boolean, correction?: { original: string; suggested: string; final: string }): void {
    const learned = correction ? learnFromCorrection(correction.original, correction.suggested, correction.final) : { keep: [], drop: [] };
    this.http
      .post<NameAssistData>('/api/name-assist/feedback', { source, accepted, ...learned })
      .subscribe({ next: (data) => this.data.set(data), error: () => {} });
  }

  modelMeta(path: string): Promise<ModelMeta | null> {
    return firstValueFrom(this.http.get<{ meta: ModelMeta | null }>('/api/model-meta', { params: { path } }))
      .then((res) => res.meta)
      .catch(() => null);
  }
}
