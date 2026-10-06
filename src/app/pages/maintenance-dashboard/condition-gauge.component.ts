import { Component, ChangeDetectionStrategy, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

/** One coloured stretch of the scale, from the previous zone's end up to `to`. */
export interface ConditionZone { to: number; color: string; }

/*
 * The small condition gauge of the Maintenance Dashboard design
 * (MEXA_DS_dashboard_UI_02.pdf): a half ring in three colours, a needle at
 * the reading, and the reading underneath. Zones run in order of value, so
 * a load or temperature reads green → amber → red as it rises, and
 * insulation resistance red → amber → green (a low resistance is the risk).
 *
 * No reading, no needle: the ring turns grey and shows "--". A needle at 0
 * would claim a cold, idle motor.
 */
@Component({
  selector: 'app-condition-gauge',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; max-width: 132px; margin: 0 auto; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .off { stroke: var(--gauge-off, #d9dde6); }
    .needle { stroke: var(--mexa-ink, #1f2430); }
    .hub { fill: var(--mexa-ink, #1f2430); }
    .value { fill: var(--mexa-ink, #1f2430); font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .value.none { fill: var(--mexa-ink-3, #5d6679); }
    .needle-turn { transform-box: view-box; transition: transform .4s cubic-bezier(.2, .8, .25, 1); }
    @media (prefers-reduced-motion: reduce) { .needle-turn { transition: none; } }
    :host-context(.dark) .off { stroke: #2a2f3b; }
  `],
  template: `
    <svg viewBox="0 0 120 84" role="img" [attr.aria-label]="ariaLabel">
      <ng-container *ngIf="hasValue; else offRing">
        <path *ngFor="let z of pieces" [attr.d]="arc(z.from, z.to)" fill="none" [attr.stroke]="z.color"
              stroke-width="11" stroke-linecap="butt"/>
        <g class="needle-turn" [style.transform-origin]="'60px 58px'" [style.transform]="'rotate(' + needleDeg + 'deg)'">
          <line class="needle" x1="60" y1="58" x2="60" y2="24" stroke-width="3.2" stroke-linecap="round"/>
        </g>
        <circle class="hub" cx="60" cy="58" r="4.5"/>
      </ng-container>
      <ng-template #offRing>
        <path [attr.d]="arc(min, max)" fill="none" class="off" stroke-width="11"/>
      </ng-template>
      <text class="value" [class.none]="!hasValue" x="60" y="80" text-anchor="middle">{{ text }}</text>
    </svg>
  `
})
export class ConditionGaugeComponent implements OnChanges {
  @Input() value: number | null | undefined = null;
  @Input() min = 0;
  @Input() max = 100;
  @Input() zones: ConditionZone[] = [];
  @Input() unit = '';
  @Input() digits = 0;
  @Input() ariaLabel = '';

  hasValue = false;
  text = '--';
  needleDeg = -90;
  pieces: { from: number; to: number; color: string }[] = [];

  ngOnChanges(): void {
    const n = Number(this.value);
    this.hasValue = this.value !== null && this.value !== undefined && Number.isFinite(n);
    this.text = this.hasValue ? `${n.toFixed(this.digits)}${this.unit}` : '--';
    // a reading past the scale pins the needle at the end; the text stays true
    const clamped = Math.min(this.max, Math.max(this.min, this.hasValue ? n : this.min));
    this.needleDeg = -90 + ((clamped - this.min) / (this.max - this.min || 1)) * 180;

    let from = this.min;
    this.pieces = this.zones.map(z => {
      const piece = { from, to: Math.min(this.max, z.to), color: z.color };
      from = piece.to;
      return piece;
    }).filter(p => p.to > p.from);
  }

  /** The band between two scale values, as an SVG arc path. */
  arc(a: number, b: number): string {
    const pt = (v: number) => {
      const f = (Math.min(this.max, Math.max(this.min, v)) - this.min) / (this.max - this.min || 1);
      const ang = Math.PI * (1 - f);
      return [60 + 44 * Math.cos(ang), 58 - 44 * Math.sin(ang)];
    };
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A 44 44 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
}
