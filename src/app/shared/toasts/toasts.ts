import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';
import { Icon } from '../icon/icon';

/** Toast-Benachrichtigungen (live region, unten rechts). */
@Component({
  selector: 'app-toasts',
  imports: [Icon],
  template: `
    <div class="toasts" aria-live="polite" aria-relevant="additions">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [attr.data-tone]="toast.tone" [attr.role]="toast.tone === 'error' ? 'alert' : 'status'">
          <span class="dot" aria-hidden="true"></span>
          <div class="body">
            <p class="msg">{{ toast.message }}</p>
            @if (toast.detail) {
              <p class="detail">{{ toast.detail }}</p>
            }
          </div>
          <button type="button" class="icon-btn" aria-label="Meldung schließen" (click)="toasts.dismiss(toast.id)">
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 200;
      display: grid;
      gap: 8px;
      width: min(380px, calc(100vw - 32px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 8px 10px 12px;
      border-radius: var(--radius);
      background: var(--bg-elevated);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-lift);
      animation: toast-in var(--dur-slow) var(--ease-out) both;
    }
    .dot {
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 50%;
      background: var(--accent);
      flex: none;
    }
    .toast[data-tone='success'] .dot {
      background: var(--success);
    }
    .toast[data-tone='error'] .dot {
      background: var(--danger);
    }
    .body {
      flex: 1;
      min-width: 0;
    }
    .msg {
      margin: 0;
      font-weight: 550;
    }
    .detail {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--ink-soft);
      overflow-wrap: anywhere;
    }
    .icon-btn {
      width: 24px;
      height: 24px;
      font-size: 14px;
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.98);
      }
    }
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}
