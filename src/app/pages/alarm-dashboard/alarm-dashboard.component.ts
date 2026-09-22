import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AlarmDashboardService } from './alarm-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 5 — Alarm Dashboard & Reports

   Every figure is bounded by a date range, defaulting to the last 7
   days. machine_alarms grows with every fault on every machine, so an
   unbounded view is the one that works in testing and stops returning
   a year later.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-alarm-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, MexaPagerComponent],
  templateUrl: './alarm-dashboard.component.html'
})
export class AlarmDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  /* ── filters ── */
  machines: any[] = [];
  shifts: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  limit = 10;
  sort = '';
  dir: 'asc' | 'desc' = 'desc';

  /** Table columns, in the design's order; `key` is what the server sorts by. */
  readonly columns = [
    { key: 'machine_serial_no', label: 'Machine Name' }, { key: 'shift_name', label: 'Shift' },
    { key: 'alarm_code', label: 'Alarm Code' }, { key: 'message', label: 'Alarm Name' },
    { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' },
    { key: 'duration_seconds', label: 'Duration (HH:MM:SS)' }, { key: 'started_at', label: 'Generated Time' },
    { key: 'ended_at', label: 'Closed Time' }
  ];

  /** Click a header to sort by it; again to flip the direction. */
  sortBy(key: string): void {
    if (this.sort === key) this.dir = this.dir === 'desc' ? 'asc' : 'desc';
    else { this.sort = key; this.dir = ['machine_serial_no', 'shift_name', 'alarm_code', 'message'].includes(key) ? 'asc' : 'desc'; }
    this.page = 1;
    this.load();
  }
  ariaSort(key: string): string { return this.sort !== key ? 'none' : this.dir === 'asc' ? 'ascending' : 'descending'; }
  goTo(p: number): void { this.page = p; this.load(); }
  setLimit(n: number): void { this.limit = n || 10; this.page = 1; this.load(); }

  /* ── state ── */
  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  /* ── charts ── */
  trendSeries: any[] = [];
  trendCategories: string[] = [];
  machineSeries: any[] = [];
  machineCategories: string[] = [];
  shiftDonutSeries: number[] = [];
  /* The donut's own total. Not kpis.total: an alarm outside every shift
     window is counted there but not here, so using it as the key's
     denominator makes the key disagree with the slice it labels. */
  shiftTotal = 0;
  severitySeries: number[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: AlarmDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('analytics-alarms', 'export'); }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];
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
      machine_id: null, shift_id: null,
      alarm_type: '', alarm_code: '', severity: '', search: ''
    };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }

  submit(): void { this.page = 1; this.load(); }

  reset(): void {
    this.f = this.blankFilters();
    this.page = 1; this.sort = ''; this.dir = 'desc';
    this.load();
  }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.alarms?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getAlarms({ ...this.f, sort: this.sort || null, dir: this.dir, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load alarm data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No alarm data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    // one day selected: hour by hour, as the design's "Alarms Trend (By Hour)"
    this.trendCategories = (d.trend || []).map((t: any) => d.trend_by === 'hour'
      ? `${String(t.hour).padStart(2, '0')}:00`
      : new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [
      { name: 'Critical', data: (d.trend || []).map((t: any) => t.critical) },
      { name: 'Normal',   data: (d.trend || []).map((t: any) => t.total - t.critical) }
    ];

    this.machineCategories = (d.by_machine || []).map((m: any) => m.machine_serial_no);
    this.machineSeries = [{ name: 'Alarms', data: (d.by_machine || []).map((m: any) => m.total) }];

    /* Donuts take a flat number array; the {name,data} series shape
       renders an empty chart with no error. */
    this.shiftDonutSeries = (d.by_shift || []).map((s: any) => Number(s.total) || 0);
    this.shiftTotal = this.shiftDonutSeries.reduce((a, b) => a + b, 0);
    this.severitySeries = [Number(d.by_severity.critical) || 0, Number(d.by_severity.normal) || 0];

    this.cdr.markForCheck();
  }

  /*
   * Fill in anything the payload is missing before it reaches the template.
   * A template expression that throws aborts the whole change-detection
   * pass, so a partial response would freeze unrelated components on the
   * page — it reads as a broken menu rather than a broken dashboard.
   */
  private normalise(d: any): any {
    return {
      ...d,
      kpis: {
        total: 0, critical: 0, normal: 0, open: 0,
        max_duration_seconds: 0, avg_duration_seconds: 0, ...(d?.kpis ?? {})
      },
      by_machine:  d?.by_machine  ?? [],
      by_shift:    d?.by_shift    ?? [],
      by_severity: { critical: 0, normal: 0, ...(d?.by_severity ?? {}) },
      trend:       d?.trend       ?? [],
      facets:      { types: [], codes: [], ...(d?.facets ?? {}) },
      alarms: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.alarms ?? {}) }
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
          a.download = `alarms_${this.todayStr()}.${format}`;
          a.click();
          // revoke on the next tick — Safari has not started reading the
          // blob when click() returns
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No alarms match these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** True when nothing has ever been recorded, as opposed to a filter that
   *  happens to match nothing. The distinction matters: one is a setup
   *  problem, the other is a normal empty result. */
  get isUnconfigured(): boolean {
    return !!this.data && this.data.kpis.total === 0 && this.data.facets.types.length === 0;
  }

  /** HH:MM:SS, as the design writes a duration; hours run past 24. */
  hms(seconds: number | null | undefined): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
  }

  duration(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    if (n < 60) return `${n}s`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  isCritical(severity: string): boolean {
    return String(severity || '').toUpperCase() === 'CRITICAL';
  }

  /* Colour reinforces the text; it is never the only cue. */
  severityClass(s: string): string {
    return this.isCritical(s)
      ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  /** The MEXA palette, in the order the design cycles it. */
  private readonly palette = ['#2f2d8f', '#4a76c8', '#9b7ec8', '#17b3a3', '#6b7280', '#f5811f'];

  donutColour(i: number): string { return this.palette[i % this.palette.length]; }

  /** Share of a total, guarding the empty-period divide-by-zero. */
  sharePct(value: number | null | undefined, total: number): string {
    const n = Number(value);
    if (!total || !Number.isFinite(n)) return '--';
    return `${Math.round((n / total) * 1000) / 10}%`;
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
    return {
      chart:  { type: 'line', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {},
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4 },
      colors: ['#e03131', '#f59f00'],
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'No. of Alarms' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No alarms in this period' }
    };
  });
  }

  get machineChart(): any {
    return this.charts.memo('machineChart', () => {
    return {
      chart:  { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '55%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: false },
      // distributed repeats every machine in the legend; the axis names them
      legend: { show: false },
      xaxis:  { categories: this.machineCategories },
      yaxis:  { title: { text: 'No. of Alarms' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No alarms in this period' }
    };
  });
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
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this period' }
    };
  });
  }

  get severityDonut(): any {
    return this.charts.memo('severityDonut', () => {
    return {
      chart: { type: 'donut', height: 240, fontFamily: 'inherit' },
      labels: ['Critical', 'Normal'],
      colors: ['#e03131', '#17b3a3'],
      plotOptions: { pie: { donut: { size: '62%' } } },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%` },
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this period' }
    };
  });
  }
}
