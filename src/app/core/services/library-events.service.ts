import { Service, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { LibraryService } from './library.service';

export interface LibraryChangeEvent {
  type: 'change' | 'library';
  source?: 'fs' | 'api';
  meta?: boolean;
}

/**
 * Live-Aktualisierung per Server-Sent Events (/api/events). Der Server beobachtet
 * die Bibliothek mit `fs.watch` und meldet gebündelte Änderungen.
 */
@Service()
export class LibraryEventsService {
  private readonly library = inject(LibraryService);
  private source: EventSource | null = null;
  readonly changes = new Subject<LibraryChangeEvent>();

  connect(): void {
    if (this.source || typeof EventSource === 'undefined') return;
    const source = new EventSource(this.library.eventsUrl());
    const forward = (type: LibraryChangeEvent['type']) => (event: MessageEvent<string>) => {
      let data: Partial<LibraryChangeEvent> = {};
      try {
        data = JSON.parse(event.data) as Partial<LibraryChangeEvent>;
      } catch {
        // leere Nutzlast
      }
      this.changes.next({ ...data, type });
    };
    source.addEventListener('change', forward('change'));
    source.addEventListener('library', forward('library'));
    this.source = source;
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}
