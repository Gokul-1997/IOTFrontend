import { visibleRefresh } from '../../shared/visible-refresh';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of } from 'rxjs';
import { FactoryService } from './factory.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { compactQty, qty } from '../../shared/format-number';
import { BAR_HOVER, barFigures, columnFigures } from '../../shared/bar-figures';
import { SEVERITY } from '../../shared/severity';
import { AuthService } from '../../core/services/auth.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 1 — Factory Overall Dashboard

   One factory-wide aggregate over GET /dashboard/factory,
   filterable by Shift / Machine / Date. The API already does the
   rollup work; this component only shapes it for the charts and
   re-polls so the board stays current on a shop-floor screen.
───────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;

/*
 * Where each tile and card leads — the page with the records behind the
 * number, opened on the Factory's own day, shift and machine (the pages take
 * them with takeLinkedFilters). Only for the pages the person may open; for
 * the rest the tile stays a plain figure. Live is "now", so it takes the
 * status only; Energy and the Alarm Report have no shift filter.
 */
const TARGETS = {
  live:       { path: '/dashboard',         permission: 'page:dashboard',          name: 'Live Dashboard',    day: false, shift: false, machine: false },
  oee:        { path: '/oee-dashboard',     permission: 'page:analytics-oee',      name: 'OEE Dashboard',     day: true,  shift: true,  machine: true },
  downtime:   { path: '/downtime-analysis', permission: 'page:analytics-downtime', name: 'Downtime Analysis', day: true,  shift: true,  machine: true },
  energy:     { path: '/energy-dashboard',  permission: 'page:analytics-energy',   name: 'Energy Dashboard',  day: true,  shift: false, machine: true },
  alarms:     { path: '/alarm-report',      permission: 'page:analytics-alarms',   name: 'Alarm Report',      day: true,  shift: false, machine: true },
  production: { path: '/reports',           permission: 'page:reports',            name: 'Production report', day: true, shift: true,  machine: true }
} as const;
export type FactoryTarget = keyof typeof TARGETS;

