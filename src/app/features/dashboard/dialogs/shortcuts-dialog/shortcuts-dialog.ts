import { Component, output } from '@angular/core';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';

/** Übersicht der Tastaturkürzel (Hilfe-Menü, ⌘/). */
@Component({
  selector: 'app-shortcuts-dialog',
  imports: [DialogDirective],
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()">
      <div class="dialog" appDialog aria-labelledby="shortcuts-title" (dismiss)="closed.emit()">
        <h2 id="shortcuts-title">Tastaturkürzel</h2>
        @for (group of groups; track group.title) {
          <h3>{{ group.title }}</h3>
          <dl>
            @for (row of group.rows; track row[1]) {
              <dt><kbd>{{ row[0] }}</kbd></dt>
              <dd>{{ row[1] }}</dd>
            }
          </dl>
        }
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" autofocus (click)="closed.emit()">Schließen</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .dialog {
      width: min(100%, 560px);
    }
    h3 {
      margin: 16px 0 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--ink-soft);
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 14px;
      margin: 8px 0 0;
      align-items: center;
    }
    dt {
      text-align: right;
    }
    dd {
      margin: 0;
      color: var(--ink-soft);
    }
  `,
})
export class ShortcutsDialog {
  readonly closed = output<void>();
  protected readonly groups: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Bibliothek',
      rows: [
        ['↑ ↓ ← →', 'Auswahl bewegen (⇧ erweitert die Auswahl)'],
        ['⌘-Klick / ⇧-Klick', 'Mehrere Einträge auswählen'],
        ['↩', 'Ordner öffnen / Vorschau'],
        ['⌘↑', 'Eine Ebene höher'],
        ['1–5 / 0', 'Bewerten / Bewertung entfernen (nicht bei Videos)'],
        ['⇧↩', 'Umbenennen'],
        ['⇧⌘R', 'Stapelumbenennung'],
        ['⌘Z', 'Umbenennen/Verschieben widerrufen'],
        ['⌘⌫', 'In den Papierkorb'],
        ['⇧⌘O', 'Im gewählten Slicer öffnen'],
        ['⌥⌘R', 'Im Finder zeigen'],
        ['⇧⌘N', 'Neuer Ordner'],
        ['⌘L', 'Link hinzufügen (oder URL ins Fenster ziehen)'],
        ['⇧⌘A', 'Namens-Assistent'],
        ['⌘O', 'Dateien importieren'],
        ['⌘F', 'Suchen'],
        ['⌘1 / ⌘2', 'Liste / Raster'],
        ['⌘R', 'Neu laden'],
        ['⌘,', 'Einstellungen'],
      ],
    },
    {
      title: 'Vorschau (Quick Look)',
      rows: [
        ['Leertaste', 'Vorschau öffnen / schließen – auch bei Videos'],
        ['↑ ↓', 'Liste: vorherige / nächste Datei'],
        ['← → ↑ ↓', 'Raster: vorherige / nächste / Zeile darüber / darunter'],
        ['K / Klick', 'Video: Abspielen / Pause'],
        ['M', 'Video: Ton an / aus'],
        ['F', 'Video: Vollbild'],
        ['⇧← / ⇧→', 'Video: 5 s zurück / vor'],
        ['Esc', 'Vorschau bzw. Dialog schließen'],
      ],
    },
  ];
}
