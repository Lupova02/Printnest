import { Component, input } from '@angular/core';

export type EmptyKind = 'no-library' | 'empty-folder' | 'no-results' | 'no-rated';

/** Leerer Zustand mit kleiner SVG-Illustration; Aktionen kommen per Content-Projection. */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="empty">
      <svg class="art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
        <ellipse cx="80" cy="104" rx="56" ry="8" class="shadow" />
        @switch (kind()) {
          @case ('no-results') {
            <circle cx="70" cy="54" r="28" class="stroke" />
            <path d="M90 74 L114 98" class="stroke thick" />
            <path d="M60 50 h20 M60 60 h14" class="stroke soft" />
          }
          @case ('no-rated') {
            <path d="M80 18 l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z" class="stroke" />
            <path d="M80 34 v18" class="stroke soft" />
          }
          @default {
            <path d="M28 40 q0-8 8-8 h26 l8 9 h54 q8 0 8 8 v42 q0 8-8 8 H36 q-8 0-8-8z" class="fill" />
            <path d="M28 52 h104" class="stroke soft" />
            @if (kind() === 'no-library') {
              <path d="M80 62 v22 M69 73 h22" class="stroke thick" />
            } @else {
              <path d="M66 72 q14-10 28 0" class="stroke soft" />
            }
          }
        }
      </svg>
      <h2>{{ title() }}</h2>
      @if (text()) {
        <p>{{ text() }}</p>
      }
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styles: `
    .empty {
      display: grid;
      justify-items: center;
      text-align: center;
      gap: 6px;
      padding: 48px 24px;
      animation: ui-rise var(--dur-slow) var(--ease-out) both;
    }
    .art {
      width: 150px;
      height: auto;
      margin-bottom: 6px;
    }
    .shadow {
      fill: var(--bg-hover);
    }
    .fill {
      fill: var(--accent-soft);
      stroke: var(--accent);
      stroke-width: 3;
      stroke-linejoin: round;
    }
    .stroke {
      fill: none;
      stroke: var(--accent);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .thick {
      stroke-width: 6;
    }
    .soft {
      opacity: 0.55;
    }
    h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 17px;
      font-weight: 650;
    }
    p {
      margin: 0;
      max-width: 420px;
      color: var(--ink-soft);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-top: 12px;
    }
  `,
})
export class EmptyState {
  readonly kind = input<EmptyKind>('empty-folder');
  readonly title = input.required<string>();
  readonly text = input<string>('');
}
