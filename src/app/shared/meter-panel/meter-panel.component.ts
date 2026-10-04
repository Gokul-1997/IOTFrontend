import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';
import { BehaviorSubject, Subscription, catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { MeterService } from './meter.service';
import { StateComponent } from '../state/state.component';

/*
 * Everything a machine's energy meter reports, on the Energy screen (any
 * machine that has a meter) and on the machine page (that machine).
 *
 *   - now: power (kW, kVA, kVAr), voltage (phase to phase and to neutral,
 *     each phase), current (each phase), power factor and frequency — each
 *     with its unit, coloured against plain guidance (415 V ±10 %, power
 *     factor 0.9, 49.5–50.5 Hz) and with when it was read;
 *   - the meter's own running totals (import / export / total kWh, kVArh,
 *     kVAh, hours, supply interruptions);
 *   - a trend over 1 hour to 7 days for the quantity chosen, and what the
 *     range adds up to — energy used, highs and lows.
 *
 * Values are shown as the meter sends them. When its readings say the
 * current transformers face the wrong way (negative kW, more Export than
 * Import), the panel says so in words instead of hiding the sign.
 *
 * On the machine page the panel stays out of the way for a machine with no
 * meter; on the Energy screen it says that no machine has one yet.
 */

type RangeKey = '1h' | '4h' | '12h' | '24h' | '7d';
type Metric = 'kw' | 'i' | 'v' | 'pf' | 'kwh';
type Band = { label: string; badge: string; icon: string } | null;

export interface MeterLimits {
  v_ll_nominal: number; v_tolerance_pct: number; pf_good: number; pf_low: number;
  hz_min: number; hz_max: number; v_imbalance_pct: number; i_imbalance_pct: number;
}

const POLL_MS = 30_000;
const RANGES: { key: RangeKey; label: string; long: string }[] = [
  { key: '1h', label: '1 hour', long: 'the last hour' },
  { key: '4h', label: '4 hours', long: 'the last 4 hours' },
  { key: '12h', label: '12 hours', long: 'the last 12 hours' },
  { key: '24h', label: '24 hours', long: 'the last 24 hours' },
  { key: '7d', label: '7 days', long: 'the last 7 days' }
];
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'kw', label: 'Power', unit: 'kW' },
  { key: 'i', label: 'Current', unit: 'A' },
  { key: 'v', label: 'Voltage', unit: 'V' },
  { key: 'pf', label: 'Power factor', unit: '' },
  { key: 'kwh', label: 'Energy used', unit: 'kWh' }
];

const nf = [0, 1, 2, 3].map(d => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const dayClock = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** A number to a fixed count of decimals, or "--" when there is none. */
export function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '--' : nf[digits].format(v);
}

/** Two decimals for small values (1.24 A), one for large (14.9 A, 416.7 V). */
export function fmtAuto(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '--' : fmt(v, Math.abs(v) < 10 ? 2 : 1);
}

/**
 * How far the furthest phase is from the average of the three, as a % of
 * that average (the NEMA definition). Null when a phase is missing or there
 * is nothing to compare (an average of 0).
 */
export function imbalancePct(values: (number | null | undefined)[]): number | null {
  if (!values.length || values.some(v => v === null || v === undefined || !Number.isFinite(v))) return null;
  const vs = values as number[];
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  if (!(avg > 0)) return null;
  return (Math.max(...vs.map(v => Math.abs(v - avg))) / avg) * 100;
}

/** Phase-to-phase voltage against the nominal supply and its tolerance. */
export function voltageBand(v: number | null | undefined, l: MeterLimits): Band {
  if (v === null || v === undefined) return null;
  const lo = l.v_ll_nominal * (1 - l.v_tolerance_pct / 100);
  const hi = l.v_ll_nominal * (1 + l.v_tolerance_pct / 100);
  if (v < lo) return { label: 'Low', badge: 'mexa-badge-warn', icon: 'south' };
  if (v > hi) return { label: 'High', badge: 'mexa-badge-warn', icon: 'north' };
  return { label: 'Within limits', badge: 'mexa-badge-good', icon: 'check_circle' };
}

/** Power factor by its size: a meter wired the wrong way round reports it negative. */
export function pfBand(pf: number | null | undefined, l: MeterLimits): Band {
  if (pf === null || pf === undefined) return null;
  const a = Math.abs(pf);
  if (a >= l.pf_good) return { label: 'Good', badge: 'mexa-badge-good', icon: 'check_circle' };
  if (a >= l.pf_low) return { label: 'Fair', badge: 'mexa-badge-info', icon: 'info' };
  return { label: 'Low', badge: 'mexa-badge-warn', icon: 'warning_amber' };
}

