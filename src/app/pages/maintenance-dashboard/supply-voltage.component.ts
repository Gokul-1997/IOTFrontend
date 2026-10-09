import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { fmt, imbalancePct } from '../../shared/meter-panel/meter-panel.component';

export type SupplyBand = 'Healthy' | 'Stable' | 'Critical' | '';

/** One phase's voltage, and whether it is outside the supply's tolerance. */
export interface SupplyPhase { label: string; value: string; out: boolean; }

export interface SupplyGroup {
  key: 'ln' | 'll'; title: string; short: string; nominal: number;
  phases: SupplyPhase[]; avg: string; imbalance: string;
}

/** The supply voltage as the card shows it: phase to neutral and phase to phase, each with its average. */
export interface SupplyView {
  at: string; stale: boolean; word: SupplyBand;
  /** What is wrong, in a few words, for the attention line ("L2-N 205.0 V"); empty when nothing is. */
  problem: string;
  groups: SupplyGroup[];
}

/**
 * The meter's latest reading (GET /dashboard/maintenance → `supply`) as two
 * groups — phase to neutral (L-N) and phase to phase (L-L), the embedded
 * team's LN and LL parameters — each phase judged against the supply's
 * tolerance (415 V, 240 V to neutral, ±10 %) and each group by how far its
 * phases are apart (over 2 % is worth a look). Critical: a phase out of
 * tolerance; Stable: the phases apart; Healthy otherwise. Null when the
 * machine has no meter reading.
 */
export function supplyView(s: any): SupplyView | null {
  if (!s || !s.ln || !s.ll || !s.limits) return null;
  const L = s.limits;
  const tol = Number(L.tolerance_pct) / 100;
  const real = (v: any) => v !== null && v !== undefined && Number.isFinite(Number(v));
  const outOf = (v: any, nominal: number) => real(v) && Math.abs(Number(v) - nominal) > nominal * tol;

  const group = (key: 'ln' | 'll', title: string, short: string, names: [string, string][], nominal: number) => {
    const raw = names.map(([, k]) => (real(s[key][k]) ? Number(s[key][k]) : null));
    const imb = imbalancePct(raw);
    return {
      key, title, short, nominal, imb,
      phases: names.map(([label, k], i) => ({ label, value: fmt(raw[i], 1), out: outOf(raw[i], nominal) })),
      avg: fmt(real(s[key].avg) ? Number(s[key].avg) : null, 1),
      imbalance: imb === null ? '--' : `${fmt(imb, 1)} %`
    };
  };
  const groups = [
    group('ln', 'Phase to neutral', 'L-N', [['L1-N', 'v1n'], ['L2-N', 'v2n'], ['L3-N', 'v3n']], Number(L.ln_nominal)),
    group('ll', 'Phase to phase', 'L-L', [['L1-L2', 'v12'], ['L2-L3', 'v23'], ['L3-L1', 'v31']], Number(L.ll_nominal))
  ];

  const out = groups.flatMap(g => g.phases.filter(p => p.out).map(p => `${p.label} ${p.value} V`));
  const apart = groups.filter(g => g.imb !== null && g.imb > Number(L.imbalance_pct));
  const anyReading = groups.some(g => g.phases.some(p => p.value !== '--'));
  const word: SupplyBand = !anyReading ? '' : out.length ? 'Critical' : apart.length ? 'Stable' : 'Healthy';
  const problem = out.length ? out.join(', ')
    : apart.length ? apart.map(g => `${g.short} ${g.imbalance} apart`).join(', ') : '';

  const at = new Date(s.read_at);
  return {
    at: Number.isNaN(at.getTime()) ? ''
      : at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
    stale: !!s.stale, word, problem,
    groups: groups.map(({ imb, ...g }) => g)
  };
}

/*
 * The Maintenance Dashboard's supply voltage card: the machine's energy
 * meter, phase by phase. A phase outside the supply's tolerance is red; the
 * word beside the title is the worst of it. A machine without a meter gets
 * one line saying so, not six empty boxes.
 */
