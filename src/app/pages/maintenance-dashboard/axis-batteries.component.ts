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

@Component({
  selector: 'app-axis-batteries', standalone: true, imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-width: 0; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    li { display: flex; flex-direction: column; align-items: flex-start; gap: .2rem; min-width: 0; padding: .4rem .45rem;
         border: 1px solid var(--mexa-rule); border-radius: 8px; background: rgba(148,163,184,.07); }
    li.is-low { background: rgba(245,166,35,.1); border-color: rgba(245,166,35,.45); }
    .head { display: flex; align-items: center; gap: .3rem; }
    svg { width: .8rem; height: 1.1rem; color: var(--mexa-ink-2); flex: none; }
    .axis { font-size: .8rem; font-weight: 800; color: var(--mexa-ink); }
    .word { font-size: .67rem; line-height: 1.3; color: var(--mexa-ink-2); overflow-wrap: anywhere; }
    li.is-healthy { background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.25); }
    .is-healthy .word { color: #047857; font-weight: 700; }
    :host-context(.dark) .is-healthy .word { color: #6ee7b7; }
    .is-low .word { color: #92400e; font-weight: 700; }
    :host-context(.dark) .is-low .word { color: #fcd34d; }
    .flags { display: flex; flex-wrap: wrap; gap: .2rem; }
    .flag { font-size: .63rem; padding: .1rem .25rem; border-radius: 4px; color: var(--mexa-ink); background: rgba(245,166,35,.18); font-weight: 700; }
    @keyframes alert { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
    li.fresh .word { animation: alert 1.2s ease-in-out 3; }
    @media (prefers-reduced-motion: reduce) { li.fresh .word { animation: none; } }
  `],
  template: `
    <ul role="list" aria-label="ACC battery by axis">
      <li *ngFor="let a of axes; trackBy: axisKey" [class.is-low]="a.low === true" [class.is-healthy]="a.low === false" [class.fresh]="fresh.has(a.axis)"
          [attr.aria-label]="axisLabel(a)">
        <span class="head"><svg viewBox="0 0 14 24" aria-hidden="true">
          <rect x="1.5" y="3.5" width="11" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <rect x="4.5" y="1" width="5" height="2.5" rx=".8" fill="currentColor"/>
          <path *ngIf="a.low === true" d="M7 8v6m0 3v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg><span class="axis">{{ a.axis }}</span></span>
        <span class="word">{{ word(a.low) }}</span>
        <span class="flags" *ngIf="a.active?.length"><span class="flag" *ngFor="let flag of a.active" [title]="meaning(flag)">{{ flag }}</span></span>
      </li>
    </ul>
  `
})
export class AxisBatteriesComponent {
  @Input() axes: AxisBattery[] = [];
  @Input() fresh: Set<string> = new Set();
  word = accBatteryWord;
  axisKey(_: number, axis: AxisBattery): string { return axis.axis; }
  meaning(flag: BatteryFlag): string { return BATTERY_FLAGS.find(item => item.key === flag)!.meaning; }
  axisLabel(axis: AxisBattery): string {
    return `${axis.axis} axis battery: ${this.word(axis.low)}${axis.active?.length ? '. ' + axis.active.map(flag => this.meaning(flag)).join('; ') : ''}`;
  }
}
