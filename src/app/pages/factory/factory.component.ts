import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, interval, startWith, switchMap, takeUntil, catchError, of } from 'rxjs';
import { FactoryService } from './factory.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 1 — Factory Overall Dashboard

   One factory-wide aggregate over GET /dashboard/factory,
   filterable by Shift / Machine / Date. The API already does the
   rollup work; this component only shapes it for the charts and
   re-polls so the board stays current on a shop-floor screen.
───────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;

@Component({
  selector: 'app-factory',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './factory.component.html'
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

  constructor(
    private svc: FactoryService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];
        this.cdr.markForCheck();
      });

    /* poll so a wall-mounted board stays live without a reload */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.fetch$()),
        takeUntil(this.destroy$)
      )
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Submit re-runs the query immediately with the current filters. */
  submit(): void {
    this.fetch$().pipe(takeUntil(this.destroy$)).subscribe(res => this.apply(res));
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
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

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
      chart:  { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 6, columnWidth: '45%' } },
      dataLabels: { enabled: true },
      colors: ['#2B3990'],
      xaxis:  { categories: this.shiftCategories },
      yaxis:  { title: { text: 'Qty' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' }
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
      tooltip:{ theme: 'dark', shared: true, intersect: false }
    };
  });
  }

  /** The small energy line inside the Energy Cost card. */
  get energyChart(): any {
    return this.charts.memo('energyChart', () => {
    return {
      chart:  { height: 170, type: 'line', toolbar: { show: false }, fontFamily: 'inherit', sparkline: { enabled: false } },
      stroke: { width: 2, curve: 'straight' },
      colors: ['#9b7ec8'],
      markers: { size: 4 },
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories, title: { text: 'Hour' }, labels: { rotate: -45, hideOverlappingLabels: true } },
      yaxis:  { min: 0, title: { text: 'Units' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', y: { formatter: (v: number) => `${v} kWh` } }
    };
  });
  }

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
    return {
      chart: { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '62%', distributed: true } },
      colors: ['#9b7ec8', '#f5811f', '#3b9ae1', '#22c6d6', '#4a5a7a', '#8a63d2', '#f06a8a', '#17b3a3'],
      dataLabels: {
        enabled: true,
        // inside the bar, as in the mock, so long reason names keep their room
        offsetX: 0, style: { fontSize: '.72rem', fontWeight: 700, colors: ['#fff'] }
      },
      // distributed gives each bar its own colour, which also duplicates
      // the category in the legend — the axis already names them
      legend: { show: false },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { y: { formatter: (v: number) => `${v} min` } },
      noData: { text: 'No downtime reasons recorded' }
    };
  });
  }

  /* ── MEXA charts ────────────────────────────────────────── */

  /** The three OEE components as concentric arcs, OEE itself in the middle. */
  get oeeRadial(): any {
    return this.charts.memo('oeeRadial', () => {
    return {
      chart: { type: 'radialBar', height: 300, fontFamily: 'inherit' },
      plotOptions: {
        radialBar: {
          startAngle: -168, endAngle: 168,
          hollow: { size: '42%' },
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
      colors: ['#9b7ec8', '#4a76c8', '#2b3a8f'],
      labels: ['Availability', 'Performance', 'Quality'],
      stroke: { lineCap: 'round' },
      legend: { show: false },
      noData: { text: 'No OEE recorded for this period' }
    };
  });
  }

  get runtimeDonut(): any {
    return this.charts.memo('runtimeDonut', () => {
    return {
      chart: { type: 'donut', height: 280, fontFamily: 'inherit' },
      labels: ['Run Time', 'Idle Time'],
      colors: ['#22c55e', '#f5a623'],
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%`,
                    style: { fontSize: '1rem', fontWeight: 700 } },
      plotOptions: { pie: { donut: { size: '58%' } } },
      legend: { position: 'bottom', fontSize: '.9rem' },
      tooltip: { y: { formatter: (v: number) => this.hm(v) } },
      noData: { text: 'No run or idle time recorded' }
    };
  });
  }

  get alarmDonut(): any {
    return this.charts.memo('alarmDonut', () => {
    return {
      chart: { type: 'donut', height: 280, fontFamily: 'inherit' },
      labels: ['Critical', 'Non critical', 'Information'],
      colors: ['#f43f5e', '#22c55e', '#f5a623'],
      dataLabels: { enabled: true, formatter: (_v: number, o: any) => o.w.config.series[o.seriesIndex] },
      plotOptions: {
        pie: { donut: { size: '62%', labels: {
          show: true,
          total: { show: true, label: 'Total Alarms', fontSize: '.95rem',
                   formatter: () => String(this.data?.alarms?.total ?? 0) }
        } } }
      },
      legend: { position: 'bottom', fontSize: '.9rem' },
      noData: { text: 'No alarms recorded' }
    };
  });
  }
}
