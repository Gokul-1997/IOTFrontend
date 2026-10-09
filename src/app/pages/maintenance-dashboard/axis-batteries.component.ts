import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/** One axis's absolute-encoder (APC) battery: the flag the controller keeps for it. */
export interface AxisBattery { axis: string; low: boolean; }

/* Axes in the order a machine names them, then anything else alphabetically:
   JSONB hands a 5-axis machine's flags back as B, W, X, Y, Z. */
const AXIS_ORDER = ['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W'];
const axisRank = (a: string) => { const i = AXIS_ORDER.indexOf(a); return i < 0 ? AXIS_ORDER.length : i; };

/**
 * The APC battery flag of each axis, in the machine's axis order: true is
 * that axis's battery low (`battery: {"X": false, ...}`, stored as sent).
 * Anything but true/false is left out.
 */
export function axisBatteries(flags: any): AxisBattery[] {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return [];
  return (Object.entries(flags).filter(([, v]) => typeof v === 'boolean') as [string, boolean][])
    .sort(([a], [b]) => axisRank(a) - axisRank(b) || a.localeCompare(b))
    .map(([axis, low]) => ({ axis, low }));
}

/*
 * The APC battery axis by axis — three on a 3-axis machine, five or six with
 * A, B or W — each a small battery filled green (OK) or short and red (Low),
 * its axis and the word. The tile's own heading and overall word stay with
 * the dashboard.
 */
@Component({
  selector: 'app-axis-batteries',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    /* up to four in a row; five or six as rows of three, so none sits alone */
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem .25rem;
         grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); }
    li { display: flex; flex-direction: column; align-items: center; gap: .1rem; padding: .3rem .1rem;
         border-radius: 8px; background: rgba(34, 197, 94, .1); }
    li.is-low { background: rgba(224, 49, 49, .12); }
    svg { width: .9rem; height: auto; color: var(--mexa-ink); }
    .fill { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .4s cubic-bezier(.2, .8, .25, 1); }
    .axis { font-size: .82rem; font-weight: 800; color: var(--mexa-ink); line-height: 1.1; }
    .word { font-size: .68rem; font-weight: 700; line-height: 1.1; }
    @keyframes alert { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
    li.fresh .word { animation: alert 1.2s ease-in-out 3; }
    @media (prefers-reduced-motion: reduce) { .fill { transition: none; } li.fresh .word { animation: none; } }
  `],
  template: `
    <ul role="list" aria-label="APC battery by axis" [style.--cols]="cols">
      <li *ngFor="let a of axes; trackBy: axisKey" [class.is-low]="a.low" [class.fresh]="fresh.has(a.axis)"
          [attr.aria-label]="a.axis + ' axis battery ' + (a.low ? 'low' : 'OK')">
        <svg viewBox="0 0 14 24" aria-hidden="true">
          <rect x="1.5" y="3.5" width="11" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <rect x="4.5" y="1" width="5" height="2.5" rx=".8" fill="currentColor"/>
          <rect class="fill" x="3.6" y="5.6" width="6.8" height="14.8" rx=".8"
                [style.fill]="a.low ? '#e03131' : '#22c55e'" [style.transform]="a.low ? 'scaleY(.22)' : 'scaleY(1)'"/>
        </svg>
        <span class="axis" aria-hidden="true">{{ a.axis }}</span>
        <span class="word" aria-hidden="true"
              [ngClass]="a.low ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'">{{ a.low ? 'Low' : 'OK' }}</span>
      </li>
    </ul>
  `
})
export class AxisBatteriesComponent {
  @Input() axes: AxisBattery[] = [];
  /** Axes whose battery has just gone low since the last refresh. */
  @Input() fresh: Set<string> = new Set();

  axisKey(_: number, a: AxisBattery): string { return a.axis; }

  get cols(): number { const n = this.axes.length; return n <= 4 ? Math.max(1, n) : 3; }
}
