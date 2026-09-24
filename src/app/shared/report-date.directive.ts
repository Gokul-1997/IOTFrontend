import { Directive, ElementRef, Input } from '@angular/core';

/*
 * The dates a report or dashboard filter may be set to: no later than today,
 * and no earlier than the last three months.
 *
 * Three months is 92 days, the Reports page's own limit for fetching a range
 * directly (MAX_DIRECT_DAYS), so a full window never tips a report into the
 * "too long, email it" path. Plant time throughout: toISOString() is UTC,
 * which before 05:30 IST is still yesterday.
 *
 * Not for dates that belong in the future — an operator's "Effective from",
 * a maintenance plan's "Next due" — only for filters over recorded data.
 */
export const REPORT_WINDOW_DAYS = 92;

const IST_MS = 330 * 60 * 1000;
const day = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

/** Today in plant time, YYYY-MM-DD. */
export function plantToday(): string { return day(Date.now()); }

/** The earliest date a filter may show: the start of the last three months. */
export function reportMinDate(): string { return day(Date.now() - (REPORT_WINDOW_DAYS - 1) * 86_400_000); }

/**
 * <input type="date" appReportDate> — sets min and max so the picker cannot
 * go past today or before the three-month window, and pulls a typed date
 * back inside it (a date field accepts typed values its picker would not
 * offer). For a range, bind the other end: the From gets [rdBefore]="to",
 * the To gets [rdAfter]="from", so the two cannot cross.
 */
@Directive({
  selector: 'input[type=date][appReportDate]',
  standalone: true,
  host: {
    '[attr.min]': 'min',
    '[attr.max]': 'max',
    '(change)': 'keepInside()',
    '(blur)': 'keepInside()'
  }
})
export class ReportDateDirective {
  /** This date may not be earlier than this (the From of a range). */
  @Input() rdAfter: string | null | undefined = null;
  /** This date may not be later than this (the To of a range). */
  @Input() rdBefore: string | null | undefined = null;

  constructor(private el: ElementRef<HTMLInputElement>) {}

  get min(): string {
    const floor = reportMinDate();
    return this.rdAfter && this.rdAfter > floor ? this.rdAfter : floor;
  }

  get max(): string {
    const top = plantToday();
    return this.rdBefore && this.rdBefore < top ? this.rdBefore : top;
  }

  /** A typed date outside the window becomes the nearest allowed one — set
   *  through an input event, so ngModel and reactive forms both see it. */
  keepInside(): void {
    const input = this.el.nativeElement;
    const v = input.value;
    if (!v) return;
    const inside = v < this.min ? this.min : v > this.max ? this.max : v;
    if (inside === v) return;
    input.value = inside;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
