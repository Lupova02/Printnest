import { Service, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
}

const DURATION: Record<ToastTone, number> = { info: 3200, success: 3200, error: 6500 };
const MAX_TOASTS = 4;

/** Kurze Benachrichtigungen unten rechts (ersetzt die frühere Statuszeile). */
@Service()
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<Toast[]>([]);

  show(message: string, tone: ToastTone = 'info', detail?: string): number {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, tone, message, detail }].slice(-MAX_TOASTS));
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), DURATION[tone]),
    );
    return id;
  }

  success(message: string, detail?: string): number {
    return this.show(message, 'success', detail);
  }

  error(message: string, detail?: string): number {
    return this.show(message, 'error', detail);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }
}
