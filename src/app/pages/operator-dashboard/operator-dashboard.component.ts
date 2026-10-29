import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { OperatorDashboardService } from './operator-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { barFigures, columnFigures } from '../../shared/bar-figures';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { UiTabsDirective } from '../../shared/ui-tabs.directive';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { DashPart, DashTab, DashViewHooks, DashViews, viewInUrl, TileDrill } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';
import { SearchSelectDirective } from '../../shared/search-select.directive';

/** Charts | Operator Performance Details, under the tiles both share. */
const VIEWS: DashTab[] = [
  { key: 'charts',  label: 'Charts',                       icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Operator Performance Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 7 — Operator Performance

   No production table carries an operator; the link is the machine
   assignment, and it is not exclusive — several operators can be
   assigned to one machine at once. So a row here means "the machines
   this operator is responsible for", and the screen says so rather
   than implying a person personally made every part.

   Each ranking switches between Top 5 and Bottom 5, ranked by the server
   over every operator — not over the page the table shows. Operator Score,
   Rejection Rate and Downtime Contribution share one card, a tab each
   (6 Oct 2026); OEE keeps its own. All of it arrives in the one answer the
   page loads, so a tab or Top 5 / Bottom 5 asks the server for nothing and
   redraws only the chart it changes.
───────────────────────────────────────────────────────────── */

type Which = 'top' | 'bottom';
type Board = 'score' | 'rejection' | 'downtime' | 'oee';
/** The tabs of the merged card. */
type Tab = Exclude<Board, 'oee'>;

@Component({
  selector: 'app-operator-dashboard',
  standalone: true,
  imports: [DashViewTabsComponent, MexaPagerComponent, MetricHelpComponent, UiTabsDirective, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, SearchSelectDirective],
  templateUrl: './operator-dashboard.component.html'
})
export class OperatorDashboardComponent implements OnInit, OnDestroy, DashViewHooks {

  /* ── Charts | Operator Performance Details ──
     The page's tabs (not to be confused with `tab` below: the ranking
     card's own). Each part of the page is asked for only while it is on
     screen and out of date (shared/dash-view). */
  private url = viewInUrl(VIEWS);
  readonly views = new DashViews(this, VIEWS, this.url.initial);

  /** Chart options keep their reference until their own figures change (deps). */
  private charts = new ChartMemo();

  machines: any[] = [];
  shifts: any[] = [];
  operatorList: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  limit = 10;
  readonly pageSizes = [6, 10, 20, 50];
  sort = 'score';
  dir: 'asc' | 'desc' = 'desc';

  /** The page's data, each part merged in as it arrives. */
  data: any = null;
  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.views.loading; }
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  /** Which half each ranking shows. */
  which: Record<Board, Which> = { score: 'top', rejection: 'top', downtime: 'top', oee: 'top' };

  /** The merged card's tabs, and the one on show. `short` is what a phone
   *  shows; the tab is always named in full. */
  readonly tabs: { key: Tab; label: string; short: string; topic: string; empty: string }[] = [
    { key: 'score', label: 'Operator Score', short: 'Score', topic: 'operator_score',
      empty: 'No operator has a score for this period.' },
    { key: 'rejection', label: 'Rejection Rate', short: 'Rejection', topic: 'rejection_rate',
      empty: 'Nothing produced, so there is no rejection rate.' },
    { key: 'downtime', label: 'Downtime Contribution', short: 'Downtime', topic: 'downtime_contribution',
      empty: 'No machine time was reported for these operators.' }
  ];
  tab: Tab = 'score';
  get tabInfo() { return this.tabs.find(t => t.key === this.tab)!; }

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  /** The table's columns, in the mock's order. `key` is what the server sorts by. */
  readonly columns = [
    { key: 'operator_code',      label: 'ID' },
    { key: 'operator_name',      label: 'Name' },
    { key: 'shift_name',         label: 'Shift' },
    { key: 'machine_names',      label: 'Machines', cls: 'wrap' },
    { key: 'score',              label: 'Performance', cls: 'qty' },
    { key: 'run_seconds',        label: 'Run time', cls: 'qty' },
    { key: 'downtime_seconds',   label: 'Downtime', cls: 'qty' },
    { key: 'utilization_pct',    label: 'Utilization (%)', cls: 'qty' },
    { key: 'produced',           label: 'Produced', cls: 'qty' },
    { key: 'good',               label: 'Good', cls: 'qty' },
    { key: 'rejected',           label: 'Rejected', cls: 'qty' },
    { key: 'quality_rate_pct',   label: 'Quality (%)', cls: 'qty' },
    { key: 'alarm_count',        label: 'Alarms', cls: 'qty' },
    { key: 'oee_pct',            label: 'OEE (%)', cls: 'qty' },
    { key: 'efficiency_pct',     label: 'Efficiency', cls: 'qty' }
  ];

  constructor(
    private svc: OperatorDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('analytics-operators', 'export'); }

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

  ngOnDestroy(): void { this.views.cancel(); this.destroy$.next(); this.destroy$.complete(); }

  /** Open a page tab; nothing is asked for that is already up to date. */
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
    return { from: weekAgo, to: today, machine_id: null, shift_id: null, operator_id: null, search: '' };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void {
    this.f = this.blankFilters();
    this.page = 1; this.sort = 'score'; this.dir = 'desc';
    this.drill.clear();
    this.load();
  }

  /* ── KPI tile → the operators behind its number (shared/dash-view TileDrill) ── */
  readonly drill = new TileDrill<'excellent' | 'good' | 'average' | 'needs_help'>('opDetails', 'opDetailsTitle');
  readonly drillLabels: Record<string, string> = {
    excellent:  'excellent performers',
    good:       'good performers',
    average:    'average performers',
    needs_help: 'operators who need help'
  };

  /** A tile: Operator Performance Details, narrowed to that band. */
  openTile(kind: '' | 'excellent' | 'good' | 'average' | 'needs_help'): void {
    this.drill.pick(kind);
    this.page = 1;
    if (this.views.tab !== 'details') this.setView('details');
    else this.load();
    if (!this.views.loading) this.drill.revealIfAsked();
  }

  clearTile(): void { this.drill.clear(); this.page = 1; this.load(); }

  goTo(page: number): void {
    if (page < 1 || page > (this.data?.operators?.totalPages || 1) || page === this.page) return;
    this.page = page;
    this.load();
  }

  setPageSize(size: number): void { this.limit = Number(size) || 10; this.page = 1; this.load(); }

  /** Click a header: sort by it; click it again to flip the direction. */
  sortBy(key: string): void {
    if (this.sort === key) this.dir = this.dir === 'desc' ? 'asc' : 'desc';
    else { this.sort = key; this.dir = ['operator_code', 'operator_name', 'shift_name', 'machine_names'].includes(key) ? 'asc' : 'desc'; }
    this.page = 1;
    this.load();
  }

  ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    return this.sort !== key ? 'none' : this.dir === 'asc' ? 'ascending' : 'descending';
  }

  isShowing(board: string, which: Which): boolean { return this.which[board as Board] === which; }

  /** Top 5 / Bottom 5: the rows are already here — no request, and only this chart is redrawn. */
  show(board: Board, which: Which): void {
    if (this.which[board] === which) return;
    this.which = { ...this.which, [board]: which };
    this.cdr.markForCheck();
  }

  /** A tab of the merged card: the same, for the measure it ranks by. */
  setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.cdr.markForCheck();
  }

  /** Bring what is on screen up to date with the filters; the other tab follows when it is opened. */
  load(): void {
    this.errorMsg = '';
    this.views.load();
    this.cdr.markForCheck();
  }

  /* What each part depends on: the tiles and rankings on the filters (the
     operator search narrows them too); the list on those and its order and page. */
  partKeys(): Record<DashPart, string> {
    const shared = JSON.stringify(this.f);
    return { kpis: shared, charts: shared, table: JSON.stringify([shared, this.drill.kind, this.sort, this.dir, this.page, this.limit]) };
  }

  fetchParts(parts: DashPart[]) {
    const table = parts.includes('table') ? { show: this.drill.kind || null, sort: this.sort, dir: this.dir, page: this.page, limit: this.limit } : {};
    return this.svc.getOperators({ ...this.f, ...table, part: parts.join(',') }).pipe(takeUntil(this.destroy$));
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components: each part is filled in where the
     payload is short before it reaches the template. */
  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load operator performance.' : 'No operator performance data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next: any = { ...(this.data ?? {}) };
    if (parts.includes('kpis')) {
      next.attribution  = { operators: 0, shared_machines: 0, note: '', ...(d.attribution ?? {}) };
      next.oee_coverage = { machines: 0, with_cycle_time: 0, ...(d.oee_coverage ?? {}) };
      next.score_bands  = { excellent: 75, good: 60, average: 45, ...(d.score_bands ?? {}) };
      next.bands        = { excellent: 0, good: 0, average: 0, needs_help: 0, unrated: 0, ...(d.bands ?? {}) };
      next.kpis         = d.kpis ?? {};
      // the operator list for the filter comes with the tiles
      this.operatorList = d.operator_list ?? this.operatorList;
    }
    if (parts.includes('charts')) {
      const empty = { top: [], bottom: [] };
      const lb = d.leaders ?? {};
      next.leaders = {
        score: { ...empty, ...(lb.score ?? {}) }, rejection: { ...empty, ...(lb.rejection ?? {}) },
        downtime: { ...empty, ...(lb.downtime ?? {}) }, oee: { ...empty, ...(lb.oee ?? {}) }
      };
    }
    if (parts.includes('table')) next.operators = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.operators ?? {}) };
    this.data = next;
    if (parts.includes('table')) this.drill.revealIfAsked();
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  export(format: 'xlsx' | 'csv'): void {
    this.exporting = format;
    this.cdr.markForCheck();
    this.svc.exportAs(format, { ...this.f, show: this.drill.kind || null, sort: this.sort, dir: this.dir })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.exporting = '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `operator_performance_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No operators match these filters');
        }
      });
  }

  /* ── what each card shows ── */

  /** The five rows a card is showing: highest first for Top 5, lowest first for Bottom 5. */
  rows(board: Board): any[] {
    return this.data?.leaders?.[board]?.[this.which[board]] ?? [];
  }

  /** OEE needs a cycle time on the machine's current job; say how many running machines lack one. */
  get oeeGap(): number {
    const c = this.data?.oee_coverage;
    return c ? Math.max(0, c.machines - c.with_cycle_time) : 0;
  }

  /* ── charts ── */

  private readonly palette = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#06B6D4'];

  /** What a ranking's chart is drawn from: rebuilt — and the chart redrawn — only when this changes. */
  private drawn(board: Board): string {
    return `${board}|${this.which[board]}|${JSON.stringify(this.rows(board))}`;
  }

  /* One horizontal bar per operator. A fresh options object whenever the
     tab, the half or the figures change, so each chart is drawn new rather
     than patched (ApexCharts leaks a tooltip on every series patch). */
  private hbar(board: Tab): any {
    return this.charts.memo('board', () => {
      const rows = this.rows(board);
      const pct = (v: number) => `${this.fix(v)}%`;
      const fmt = board === 'downtime' ? (v: number) => this.dur(v * 3600) : pct;
      const axisTitle = board === 'score' ? 'Score (%)' : board === 'rejection' ? 'Rejection rate (%)' : 'Downtime (h)';
      /* As on the Energy chart (26 Oct 2026): each figure inside its bar when
         the bar can hold it, a short bar's on hover anywhere along its row
         (shared/bar-figures). A score runs to 100 %. */
      const values = rows.map((r: any) => board === 'downtime' ? r.value / 3600 : r.value);
      const fig = barFigures(values, fmt, { bar: { borderRadius: 3, barHeight: '62%', distributed: true }, axisMax: board === 'score' ? 100 : undefined });
      return {
        series: [{ name: axisTitle, data: values }],
        chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false }, events: fig.events },
        plotOptions: fig.plotOptions,
        colors: this.palette,
        dataLabels: fig.dataLabels,
        legend: { show: false },
        xaxis: { categories: rows.map((r: any) => r.operator_name), title: { text: axisTitle }, ...fig.xaxis,
                 labels: { formatter: (v: any) => {
                   const n = Math.round(Number(v));
                   return board === 'downtime' ? `${n}h` : `${n}`;
                 } } },
        yaxis: { labels: { maxWidth: 120 } },
        grid: { borderColor: 'rgba(148,163,184,.25)' },
        tooltip: { theme: 'light', ...fig.tooltip },
        noData: { text: 'Nothing measured for this period' }
      };
    }, this.drawn(board));
  }

  /** The chart of the tab on show — the only one of the three that exists. */
  get boardChart(): any { return this.hbar(this.tab); }

  /* OEE for each operator: Availability, Performance and Quality side by side.
     The chart stays (26 Oct 2026, the user: "the same chart — only better to
     look at"): the MEXA colours, a gap between the three, rounded tops, each
     value upright inside its column when the column can hold it, the
     operator's OEE under the name, and all three with the OEE on hover. */
  get oeeChart(): any {
    const dark = document.documentElement.classList.contains('dark');
    return this.charts.memo('oee', () => {
      const rows = this.rows('oee');
      const col = (f: string) => rows.map((r: any) => r[f] ?? null);
      const pct = (v: number | null | undefined) => (v === null || v === undefined ? '--' : `${this.fix(Number(v))}%`);
      return {
        series: [
          { name: 'Availability', data: col('availability_pct') },
          { name: 'Performance', data: col('efficiency_pct') },
          { name: 'Quality', data: col('quality_rate_pct') }
        ],
        chart: { type: 'bar', height: 290, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        plotOptions: { bar: { columnWidth: '66%', borderRadius: 5, borderRadiusApplication: 'end',
                              dataLabels: { orientation: 'vertical', position: 'center' } } },
        // a clear gap between the three columns of an operator
        stroke: { show: true, width: 3, colors: ['transparent'] },
        fill: { opacity: 1 },
        // the white figures keep their contrast on the dark card too
        colors: dark ? ['#13917e', '#5a58d6', '#9a4fb4'] : ['#0b7267', '#2b3a8f', '#6e3b71'],
        dataLabels: columnFigures(v => `${Math.round(v)}%`, undefined, { vertical: true }),
        legend: { position: 'bottom', markers: { shape: 'circle', size: 6 }, itemMargin: { horizontal: 12 } },
        xaxis: { categories: rows.map((r: any) => [r.operator_name, `OEE ${pct(r.oee_pct)}`]),
                 labels: { rotate: 0, trim: true }, axisTicks: { show: false } },
        yaxis: { min: 0, max: 100, tickAmount: 4, labels: { formatter: (v: number) => `${Math.round(v)}%` } },
        grid: { borderColor: 'rgba(148,163,184,.25)', strokeDashArray: 4 },
        tooltip: {
          theme: dark ? 'dark' : 'light', shared: true, intersect: false,
          y: { formatter: (v: number | null) => pct(v) },
          // the OEE itself, which the three multiply to
          x: { formatter: (_: any, o: any) => {
            const r = rows[o?.dataPointIndex];
            return r ? `${r.operator_name} — OEE ${pct(r.oee_pct)}` : '';
          } }
        },
        noData: { text: 'Nothing measured for this period' },
        // a phone: thinner gaps, wider columns, the first name slanted to fit (the OEE on hover)
        responsive: [{ breakpoint: 640, options: {
          chart: { height: 320 }, stroke: { width: 1 }, plotOptions: { bar: { columnWidth: '80%' } },
          xaxis: { categories: rows.map((r: any) => {
                     const first = String(r.operator_name || '').split(/\s+/)[0];
                     return first.length > 9 ? first.slice(0, 8) + '…' : first;
                   }),
                   labels: { rotate: -45, rotateAlways: true, trim: false, hideOverlappingLabels: false, maxHeight: 70 } }
        } }]
      };
    }, this.drawn('oee') + dark);
  }

  /* ── view helpers ── */

  private fix(v: number): string { return Number.isInteger(v) ? String(v) : Number(v).toFixed(1); }

  /** "6 h 20 m" — a duration read at a glance, on the chart's bars. */
  private dur(seconds: number): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60);
    return h ? `${h} h ${m} m` : `${m} m`;
  }

  /** Durations as the mock writes them: hh:mm:ss, hours running past 24. */
  hms(seconds: number | null | undefined): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Unmeasured shows as a dash, never as 0% — they are different claims. */
  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  readonly bandText: Record<string, string> = {
    EXCELLENT: 'Excellent', GOOD: 'Good', AVERAGE: 'Avg', NEEDS_HELP: 'Help', UNRATED: 'Unrated'
  };
  readonly bandClass: Record<string, string> = {
    EXCELLENT: 'mexa-badge-good', GOOD: 'mexa-badge-info', AVERAGE: 'mexa-badge-warn',
    NEEDS_HELP: 'mexa-badge-bad', UNRATED: 'mexa-badge-neutral'
  };

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }
}
