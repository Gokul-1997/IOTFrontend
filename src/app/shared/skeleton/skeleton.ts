import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Loading placeholders shaped like the content that is coming.
 *
 * A dashboard that shows "Loading…" on a blank field tells the reader
 * nothing about what is about to appear, and every card then jumps into
 * place at once. These stand in for the real geometry, so the page settles
 * where it started.
 *
 * Deliberately shows no numbers — not 0, not "--". A skeleton that borrows
 * the shape of a KPI tile must not also borrow the authority of a reading;
 * on a maintenance screen a placeholder "0 °C" would be a claim about a
 * machine.
 *
 *   <app-skeleton kind="kpis" [count]="6"></app-skeleton>
 *   <app-skeleton kind="chart"></app-skeleton>
 *   <app-skeleton kind="table" [count]="8"></app-skeleton>
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- aria-busy + a single polite label: a screen reader should hear
         "loading" once, not once per placeholder bar. -->
    <div [attr.aria-busy]="true" role="status" [attr.aria-label]="label">

      <div *ngIf="kind === 'kpis'" class="mexa-kpis">
        <div *ngFor="let i of items" class="mexa-kpi">
          <div class="mexa-kpi-head">
            <span class="mexa-skel mexa-skel-label"></span>
            <span class="mexa-skel mexa-skel-disc"></span>
          </div>
          <div class="mexa-skel mexa-skel-value"></div>
          <div class="mexa-skel mexa-skel-sub"></div>
        </div>
      </div>

      <div *ngIf="kind === 'chart'">
        <div class="mexa-skel mexa-skel-title"></div>
        <div class="mexa-skel mexa-skel-chart" [style.height.px]="height"></div>
      </div>

      <div *ngIf="kind === 'donut'">
        <div class="mexa-skel mexa-skel-title"></div>
        <div class="mexa-skel mexa-skel-donut"></div>
      </div>

      <div *ngIf="kind === 'table'">
        <div class="mexa-skel mexa-skel-title"></div>
        <div *ngFor="let i of items" class="mexa-skel mexa-skel-row"></div>
      </div>

      <div *ngIf="kind === 'lines'">
        <div *ngFor="let i of items" class="mexa-skel mexa-skel-line"
             [ngClass]="i % 3 === 0 ? 'mexa-skel-w60' : (i % 2 === 0 ? 'mexa-skel-w80' : 'mexa-skel-w40')"></div>
      </div>

      <span class="sr-only">{{ label }}</span>
    </div>
  `
})
export class SkeletonComponent {

  @Input() kind: 'kpis' | 'chart' | 'donut' | 'table' | 'lines' = 'lines';

  /** How many placeholder units to draw — tiles, rows or lines. */
  @Input() set count(n: number) { this.items = Array.from({ length: Math.max(1, n) }, (_, i) => i); }

  /** Chart skeletons match the height of the chart they stand in for. */
  @Input() height = 220;

  @Input() label = 'Loading';

  items: number[] = [0, 1, 2];
}
