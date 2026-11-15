import { Component, input, output, signal } from '@angular/core';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';

/** Dialog: neuen Unterordner anlegen. */
@Component({
  selector: 'app-folder-dialog',
  imports: [DialogDirective],
  templateUrl: './folder-dialog.html',
  styleUrl: './folder-dialog.scss',
})
export class FolderDialog {
  readonly locationLabel = input.required<string>();
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly name = signal('');

  protected submit(): void {
    const name = this.name().trim();
    if (name && !this.busy()) this.saved.emit(name);
  }
}
