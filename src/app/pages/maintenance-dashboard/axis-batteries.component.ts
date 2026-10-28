import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export const BATTERY_FLAGS = [
  { key: 'ABP', meaning: 'A/B phase detector battery low (bit 3)' },
  { key: 'INP', meaning: 'Built-in serial pulse coder battery low (bit 4)' },
  { key: 'EXP', meaning: 'Separate / external serial detector battery low (bit 5)' }
] as const;
export type BatteryFlag = typeof BATTERY_FLAGS[number]['key'];
export interface AxisBattery { axis: string; low: boolean | null; active?: BatteryFlag[]; detailed?: boolean; }
const AXIS_ORDER = ['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W'];
const axisRank = (axis: string) => { const i = AXIS_ORDER.indexOf(axis); return i < 0 ? AXIS_ORDER.length : i; };
const object = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const order = (a: AxisBattery, b: AxisBattery) => axisRank(a.axis) - axisRank(b.axis) || a.axis.localeCompare(b.axis);

/** Older collectors supplied a boolean per axis. Never coerce unknown flags. */
export function axisBatteries(flags: any): AxisBattery[] {
  if (!object(flags)) return [];
  return Object.entries(flags).filter(([, value]) => typeof value === 'boolean')
    .map(([axis, low]) => ({ axis, low })).sort(order);
}

/** Explicit booleans are authoritative; neither status words nor raw alarm masks are decoded here. */
export function accAxisBatteries(diagnostics: any, legacy?: any): AxisBattery[] {
  if (!object(diagnostics)) return axisBatteries(legacy);
  return Object.entries(diagnostics).filter(([axis]) => /^[A-Z][A-Z0-9_]{0,15}$/i.test(axis)).slice(0, 32)
    .map(([axis, value]) => {
      const entry = object(value) ? value : {};
      const active = BATTERY_FLAGS.filter(flag => entry[flag.key] === true).map(flag => flag.key);
      const allClear = BATTERY_FLAGS.every(flag => entry[flag.key] === false);
      const low = active.length || entry['low'] === true ? true : allClear || entry['low'] === false ? false : null;
      return { axis, low, active, detailed: true };
    }).sort(order);
}
export function accBatteryWord(low: boolean | null): string {
  return low === true ? 'Battery issue' : low === false ? 'Healthy' : 'Not reported';
}
export function batteryWarningWord(low: boolean | null): string {
  return low === true ? 'Check battery' : low === false ? 'No warning reported' : 'Not reported';
}
export function fanucBatterySupported(row: any): boolean {
  return !!row && (row.battery_supported === true || String(row.controller_type || '').toUpperCase() === 'FANUC');
}

/*
 * The ACC battery, axis by axis, as a row of cells (28 Oct 2026, the user:
 * the battery cards "not feeling well"): each axis its battery and letter —
 * a tick when the controller reports no warning, "!" and the warning's code
 * when it does, a dash when it says nothing. No charge level is drawn: the
 * controller sends warning flags, not a charge. The word for each axis is
 * there for screen readers and in its label; the card's head says it once.
 */
@Component({
  selector: 'app-axis-batteries', standalone: true, imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--cols]': 'cols' },
  styles: [`
    :host { display: block; min-width: 0; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); }
    li { display: flex; flex-direction: column; align-items: center; gap: .2rem; min-width: 0; padding: .45rem .2rem .4rem;
         border-radius: 10px; background: rgba(148,163,184,.1); color: #94a3b8; }
    li.is-healthy { background: rgba(4,120,87,.08); color: #047857; }
    li.is-low { background: rgba(245,166,35,.14); color: #b45309; box-shadow: inset 0 0 0 1px rgba(245,166,35,.5); }
    :host-context(.dark) li { background: rgba(148,163,184,.1); color: #64748b; }
    :host-context(.dark) li.is-healthy { background: rgba(110,231,183,.1); color: #6ee7b7; }
    :host-context(.dark) li.is-low { background: rgba(252,211,77,.12); color: #fcd34d; }
    svg { width: .95rem; height: 1.6rem; flex: none; }
    .axis { font-size: .82rem; font-weight: 800; line-height: 1; color: var(--mexa-ink); }
    li:not(.is-healthy):not(.is-low) .axis { color: var(--mexa-ink-3); }
    .flags { display: flex; flex-wrap: wrap; justify-content: center; gap: .15rem; }
    .flag { font-size: .6rem; line-height: 1.3; padding: 0 .25rem; border-radius: 4px; font-weight: 700; color: inherit; background: rgba(245,166,35,.2); }
    .low { font-size: .62rem; font-weight: 700; line-height: 1.3; }
    @keyframes alert { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
    li.fresh svg { animation: alert 1.2s ease-in-out 3; }
    @media (prefers-reduced-motion: reduce) { li.fresh svg { animation: none; } }
  `],
  template: `
    <ul role="list" aria-label="ACC battery by axis">
      <li *ngFor="let a of axes; trackBy: axisKey" [class.is-low]="a.low === true" [class.is-healthy]="a.low === false" [class.fresh]="fresh.has(a.axis)"
          [attr.aria-label]="axisLabel(a)" [attr.title]="axisLabel(a)">
        <svg viewBox="0 0 14 24" aria-hidden="true">
          <rect x="1.5" y="3.5" width="11" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <rect x="4.5" y="1" width="5" height="2.5" rx=".8" fill="currentColor"/>
          <path *ngIf="a.low === true" d="M7 8v6m0 3v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path *ngIf="a.low === false" d="m4.3 13.4 1.9 2 3.5-4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          <path *ngIf="a.low === null" d="M4.8 13h4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
        <span class="axis">{{ a.axis }}</span>
        <span class="word sr-only">{{ word(a.low) }}</span>
        <span class="flags" *ngIf="a.active?.length; else plainLow"><span class="flag" *ngFor="let flag of a.active" [title]="meaning(flag)">{{ flag }}</span></span>
        <ng-template #plainLow><span class="low" *ngIf="a.low === true" aria-hidden="true">Low</span></ng-template>
      </li>
    </ul>
  `
})
export class AxisBatteriesComponent {
  @Input() axes: AxisBattery[] = [];
  @Input() fresh: Set<string> = new Set();
  word = accBatteryWord;
  /** All in one row up to four axes; five or six, two even rows. */
  get cols(): number { return this.axes.length <= 4 ? Math.max(1, this.axes.length) : Math.ceil(this.axes.length / 2); }
  axisKey(_: number, axis: AxisBattery): string { return axis.axis; }
  meaning(flag: BatteryFlag): string { return BATTERY_FLAGS.find(item => item.key === flag)!.meaning; }
  axisLabel(axis: AxisBattery): string {
    return `${axis.axis} axis battery: ${this.word(axis.low)}${axis.active?.length ? '. ' + axis.active.map(flag => this.meaning(flag)).join('; ') : ''}`;
  }
}
