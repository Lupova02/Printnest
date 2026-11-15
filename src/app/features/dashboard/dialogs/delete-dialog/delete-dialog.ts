import { Component, computed, input, output } from '@angular/core';
import { LibraryEntry } from '../../../../core/services/library.service';
import { DialogDirective } from '../../../../shared/dialog/dialog.directive';
import { isLinkEntry } from '../../dashboard.utils';

/** Dialog: In den Papierkorb legen bzw. Link entfernen. */
@Component({
  selector: 'app-delete-dialog',
  imports: [DialogDirective],
  templateUrl: './delete-dialog.html',
  styleUrl: './delete-dialog.scss',
})
export class DeleteDialog {
  readonly entry = input.required<LibraryEntry>();
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly confirmed = output<void>();

  protected readonly isLink = computed(() => isLinkEntry(this.entry()));
}
