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
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 7 — Operator Performance

   No production table carries an operator; the link is the machine
   assignment, and it is not exclusive — several operators can be
   assigned to one machine at once. So a row here means "the machines
   this operator is responsible for", and the screen says so rather
   than implying a person personally made every part.

   The four chart cards each switch between Top 5 and Bottom 5, ranked by
   the server over every operator — not over the page the table shows.
───────────────────────────────────────────────────────────── */

type Which = 'top' | 'bottom';
type Board = 'score' | 'rejection' | 'downtime' | 'oee';

@Component({
  selector: 'app-operator-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './operator-dashboard.component.html'
})
export class OperatorDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
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

  /** Which half each card shows. */
  which: Record<Board, Which> = { score: 'top', rejection: 'top', downtime: 'top', oee: 'top' };

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  /** The table's columns, in the mock's order. `key` is what the server sorts by. */
  readonly columns = [
    { key: 'operator_code',      label: 'ID' },
    { key: 'operator_name',      label: 'Name' },
    { key: 'shift_name',         label: 'Shift' },
    { key: 'machine_names',      label: 'Machine Name' },
    { key: 'score',              label: 'Performance' },
    { key: 'run_seconds',        label: 'Run Time' },
    { key: 'downtime_seconds',   label: 'Down Time' },
    { key: 'utilization_pct',    label: 'Utilization (%)' },
    { key: 'produced',           label: 'Prod Qty' },
    { key: 'good',               label: 'Good Qty' },
    { key: 'rejected',           label: 'Rej Qty' },
    { key: 'quality_rate_pct',   label: 'Qly Rate' },
    { key: 'alarm_count',        label: 'Alarms' },
    { key: 'oee_pct',            label: 'OEE (%)' },
    { key: 'efficiency_pct',     label: 'Efficiency' }
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

  show(board: Board, which: Which): void {
    if (this.which[board] === which) return;
    this.which = { ...this.which, [board]: which };
    this.charts.bump();
    this.cdr.markForCheck();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getOperators({ ...this.f, sort: this.sort, dir: this.dir, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load operator performance.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No operator performance data available.';
      this.cdr.markForCheck();
      return;
    }
    const d = this.data = this.normalise(res.data);
    this.operatorList = d.operator_list;
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';
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

  /** Every operator on the rejection card is at 0% — say so rather than draw five empty bars. */
  get noRejects(): boolean {
    const r = this.data?.leaders?.rejection;
    const all = [...(r?.top ?? []), ...(r?.bottom ?? [])];
    return all.length > 0 && all.every((x: any) => !x.value);
  }

  /** OEE needs a cycle time on the machine's current job; say how many running machines lack one. */
  get oeeGap(): number {
    const c = this.data?.oee_coverage;
    return c ? Math.max(0, c.machines - c.with_cycle_time) : 0;
  }

  /* ── charts ── */

  private readonly palette = ['#2f2d8f', '#4a76c8', '#9b7ec8', '#17b3a3', '#6b7280'];

  private hbar(key: string, board: Board, axisTitle: string, fmt: (v: number) => string, fixedMax?: number): any {
    return this.charts.memo(key, () => {
      const rows = this.rows(board);
      /* Room past the longest bar for its label, and a scale that is never
         0–1 with repeated ticks when every value is 0 (no rejects entered). */
      const values = rows.map((r: any) => board === 'downtime' ? r.value / 3600 : r.value);
      const top = Math.max(0, ...values);
      const max = fixedMax ?? (top > 0 ? Math.ceil(top * 1.3) : 10);
      return {
        series: [{ name: axisTitle, data: values }],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '62%', distributed: true,
                              dataLabels: { position: 'top' } } },
        colors: this.palette,
        dataLabels: { enabled: true, offsetX: 34, formatter: (v: number) => fmt(v),
                      style: { fontSize: '.72rem', fontWeight: 700, colors: [this.ink] } },
        legend: { show: false },
        xaxis: { categories: rows.map((r: any) => r.operator_name), title: { text: axisTitle },
                 min: 0, max, tickAmount: 5,
                 labels: { formatter: (v: any) => board === 'downtime' ? `${Math.round(Number(v))}h` : `${Math.round(Number(v))}` } },
        yaxis: { labels: { maxWidth: 110 }, title: { text: 'Operator name' } },
        grid: { borderColor: 'rgba(148,163,184,.25)', padding: { right: 12 } },
        tooltip: { theme: 'dark', y: { formatter: (v: number) => fmt(v) } },
        noData: { text: 'Nothing measured for this period' }
      };
    });
  }

  get scoreChart(): any     { return this.hbar('score', 'score', 'Score', v => `${this.fix(v)}%`, 120); }
  get rejectionChart(): any { return this.hbar('rejection', 'rejection', 'Score', v => `${this.fix(v)}%`); }
  get downtimeChart(): any  { return this.hbar('downtime', 'downtime', 'Time', v => this.hms(v * 3600)); }

  /** A, P and Q for each operator on the OEE card, as the mock draws them. */
  get oeeChart(): any {
    return this.charts.memo('oee', () => {
      const rows = this.rows('oee');
      const col = (f: string) => rows.map((r: any) => r[f] ?? null);
      return {
        series: [
          { name: 'A', data: col('availability_pct') },
          { name: 'P', data: col('efficiency_pct') },
          { name: 'Q', data: col('quality_rate_pct') }
        ],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        plotOptions: { bar: { borderRadius: 2, columnWidth: '62%' } },
        colors: ['#2f2d8f', '#4a76c8', '#9b7ec8'],
        dataLabels: { enabled: false },
        legend: { position: 'bottom', markers: { shape: 'circle' } },
        xaxis: { categories: rows.map((r: any) => r.operator_name), labels: { rotate: -30, trim: true } },
        yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: (v: number) => `${Math.round(v)}%` } },
        grid: { borderColor: 'rgba(148,163,184,.25)' },
        tooltip: {
          theme: 'dark', shared: true, intersect: false,
          y: { formatter: (v: number | null) => v == null ? '--' : `${v}%` },
          // the OEE itself, which the three bars multiply to
          x: { formatter: (_: any, o: any) => {
            const r = rows[o?.dataPointIndex];
            return r ? `${r.operator_name} — OEE ${r.oee_pct == null ? '--' : r.oee_pct + '%'}` : '';
          } }
        },
        noData: { text: 'Nothing measured for this period' }
      };
    });
  }

  /* ── view helpers ── */

  /** Label colour for the theme in use — the labels sit outside the bars, on the card. */
  private get ink(): string {
    return document.documentElement.classList.contains('dark') ? '#e8ebf2' : '#1f2430';
  }

  private fix(v: number): string { return Number.isInteger(v) ? String(v) : Number(v).toFixed(1); }

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
