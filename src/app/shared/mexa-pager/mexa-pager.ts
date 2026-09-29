import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * The table footer every MEXA dashboard draws the same way:
 * "Showing: 6 of 126 · Show Items Per Page [06] · ‹ Previous 1 2 … Next ›".
 */
@Component({
  selector: 'app-mexa-pager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mexa-pager" *ngIf="total > 0">
      <span aria-live="polite">Showing: {{ shown }} of {{ total }}</span>
      <span class="inline-flex items-center gap-3 flex-wrap">
        <label class="mexa-pagesize">
          Show Items Per Page
          <select class="mexa-select" [ngModel]="limit" (ngModelChange)="limitChange.emit(+$event)">
            <option *ngFor="let n of sizes" [ngValue]="n">{{ n < 10 ? '0' + n : n }}</option>
          </select>
        </label>
        <nav class="inline-flex items-center gap-1" aria-label="Pages">
          <button type="button" class="mexa-pagebtn" (click)="go(page - 1)" [disabled]="page <= 1">‹ Previous</button>
          <ng-container *ngFor="let p of pages">
            <span *ngIf="p === 0" class="px-1" aria-hidden="true">…</span>
            <button *ngIf="p !== 0" type="button" class="mexa-pagebtn" (click)="go(p)"
                    [attr.aria-current]="p === page ? 'page' : null">{{ p }}</button>
          </ng-container>
          <button type="button" class="mexa-pagebtn" (click)="go(page + 1)" [disabled]="page >= totalPages">Next ›</button>
        </nav>
      </span>
    </div>`
})
export class MexaPagerComponent {
  @Input() page = 1;
  @Input() totalPages = 1;
  @Input() total = 0;
  @Input() shown = 0;
  @Input() limit = 10;
  @Input() sizes: number[] = [6, 10, 20, 50];
  @Output() pageChange = new EventEmitter<number>();
  @Output() limitChange = new EventEmitter<number>();

  go(p: number): void {
    if (p < 1 || p > this.totalPages || p === this.page) return;
    this.pageChange.emit(p);
  }

  /** All pages when few; else first, last and this page's neighbours, 0 marking a gap. */
  get pages(): number[] {
    const total = this.totalPages || 1;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const nums = [...new Set([1, total, this.page - 1, this.page, this.page + 1])]
      .filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const out: number[] = [];
    nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push(0); out.push(n); });
    return out;
  }
}
