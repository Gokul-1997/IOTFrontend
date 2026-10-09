import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { DowntimeDashboardService } from './downtime-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { EnumLabelPipe } from '../../shared/enum-label.pipe';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { lostCostLine, LOST_COST_HINT } from '../../shared/lost-cost';
import { DashPart, DashTab, DashViewHooks, DashViews, viewInUrl } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';

/** Charts | Downtime Details (the reason summary and the events), under the tiles both share. */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',           icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Downtime Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

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
  imports: [DashViewTabsComponent, MetricHelpComponent, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, RouterModule, NgApexchartsModule, SkeletonComponent, MexaPagerComponent, EnumLabelPipe],
  templateUrl: './downtime-dashboard.component.html'
})
export class DowntimeDashboardComponent implements OnInit, OnDestroy, DashViewHooks {

  /* ── Charts | Downtime Details ──
     The charts on one tab, the reason summary and the events on the other,
     the tiles above both; each part of the page is asked for only while it
     is on screen and out of date (shared/dash-view). */
  private url = viewInUrl(TABS);
  readonly views = new DashViews(this, TABS, this.url.initial);
  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  machines: any[] = [];
  shifts: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  limit = 20;

  /** The page's data, each part merged in as it arrives. */
  data: any = null;
  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.views.loading; }
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
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('analytics-downtime', 'export'); }

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
    this.views.cancel();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Open a tab; nothing is asked for that is already up to date. */
  setView(tab: string): void {
    if (tab === this.views.tab) return;
    this.errorMsg = '';
    this.views.show(tab);
    this.url.write(tab);
    this.cdr.markForCheck();
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

  /** From the shared pager: jump to a page, or change how many rows a page holds. */
  goTo(p: number): void { this.page = p; this.load(); }
  setLimit(n: number): void { this.limit = n || 10; this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.events?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  /** Bring what is on screen up to date with the filters; the other tab follows when it is opened. */
  load(): void {
    this.errorMsg = '';
    this.views.load();
    this.cdr.markForCheck();
  }

  /* What each part depends on: the tiles and charts on the filters (the
     search narrows them too); the tables on those and the page. */
  partKeys(): Record<DashPart, string> {
    const shared = JSON.stringify(this.f);
    return { kpis: shared, charts: shared, table: JSON.stringify([shared, this.page, this.limit]) };
  }

  fetchParts(parts: DashPart[]) {
    const paging = parts.includes('table') ? { page: this.page, limit: this.limit } : {};
    return this.svc.getDowntime({ ...this.f, ...paging, part: parts.join(',') }).pipe(takeUntil(this.destroy$));
  }

  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load downtime data.' : 'No downtime data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next = { ...(this.data ?? {}) };
    if (parts.includes('kpis')) next.kpis = {
      total_downtime_seconds: 0, downtime_events: 0, open_events: 0,
      run_seconds: 0, idle_seconds: 0, alarm_seconds: 0,
      availability_pct: null, unaccounted_seconds: 0, reason_coverage_pct: null,
      ...(d.kpis ?? {})
    };
    if (parts.includes('charts') || parts.includes('table')) next.by_reason = d.by_reason ?? [];
    if (parts.includes('charts')) Object.assign(next, this.normalise(d));
    if (parts.includes('table')) next.events = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.events ?? {}) };
    this.data = next;
    // the charts part always comes with the tiles it shares the status donut's seconds with, or after them
    if (parts.includes('charts')) this.applyCharts(next);
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  /** The charts' series, built once per answer rather than in getters. */
  private applyCharts(d: any): void {
    this.charts.bump();

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
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. (The tiles
     and the tables are filled in by applyParts.) */
  private normalise(d: any): any {
    return {
      top_reasons: d?.top_reasons ?? [],
      by_category: d?.by_category ?? [],
      by_shift:    d?.by_shift    ?? [],
      hourly:      d?.hourly      ?? []
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

  /* Idle and alarm time in rupees, at each machine's hour rate. Shown side by
     side, never added: a machine in alarm is usually idle too. */
  readonly costHint = LOST_COST_HINT;
  get idleCostLine(): string {
    const k = this.data?.kpis;
    return k ? lostCostLine(k.idle_cost, k.cost_machines?.priced, k.cost_machines?.of) : '';
  }
  get alarmCostLine(): string {
    const k = this.data?.kpis;
    return k ? lostCostLine(k.alarm_cost, k.cost_machines?.priced, k.cost_machines?.of) : '';
  }

  /** The Downtime page, where a stop's reason is entered — for whoever may open it. */
  get canRecordReasons(): boolean { return this.auth.hasPermission('page:downtime'); }

  /** True when telemetry exists but nobody has entered a single reason —
   *  a setup gap, not an empty filter result. */
  get hasNoReasons(): boolean {
    return this.data?.kpis?.downtime_events === 0 && this.data.kpis.idle_seconds > 0;
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
      tooltip:{ theme: 'light', shared: true, intersect: false },
      noData: { text: 'No downtime reasons recorded for this period' }
    };
  });
  }

  get hourlyChart(): any {
    return this.charts.memo('hourlyChart', () => {
    return {
      chart:  { type: 'line', height: 200, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {},
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4 },
      colors: ['#2f2d8f'],
      dataLabels: { enabled: false },
      // 24 hour labels ran together on a 1366px screen ('00010203…'): every third hour is enough
      xaxis:  { categories: this.hourlyCategories, tickAmount: 8, labels: { rotate: 0, hideOverlappingLabels: true }, title: { text: 'Time (Hour)' } },
      yaxis:  { title: { text: 'Hours down' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
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
