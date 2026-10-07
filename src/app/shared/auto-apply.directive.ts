import { Directive, EventEmitter, OnDestroy, Output } from '@angular/core';
import { Subject, Subscription, debounce, timer } from 'rxjs';

/*
 * <form class="mexa-titlebar" appAutoApply (autoApply)="submit()">
 * <div class="filters" appAutoApply (autoApply)="load()">
 *
 * A dashboard's filters apply themselves: choosing from a dropdown asks for
 * the data straight away, and a date once it has stopped changing. It
 * replaced the Submit button, which had to be found and pressed after every
 * change — and a filter that had been changed but not submitted showed
 * numbers that did not match what it said.
 *
 * It listens for `change`, which a <select> fires on a choice and a date
 * field fires on a complete date (from the picker, or the last digit typed,
 * or when appReportDate pulls a date back inside its window) — never on
 * each keystroke, and never for a search box, which has its own debounce.
 * A date waits longer than a dropdown, so typing a year does not ask for
 * data four times. Changes close together are applied once.
 */
export const SELECT_WAIT_MS = 150;
export const DATE_WAIT_MS = 600;

@Directive({
  // a <form> on the dashboards; a filter row (<div>) on the report pages
  selector: '[appAutoApply]',
  standalone: true,
  host: { '(change)': 'onChange($event)' }
})
export class AutoApplyDirective implements OnDestroy {
  /** The filters changed and have settled: load the data for them. */
  @Output() autoApply = new EventEmitter<void>();

  private changes = new Subject<number>();
  private sub: Subscription = this.changes
    .pipe(debounce(wait => timer(wait)))
    .subscribe(() => this.autoApply.emit());

  onChange(event: Event): void {
    const el = event.target;
    if (el instanceof HTMLSelectElement) this.changes.next(SELECT_WAIT_MS);
    else if (el instanceof HTMLInputElement && el.type === 'date') this.changes.next(DATE_WAIT_MS);
  }

  ngOnDestroy(): void { this.sub.unsubscribe(); }
}
