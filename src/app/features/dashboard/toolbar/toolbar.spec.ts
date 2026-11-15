import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LibraryStore } from '../library.store';
import { Toolbar } from './toolbar';

/** Minimaler Store-Stub für die Toolbar. */
function createStoreStub() {
  return {
    isFolderView: signal(true),
    currentFolder: signal('Teile'),
    breadcrumbs: signal([
      { name: 'Home', relativePath: '' },
      { name: 'Teile', relativePath: 'Teile' },
    ]),
    title: signal('Teile'),
    loading: signal(false),
    busy: signal(false),
    visibleEntries: signal([{}, {}]),
    search: signal(''),
    minRating: signal(0),
    sort: signal('name'),
    layout: signal('list'),
    selected: signal(null),
    activeSlicer: signal({ id: 'bambu', name: 'Bambu Studio', installed: true, extensions: ['stl', '3mf'] }),
    canUndo: signal(false),
    setMinRating: vi.fn(),
    setSort: vi.fn(),
    setLayout: vi.fn(),
    setSearch: vi.fn(),
    openFolder: vi.fn(),
    goUp: vi.fn(),
  };
}

describe('Toolbar', () => {
  let store: ReturnType<typeof createStoreStub>;

  beforeEach(() => {
    store = createStoreStub();
    TestBed.configureTestingModule({
      imports: [Toolbar],
      providers: [{ provide: LibraryStore, useValue: store }],
    });
  });

  it('setzt den Bewertungsfilter', () => {
    const fixture = TestBed.createComponent(Toolbar);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
    select.value = '4';
    select.dispatchEvent(new Event('change'));
    expect(store.setMinRating).toHaveBeenCalledWith(4);
  });

  it('zeigt Breadcrumbs und navigiert zur Bibliothek', () => {
    const fixture = TestBed.createComponent(Toolbar);
    fixture.detectChanges();
    const crumb = fixture.nativeElement.querySelector('button.crumb') as HTMLButtonElement;
    expect(crumb.textContent?.trim()).toBe('Bibliothek');
    crumb.click();
    expect(store.openFolder).toHaveBeenCalledWith('');
    expect(fixture.nativeElement.querySelector('h1').textContent.trim()).toBe('Teile');
  });

  it('wechselt die Darstellung', () => {
    const fixture = TestBed.createComponent(Toolbar);
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('[aria-label="Als Raster"]') as HTMLButtonElement;
    grid.click();
    expect(store.setLayout).toHaveBeenCalledWith('grid');
  });
});

describe('Toolbar – Slicer', () => {
  it('zeigt nur den gewählten Slicer und ist ohne passende Auswahl deaktiviert', () => {
    const store = createStoreStub();
    TestBed.configureTestingModule({ imports: [Toolbar], providers: [{ provide: LibraryStore, useValue: store }] });
    const fixture = TestBed.createComponent(Toolbar);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[aria-label="In Bambu Studio öffnen (⇧⌘O)"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);
    store.selected.set({ id: 'a.stl', name: 'a.stl', type: 'file' } as never);
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });
});
