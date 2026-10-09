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
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { ALARM_STATE, SEVERITY, severityOf } from '../../shared/severity';
import { DashPart, DashTab, DashViewHooks, DashViews, revealWhenShown, viewInUrl } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';

/** Charts | Alarms Details, under the cards both share. */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',         icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Alarms Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

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
  imports: [DashViewTabsComponent, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, MexaPagerComponent],
  templateUrl: './alarm-dashboard.component.html'
})
export class AlarmDashboardComponent implements OnInit, OnDestroy, DashViewHooks {

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
    { key: 'machine_serial_no', label: 'Machine' }, { key: 'shift_name', label: 'Shift' },
    { key: 'alarm_code', label: 'Alarm Code' }, { key: 'message', label: 'Alarm Name' },
    { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' },
    { key: 'duration_seconds', label: 'Duration (h:m:s)', cls: 'qty' }, { key: 'started_at', label: 'Started' },
    { key: 'ended_at', label: 'Closed' }
  ];

  /* ── Charts | Alarms Details ──
     The charts on one tab, the alarm list on the other, the cards above
     both; each part of the page is asked for only while it is on screen
     and out of date (shared/dash-view). */
  private url = viewInUrl(TABS);
  readonly views = new DashViews(this, TABS, this.url.initial);

  /* ── KPI card drill-down ──
     A card opens the alarms behind its number in Alarms Details, on its own
     tab. The server narrows the table only (?show=), never the cards or
     charts, so the other cards keep their figures while one is selected.
     Max Duration is not a subset: it sorts the table longest first. */
  drillKind: '' | 'critical' | 'normal' | 'open' | 'longest' = '';
  private scrollToTable = false;

  readonly drillLabels: Record<string, string> = {
    critical: 'critical alarms only',
    normal:   'non-critical alarms only',
    open:     'open alarms only — not yet closed',
    longest:  'every alarm, longest first'
  };

  drill(kind: 'all' | 'critical' | 'normal' | 'open' | 'longest'): void {
    const next = kind === 'all' || kind === this.drillKind ? '' : kind;   // same card again: back to all
    if (next === 'longest') { this.sort = 'duration_seconds'; this.dir = 'desc'; }
    else if (this.drillKind === 'longest') { this.sort = ''; this.dir = 'desc'; }
    this.drillKind = next;
    this.page = 1;
    this.scrollToTable = true;
    // the alarms are on the Alarms Details tab: the card opens it, narrowed
    if (this.views.tab !== 'details') this.setView('details');
    else this.load();
    // already loaded for this narrowing: say so at once
    if (!this.views.loading) this.revealTable();
  }

  /** What the server narrows the table to; "longest" is a sort, not a subset. */
  private get show(): string {
    return this.drillKind === 'longest' ? '' : this.drillKind;
  }

  /** Click a header to sort by it; again to flip the direction. */
  sortBy(key: string): void {
    if (this.sort === key) this.dir = this.dir === 'desc' ? 'asc' : 'desc';
    else { this.sort = key; this.dir = ['machine_serial_no', 'shift_name', 'alarm_code', 'message'].includes(key) ? 'asc' : 'desc'; }
    // a header sort replaces the Max Duration card's ordering
    if (this.drillKind === 'longest') this.drillKind = '';
    this.page = 1;
    this.load();
  }
  ariaSort(key: string): string { return this.sort !== key ? 'none' : this.dir === 'asc' ? 'ascending' : 'descending'; }
  goTo(p: number): void { this.page = p; this.load(); }
  setLimit(n: number): void { this.limit = n || 10; this.page = 1; this.load(); }

