import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';

export const VIDEO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Sekunden als m:ss bzw. h:mm:ss. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Schlanker Video-Player: startet stumm (Autoplay), eigene Steuerleiste mit
 * Play/Pause, Scrubbing mit Zeitvorschau, Lautstärke, Tempo und Vollbild.
 * Tasten (aus der Vorschau weitergereicht): K/Klick Play, M Ton, F Vollbild, ⇧←/⇧→ ±5 s.
 */
@Component({
  selector: 'app-video-player',
  imports: [Icon],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
})
export class VideoPlayer {
  readonly src = input.required<string>();
  readonly ready = output<void>();
  readonly failed = output<void>();

  protected readonly speeds = VIDEO_SPEEDS;
  protected readonly formatTime = formatTime;
  protected readonly playing = signal(false);
  protected readonly muted = signal(true);
  protected readonly volume = signal(1);
  protected readonly current = signal(0);
  protected readonly duration = signal(0);
  protected readonly rate = signal(1);
  protected readonly hover = signal<{ time: number; x: number } | null>(null);
  protected readonly progress = computed(() => (this.duration() ? (this.current() / this.duration()) * 100 : 0));

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');

  constructor() {
    // Neue Quelle: Zustand zurücksetzen (das alte Video stoppt der Browser beim Quellwechsel).
    effect(() => {
      this.src();
      untracked(() => {
        this.current.set(0);
        this.duration.set(0);
        this.playing.set(false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  /** Decoder freigeben: Video stoppen und Quelle leeren. */
  release(): void {
    const el = this.video()?.nativeElement;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  togglePlay(): void {
    const el = this.video().nativeElement;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  toggleMute(): void {
    const el = this.video().nativeElement;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 0.5;
  }

  seekBy(delta: number): void {
    const el = this.video().nativeElement;
    this.seekTo(el.currentTime + delta);
  }

  seekTo(time: number): void {
    const el = this.video().nativeElement;
    const max = Number.isFinite(el.duration) ? el.duration : time;
    el.currentTime = Math.min(Math.max(time, 0), max);
    this.current.set(el.currentTime);
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void this.root().nativeElement.requestFullscreen?.().catch(() => {});
  }

  protected setVolume(value: number): void {
    const el = this.video().nativeElement;
    el.volume = value;
    el.muted = value === 0;
  }

  protected setRate(value: number): void {
    this.video().nativeElement.playbackRate = value;
    this.rate.set(value);
  }

  protected onMeta(): void {
    const el = this.video().nativeElement;
    this.duration.set(Number.isFinite(el.duration) ? el.duration : 0);
    el.playbackRate = this.rate();
  }

  protected onTime(): void {
    this.current.set(this.video().nativeElement.currentTime);
  }

  protected onVolume(): void {
    const el = this.video().nativeElement;
    this.muted.set(el.muted);
    this.volume.set(el.volume);
  }

  protected onScrubHover(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / (rect.width || 1), 0), 1);
    this.hover.set({ time: ratio * this.duration(), x: ratio * rect.width });
  }
}
