import { Service } from '@angular/core';

/** Farbprofile (siehe scripts/themes.mjs → _themes.scss). */
export type ThemeId = 'home' | 'stl' | '3mf' | 'f3d' | 'pdf' | 'mp4' | 'img' | 'link' | 'rated';

const TRANSITION_MS = 300;

/** Setzt `data-theme` am Root und blendet die Farben kurz über (respektiert reduced motion). */
@Service()
export class ThemeService {
  private current: ThemeId | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  apply(theme: ThemeId): void {
    if (theme === this.current) return;
    const root = document.documentElement;
    const first = this.current === null;
    this.current = theme;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!first && !reduced) {
      root.classList.add('is-theme-changing');
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => root.classList.remove('is-theme-changing'), TRANSITION_MS);
    }
    root.dataset['theme'] = theme;
  }
}
