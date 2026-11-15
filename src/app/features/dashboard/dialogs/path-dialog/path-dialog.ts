import { Component, OnInit, input, output, signal } from '@angular/core';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';

/** Dialog: Bibliotheksordner per Ordnerdialog oder manuellem Pfad setzen. */
@Component({
  selector: 'app-path-dialog',
  imports: [DialogDirective],
  templateUrl: './path-dialog.html',
  styleUrl: './path-dialog.scss',
})
export class PathDialog implements OnInit {
  readonly busy = input(false);
  readonly currentPath = input<string | null>(null);
  readonly closed = output<void>();
  readonly pickFolder = output<void>();
  readonly savePath = output<string>();

  protected readonly pathDraft = signal('');
  protected readonly showManual = signal(false);

  ngOnInit(): void {
    this.pathDraft.set(this.currentPath() ?? '');
  }

  protected submit(): void {
    const value = this.pathDraft().trim();
    if (value && !this.busy()) this.savePath.emit(value);
  }
}
