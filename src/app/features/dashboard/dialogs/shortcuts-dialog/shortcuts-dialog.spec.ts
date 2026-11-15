import { TestBed } from '@angular/core/testing';
import { ShortcutsDialog } from './shortcuts-dialog';

describe('Kürzel-Dialog (⌘/)', () => {
  it('dokumentiert Leertaste-Toggle, Pfeil-Navigation und Video-Tasten', () => {
    const fixture = TestBed.createComponent(ShortcutsDialog);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Vorschau öffnen / schließen – auch bei Videos');
    expect(text).toContain('Raster: vorherige / nächste / Zeile darüber / darunter');
    expect(text).toContain('Video: Abspielen / Pause');
    expect(text).toContain('⇧⌘O');
    expect(text).toContain('⌘Z');
  });
});
