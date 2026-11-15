import { TestBed } from '@angular/core/testing';
import { LibraryEntry } from '../../../core/services/library.service';
import { ThumbnailService } from '../../../core/services/thumbnail.service';
import { EntryList } from './entry-list';
import { gridColumns, rowOffsets, scrollToReveal, visibleRows } from './virtual-layout';

function files(count: number): LibraryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`,
    name: `Datei ${String(i).padStart(4, '0')}.pdf`,
    type: 'file' as const,
    relativePath: `f${i}.pdf`,
    kind: 'pdf' as const,
    kinds: ['pdf' as const],
    size: 100,
    childCount: null,
    updatedAt: null,
  }));
}

describe('Virtualisierung', () => {
  it('berechnet sichtbare Zeilen mit Puffer', () => {
    const offsets = rowOffsets(new Array(2000).fill(48));
    expect(offsets.at(-1)).toBe(96000);
    expect(visibleRows(offsets, 0, 480, 8)).toEqual({ start: 0, end: 19 });
    expect(visibleRows(offsets, 4800, 480, 8)).toEqual({ start: 92, end: 119 });
    expect(gridColumns(1000)).toBe(5);
    expect(gridColumns(0)).toBe(1);
    expect(scrollToReveal(1000, 1048, 0, 480)).toBe(1048 + 8 - 480);
    expect(scrollToReveal(100, 148, 0, 480)).toBeNull();
  });

  it('hält die DOM-Knotenzahl bei 2 000 Einträgen begrenzt (Liste und Raster)', () => {
    TestBed.configureTestingModule({
      imports: [EntryList],
      providers: [{ provide: ThumbnailService, useValue: { cached: () => null, request: () => ({ promise: new Promise(() => {}), setPriority: () => {} }) } }],
    });
    const fixture = TestBed.createComponent(EntryList);
    fixture.componentRef.setInput('entries', files(2000));
    fixture.detectChanges();
    const listCount = fixture.nativeElement.querySelectorAll('[role=option]').length;
    expect(listCount).toBeGreaterThan(10);
    expect(listCount).toBeLessThan(60);
    const host = fixture.nativeElement.querySelector('.entries') as HTMLElement;
    expect(host.style.height).toBe(`${2000 * 48}px`);
    const last = fixture.nativeElement.querySelector('[role=option]:last-child') as HTMLElement;
    expect(last.getAttribute('aria-setsize')).toBe('2000');

    fixture.componentRef.setInput('layout', 'grid');
    fixture.detectChanges();
    const gridCount = fixture.nativeElement.querySelectorAll('[role=option]').length;
    expect(gridCount).toBeLessThan(60);
    expect(fixture.nativeElement.querySelectorAll('*').length).toBeLessThan(1500);
  });
});
