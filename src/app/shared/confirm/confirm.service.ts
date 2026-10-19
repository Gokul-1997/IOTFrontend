import { Injectable, signal } from '@angular/core';

/** What a confirmation asks. The wording is the caller's. */
export interface ConfirmOptions {
  /** The question, as the dialog's title: 'Delete role "Shift lead"?' */
  title: string;
  /** What saying yes does, in a sentence or two. A blank line starts a new paragraph. */
  message?: string;
  /** Consequences worth listing one by one, shown in a warning box. */
  items?: string[];
  /** The yes button, named for what it does: "Delete", "Deactivate". */
  confirmText: string;
  cancelText?: string;
  /** 'danger' (the default) for anything destructive: a red button and a warning badge. */
  tone?: 'danger' | 'primary';
  /** Material icon in the badge; 'delete_forever' for deletions, like the other delete dialogs. */
  icon?: string;
}

export interface PendingConfirm extends ConfirmOptions {
  answer(yes: boolean): void;
}

/*
 * The app's one confirmation dialog: the same card as every other dialog
 * (.ui-overlay > .ui-dialog, drawn by ConfirmDialogComponent in the main
 * layout) in place of the browser's confirm() box, which looked different
 * in every browser, ignored dark mode and froze the page while it was open.
 *
 *   if (!(await this.confirm.ask({ title: 'Delete this schedule?', confirmText: 'Delete' }))) return;
 *
 * One at a time: asking again while one is open answers the first "no".
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.pending()?.answer(false);
    return new Promise<boolean>(resolve => {
      const entry: PendingConfirm = {
        ...options,
        answer: (yes: boolean) => {
          if (this.pending() === entry) this.pending.set(null);
          resolve(yes);
        }
      };
      this.pending.set(entry);
    });
  }
}
