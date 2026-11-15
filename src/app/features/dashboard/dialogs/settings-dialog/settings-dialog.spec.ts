import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SlicerInfo } from '../../../../core/services/library.service';
import { LibraryStore } from '../../library.store';
import { SettingsDialog } from './settings-dialog';

function slicer(id: string, name: string, installed: boolean, extra: Partial<SlicerInfo> = {}): SlicerInfo {
  return { id, name, installed, appPath: installed ? `/Applications/${name}.app` : null, extensions: ['stl', '3mf'], technology: 'fdm', verified: true, custom: false, ...extra };
}

describe('Einstellungen – Slicer-Auswahl', () => {
  function setup(defaultSlicer: string | null) {
    const slicers = signal([slicer('bambu', 'Bambu Studio', true), slicer('orca', 'OrcaSlicer', true), slicer('lychee', 'Lychee Slicer', false, { technology: 'resin', extensions: ['stl', 'obj'] })]);
    const def = signal<string | null>(defaultSlicer);
    const store = {
      root: signal('/Bibliothek'),
      slicers,
      defaultSlicer: def,
      slicersLoading: signal(false),
      activeSlicer: computed(() => slicers().find((s) => s.id === def() && s.installed) ?? null),
      setDefaultSlicer: vi.fn((id: string) => def.set(id)),
      loadSlicers: vi.fn(),
      addCustomSlicer: vi.fn(),
      removeCustomSlicer: vi.fn(),
    };
    TestBed.configureTestingModule({ imports: [SettingsDialog], providers: [{ provide: LibraryStore, useValue: store }] });
    const fixture = TestBed.createComponent(SettingsDialog);
    fixture.detectChanges();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  }

  it('listet alle Slicer; nicht installierte sind ausgegraut und nicht wählbar', () => {
    const { el } = setup('bambu');
    const rows = [...el.querySelectorAll('.slicer')];
    expect(rows).toHaveLength(3);
    const lychee = rows.find((r) => r.textContent?.includes('Lychee'))!;
    expect(lychee.classList).toContain('is-missing');
    expect(lychee.textContent).toContain('nicht installiert');
    expect((lychee.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect((rows[0].querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(el.textContent).toContain('Andere App wählen');
  });

  it('wählt genau einen Standard-Slicer', () => {
    const { el, store, fixture } = setup('bambu');
    const orca = [...el.querySelectorAll('.slicer input')].find((i) => (i as HTMLInputElement).value === 'orca') as HTMLInputElement;
    orca.click();
    fixture.detectChanges();
    expect(store.setDefaultSlicer).toHaveBeenCalledWith('orca');
    const checked = [...el.querySelectorAll<HTMLInputElement>('.slicer input')].filter((i) => i.checked);
    expect(checked.map((i) => i.value)).toEqual(['orca']);
  });

  it('zeigt einen Hinweis, wenn kein Slicer gewählt ist', () => {
    const { el } = setup(null);
    expect(el.querySelector('.notice')?.textContent).toContain('Noch kein Slicer gewählt');
  });
});
