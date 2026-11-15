/**
 * Warteschlange für Thumbnail-Jobs: höchstens `concurrency` gleichzeitig, sichtbare Kacheln
 * zuerst (kleinere Priorität = wichtiger), abbrechbar über AbortSignal.
 */
export interface QueueHandle<T> {
  promise: Promise<T>;
  /** Priorität ändern (z. B. Kachel ist jetzt im Sichtbereich). */
  setPriority(priority: number): void;
}

interface Job {
  id: number;
  priority: number;
  run: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function abortError(): DOMException {
  return new DOMException('Abgebrochen.', 'AbortError');
}

export class ThumbQueue {
  private readonly waiting: Job[] = [];
  private running = 0;
  private nextId = 1;
  /** Höchststand gleichzeitig laufender Jobs (für Tests/Messung). */
  peak = 0;

  constructor(private readonly concurrency = 3) {}

  get pending(): number {
    return this.waiting.length;
  }

  get active(): number {
    return this.running;
  }

  enqueue<T>(run: (signal: AbortSignal) => Promise<T>, options: { priority?: number; signal?: AbortSignal } = {}): QueueHandle<T> {
    const controller = new AbortController();
    let job!: Job;
    const promise = new Promise<T>((resolve, reject) => {
      job = {
        id: this.nextId++,
        priority: options.priority ?? 1,
        run,
        controller,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
    });
    const external = options.signal;
    if (external?.aborted) {
      job.reject(abortError());
      return { promise, setPriority: () => {} };
    }
    external?.addEventListener(
      'abort',
      () => {
        const index = this.waiting.indexOf(job);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          job.reject(abortError());
        } else {
          controller.abort();
        }
      },
      { once: true },
    );
    this.waiting.push(job);
    queueMicrotask(() => this.pump());
    return {
      promise,
      setPriority: (priority: number) => {
        job.priority = priority;
      },
    };
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length) {
      // Wichtigste zuerst, bei Gleichstand in Reihenfolge des Eintreffens.
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i];
        const b = this.waiting[best];
        if (a.priority < b.priority || (a.priority === b.priority && a.id < b.id)) best = i;
      }
      const [job] = this.waiting.splice(best, 1);
      this.running += 1;
      this.peak = Math.max(this.peak, this.running);
      job
        .run(job.controller.signal)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}

/** LRU für Objekt-URLs, begrenzt nach Anzahl und Bytes; verdrängte URLs werden freigegeben. */
export class BlobUrlCache {
  private readonly map = new Map<string, { url: string; size: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 400,
    private readonly maxBytes = 160 * 1024 * 1024,
    private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    // Als zuletzt benutzt markieren.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.url;
  }

  set(key: string, url: string, size: number): void {
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.bytes -= old.size;
      if (old.url !== url) this.revoke(old.url);
    }
    this.map.set(key, { url, size });
    this.bytes += size;
    while (this.map.size > this.maxEntries || (this.bytes > this.maxBytes && this.map.size > 1)) {
      const [oldestKey, oldest] = this.map.entries().next().value as [string, { url: string; size: number }];
      this.map.delete(oldestKey);
      this.bytes -= oldest.size;
      this.revoke(oldest.url);
    }
  }
}
