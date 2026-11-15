import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Barrierefreies Dialogverhalten: Fokus beim Öffnen setzen ([autofocus] oder erstes Element),
 * Tab-Fokusfalle, Esc schließt, Fokus beim Schließen zurückgeben.
 */
@Directive({
  selector: '[appDialog]',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
    '(keydown)': 'onKeydown($event)',
    '(click)': '$event.stopPropagation()',
  },
})
export class DialogDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly previousFocus =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  /** Esc gedrückt. */
  readonly dismiss = output<void>();

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const el = this.host.nativeElement;
      const preferred = el.querySelector<HTMLElement>('[autofocus]') ?? this.focusables()[0] ?? el;
      preferred.focus();
      if (preferred instanceof HTMLInputElement && preferred.type === 'text') preferred.select();
    });
  }

  ngOnDestroy(): void {
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismiss.emit();
      return;
    }
    // Tastenkürzel der Bibliothek nicht aus Dialogen heraus auslösen.
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }
}
