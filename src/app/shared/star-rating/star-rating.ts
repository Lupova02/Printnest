import { Component, computed, input, output, signal } from '@angular/core';

/**
 * 1–5-Sterne-Bewertung: Hover zeigt die Vorschau, Klick setzt,
 * erneuter Klick auf denselben Stern entfernt die Bewertung.
 */
@Component({
  selector: 'app-star-rating',
  templateUrl: './star-rating.html',
  styleUrl: './star-rating.scss',
  host: {
    '[class.is-compact]': 'compact()',
    '[class.is-readonly]': 'readonly()',
    '[class.is-rated]': '(value() ?? 0) > 0',
  },
})
export class StarRating {
  /** Aktuelle Bewertung (null/0 = unbewertet). */
  readonly value = input<number | null | undefined>(null);
  /** Kompakt in Listen: Sterne nicht per Tab erreichbar (Tastatur: 1–5 auf der Auswahl). */
  readonly compact = input(false);
  readonly readonly = input(false);
  readonly label = input('Bewertung');
  readonly rate = output<number>();

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly hover = signal(0);
  /** Stern, der gerade „poppt“ (Animation nach dem Setzen). */
  protected readonly popped = signal(0);

  protected readonly shown = computed(() => this.hover() || this.value() || 0);

  protected starLabel(n: number): string {
    if (n === this.value()) return `Bewertung ${n} entfernen`;
    return n === 1 ? '1 Stern' : `${n} Sterne`;
  }

  protected set(n: number, event: Event): void {
    event.stopPropagation();
    if (this.readonly()) return;
    const next = n === this.value() ? 0 : n;
    this.popped.set(0);
    // Neu auslösen, auch wenn derselbe Stern mehrfach gesetzt wird.
    queueMicrotask(() => this.popped.set(next));
    this.hover.set(0);
    this.rate.emit(next);
  }
}