export function hzBand(hz: number | null | undefined, l: MeterLimits): Band {
  if (hz === null || hz === undefined) return null;
  return hz < l.hz_min || hz > l.hz_max
    ? { label: 'Out of range', badge: 'mexa-badge-warn', icon: 'warning_amber' }
    : { label: 'Normal', badge: 'mexa-badge-good', icon: 'check_circle' };
}

/**
 * Round axis bounds that take in [lo, hi] — -0.83…-0.73 kW becomes -1…0 in
 * steps of 0.2 rather than ticks at -0.17, -0.33, -0.66.
 */
export function niceBounds(lo: number, hi: number, maxTicks = 6): { min: number; max: number; ticks: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, ticks: 5 };
  if (hi <= lo) hi = lo + 1;
  const span = hi - lo;
  const mag = Math.pow(10, Math.floor(Math.log10(span)));
  for (const f of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    const step = f * mag;
    const min = Math.floor(lo / step + 1e-9) * step;
    const max = Math.ceil(hi / step - 1e-9) * step;
    const ticks = Math.round((max - min) / step);
    if (ticks <= maxTicks) return { min: +min.toFixed(10), max: +max.toFixed(10), ticks };
  }
  return { min: lo, max: hi, ticks: 5 };
}

let uidSeq = 0;

