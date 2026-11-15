import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FileKind, LibraryEntry, LibraryService } from '../../../../core/services/library.service';
import { FilePreview } from '../../../file-preview/file-preview';
import { PreviewDialog } from './preview-dialog';

/** Ersatz für die echte Vorschau (ohne WebGL/PDF.js). */
@Component({ selector: 'app-file-preview', template: '' })
class FilePreviewStub {
  readonly kind = input<FileKind | null>(null);
  readonly relativePath = input('');
  readonly version = input<string | null>(null);
  readonly handled = signal<string[]>([]);
  handleMediaKey(event: KeyboardEvent): boolean {
    if (this.kind() !== 'mp4' || !['k', 'm', 'f'].includes(event.key.toLowerCase())) return false;
    this.handled.update((list) => [...list, event.key]);
    return true;
  }
}

function entry(kind: FileKind, name = `datei.${kind}`): LibraryEntry {
  return { id: name, name, type: 'file', relativePath: name, kind, kinds: [kind], size: 1000, childCount: null, updatedAt: null, rating: 3 };
}

describe('PreviewDialog (Quick Look)', () => {
  const api = {
    getMeta: vi.fn(() => of({ path: '', meta: { note: 'Alt' } })),
    updateMeta: vi.fn(() => of({ path: '', meta: null })),
  };

  beforeEach(() => {
    api.getMeta.mockClear();
    api.updateMeta.mockClear();
    TestBed.configureTestingModule({ imports: [PreviewDialog], providers: [{ provide: LibraryService, useValue: api }] });
    TestBed.overrideComponent(PreviewDialog, { remove: { imports: [FilePreview] }, add: { imports: [FilePreviewStub] } });
  });

  function create(kind: FileKind, layout: 'list' | 'grid' = 'list') {
    const fixture = TestBed.createComponent(PreviewDialog);
    fixture.componentRef.setInput('entry', entry(kind));
    fixture.componentRef.setInput('layout', layout);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('.preview-dialog') as HTMLElement;
    const press = (key: string, init: KeyboardEventInit = {}, target: HTMLElement = dialog) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    return { fixture, dialog, press };
  }

  it('Leertaste schließt die Vorschau (auch wenn ein Knopf fokussiert ist)', () => {
    const { fixture, dialog, press } = create('stl');
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    press(' ', {}, dialog.querySelector('button')!);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('Leertaste schließt auch bei Video; K/M gehen an den Player', () => {
    const { fixture, press } = create('mp4');
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    press('k');
    press('m');
    press(' ');
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('Pfeiltasten melden die Richtung je Ansicht', () => {
    const list = create('stl', 'list');
    const listDirs: string[] = [];
    list.fixture.componentInstance.navigate.subscribe((d) => listDirs.push(d));
    list.press('ArrowDown');
    list.press('ArrowUp');
    expect(listDirs).toEqual(['next', 'prev']);

    const grid = create('stl', 'grid');
    const gridDirs: string[] = [];
    grid.fixture.componentInstance.navigate.subscribe((d) => gridDirs.push(d));
    grid.press('ArrowRight');
    grid.press('ArrowDown');
    grid.press('ArrowUp');
    grid.press('ArrowLeft');
    expect(gridDirs).toEqual(['next', 'down', 'up', 'prev']);
  });

  it('Video: keine Sterne, kein Druckdatum, nur Notiz; Zifferntasten bewerten nicht', () => {
    const { fixture, dialog, press } = create('mp4');
    expect(dialog.querySelector('app-star-rating')).toBeNull();
    expect(dialog.querySelector('input[type=date]')).toBeNull();
    expect(dialog.querySelector('textarea')).toBeTruthy();
    const rate = vi.fn();
    fixture.componentInstance.rate.subscribe(rate);
    press('4');
    expect(rate).not.toHaveBeenCalled();
  });

  it('Andere Typen behalten Sterne, Druckdatum und Notiz', () => {
    const { fixture, dialog, press } = create('3mf');
    expect(dialog.querySelector('app-star-rating')).toBeTruthy();
    expect(dialog.querySelector('input[type=date]')).toBeTruthy();
    const rate = vi.fn();
    fixture.componentInstance.rate.subscribe(rate);
    press('4');
    expect(rate).toHaveBeenCalledWith(4);
  });

  it('Notiz speichert automatisch nach kurzer Pause (Video ohne Druckdatum)', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, dialog } = create('mp4');
      await fixture.whenStable();
      const textarea = dialog.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Timelapse';
      textarea.dispatchEvent(new Event('input'));
      expect(api.updateMeta).not.toHaveBeenCalled();
      vi.advanceTimersByTime(800);
      expect(api.updateMeta).toHaveBeenCalledWith('datei.mp4', { note: 'Timelapse' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PreviewDialog – Fokus außerhalb', () => {
  it('Leertaste schließt auch, wenn der Fokus nicht im Dialog liegt', () => {
    TestBed.configureTestingModule({ imports: [PreviewDialog], providers: [{ provide: LibraryService, useValue: { getMeta: () => of({ path: '', meta: null }), updateMeta: () => of({}) } }] });
    TestBed.overrideComponent(PreviewDialog, { remove: { imports: [FilePreview] }, add: { imports: [FilePreviewStub] } });
    const fixture = TestBed.createComponent(PreviewDialog);
    fixture.componentRef.setInput('entry', entry('mp4'));
    fixture.detectChanges();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