@Component({
  selector: 'app-supply-voltage',
  standalone: true,
  imports: [CommonModule, MetricHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; margin-bottom: 1rem; }
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .75rem; margin-bottom: .6rem; }
    .head h2 { margin: 0; display: inline-flex; align-items: center; gap: .3rem; }
    .at { margin-left: auto; font-size: .78rem; color: var(--mexa-ink-2); font-variant-numeric: tabular-nums; }
    .at.is-stale { color: #b45309; }
    :host-context(.dark) .at.is-stale { color: #fcd34d; }
    .word { margin: 0; font-size: .78rem; font-weight: 700; }
    .groups { display: grid; gap: .75rem 1.25rem; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 768px) { .groups { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .group { min-width: 0; }
    .title { margin: 0 0 .35rem; font-size: .8rem; font-weight: 700; color: var(--mexa-ink); }
    .title span { font-weight: 500; color: var(--mexa-ink-3); }
    dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .4rem; margin: 0; }
    @media (max-width: 420px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .phase { padding: .45rem .55rem; border-radius: 10px; background: var(--mexa-row-alt); min-width: 0; }
    dt { font-size: .72rem; font-weight: 600; color: var(--mexa-ink-2); }
    dd { margin: .1rem 0 0; font-size: 1.05rem; font-weight: 800; color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .phase.is-avg { background: transparent; box-shadow: inset 0 0 0 1px var(--mexa-rule); }
    .phase.is-out { background: rgba(224, 49, 49, .1); }
    .phase.is-out dd { color: #b42334; }
    :host-context(.dark) .phase.is-out dd { color: #f59aa6; }
    .foot { margin: .35rem 0 0; font-size: .75rem; color: var(--mexa-ink-3); font-variant-numeric: tabular-nums; }
    .none { margin: 0; font-size: .82rem; color: var(--mexa-ink-3); }
    @keyframes alert { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
    .fresh .word { animation: alert 1.2s ease-in-out 3; }
    @media (prefers-reduced-motion: reduce) { .fresh .word { animation: none; } }
  `],
  template: `
    <section class="mexa-card" aria-labelledby="mtSupply" [class.fresh]="fresh">
      <div class="head">
        <h2 id="mtSupply" class="mexa-card-title mexa-card-title-left">Supply voltage
          <app-metric-help topic="supply_voltage"></app-metric-help></h2>
        @if (supply; as sv) {
          <span class="at" [class.is-stale]="sv.stale">{{ sv.stale ? 'Last reading' : 'Reading' }} {{ sv.at }}</span>
          <p class="word" [ngClass]="wordClass(sv.word)">{{ sv.word || 'Not reported' }}</p>
        }
      </div>
      @if (supply; as sv) {
        <div class="groups">
          <div class="group" *ngFor="let g of sv.groups; trackBy: groupKey" role="group" [attr.aria-label]="g.title + ' voltage'">
            <p class="title">{{ g.title }} <span>· {{ g.short }} · V</span></p>
            <dl>
              <div class="phase" *ngFor="let p of g.phases" [class.is-out]="p.out">
                <dt>{{ p.label }}</dt>
                <dd>{{ p.value }}<span class="sr-only"> volts{{ p.out ? ', outside the supply tolerance' : '' }}</span></dd>
              </div>
              <div class="phase is-avg"><dt>Average</dt><dd>{{ g.avg }}<span class="sr-only"> volts</span></dd></div>
            </dl>
            <p class="foot">Phases apart {{ g.imbalance }}</p>
          </div>
        </div>
      } @else {
        <p class="none">Not reported — no energy meter reading for this machine in this window.</p>
      }
    </section>
  `
})
export class SupplyVoltageComponent {
  @Input() supply: SupplyView | null = null;
  /** The supply has just got worse since the last refresh: its word pulses three times. */
  @Input() fresh = false;

  groupKey(_: number, g: SupplyGroup): string { return g.key; }

  /** The dashboard's band colours, 4.8–5.5:1 on white. */
  wordClass(w: SupplyBand): string {
    return w === 'Critical' ? 'text-red-700 dark:text-red-400'
         : w === 'Stable'   ? 'text-amber-700 dark:text-amber-400'
         : w === 'Healthy'  ? 'text-emerald-700 dark:text-emerald-400' : 'text-[--mexa-ink-3]';
  }
}
