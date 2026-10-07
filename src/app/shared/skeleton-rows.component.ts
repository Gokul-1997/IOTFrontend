import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Placeholder rows while a table loads, under the table's real header:
 *
 *   <tbody *ngIf="loading" appSkeletonRows [cols]="6"></tbody>
 *   <tbody *ngIf="!loading"> …rows… </tbody>
 *
 * The header stays where it is and the rows arrive into the space they
 * already had, instead of a spinner on a blank card and a jump. Bars only:
 * a placeholder never shows a number (see skeleton.ts). One polite
 * "Loading…" for screen readers, not one per bar.
 */
@Component({
  selector: 'tbody[appSkeletonRows]',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tbl-skel', 'aria-busy': 'true' },
  template: `
    <tr *ngFor="let r of rowList" aria-hidden="true">
      <td *ngFor="let c of colList"><span class="tbl-skel-bar" [style.width.%]="width(r, c)"></span></td>
    </tr>
    <tr class="sr-only"><td [attr.colspan]="cols" role="status">{{ label }}</td></tr>
  `
})
export class SkeletonRowsComponent {
  @Input() cols = 5;
  @Input() rows = 5;
  @Input() label = 'Loading…';

  get colList(): number[] { return Array.from({ length: this.cols }, (_, i) => i); }
  get rowList(): number[] { return Array.from({ length: this.rows }, (_, i) => i); }

  /** Varied but stable widths, so the rows read as text, not as a grid of bars. */
  width(r: number, c: number): number { return 40 + ((r * 7 + c * 13) % 50); }
}