  /* ── state ── */
  /** The page's data, each part merged in as it arrives. */
  data: any = null;
  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.views.loading; }
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
      machine_id: null, shift_id: null,
      alarm_type: '', alarm_code: '', severity: '', search: ''
    };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }

  submit(): void { this.page = 1; this.load(); }

  reset(): void {
    this.f = this.blankFilters();
    this.page = 1; this.sort = ''; this.dir = 'desc'; this.drillKind = '';
    this.load();
  }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.alarms?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  /** Bring what is on screen up to date with the filters; the other tab follows when it is opened. */
  load(): void {
    this.errorMsg = '';
    this.views.load();
    this.cdr.markForCheck();
  }

  /* What each part depends on: the cards and charts on the filters (the
     search narrows them too); the list on those and its narrowing, order and page. */
  partKeys(): Record<DashPart, string> {
    const shared = JSON.stringify(this.f);
    return { kpis: shared, charts: shared, table: JSON.stringify([shared, this.show, this.sort, this.dir, this.page, this.limit]) };
  }

  fetchParts(parts: DashPart[]) {
    const table = parts.includes('table')
      ? { show: this.show, sort: this.sort || null, dir: this.dir, page: this.page, limit: this.limit } : {};
    return this.svc.getAlarms({ ...this.f, ...table, part: parts.join(',') }).pipe(takeUntil(this.destroy$));
  }

  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load alarm data.' : 'No alarm data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next = { ...(this.data ?? {}) };
    if (parts.includes('kpis')) {
      next.kpis = { total: 0, critical: 0, normal: 0, open: 0, max_duration_seconds: 0, avg_duration_seconds: 0, ...(d.kpis ?? {}) };
      next.facets = { types: [], codes: [], ...(d.facets ?? {}) };
    }
    if (parts.includes('charts')) Object.assign(next, this.normalise(d));
    if (parts.includes('table')) next.alarms = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.alarms ?? {}) };
    this.data = next;
    if (parts.includes('charts')) this.applyCharts(next);
    if (parts.includes('table') && this.scrollToTable) this.revealTable();
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  /** The charts' series, built once per answer rather than in getters. */
  private applyCharts(d: any): void {
    this.charts.bump();

    // one day selected: hour by hour, as the design's "Alarms Trend (By Hour)"
    this.trendCategories = (d.trend || []).map((t: any) => d.trend_by === 'hour'
      ? `${String(t.hour).padStart(2, '0')}:00`
      : new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [
      { name: SEVERITY.critical.label, data: (d.trend || []).map((t: any) => t.critical) },
      { name: SEVERITY.noncritical.label, data: (d.trend || []).map((t: any) => t.total - t.critical) }
    ];

    this.machineCategories = (d.by_machine || []).map((m: any) => m.machine_serial_no);
    this.machineSeries = [{ name: 'Alarms', data: (d.by_machine || []).map((m: any) => m.total) }];

    /* Donuts take a flat number array; the {name,data} series shape
       renders an empty chart with no error. */
    this.shiftDonutSeries = (d.by_shift || []).map((s: any) => Number(s.total) || 0);
    this.shiftTotal = this.shiftDonutSeries.reduce((a, b) => a + b, 0);
    this.severitySeries = [Number(d.by_severity.critical) || 0, Number(d.by_severity.normal) || 0];
  }

  /** After a card click: bring the table into view and move focus to its
   *  heading, so a keyboard or screen-reader user lands on the results too. */
  private revealTable(): void {
    this.scrollToTable = false;
    revealWhenShown('alDetails', 'alDetailsTitle');
  }

  /*
   * Fill in anything the charts' part is missing before it reaches the
   * template. A template expression that throws aborts the whole
   * change-detection pass, so a partial response would freeze unrelated
   * components on the page — it reads as a broken menu rather than a broken
   * dashboard. (The cards and the list are filled in by applyParts.)
   */
  private normalise(d: any): any {
    return {
      by_machine:  d?.by_machine  ?? [],
      by_shift:    d?.by_shift    ?? [],
      by_severity: { critical: 0, normal: 0, ...(d?.by_severity ?? {}) },
      trend:       d?.trend       ?? [],
      trend_by:    d?.trend_by    ?? 'day'
    };
  }

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();

    // the file is what the table shows: same card narrowing, same order
    this.svc.exportAs(format, { ...this.f, show: this.show, sort: this.sort || null, dir: this.dir })
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
    return this.data?.kpis?.total === 0 && (this.data?.facets?.types?.length ?? 0) === 0;
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

  /* severity and open/closed: a word, an icon and a colour (shared/severity.ts) */
  readonly SEV = SEVERITY;
  readonly STATE = ALARM_STATE;
  readonly sevOf = severityOf;

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
      chart:  { type: 'line', height: 180, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {},
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4 },
      colors: [SEVERITY.critical.color, SEVERITY.noncritical.color],
      dataLabels: { enabled: false },
      // two lines in two colours: the key says which is which
      legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '12px', markers: { size: 5 } },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'No. of Alarms' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
      noData: { text: 'No alarms in this period' }
    };
  });
  }

  get machineChart(): any {
    return this.charts.memo('machineChart', () => {
    return {
      chart:  { type: 'bar', height:200, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '55%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: false },
      // distributed repeats every machine in the legend; the axis names them
      legend: { show: false },
      xaxis:  { categories: this.machineCategories },
      yaxis:  { title: { text: 'No. of Alarms' }, 
      labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
      noData: { text: 'No alarms in this period' }
    };
  });
  }

  get shiftDonut(): any {
    return this.charts.memo('shiftDonut', () => {
    return {
      chart: { type: 'donut', height: 180, fontFamily: 'inherit' },
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
      chart: { type: 'donut', height: 180, fontFamily: 'inherit' },
      labels: [SEVERITY.critical.label, SEVERITY.noncritical.label],
      colors: [SEVERITY.critical.color, SEVERITY.noncritical.color],
      plotOptions: { pie: { donut: { size: '62%' } } },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%` },
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this period' }
    };
  });
  }
}
