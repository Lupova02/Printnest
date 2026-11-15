import { Component, OnInit, input, output, signal } from '@angular/core';
import { LibraryEntry } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { kindLabel } from '../../dashboard.utils';

/** Dialog: Eintrag umbenennen. */
@Component({
  selector: 'app-rename-dialog',
  imports: [DialogDirective],
  templateUrl: './rename-dialog.html',
  styleUrl: './rename-dialog.scss',
})
export class RenameDialog implements OnInit {
  readonly entry = input.required<LibraryEntry>();
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly name = signal('');
  protected readonly kindLabel = kindLabel;

  ngOnInit(): void {
    this.name.set(this.entry().name);
  }

  protected submit(): void {
    const name = this.name().trim();
    if (!name || this.busy()) return;
    if (name === this.entry().name) {
      this.closed.emit();
      return;
    }
    this.saved.emit(name);
  }
}
