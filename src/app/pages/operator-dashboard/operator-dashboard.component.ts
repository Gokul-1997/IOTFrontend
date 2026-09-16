import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { OperatorDashboardService } from './operator-dashboard.service';
import { ToastService } from '../../core/services/toast.service';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 7 — Operator Performance

   No production table carries an operator; the link is the machine
   assignment, and it is not exclusive — several operators can be
   assigned to one machine at once. So a row here means "the machines
   this operator is responsible for", and the screen says so rather
   than implying a person personally made every part.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-operator-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule],
  templateUrl: './operator-dashboard.component.html'
})
export class OperatorDashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  shifts: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  productionSeries: any[] = [];
  productionCategories: string[] = [];

  /* The three Top-5 bars and the grouped quality/utilisation chart. Each
     keeps its own categories: an operator with no rejection rate must not
     shift the labels on a chart they do appear in. */
  scoreSeries: any[] = [];      scoreCategories: string[] = [];
  rejectionSeries: any[] = [];  rejectionCategories: string[] = [];
  downtimeSeries: any[] = [];   downtimeCategories: string[] = [];
  apqSeries: any[] = [];        apqCategories: string[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: OperatorDashboardService,
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
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.operators?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getOperators({ ...this.f, page: this.page, limit: this.limit })
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
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';

    this.productionCategories = (d.by_production || []).map((r: any) => r.operator_name);
    this.productionSeries = [{ name: 'Parts', data: (d.by_production || []).map((r: any) => r.produced) }];

    /* Top 5 panels are drawn from the page the table shows. Rows whose
       metric is null are dropped rather than plotted as zero — an
       operator with nothing measured is not an operator scoring nil. */
    const rows = d.operators?.data || [];

    const scored = this.top(rows, 'oee_pct');
    this.scoreCategories = scored.map((r: any) => r.operator_name);
    this.scoreSeries = scored.length ? [{ name: 'OEE', data: scored.map((r: any) => r.oee_pct) }] : [];

    const rejected = this.top(rows, 'rejection_rate_pct');
    this.rejectionCategories = rejected.map((r: any) => r.operator_name);
    this.rejectionSeries = rejected.length
      ? [{ name: 'Rejection', data: rejected.map((r: any) => r.rejection_rate_pct) }] : [];

    const down = [...rows].filter((r: any) => Number(r.downtime_seconds) > 0)
      .sort((a: any, b: any) => b.downtime_seconds - a.downtime_seconds).slice(0, 5);
    this.downtimeCategories = down.map((r: any) => r.operator_name);
    this.downtimeSeries = down.length
      ? [{ name: 'Downtime', data: down.map((r: any) => +(r.downtime_seconds / 3600).toFixed(2)) }] : [];

    /* Availability is not computed per operator, so this charts the two
       rates that are — mislabelling utilisation as availability would be
       worse than showing two bars instead of three. */
    const apq = scored.length ? scored : rows.slice(0, 5);
    this.apqCategories = apq.map((r: any) => r.operator_name);
    this.apqSeries = apq.length ? [
      { name: 'Utilisation', data: apq.map((r: any) => r.utilization_pct ?? 0) },
      { name: 'Quality',     data: apq.map((r: any) => r.quality_rate_pct ?? 0) }
    ] : [];

    this.cdr.markForCheck();
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. */
  private normalise(d: any): any {
    return {
      ...d,
      kpis: {
        produced: 0, good: 0, rejected: 0, run_seconds: 0, idle_seconds: 0,
        quality_rate_pct: null, utilization_pct: null, oee_pct: null, ...(d?.kpis ?? {})
      },
      attribution:   { operators: 0, shared_machines: 0, note: '', ...(d?.attribution ?? {}) },
      by_production: d?.by_production  ?? [],
      top_performers:d?.top_performers ?? [],
      operators: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.operators ?? {}) }
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

  /* ── view helpers ── */

  /** True when OEE is recorded but flat zero across the board — which is an
   *  upstream problem, not an operator problem, and saying so stops the
   *  screen looking like every operator is failing. */
  get oeeLooksUnrecorded(): boolean {
    return !!this.data && this.data.operators.data.length > 0
        && this.data.operators.data.every((r: any) => !r.oee_pct);
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    if (n < 60) return `${n}s`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** Unmeasured shows as a dash, never as 0% — they are different claims. */
  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  rateClass(v: number | null | undefined, goodAbove: number): string {
    if (v === null || v === undefined) return 'text-gray-400';
    return v >= goodAbove
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-amber-700 dark:text-amber-400';
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get productionChart(): any {
    return {
      chart:  { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '65%' } },
      colors: ['#2563eb'],
      dataLabels: { enabled: true },
      xaxis:  { categories: this.productionCategories, title: { text: 'Parts produced' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No production recorded for this period' }
    };
  }

  /* ── performance bands ── */

  /** Server-computed over every operator, so the tiles do not change as
   *  you page through the table. */
  get bands(): any {
    return this.data?.bands ?? { excellent: 0, good: 0, average: 0, needs_help: 0, unrated: 0 };
  }

  bandLabel(oee: number | null | undefined): string {
    if (oee === null || oee === undefined) return 'Unrated';
    if (oee >= 85) return 'Excellent';
    if (oee >= 75) return 'Good';
    if (oee >= 60) return 'Avg';
    return 'Help';
  }

  bandBadge(oee: number | null | undefined): string {
    if (oee === null || oee === undefined) return 'mexa-badge-neutral';
    if (oee >= 85) return 'mexa-badge-good';
    if (oee >= 75) return 'mexa-badge-info';
    if (oee >= 60) return 'mexa-badge-warn';
    return 'mexa-badge-bad';
  }

  /** Top five rows by a numeric field, skipping rows where it is null. */
  private top(rows: any[], field: string): any[] {
    return [...rows]
      .filter(r => r[field] !== null && r[field] !== undefined)
      .sort((a, b) => b[field] - a[field])
      .slice(0, 5);
  }

  private readonly palette = ['#2f2d8f', '#4a76c8', '#9b7ec8', '#17b3a3', '#6b7280'];

  /** Shared shape for the three horizontal Top-5 bars. */
  get barChart(): any {
    return {
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '62%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: true, style: { fontSize: '.72rem', fontWeight: 700, colors: ['#fff'] } },
      // distributed repeats every name in the legend; the axis names them
      legend: { show: false },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      noData: { text: 'Nothing measured for this period' }
    };
  }

  /* Each bar keeps its own axis so a chart cannot borrow another's names. */
  get scoreAxis(): any     { return { categories: this.scoreCategories,     title: { text: 'OEE (%)' } }; }
  get rejectionAxis(): any { return { categories: this.rejectionCategories, title: { text: 'Rejection (%)' } }; }
  get downtimeAxis(): any  { return { categories: this.downtimeCategories,  title: { text: 'Hours' } }; }

  get pctTooltip(): any   { return { theme: 'dark', y: { formatter: (v: number) => `${v}%` } }; }
  get hoursTooltip(): any { return { theme: 'dark', y: { formatter: (v: number) => `${v} h` } }; }

  get apqChart(): any {
    return {
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 3, columnWidth: '62%' } },
      colors: ['#3b9ae1', '#9b7ec8'],
      dataLabels: { enabled: false },
      legend: { position: 'bottom' },
      xaxis: { categories: this.apqCategories },
      yaxis: { max: 100, title: { text: '%' } },
      grid:  { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark', y: { formatter: (v: number) => `${v}%` } },
      noData: { text: 'Nothing measured for this period' }
    };
  }
}
