import { Component, computed, inject, output } from '@angular/core';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { Icon } from '../../../../shared/icon/icon';
import { LibraryStore } from '../../library.store';

/**
 * Einstellungen: Bibliotheksordner und genau EIN Standard-Slicer. Alle bekannten Slicer werden
 * gelistet – installierte oben, nicht installierte ausgegraut; dazu „Andere App wählen …“.
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [DialogDirective, Icon],
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()">
      <div class="dialog settings" appDialog aria-labelledby="settings-title" (dismiss)="closed.emit()">
        <h2 id="settings-title">Einstellungen</h2>

        <section class="group">
          <h3>Bibliothek</h3>
          <p class="path" [title]="store.root() ?? ''">{{ store.root() ?? 'Noch kein Ordner gewählt' }}</p>
          <button type="button" class="btn btn-ghost" (click)="changeLibrary.emit()">Ordner ändern …</button>
        </section>

        <section class="group">
          <div class="group-head">
            <h3 id="slicer-label">Standard-Slicer</h3>
            <button type="button" class="btn btn-ghost btn-tiny" [disabled]="store.slicersLoading()" (click)="store.loadSlicers(true)">
              {{ store.slicersLoading() ? 'Suche …' : 'Erneut suchen' }}
            </button>
          </div>
          <p class="muted">
            Nur dieser Slicer erscheint in Toolbar, Kontextmenü, Vorschau und unter <kbd>⇧⌘O</kbd>.
          </p>
          @if (!activeName()) {
            <p class="notice" role="status">
              <app-icon name="warning" />
              {{ store.defaultSlicer() ? 'Der gewählte Slicer ist nicht installiert.' : 'Noch kein Slicer gewählt.' }}
            </p>
          }
          <div class="slicers" role="radiogroup" aria-labelledby="slicer-label">
            @for (slicer of store.slicers(); track slicer.id) {
              <label class="slicer" [class.is-missing]="!slicer.installed" [class.is-active]="store.defaultSlicer() === slicer.id">
                <input
                  type="radio"
                  name="slicer"
                  [value]="slicer.id"
                  [disabled]="!slicer.installed"
                  [checked]="store.defaultSlicer() === slicer.id"
                  (change)="store.setDefaultSlicer(slicer.id)"
                />
                <span class="slicer-name">
                  {{ slicer.name }}
                  @if (slicer.technology === 'resin') {
                    <span class="tag">Resin</span>
                  }
                  @if (slicer.custom) {
                    <span class="tag">Eigene App</span>
                  }
                </span>
                <span class="slicer-state">
                  @if (slicer.installed) {
                    <app-icon name="check" class="ok" />
                    <span class="sr-only">installiert</span>
                  } @else {
                    nicht installiert
                  }
                </span>
                <span class="slicer-types">{{ slicer.extensions.join(', ').toUpperCase() }}</span>
                @if (slicer.custom) {
                  <button type="button" class="icon-btn" [attr.aria-label]="slicer.name + ' entfernen'" (click)="$event.preventDefault(); store.removeCustomSlicer(slicer.id)">
                    <app-icon name="close" />
                  </button>
                }
              </label>
            }
          </div>
          <button type="button" class="btn btn-ghost" (click)="store.addCustomSlicer()">Andere App wählen …</button>
        </section>

        <section class="group">
          <h3>Darstellung</h3>
          <p class="muted">
            Hell/Dunkel folgt dem System. Jeder Dateityp-Filter hat ein eigenes Farbprofil, Ordner bleiben blau.
          </p>
        </section>

        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" autofocus (click)="closed.emit()">Fertig</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .settings {
      width: min(100%, 560px);
    }
    .group {
      display: grid;
      gap: 6px;
      justify-items: start;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }
    h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--ink-soft);
    }
    .path {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .muted {
      margin: 0;
      color: var(--ink-soft);
      font-size: 13px;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 13px;
      color: var(--ink);
    }
    .notice app-icon {
      color: var(--star);
    }
    .slicers {
      display: grid;
      width: 100%;
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-s);
    }
    .slicer {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: 'radio name state' 'radio types types';
      align-items: center;
      column-gap: 10px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--line);
    }
    .slicer:has(.icon-btn) {
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      grid-template-areas: 'radio name state remove' 'radio types types types';
    }
    .slicer:last-child {
      border-bottom: 0;
    }
    .slicer.is-active {
      background: var(--bg-selected);
    }
    .slicer input {
      grid-area: radio;
      accent-color: var(--accent);
    }
    .slicer-name {
      grid-area: name;
      font-weight: 550;
    }
    .slicer-state {
      grid-area: state;
      font-size: 12px;
      color: var(--ink-soft);
    }
    .slicer-types {
      grid-area: types;
      font-size: 11px;
      color: var(--ink-faint);
    }
    .slicer .icon-btn {
      grid-area: remove;
      width: 24px;
      height: 24px;
    }
    .slicer.is-missing .slicer-name {
      color: var(--ink-faint);
    }
    .ok {
      color: var(--success);
    }
    .tag {
      margin-left: 6px;
      padding: 0 5px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      background: var(--accent-soft);
      color: var(--accent-text);
    }
  `,
})
export class SettingsDialog {
  protected readonly store = inject(LibraryStore);
  readonly closed = output<void>();
  readonly changeLibrary = output<void>();

  protected readonly activeName = computed(() => this.store.activeSlicer()?.name ?? null);
}
