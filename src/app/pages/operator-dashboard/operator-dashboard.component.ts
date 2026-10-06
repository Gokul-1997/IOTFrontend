import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import { OperatorDashboardService } from './operator-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { UiTabsDirective } from '../../shared/ui-tabs.directive';

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
  imports: [MetricHelpComponent, UiTabsDirective, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './operator-dashboard.component.html'
})
export class OperatorDashboardComponent implements OnInit, OnDestroy {

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

  data: any = null;
  loading = false;
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
  /** The request on its way; a newer filter choice replaces it, so an older answer can never land last. */
  private loadSub?: Subscription;
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

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

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
    this.load();
  }

  goTo(page: number): void {
    if (page < 1 || page > (this.data?.operators?.totalPages || 1) || page === this.page) return;
    this.page = page;
    this.load();
  }
  changePage(delta: number): void { this.goTo(this.page + delta); }

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

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.loadSub?.unsubscribe();
    this.loadSub = this.svc.getOperators({ ...this.f, sort: this.sort, dir: this.dir, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load operator performance.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No operator performance data available.';
      this.cdr.markForCheck();
      return;
    }
    const d = this.data = this.normalise(res.data);
    this.operatorList = d.operator_list;
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. */
  private normalise(d: any): any {
    const empty = { top: [], bottom: [] };
    const lb = d?.leaders ?? {};
    return {
      ...d,
      attribution:  { operators: 0, shared_machines: 0, note: '', ...(d?.attribution ?? {}) },
      oee_coverage: { machines: 0, with_cycle_time: 0, ...(d?.oee_coverage ?? {}) },
      score_bands:  { excellent: 75, good: 60, average: 45, ...(d?.score_bands ?? {}) },
      bands:        { excellent: 0, good: 0, average: 0, needs_help: 0, unrated: 0, ...(d?.bands ?? {}) },
      leaders: {
        score: { ...empty, ...(lb.score ?? {}) }, rejection: { ...empty, ...(lb.rejection ?? {}) },
        downtime: { ...empty, ...(lb.downtime ?? {}) }, oee: { ...empty, ...(lb.oee ?? {}) }
      },
      operator_list: d?.operator_list ?? [],
      operators: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.operators ?? {}) }
    };
  }

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();
    this.svc.exportAs(format, { ...this.f, sort: this.sort, dir: this.dir })
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

  private readonly palette = ['#2f2d8f', '#4a76c8', '#9b7ec8', '#17b3a3', '#6b7280'];

  /** What a ranking's chart is drawn from: rebuilt — and the chart redrawn — only when this changes. */
  private drawn(board: Board): string {
    return `${board}|${this.which[board]}|${this.ink}|${JSON.stringify(this.rows(board))}`;
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
      /* Room past the longest bar for its label, and a scale that is never
         0–1 with repeated ticks when every value is 0 (no rejects entered).
         A multiple of 5, so the five ticks are whole numbers (0, 4, 8 … 20,
         not 0, 3, 7 … 17). A score runs to 100 %: the axis goes on to 120
         for the labels only. */
      const values = rows.map((r: any) => board === 'downtime' ? r.value / 3600 : r.value);
      const top = Math.max(0, ...values);
      const max = board === 'score' ? 120 : (top > 0 ? Math.ceil((top * 1.3) / 5) * 5 : 10);
      return {
        series: [{ name: axisTitle, data: values }],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '62%', distributed: true,
                              dataLabels: { position: 'top' } } },
        colors: this.palette,
        dataLabels: { enabled: true, offsetX: board === 'downtime' ? 40 : 34, formatter: (v: number) => fmt(v),
                      style: { fontSize: '.72rem', fontWeight: 700, colors: [this.ink] } },
        legend: { show: false },
        xaxis: { categories: rows.map((r: any) => r.operator_name), title: { text: axisTitle },
                 min: 0, max, tickAmount: board === 'score' ? 6 : 5,
                 labels: { formatter: (v: any) => {
                   const n = Math.round(Number(v));
                   if (board === 'score' && n > 100) return '';
                   return board === 'downtime' ? `${n}h` : `${n}`;
                 } } },
        yaxis: { labels: { maxWidth: 120 } },
        grid: { borderColor: 'rgba(148,163,184,.25)', padding: { right: 12 } },
        tooltip: { theme: 'light', y: { formatter: (v: number) => fmt(v) } },
        noData: { text: 'Nothing measured for this period' }
      };
    }, this.drawn(board));
  }

  /** The chart of the tab on show — the only one of the three that exists. */
  get boardChart(): any { return this.hbar(this.tab); }

  /** Availability, Performance and Quality for each operator, ranked by OEE. */
  get oeeChart(): any {
    return this.charts.memo('oee', () => {
      const rows = this.rows('oee');
      const col = (f: string) => rows.map((r: any) => r[f] ?? null);
      return {
        series: [
          { name: 'Availability', data: col('availability_pct') },
          { name: 'Performance', data: col('efficiency_pct') },
          { name: 'Quality', data: col('quality_rate_pct') }
        ],
        chart: { type: 'bar', height: 240, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        plotOptions: { bar: { borderRadius: 2, columnWidth: '62%' } },
        colors: ['#2f2d8f', '#4a76c8', '#9b7ec8'],
        dataLabels: { enabled: false },
        legend: { position: 'top', markers: { shape: 'circle' } },
        xaxis: { categories: rows.map((r: any) => r.operator_name), 
          labels: { rotate: -30, trim: true } },
        yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: (v: number) => `${Math.round(v)}%` } },
        grid: { borderColor: 'rgba(148,163,184,.25)' },
        tooltip: {
          theme: 'light', shared: true, intersect: false,
          y: { formatter: (v: number | null) => v == null ? '--' : `${v}%` },
          // the OEE itself, which the three bars multiply to
          x: { formatter: (_: any, o: any) => {
            const r = rows[o?.dataPointIndex];
            return r ? `${r.operator_name} — OEE ${r.oee_pct == null ? '--' : r.oee_pct + '%'}` : '';
          } }
        },
        noData: { text: 'Nothing measured for this period' }
      };
    }, this.drawn('oee'));
  }

  /* ── view helpers ── */

  /** Label colour for the theme in use — the labels sit outside the bars, on the card. */
  private get ink(): string {
    return document.documentElement.classList.contains('dark') ? '#e8ebf2' : '#1f2430';
  }

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

  /** Page buttons: all of them when few, else first, last and the neighbours of this one. */
  get pageList(): (number | '…')[] {
    const total = this.data?.operators?.totalPages || 1;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const cur = this.page;
    const set = new Set([1, total, cur - 1, cur, cur + 1].filter(n => n >= 1 && n <= total));
    const nums = [...set].sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push('…'); out.push(n); });
    return out;
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }
}