@Component({
  selector: 'app-meter-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .mp-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem .75rem; margin-bottom: .6rem; }
    .mp-titlewrap { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .6rem; min-width: 0; }
    .mp-title { margin: 0; font-size: var(--fs-card-title, .9375rem); font-weight: 700; color: var(--mexa-ink); }
    .mp-select { max-width: 14rem; }
    .mp-at { display: inline-flex; align-items: center; gap: .25rem; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); }
    .mp-at.is-stale { color: #b45309; font-weight: 600; }
    :host-context(.dark) .mp-at.is-stale { color: #f7c667; }
    .mp-at .material-icons { font-size: 14px; }
    .mp-cards { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(14.5rem, 1fr)); margin: .25rem 0 .75rem; }
    .mp-card { border: 1px solid var(--mexa-rule); border-radius: 12px; padding: .75rem .9rem; background: var(--mexa-card); min-width: 0; }
    .mp-label { margin: 0; font-size: var(--fs-label, .8125rem); font-weight: 600; color: var(--mexa-ink-2); }
    .mp-value { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .45rem; margin: .2rem 0 .1rem; font-size: 1.6rem; font-weight: 700; line-height: 1.15;
                color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .mp-value small { font-size: .85rem; font-weight: 600; color: var(--mexa-ink-2); }
    .mp-value .mexa-badge { align-self: center; }
    .mp-sub { margin: 0 0 .4rem; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); }
    .mp-rows { display: grid; grid-template-columns: auto 1fr; gap: .15rem .6rem; margin: 0; font-size: var(--fs-body, .875rem); }
    .mp-rows dt { color: var(--mexa-ink-3); font-weight: 600; white-space: nowrap; }
    .mp-rows dd { margin: 0; color: var(--mexa-ink); font-variant-numeric: tabular-nums; text-align: right; }
    .mp-phases { display: grid; grid-template-columns: repeat(3, 1fr); gap: .3rem; margin: .35rem 0 .4rem; }
    .mp-phase { border-radius: 8px; background: var(--mexa-row-alt); padding: .3rem .4rem; text-align: center; min-width: 0; }
    .mp-phase b { display: block; font-size: 11px; font-weight: 700; color: var(--mexa-ink-3); }
    .mp-phase span { font-size: .9rem; font-weight: 700; color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .mp-totals { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); margin: 0 0 1rem; }
    .mp-total { border-radius: 10px; background: var(--mexa-row-alt); padding: .5rem .7rem; }
    .mp-total dt { margin: 0; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); font-weight: 600; }
    .mp-total dd { margin: .1rem 0 0; font-size: 1.05rem; font-weight: 700; color: var(--mexa-ink); font-variant-numeric: tabular-nums; }
    .mp-total dd small { font-size: .75rem; font-weight: 600; color: var(--mexa-ink-2); margin-left: .2rem; }
    .mp-section { margin: .25rem 0 .4rem; font-size: var(--fs-label, .8125rem); font-weight: 700; color: var(--mexa-ink-2); }
    .mp-chartbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .25rem; }
    .mp-basis { margin: .5rem 0 0; font-size: var(--fs-small, .75rem); color: var(--mexa-ink-3); }
    .mexa-seg button { min-height: 32px; padding: .25rem .7rem; font-size: .78rem; }
    .mexa-seg { max-width: 100%; overflow-x: auto; }
    @media (max-width: 400px) { .mexa-seg button { padding: .25rem .45rem; } }
    @media (pointer: coarse) { .mexa-seg button { min-height: 40px; } }
  `],
  template: `
    <section *ngIf="visible" class="mexa-card" [attr.aria-labelledby]="ids.title">
      <div class="mp-head">
        <div class="mp-titlewrap">
          <h2 class="mp-title" [id]="ids.title">Energy meter</h2>
          <!-- only machines that have sent meter readings are offered -->
          <ng-container *ngIf="mode === 'energy' && meters.length">
            <label class="sr-only" [for]="ids.machine">Machine</label>
            <select class="mexa-select mp-select" [id]="ids.machine" [ngModel]="data?.machine?.id" (ngModelChange)="setMachine($event)">
              <option *ngFor="let m of meters" [ngValue]="m.id">{{ m.serial }}</option>
            </select>
          </ng-container>
          <span class="mp-at" *ngIf="data?.machine" [class.is-stale]="!latest || latest.stale" aria-live="polite">
            <span class="material-icons" aria-hidden="true">{{ !latest || latest.stale ? 'history' : 'schedule' }}</span>{{ asOf }}
          </span>
        </div>
        <div class="mexa-seg" role="group" aria-label="Time range" *ngIf="data?.machine">
          <button type="button" *ngFor="let r of ranges" [attr.aria-pressed]="range === r.key" (click)="setRange(r.key)">{{ r.label }}</button>
        </div>
      </div>

      <app-state *ngIf="state === 'loading' && !data" kind="loading" title="Loading the energy meter…"></app-state>
      <app-state *ngIf="state === 'error'" kind="error" title="Could not load the energy meter"
        text="Check the connection, then try again." action="Try again" (act)="reload()"></app-state>
      <app-state *ngIf="state !== 'error' && data && !data.machine" kind="empty" icon="electric_meter"
        title="No machine has an energy meter yet"
        text="When a machine's collector sends its meter readings, every phase, power factor, frequency and the meter's import and export totals appear here."></app-state>

      <ng-container *ngIf="state !== 'error' && data?.machine">
        <p *ngIf="data.checks?.ct_reversed" class="mexa-note mexa-note-warn">
          This meter reads the machine's power as negative and counts its energy as Export
          ({{ fmt(latest?.kwh_export, 1) }} kWh) rather than Import ({{ fmt(latest?.kwh_import, 1) }} kWh). Its current
          transformers are most likely fitted the wrong way round — ask the electrician to turn them, or to change the
          meter's CT direction. Energy used is still right: it comes from the meter's total, which counts both ways.
        </p>

        <app-state *ngIf="!latest" kind="empty" icon="sensors_off" title="No meter reading from this machine in the last 30 days"
          text="Check that the machine and its meter are switched on and connected."></app-state>

        <ng-container *ngIf="latest">
          <!-- ── now ── -->
          <div class="mp-cards">
            <article class="mp-card" [attr.aria-labelledby]="ids.power">
              <p class="mp-label" [id]="ids.power">Power</p>
              <p class="mp-value">{{ fmtAuto(latest.kw_total) }}<small>kW</small></p>
              <p class="mp-sub">Total of the three phases</p>
              <div class="mp-phases" role="list" aria-label="Power by phase">
                <span class="mp-phase" role="listitem"><b>R</b><span>{{ fmtAuto(latest.kw1) }}</span></span>
                <span class="mp-phase" role="listitem"><b>Y</b><span>{{ fmtAuto(latest.kw2) }}</span></span>
                <span class="mp-phase" role="listitem"><b>B</b><span>{{ fmtAuto(latest.kw3) }}</span></span>
              </div>
              <dl class="mp-rows">
                <ng-container *ngIf="latest.kva_total !== null"><dt>Apparent</dt><dd>{{ fmtAuto(latest.kva_total) }} kVA</dd></ng-container>
                <ng-container *ngIf="latest.kvar_total !== null"><dt>Reactive</dt><dd>{{ fmtAuto(latest.kvar_total) }} kVAr</dd></ng-container>
                <ng-container *ngIf="latest.kw_demand_max !== null || latest.kva_demand_max !== null">
                  <dt>Highest demand</dt><dd>{{ fmtAuto(latest.kw_demand_max) }} kW · {{ fmtAuto(latest.kva_demand_max) }} kVA</dd>
                </ng-container>
              </dl>
            </article>

            <article class="mp-card" [attr.aria-labelledby]="ids.volt">
              <p class="mp-label" [id]="ids.volt">Voltage</p>
              <p class="mp-value">{{ fmt(latest.v_ll_avg, 1) }}<small>V</small>
                <span *ngIf="vBand as b" class="mexa-badge" [ngClass]="b.badge"><span class="material-icons" aria-hidden="true">{{ b.icon }}</span>{{ b.label }}</span>
              </p>
              <p class="mp-sub">Phase to phase, average · {{ limits.v_ll_nominal }} V ±{{ limits.v_tolerance_pct }} %</p>
              <div class="mp-phases" role="list" aria-label="Voltage between phases">
                <span class="mp-phase" role="listitem"><b>R–Y</b><span>{{ fmt(latest.v12, 1) }}</span></span>
                <span class="mp-phase" role="listitem"><b>Y–B</b><span>{{ fmt(latest.v23, 1) }}</span></span>
                <span class="mp-phase" role="listitem"><b>B–R</b><span>{{ fmt(latest.v31, 1) }}</span></span>
              </div>
              <dl class="mp-rows">
                <ng-container *ngIf="latest.v1n !== null || latest.v2n !== null || latest.v3n !== null">
                  <dt>Phase to neutral</dt><dd>{{ fmt(latest.v1n, 1) }} · {{ fmt(latest.v2n, 1) }} · {{ fmt(latest.v3n, 1) }} V</dd>
                </ng-container>
                <dt>Imbalance</dt>
                <dd>{{ vImbalance === null ? '--' : fmt(vImbalance, 1) + ' %' }}
                  <span *ngIf="vImbalance !== null && vImbalance > limits.v_imbalance_pct" class="mexa-badge mexa-badge-warn">Over {{ limits.v_imbalance_pct }} %</span></dd>
                <ng-container *ngIf="vMaxRecorded !== null"><dt>Highest recorded</dt><dd>{{ fmt(vMaxRecorded, 1) }} V</dd></ng-container>
              </dl>
            </article>

            <article class="mp-card" [attr.aria-labelledby]="ids.amp">
              <p class="mp-label" [id]="ids.amp">Current</p>
              <p class="mp-value">{{ fmtAuto(latest.i_avg) }}<small>A</small></p>
              <p class="mp-sub">Average of the three phases</p>
              <div class="mp-phases" role="list" aria-label="Current by phase">
                <span class="mp-phase" role="listitem"><b>R</b><span>{{ fmtAuto(latest.i1) }}</span></span>
                <span class="mp-phase" role="listitem"><b>Y</b><span>{{ fmtAuto(latest.i2) }}</span></span>
                <span class="mp-phase" role="listitem"><b>B</b><span>{{ fmtAuto(latest.i3) }}</span></span>
              </div>
              <dl class="mp-rows">
                <dt>Imbalance</dt>
                <dd>{{ iImbalanceText }}
                  <span *ngIf="iImbalanceHigh" class="mexa-badge mexa-badge-warn">Over {{ limits.i_imbalance_pct }} %</span></dd>
                <ng-container *ngIf="latest.i1_max !== null || latest.i2_max !== null || latest.i3_max !== null">
                  <dt>Highest recorded</dt><dd>{{ fmtAuto(latest.i1_max) }} · {{ fmtAuto(latest.i2_max) }} · {{ fmtAuto(latest.i3_max) }} A</dd>
                </ng-container>
              </dl>
            </article>

            <article class="mp-card" [attr.aria-labelledby]="ids.pf">
              <p class="mp-label" [id]="ids.pf">Power factor</p>
              <p class="mp-value">{{ fmt(latest.pf_avg, 2) }}
                <span *ngIf="pfBandNow as b" class="mexa-badge" [ngClass]="b.badge"><span class="material-icons" aria-hidden="true">{{ b.icon }}</span>{{ b.label }}</span>
              </p>
              <p class="mp-sub">Electricity boards expect 0.9 or better</p>
              <div class="mp-phases" role="list" aria-label="Power factor by phase">
                <span class="mp-phase" role="listitem"><b>R</b><span>{{ fmt(latest.pf1, 2) }}</span></span>
                <span class="mp-phase" role="listitem"><b>Y</b><span>{{ fmt(latest.pf2, 2) }}</span></span>
                <span class="mp-phase" role="listitem"><b>B</b><span>{{ fmt(latest.pf3, 2) }}</span></span>
              </div>
              <dl class="mp-rows" *ngIf="latest.frequency_hz !== null">
                <dt>Frequency</dt>
                <dd>{{ fmt(latest.frequency_hz, 2) }} Hz
                  <span *ngIf="hzBandNow as b" class="mexa-badge" [ngClass]="b.badge">{{ b.label }}</span></dd>
              </dl>
            </article>
          </div>

          <!-- the meter's own running totals -->
          <h3 class="mp-section">Meter totals, since it was installed</h3>
          <dl class="mp-totals">
            <div class="mp-total"><dt>Total energy</dt><dd>{{ fmt(latest.kwh_total, 1) }}<small>kWh</small></dd></div>
            <div class="mp-total"><dt>Import</dt><dd>{{ fmt(latest.kwh_import, 1) }}<small>kWh</small></dd></div>
            <div class="mp-total"><dt>Export</dt><dd>{{ fmt(latest.kwh_export, 1) }}<small>kWh</small></dd></div>
            <div class="mp-total"><dt>Reactive</dt><dd>{{ fmt(latest.kvarh_total, 1) }}<small>kVArh</small></dd></div>
            <div class="mp-total"><dt>Apparent</dt><dd>{{ fmt(latest.kvah_total, 1) }}<small>kVAh</small></dd></div>
            <div class="mp-total"><dt>Meter run time</dt><dd>{{ fmt(latest.run_hours, 1) }}<small>h</small></dd></div>
            <div class="mp-total"><dt>Supply interruptions</dt><dd>{{ fmt(latest.aux_interrupts, 0) }}</dd></div>
          </dl>
        </ng-container>

        <!-- ── over the range ── -->
        <ng-container *ngIf="data.summary?.readings">
          <div class="mp-chartbar">
            <div class="mexa-seg" role="group" aria-label="Show on the chart">
              <button type="button" *ngFor="let m of metrics" [attr.aria-pressed]="metric === m.key" (click)="setMetric(m.key)">{{ m.label }}</button>
            </div>
            <span class="mp-basis">{{ rangeLong }}</span>
          </div>
          <div role="group" [attr.aria-label]="chartLabel">
            <apx-chart [series]="chart.series" [chart]="chart.chart" [colors]="chart.colors" [stroke]="chart.stroke"
              [xaxis]="chart.xaxis" [yaxis]="chart.yaxis" [annotations]="chart.annotations" [legend]="chart.legend"
              [tooltip]="chart.tooltip" [grid]="chart.grid" [dataLabels]="chart.dataLabels" [markers]="chart.markers"
              [plotOptions]="chart.plotOptions"></apx-chart>
          </div>
          <dl class="mp-totals">
            <ng-container *ngFor="let s of stats">
              <div class="mp-total"><dt>{{ s.label }}</dt><dd>{{ s.value }}<small>{{ s.unit }}</small></dd></div>
            </ng-container>
          </dl>
          <p class="mp-basis">{{ basis }}</p>
        </ng-container>
        <app-state *ngIf="latest && !data.summary?.readings" kind="empty" icon="sensors_off"
          [title]="'No meter reading in ' + rangeLong"
          [text]="range === '7d' ? 'The latest reading above is older than this range.' : 'Look at a longer range.'"
          [action]="range === '7d' ? '' : 'Show the last 7 days'" (act)="setRange('7d')"></app-state>
      </ng-container>
    </section>
  `
})
export class MeterPanelComponent implements OnInit, OnChanges, OnDestroy {
  /** 'energy': the Energy screen, with a choice of machines. 'machine': one machine's page. */
  @Input() mode: 'energy' | 'machine' = 'energy';
  /** The machine to show; on the Energy screen, null shows the first machine with a meter. */
  @Input() machineId: number | null = null;

  readonly ranges = RANGES;
  readonly metrics = METRICS;
  readonly fmt = fmt;
  readonly fmtAuto = fmtAuto;
  readonly ids = (() => { const n = ++uidSeq; return { title: `mpTitle${n}`, machine: `mpMachine${n}`, power: `mpPower${n}`,
    volt: `mpVolt${n}`, amp: `mpAmp${n}`, pf: `mpPf${n}` }; })();

  range: RangeKey = '24h';
  metric: Metric = 'kw';
  data: any = null;
  state: 'loading' | 'ready' | 'error' = 'loading';

  private selected: number | null = null;
  private query$ = new BehaviorSubject<{ id: number | null; range: RangeKey }>({ id: null, range: this.range });
  private sub?: Subscription;
  private chartCache: any = null;

  constructor(private api: MeterService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.selected = this.machineId;
    this.query$.next({ id: this.selected, range: this.range });
    // a new machine or range loads at once; the same one refreshes every 30 s
    this.sub = this.query$.pipe(
      switchMap(q => interval(POLL_MS).pipe(startWith(0), map(() => q))),
      switchMap(q => {
        if (this.mode === 'machine' && !q.id) return of({ ok: false, data: null });
        const call = this.mode === 'machine' ? this.api.forMachine(q.id!, q.range) : this.api.forEnergy(q.id, q.range);
        return call.pipe(
          map((res: any) => ({ ok: res?.status === 'success', data: res?.data })),
          catchError(() => of({ ok: false, data: null })));
      }))
      .subscribe(({ ok, data }) => {
        if (ok && data) { this.data = data; this.state = 'ready'; }
        else this.state = 'error';
        this.chartCache = null;
        this.cdr.markForCheck();
      });
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['machineId'] && !ch['machineId'].firstChange) {
      this.selected = this.machineId;
      this.state = 'loading';
      this.query$.next({ id: this.selected, range: this.range });
    }
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  /** On the machine page, nothing at all for a machine without a meter. */
  get visible(): boolean {
    if (this.mode === 'energy') return true;
    return !!this.data && (!!this.data.latest || !!this.data.summary?.readings);
  }

  get meters(): any[] { return this.data?.meters ?? []; }
  get latest(): any { return this.data?.latest ?? null; }
  get limits(): MeterLimits { return this.data?.limits; }

  setMachine(id: number): void {
    if (id === this.data?.machine?.id) return;
    this.selected = id;
    this.state = 'loading';
    this.query$.next({ id, range: this.range });
  }

  setRange(r: RangeKey): void {
    if (r === this.range) return;
    this.range = r;
    this.state = 'loading';
    this.query$.next({ id: this.selected ?? this.data?.machine?.id ?? null, range: r });
  }

  setMetric(m: Metric): void { this.metric = m; this.chartCache = null; }

  reload(): void { this.state = 'loading'; this.query$.next({ id: this.selected, range: this.range }); }

  get asOf(): string {
    const l = this.latest;
    if (!l) return this.state === 'loading' ? 'Waiting for the first reading…' : 'No reading in the last 30 days';
    return l.stale ? `No reading since ${dayClock.format(l.at)}` : `As of ${clock.format(l.at)}`;
  }

  get vBand(): Band { return this.limits ? voltageBand(this.latest?.v_ll_avg, this.limits) : null; }
  get pfBandNow(): Band { return this.limits ? pfBand(this.latest?.pf_avg, this.limits) : null; }
  get hzBandNow(): Band { return this.limits ? hzBand(this.latest?.frequency_hz, this.limits) : null; }

  get vImbalance(): number | null {
    const l = this.latest;
    return l ? imbalancePct([l.v12, l.v23, l.v31]) : null;
  }

  /** Under 1 A a machine is all but idle, and the phases' differences say nothing. */
  get iImbalanceText(): string {
    const l = this.latest;
    if (!l || l.i_avg === null) return '--';
    if (l.i_avg < 1) return 'too little load to judge';
    const p = imbalancePct([l.i1, l.i2, l.i3]);
    return p === null ? '--' : `${fmt(p, 1)} %`;
  }

  get iImbalanceHigh(): boolean {
    const l = this.latest;
    if (!l || l.i_avg === null || l.i_avg < 1 || !this.limits) return false;
    const p = imbalancePct([l.i1, l.i2, l.i3]);
    return p !== null && p > this.limits.i_imbalance_pct;
  }

  get vMaxRecorded(): number | null {
    const l = this.latest;
    if (!l) return null;
    const vs = [l.v12_max, l.v23_max, l.v31_max].filter((v: any) => v !== null && v !== undefined);
    return vs.length ? Math.max(...vs) : null;
  }

  get rangeLong(): string { return RANGES.find(r => r.key === this.range)!.long; }

  /** The figures under the chart, for the quantity shown. */
  get stats(): { label: string; value: string; unit: string }[] {
    const s = this.data?.summary;
    if (!s) return [];
    switch (this.metric) {
      case 'kw': return [
        { label: 'Average', value: fmtAuto(s.kw.avg), unit: 'kW' },
        { label: 'Lowest', value: fmtAuto(s.kw.min), unit: 'kW' },
        { label: 'Highest', value: fmtAuto(s.kw.max), unit: 'kW' },
        { label: 'Peak load (size)', value: fmtAuto(s.kw.peak), unit: 'kW' },
        { label: 'Highest apparent', value: fmtAuto(s.kva.max), unit: 'kVA' }];
      case 'i': return [
        { label: 'Average', value: fmtAuto(s.i.avg), unit: 'A' },
        { label: 'Highest on a phase', value: fmtAuto(s.i.max), unit: 'A' }];
      case 'v': return [
        { label: 'Lowest', value: fmt(s.v_ll.min, 1), unit: 'V' },
        { label: 'Average', value: fmt(s.v_ll.avg, 1), unit: 'V' },
        { label: 'Highest', value: fmt(s.v_ll.max, 1), unit: 'V' },
        { label: 'Phase to neutral, average', value: fmt(s.v_ln.avg, 1), unit: 'V' }];
      case 'pf': return [
        { label: 'Average', value: fmt(s.pf.avg, 2), unit: '' },
        { label: 'Lowest', value: fmt(s.pf.min, 2), unit: '' },
        { label: 'Frequency', value: `${fmt(s.hz.min, 2)} – ${fmt(s.hz.max, 2)}`, unit: 'Hz' }];
      case 'kwh': return [
        { label: 'Energy used', value: fmt(s.kwh_used, 2), unit: 'kWh' },
        { label: 'Import', value: fmt(s.kwh_import, 2), unit: 'kWh' },
        { label: 'Export', value: fmt(s.kwh_export, 2), unit: 'kWh' },
        { label: 'Reactive', value: fmt(s.kvarh, 2), unit: 'kVArh' },
        { label: 'Apparent', value: fmt(s.kvah, 2), unit: 'kVAh' }];
    }
  }

  get basis(): string {
    const s = this.data?.summary;
    if (!s?.readings) return '';
    const span = s.first_at && s.last_at ? `, ${dayClock.format(s.first_at)} – ${dayClock.format(s.last_at)}` : '';
    const b = this.data.range.bucket_seconds;
    const each = b < 3600 ? `${b / 60}-minute` : `${b / 3600}-hour`;
    return `From ${nf[0].format(s.readings)} meter readings${span}. Each point on the chart is one ${each} interval.`;
  }

  get chartLabel(): string {
    const m = METRICS.find(x => x.key === this.metric)!;
    const what = m.key === 'kwh' ? 'energy used in each interval' : 'average, and the extremes, in each interval';
    return `${m.label} over ${this.rangeLong}: ${what}${m.unit ? `, in ${m.unit}` : ''}.`;
  }

  /* ── the chart ── */

  get chart(): any {
    if (this.chartCache) return this.chartCache;
    const d = this.data;
    const dark = document.documentElement.classList.contains('dark');
    const ink = dark ? '#c7cbd6' : '#4b5262';
    const m = METRICS.find(x => x.key === this.metric)!;

    // every interval of the range, so a gap in readings shows as a gap
    const step = d.range.bucket_seconds * 1000;
    const byT = new Map<number, any>(d.points.map((p: any) => [p.t, p]));
    const times: number[] = [];
    for (let t = Math.floor(d.range.from / step) * step; t <= d.range.to; t += step) times.push(t);
    const line = (key: string) => times.map(t => [t, byT.get(t)?.[key] ?? null] as [number, number | null]);

    let series: any[];
    let colors: string[];
    let dash: number[];
    let widths: number[];
    const lines: any[] = [];
    switch (this.metric) {
      case 'kw':
        series = [{ name: 'Average', data: line('kw_avg') }, { name: 'Highest', data: line('kw_max') }, { name: 'Lowest', data: line('kw_min') }];
        colors = ['#2b3990', '#9b7ec8', '#17b3a3']; dash = [0, 4, 2]; widths = [2.5, 1.5, 1.5];
        break;
      case 'i':
        series = [{ name: 'Average', data: line('i_avg') }, { name: 'Highest phase', data: line('i_max') }];
        colors = ['#2b3990', '#9b7ec8']; dash = [0, 4]; widths = [2.5, 1.5];
        break;
      case 'v':
        series = [{ name: 'Average', data: line('v_ll_avg') }, { name: 'Highest', data: line('v_ll_max') }, { name: 'Lowest', data: line('v_ll_min') }];
        colors = ['#2b3990', '#9b7ec8', '#17b3a3']; dash = [0, 4, 2]; widths = [2.5, 1.5, 1.5];
        lines.push({ y: d.limits.v_ll_nominal, borderColor: '#64748b', strokeDashArray: 4,
                     label: { text: `${d.limits.v_ll_nominal} V`, borderWidth: 0, style: { background: '#64748b', color: '#fff', fontSize: '11px' } } });
        break;
      case 'pf':
        series = [{ name: 'Average', data: line('pf_avg') }, { name: 'Lowest', data: line('pf_min') }];
        colors = ['#2b3990', '#9b7ec8']; dash = [0, 4]; widths = [2.5, 1.5];
        break;
      default:
        series = [{ name: 'Energy used', data: line('kwh') }];
        colors = ['#2b3990']; dash = [0]; widths = [0];
    }

    const values = series.flatMap(s => s.data.map((p: [number, number | null]) => p[1])).filter((v: any) => v !== null) as number[];
    let lo = Math.min(0, ...values, ...lines.map(l => l.y));
    let hi = Math.max(0, ...values, ...lines.map(l => l.y));
    let axis: { min: number; max: number; ticks: number };
    if (this.metric === 'v') {
      // voltage sits near 415: show the few volts around it in 5 V (or 10 V) steps, not 0–450
      const vStep = Math.max(...values, d.limits.v_ll_nominal) - Math.min(...values, d.limits.v_ll_nominal) > 20 ? 10 : 5;
      const vMin = Math.floor((Math.min(...values, d.limits.v_ll_nominal) - 3) / vStep) * vStep;
      const vMax = Math.ceil((Math.max(...values, d.limits.v_ll_nominal) + 3) / vStep) * vStep;
      axis = { min: vMin, max: vMax, ticks: Math.round((vMax - vMin) / vStep) };
    } else if (this.metric === 'pf') {
      lo = lo < 0 ? -1 : 0; hi = hi > 0 ? 1 : 0;
      axis = { min: lo, max: hi, ticks: lo < 0 && hi > 0 ? 8 : 4 };
    } else {
      axis = niceBounds(lo, hi);
    }
    const digits = this.metric === 'v' ? 0 : axis.max - axis.min >= 10 ? 0 : axis.max - axis.min >= 1 ? 1 : 2;

    this.chartCache = {
      series,
      chart: { type: this.metric === 'kwh' ? 'bar' : 'line', height: 240, toolbar: { show: false }, zoom: { enabled: false },
               animations: { enabled: false }, fontFamily: 'inherit', foreColor: ink },
      plotOptions: { bar: { columnWidth: '70%', borderRadius: 2 } },
      colors,
      stroke: { width: widths, curve: 'straight', dashArray: dash },
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      legend: { show: series.length > 1, position: 'top', horizontalAlign: 'right', fontSize: '12px', markers: { size: 5 } },
      grid: { borderColor: dark ? 'rgba(148,163,184,.18)' : 'rgba(148,163,184,.3)', padding: { right: 12 } },
      xaxis: { type: 'datetime', min: d.range.from, max: d.range.to,
               labels: { datetimeUTC: false, hideOverlappingLabels: true,
                         datetimeFormatter: { day: 'd MMM', hour: 'h TT', minute: 'h:mm TT' } },
               tooltip: { enabled: false } },
      yaxis: { min: axis.min, max: axis.max, tickAmount: axis.ticks,
               title: { text: m.unit || m.label, style: { fontSize: '11px', fontWeight: 600 } },
               // a top tick at -0.0 reads as a reading; it is zero
               labels: { formatter: (v: number) => (v === null || v === undefined ? '' : fmt(Math.abs(v) < 1e-9 ? 0 : v, digits)) } },
      annotations: { yaxis: lines },
      // bars default to intersect: true, which ApexCharts refuses alongside shared
      tooltip: { shared: true, intersect: false, x: { format: 'd MMM, h:mm TT' },
                 y: { formatter: (v: number | null) => (v === null || v === undefined ? 'no reading' : `${fmtAuto(v)}${m.unit ? ' ' + m.unit : ''}`) } }
    };
    return this.chartCache;
  }
}
