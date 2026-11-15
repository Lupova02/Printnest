import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { Icon, IconName } from '../../../shared/icon/icon';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** Kontextmenü (Rechtsklick/⇧F10) mit Pfeiltasten-Navigation; Esc oder Klick daneben schließt. */
@Component({
  selector: 'app-context-menu',
  imports: [Icon],
  template: `
    <div class="layer" (mousedown)="closed.emit()" (contextmenu)="$event.preventDefault(); closed.emit()"></div>
    <div
      class="menu"
      role="menu"
      [attr.aria-label]="label()"
      [style.left.px]="pos().x"
      [style.top.px]="pos().y"
      (keydown)="onKeydown($event)"
    >
      @for (item of items(); track item.id) {
        @if (item.separatorBefore) {
          <div class="sep" role="separator"></div>
        }
        <button
          #menuItem
          type="button"
          role="menuitem"
          class="item"
          tabindex="-1"
          [class.is-danger]="item.danger"
          [disabled]="item.disabled"
          (click)="choose(item)"
        >
          @if (item.icon) {
            <app-icon [name]="item.icon" class="icon" />
          } @else {
            <span class="icon" aria-hidden="true"></span>
          }
          <span class="label">{{ item.label }}</span>
          @if (item.shortcut) {
            <span class="shortcut" aria-hidden="true">{{ item.shortcut }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './context-menu.scss',
})
export class ContextMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly items = input.required<MenuItem[]>();
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly label = input('Aktionen');

  readonly selected = output<string>();
  readonly closed = output<void>();

  protected readonly pos = signal({ x: 0, y: 0 });
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('menuItem');

  constructor() {
    afterNextRender(() => {
      // Im Fenster halten.
      const menu = this.host.nativeElement.querySelector<HTMLElement>('.menu');
      const width = menu?.offsetWidth ?? 220;
      const height = menu?.offsetHeight ?? 300;
      this.pos.set({
        x: Math.max(8, Math.min(this.x(), window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(this.y(), window.innerHeight - height - 8)),
      });
      this.focusAt(0);
    });
    this.pos.set({ x: -9999, y: -9999 });
  }

  protected choose(item: MenuItem): void {
    if (item.disabled) return;
    this.selected.emit(item.id);
  }

  private enabledButtons(): HTMLButtonElement[] {
    return this.buttons()
      .map((ref) => ref.nativeElement)
      .filter((el) => !el.disabled);
  }

  private focusAt(index: number): void {
    const list = this.enabledButtons();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const list = this.enabledButtons();
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusAt(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusAt(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusAt(list.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        this.closed.emit();
        break;
    }
  }
}