@Component({
  selector: 'app-factory',
  standalone: true,
  imports: [MetricHelpComponent, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, RouterLink, NgApexchartsModule, SkeletonComponent],
  templateUrl: './factory.component.html',
  styles: [`
    /* a card's way to the page with its records */
    .fx-more { margin: .6rem 0 0; text-align: right; }
    .fx-more a, .fx-rank-link {
      display: inline-flex; align-items: center; gap: .1rem; font-size: .8rem; font-weight: 600;
      color: var(--mexa-submit); text-decoration: none; border-radius: 4px;
    }
    .fx-rank-link { font-size: inherit; font-weight: inherit; color: inherit; }
    .fx-more a:hover, .fx-rank-link:hover { text-decoration: underline; }
    .fx-more a:focus-visible, .fx-rank-link:focus-visible { outline: 2px solid var(--mexa-submit); outline-offset: 2px; }
    .fx-more mat-icon { width: 1rem; height: 1rem; font-size: 1rem; }
  `]
})
export class FactoryComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  /* ── filters ── */
  machines: any[] = [];
  shifts:   any[] = [];
  selectedMachine: number | null = null;
  selectedShift:   number | null = null;
  selectedDate = this.todayStr();
  today        = this.todayStr();

  /* ── state ── */
  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';

  /* ── charts ── */
  shiftSeries:     any[] = [];
  shiftCategories: any[] = [];
  trendSeries:     any[] = [];
  energySeries:    any[] = [];
  trendCategories: string[] = [];
  downtimeSeries:  number[] = [];
  downtimeLabels:  string[] = [];
  /* Charts the MEXA design adds: the OEE radial, the run/idle split and
     the alarm severity ring. */
  oeeRadialSeries:  number[] = [];
  runtimeSeries:    number[] = [];
  alarmSeries:      number[] = [];

  private destroy$ = new Subject<void>();
  /** A filter change: fetch now, and start the minute's polling again from here. */
  private refresh$ = new Subject<void>();

  constructor(
    private svc: FactoryService,
    private cdr: ChangeDetectorRef
  ) {}

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly targets = TARGETS;

  /** Share of target when any machine has a job target; the piece count otherwise. */
  get hasProductionTarget(): boolean {
    return this.data?.production?.target_pct !== null && this.data?.production?.target_pct !== undefined;
  }
  get productionValue(): string {
    return this.hasProductionTarget ? `${this.data.production.target_pct}%` : String(this.data?.production?.produced ?? '--');
  }

  /** May this person open the page a tile leads to? */
  can(target: FactoryTarget): boolean { return this.auth.hasPermission(TARGETS[target].permission); }

  /** The page's address parameters: this dashboard's day, shift and machine, as far as that page filters by them. */
  linkParams(target: FactoryTarget, extra: Record<string, string> = {}): Record<string, string | number> {
    const t = TARGETS[target];
    const params: Record<string, string | number> = { ...extra };
    if (target === 'production') params['tab'] = 'production';
    if (t.day && this.selectedDate) { params['from'] = this.selectedDate; params['to'] = this.selectedDate; }
    if (t.shift && this.selectedShift) params['shift_id'] = this.selectedShift;
    if (t.machine && this.selectedMachine) params['machine_id'] = this.selectedMachine;
    return params;
  }

  /** A tile's number: open its page. */
  open(target: FactoryTarget, extra: Record<string, string> = {}): void {
    void this.router.navigate([TARGETS[target].path], { queryParams: this.linkParams(target, extra) });
  }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];
        this.cdr.markForCheck();
      });

    /* Poll so a wall-mounted board stays live without a reload. A filter
       change fetches at once and restarts the clock; a request still on its
       way is dropped for the newer one (switchMap), so a slow answer for the
       old filters can never land on top of the new. */
    visibleRefresh(() => this.fetch$(), POLL_MS, this.refresh$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The filters changed (they apply themselves): fetch now with them. */
  submit(): void {
    this.refresh$.next();
  }

  private fetch$() {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    return this.svc.getFactory({
      date:       this.selectedDate,
      shift_id:   this.selectedShift,
      machine_id: this.selectedMachine
    }).pipe(
      catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load factory dashboard.';
        return of(null);
      })
    );
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No dashboard data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = res.data;
    this.data = d;
    this.updatedAt = updatedLabel(d.updated_at);

    /* shift-wise production, each shift labelled with its hours as the mock does */
    this.shiftCategories = (d.shiftwise || []).map((s: any) =>
      s.start_time ? [s.shift_code, `(${this.hhmm(s.start_time)} - ${this.hhmm(s.end_time)})`] as any : s.shift_code);
    this.shiftSeries = [{
      name: 'Produced',
      data: (d.shiftwise || []).map((s: any) => s.produced)
    }];

    /* Production Trend: actual against target, hour by hour (the mock's two
       lines). Energy has its own trend in the Energy Cost card. */
    const trend = d.trend || [];
    this.trendCategories = trend.map((t: any) =>
      new Date(t.hour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    );
    const hasTarget = trend.some((t: any) => t.target != null);
    this.trendSeries = trend.length ? [
      { name: 'Actual', data: trend.map((t: any) => t.produced) },
      ...(hasTarget ? [{ name: 'Target', data: trend.map((t: any) => t.target) }] : [])
    ] : [];
    this.energySeries = trend.some((t: any) => t.kwh > 0)
      ? [{ name: 'Energy (kWh)', data: trend.map((t: any) => t.kwh) }] : [];

    /* downtime split by reason */
    const reasons = d.downtime?.by_reason || [];
    this.downtimeLabels = reasons.map((r: any) => r.reason);
    this.downtimeSeries = reasons.map((r: any) => Math.round(r.seconds / 60));

    /* The three rings on the MEXA layout. Values are read straight from
       the payload rather than recomputed here, so a chart can never show
       a different number from the tile above it. */
    this.oeeRadialSeries = [
      this.pct(d.oee?.availability), this.pct(d.oee?.performance), this.pct(d.oee?.quality)
    ];

    const run = Number(d.time?.run_seconds || 0);
    const idle = Number(d.time?.idle_seconds || 0);
    this.runtimeSeries = (run + idle) > 0 ? [run, idle] : [];

    const a = d.alarms || {};
    this.alarmSeries = [
      Number(a.critical || 0), Number(a.non_critical || 0), Number(a.information || 0)
    ];

    this.cdr.markForCheck();
  }

  /* ── view helpers ── */

  /** A percentage the charts can plot, never NaN. */
  /** How far OEE sits from its target, or null when either is unmeasured. */
  get oeeVsTarget(): number | null {
    const oee = this.data?.oee?.oee;
    const target = this.data?.oee?.target;
    if (oee == null || target == null) return null;
    return Number((Number(oee) - Number(target)).toFixed(2));
  }

  absPct(v: number): string { return `${Math.abs(v)}%`; }

  /** A dash, not 0%, when a factor could not be measured (no cycle time, nothing made). */
  pctText(v: any): string { return v === null || v === undefined ? '--' : `${this.pct(v)}%`; }

  pct(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  /** Running share of manned time — the "Overall Utilization" tile. */
  get utilisation(): number | null {
    const run = Number(this.data?.time?.run_seconds || 0);
    const idle = Number(this.data?.time?.idle_seconds || 0);
    // null rather than 0 when nothing was recorded: "0% utilised" and
    // "nothing reported" are different claims.
    return (run + idle) > 0 ? Math.round((run / (run + idle)) * 100) : null;
  }

  /** Seconds → "8h 12m", the format the shop floor reads fastest. */
  hm(seconds: number | null | undefined): string {
    const s = Number(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** Cost is null (not 0) when no tariff is configured — say so plainly. */
  money(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'Tariff not set';
    const cur = this.data?.energy?.currency || 'INR';
    const sym = cur === 'INR' ? '₹' : '';
    return `${sym}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  oeeColor(v: number): string {
    const target = this.data?.oee?.target ?? 85;
    if (v >= target)       return 'text-emerald-600 dark:text-emerald-400';
    if (v >= target * 0.8) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  }

  private todayStr(): string {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    ).toISOString().split('T')[0];
  }

  /* ── chart option blocks (kept out of the template) ── */

  get shiftChart(): any {
    return this.charts.memo('shiftChart', () => {
    return {
      chart:  { type: 'bar', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 6, columnWidth: '45%', distributed: true } },
      // a column too short or narrow for its figure shows it on hover
      dataLabels: columnFigures(v => `${v}`),
      colors: ['#2F2D8F', '#9365B0'],
      xaxis:  { categories: this.shiftCategories },
      yaxis:  { title: { text: 'Qty' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light', ...BAR_HOVER }
    };
  });
  }

  /** Actual (solid) against target (dashed), units per hour. */
  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
    return {
      chart:  { height: 280, type: 'line', toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: [3, 2], curve: 'smooth', dashArray: [0, 6] },
      colors: ['#2B3990', '#ef4444'],
      dataLabels: { enabled: false },
      markers: { size: 0 },
      xaxis:  { categories: this.trendCategories, title: { text: 'Hour' }, labels: { rotate: -45 } },
      yaxis:  { min: 0, title: { text: 'Units' } },
      legend: { position: 'bottom' },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light', shared: true, intersect: false }
    };
  });
  }

  /** The small energy line inside the Energy Cost card. */
  get energyChart(): any {
    return this.charts.memo('energyChart', () => {
    return {
      chart:  { height: 230, 
      type: 'line', 
      toolbar: { show: false }, 
      fontFamily: 'inherit', 
      sparkline: { enabled: false } },
      stroke: { width: 2, curve: 'straight' },
      colors: ['#6E398F'],
      markers: { size: 4 },
      dataLabels: { enabled: false },
      // a small chart: every fourth hour, level, instead of 24 slanted labels on top of each other
      xaxis:  { categories: this.trendCategories, tickAmount: 6, title: { text: 'Hour', offsetY: -30 }, labels: { rotate: -60, rotateAlways: true, hideOverlappingLabels: true } },
      yaxis:  { min: 0, title: { text: 'Units' }, labels: { formatter: compactQty } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light', y: { formatter: (v: number) => `${qty(v, 2)} kWh` } }
    };
  });
  }

  readonly qty = qty;

  /** "08:00:00" → "08:00". */
  hhmm(t: string | null | undefined): string { return t ? String(t).slice(0, 5) : ''; }

  /** Share of target for the Actual vs Target bars, capped for drawing only. */
  targetBar(actual: number, target: number | null): number {
    return target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  }

  /** "↑ 5.2%" / "↓ 3.4%" from a signed change. */
  change(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return `${v > 0 ? '↑' : v < 0 ? '↓' : ''} ${Math.abs(v)}%`;
  }

  /**
   * Downtime by reason, as horizontal bars.
   *
   * The MEXA layout puts the reason names down the left and the minutes
   * along the bar, which reads faster than a donut when there are eight
   * reasons — a donut with eight slices is a legend, not a chart.
   */
  get downtimeChart(): any {
    return this.charts.memo('downtimeChart', () => {
    // inside the bar, as in the mock, so long reason names keep their room; a
    // bar too short for its figure shows it on hover (shared/bar-figures)
    const fig = barFigures(this.downtimeSeries, v => `${v}`, { borderRadius: 3, barHeight: '62%', distributed: true }, true);
    return {
      chart: { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: fig.plotOptions,
      colors: ['#9b7ec8', '#f5811f', '#3b9ae1', '#22c6d6', '#4a5a7a', '#8a63d2', '#f06a8a', '#17b3a3'],
      dataLabels: fig.dataLabels,
      // distributed gives each bar its own colour, which also duplicates
      // the category in the legend — the axis already names them
      legend: { show: false },
      xaxis: { categories: this.downtimeLabels, title: { text: 'Minutes' }, ...fig.xaxis },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { ...fig.tooltip, y: { formatter: (v: number) => `${v} min` } },
      noData: { text: 'No downtime reasons recorded' }
    };
  }, JSON.stringify([this.downtimeLabels, this.downtimeSeries]));
  }

  /* ── MEXA charts ────────────────────────────────────────── */

  /** The three OEE components as concentric arcs, OEE itself in the middle. */
  get oeeRadial(): any {
    return this.charts.memo('oeeRadial', () => {
    return {
      chart: { type: 'radialBar', height: 280, fontFamily: 'inherit' },
      plotOptions: {
        radialBar: {
          startAngle: -168, endAngle: 168,
          hollow: { size: '50%' },
          track: { background: '#eceaf5', strokeWidth: '100%' },
          dataLabels: {
            name: { fontSize: '1.1rem', offsetY: -6, color: '#1f2430' },
            value: { fontSize: '1.9rem', fontWeight: 700, offsetY: 4, color: '#1f2430',
                     formatter: (v: number) => `${Math.round(v)}%` },
            total: {
              show: true, label: 'OEE', fontSize: '1.1rem', color: '#1f2430',
              // the middle shows OEE from the payload, not an average of
              // the three arcs, so it matches the tile above
              formatter: () => `${this.pct(this.data?.oee?.oee)}%`
            }
          }
        }
      },
      colors: ['#1E2B7E', '#274994', '#6E398F'],
      labels: ['Availability', 'Performance', 'Quality'],
      stroke: { lineCap: 'round' },
      legend: { show: false },
      noData: { text: 'No OEE recorded for this period' },
      responsive: [
        {
          breakpoint: 1600,
          options: {
            chart: {
              height: 360
            }
          }
        }
      ]
    };
  });
  }

  get runtimeDonut(): any {
    return this.charts.memo('runtimeDonut', () => {
    return {
      chart: { type: 'donut', height: 280, fontFamily: 'inherit' },
      labels: ['Run Time', 'Idle Time'],
      colors: ['#16A34A', '#F59E0B'],
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%`,
                    style: { fontSize: '1rem', fontWeight: 700 } },
      plotOptions: { pie: { donut: { size: '58%' } } },
      legend: { position: 'bottom', fontSize: '.9rem', show:false },
      tooltip: { y: { formatter: (v: number) => this.hm(v) } },
      noData: { text: 'No run or idle time recorded' }
    };
  });
  }

  readonly SEV = SEVERITY;

  get alarmDonut(): any {
    return this.charts.memo('alarmDonut', () => {
    return {
      chart: { type: 'donut', height: 180, fontFamily: 'inherit' },
      labels: [SEVERITY.critical.label, SEVERITY.noncritical.label, SEVERITY.info.label],
      colors: [SEVERITY.critical.color, SEVERITY.noncritical.color, SEVERITY.info.color],
      dataLabels: { enabled: true, formatter: (_v: number, o: any) => o.w.config.series[o.seriesIndex] },
      plotOptions: {
        pie: { donut: { size: '62%', labels: {
          show: true,
          total: { show: true, label: 'Total Alarms', fontSize: '.95rem',
                   formatter: () => String(this.data?.alarms?.total ?? 0) }
        } } }
      },
      legend: { position: 'bottom', fontSize: '.9rem', show:false },
      noData: { text: 'No alarms recorded' }
    };
  });
  }
}
