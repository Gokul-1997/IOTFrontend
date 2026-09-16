import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { DowntimeDashboardService } from './downtime-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 6 — Downtime Reason Loss Analysis

   Two sources, deliberately not blended:

     measured   run and idle time from telemetry — availability is this
     declared   reasons operators typed in — the Pareto is this

   The gap between them is shown rather than hidden. It is the number
   that says whether the downtime reporting is worth anything.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-downtime-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './downtime-dashboard.component.html'
})
export class DowntimeDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  machines: any[] = [];
  shifts: any[] = [];
  reasons: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  paretoSeries: any[] = [];
  paretoCategories: string[] = [];
  hourlySeries: any[] = [];
  hourlyCategories: string[] = [];
  shiftDonutSeries: number[] = [];
  statusSeries: number[] = [];
  statusRows: { label: string; seconds: number; colour: string }[] = [];
  statusTotal = 0;

  readonly CATEGORIES = ['PLANNED', 'UNPLANNED', 'QUALITY', 'CHANGEOVER'];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: DowntimeDashboardService,
    private toast: ToastService,
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

    this.svc.getReasons()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.reasons = res?.data ?? res ?? [];
        this.cdr.markForCheck();
      });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  blankFilters() {
    const today = this.todayStr();
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    return {
      from: weekAgo, to: today,
      machine_id: null, shift_id: null, operator_id: null,
      reason_id: null, category: '', search: ''
    };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.events?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getDowntime({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load downtime data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No downtime data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    /* A Pareto is bars plus the cumulative line — the line is the point,
       because it is what shows how few reasons cover most of the loss. */
    this.paretoCategories = (d.by_reason || []).map((r: any) => r.reason);
    /* Per-point fillColor rather than plotOptions.bar.distributed: this is
       a mixed bar+line chart, and distributed colours the line series too. */
    this.paretoSeries = [
      { name: 'Hours', type: 'column',
        data: (d.by_reason || []).map((r: any, i: number) => ({
          x: r.reason,
          y: +(r.seconds / 3600).toFixed(2),
          fillColor: this.donutColour(i)
        })) },
      { name: 'Cumulative %', type: 'line',
        data: (d.by_reason || []).map((r: any) => ({ x: r.reason, y: r.cumulative_pct })) }
    ];

    this.hourlyCategories = (d.hourly || []).map((h: any) => String(h.hour).padStart(2, '0'));
    this.hourlySeries = [{ name: 'Hours down', data: (d.hourly || []).map((h: any) => +(h.seconds / 3600).toFixed(2)) }];

    /* Donuts take a flat number array; the {name,data} series shape
       renders an empty chart with no error. */
    this.shiftDonutSeries = (d.by_shift || []).map((s: any) => Number(s.seconds) || 0);

    /* Run / idle / alarm is the machine's whole day, so it is built from
       the KPI seconds rather than the reason table — a machine can be
       idle without anyone having entered a reason for it. */
    this.statusRows = [
      { label: 'Running', seconds: Number(d.kpis.run_seconds)   || 0, colour: '#2f2d8f' },
      { label: 'Idle',    seconds: Number(d.kpis.idle_seconds)  || 0, colour: '#4a76c8' },
      { label: 'Alarm',   seconds: Number(d.kpis.alarm_seconds) || 0, colour: '#f5a623' }
    ].filter(r => r.seconds > 0);
    this.statusSeries = this.statusRows.map(r => r.seconds);
    this.statusTotal = this.statusSeries.reduce((a, b) => a + b, 0);

    this.cdr.markForCheck();
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. */
  private normalise(d: any): any {
    return {
      ...d,
      kpis: {
        total_downtime_seconds: 0, downtime_events: 0, open_events: 0,
        run_seconds: 0, idle_seconds: 0, alarm_seconds: 0,
        availability_pct: null, unaccounted_seconds: 0, reason_coverage_pct: null,
        ...(d?.kpis ?? {})
      },
      by_reason:   d?.by_reason   ?? [],
      top_reasons: d?.top_reasons ?? [],
      by_category: d?.by_category ?? [],
      by_shift:    d?.by_shift    ?? [],
      hourly:      d?.hourly      ?? [],
      events: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.events ?? {}) }
    };
  }

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();

    this.svc.exportAs(format, this.f)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.exporting = '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `downtime_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No downtime records match these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** True when telemetry exists but nobody has entered a single reason —
   *  a setup gap, not an empty filter result. */
  get hasNoReasons(): boolean {
    return !!this.data && this.data.kpis.downtime_events === 0 && this.data.kpis.idle_seconds > 0;
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    if (n < 60) return `${n}s`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  /** MEXA pill class per category. Kept alongside categoryClass so the
   *  older Tailwind call sites keep working. */
  categoryBadge(c: string): string {
    switch (String(c).toUpperCase()) {
      case 'PLANNED':    return 'mexa-badge-info';
      case 'UNPLANNED':  return 'mexa-badge-bad';
      case 'QUALITY':    return 'mexa-badge-warn';
      case 'CHANGEOVER': return 'mexa-badge-violet';
      default:           return 'mexa-badge-neutral';
    }
  }

  categoryClass(c: string): string {
    switch (String(c).toUpperCase()) {
      case 'PLANNED':    return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
      case 'UNPLANNED':  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'QUALITY':    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'CHANGEOVER': return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300';
      default:           return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get paretoChart(): any {
    return this.charts.memo('paretoChart', () => {
    return {
      chart:  { type: 'line', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: [0, 3], curve: 'straight' },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } },
      // the columns carry their own fillColor; this sets the line
      colors: ['#2f2d8f', '#1f2937'],
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis:  { categories: this.paretoCategories, labels: { rotate: -35, trim: true } },
      yaxis: [
        { title: { text: 'Hours' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
        { opposite: true, min: 0, max: 100, title: { text: 'Cumulative %' },
          labels: { formatter: (v: number) => v?.toFixed(0) } }
      ],
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', shared: true, intersect: false },
      noData: { text: 'No downtime reasons recorded for this period' }
    };
  });
  }

  get hourlyChart(): any {
    return this.charts.memo('hourlyChart', () => {
    return {
      chart:  { type: 'line', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {},
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4 },
      colors: ['#2f2d8f'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.hourlyCategories, title: { text: 'Time (Hour)' } },
      yaxis:  { title: { text: 'Hours down' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No downtime recorded for this period' }
    };
  });
  }

  /** The MEXA palette, in the order the design cycles it. */
  private readonly palette = ['#2f2d8f', '#9b7ec8', '#4a76c8', '#17b3a3', '#6b7280', '#f5811f'];

  donutColour(i: number): string { return this.palette[i % this.palette.length]; }

  /** Share of a total, guarding the empty-period divide-by-zero. */
  sharePct(value: number | null | undefined, total: number): string {
    const n = Number(value);
    if (!total || !Number.isFinite(n)) return '--';
    return `${Math.round((n / total) * 1000) / 10}%`;
  }

  get shiftDonut(): any {
    return this.charts.memo('shiftDonut', () => {
    return {
      chart: { type: 'donut', height: 240, fontFamily: 'inherit' },
      labels: (this.data?.by_shift || []).map((s: any) => s.shift_name),
      colors: this.palette,
      plotOptions: { pie: { donut: { size: '62%' } } },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%` },
      // the key list beside the donut already names every shift
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => this.hours(v) } },
      noData: { text: 'Nothing recorded by shift' }
    };
  });
  }

  get statusDonut(): any {
    return this.charts.memo('statusDonut', () => {
    return {
      chart: { type: 'donut', height: 240, fontFamily: 'inherit' },
      labels: this.statusRows.map(r => r.label),
      colors: this.statusRows.map(r => r.colour),
      plotOptions: { pie: { donut: { size: '62%' } } },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%` },
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => this.hours(v) } },
      noData: { text: 'No machine time recorded' }
    };
  });
  }
}
