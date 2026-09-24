import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { PreventiveDashboardService } from './preventive-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { ReportDateDirective, reportMinDate, plantToday } from '../../shared/report-date.directive';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 3 — Preventive Maintenance Dashboard

   Reports the loop the PM engine drives: alarms cross a
   configured threshold → a PM ticket is raised with a due date
   → the work gets done.

   Not polled on a timer like Screens 1 and 2. This is a planning
   view rather than a live board — the engine only evaluates every
   15 minutes, so a 60-second poll would just add load for numbers
   that cannot have changed.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-preventive-dashboard',
  standalone: true,
  imports: [ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, MexaPagerComponent],
  templateUrl: './preventive-dashboard.component.html'
})
export class PreventiveDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  /* ── filters ── */
  machines: any[] = [];
  selectedMachine: number | null = null;
  /* A From–To range, as the design draws it ("18 Jun 2026 - 18 Jul 2026");
     it was one date, which could not show a week or a month. Defaults to
     the last 7 days, the window the agreement's alarm trend describes. */
  fromDate     = this.istDate(-6);
  toDate       = this.istDate(0);
  today        = this.istDate(0);
  rangeError   = '';
  search       = '';
  page         = 1;
  limit = 10;

  /* ── state ── */
  data: any = null;
  loading   = false;
  errorMsg  = '';
  updatedAt = '';
  running   = false;

  /* ── threshold rules ── */
  thresholds: any[] = [];
  showRules = false;
  savingRule = false;
  ruleForm: any = this.blankRule();

  /* ── charts ── */
  trendSeries: any[] = [];
  trendCategories: string[] = [];
  machineSeries: any[] = [];
  machineCategories: string[] = [];
  severitySeries: number[] = [];
  severityTotal = 0;
  reasonSeries: any[] = [];
  reasonCategories: string[] = [];

  private destroy$ = new Subject<void>();
  private search$  = new RxSubject<string>();

  constructor(
    private svc: PreventiveDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.cdr.markForCheck();
      });

    /* debounced so typing in the ticket search does not fire a request per
       keystroke against a paginated endpoint */
    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.loadThresholds();
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(): void { this.search$.next(this.search); }

  /** Said before sending, in the words the server would use. */
  private checkRange(): boolean {
    const from = this.fromDate, to = this.toDate;
    if (!from || !to)  this.rangeError = 'Choose both a start and an end date.';
    else if (from > to) this.rangeError = 'The start date must be on or before the end date.';
    else if (from < reportMinDate() || to > plantToday())
                        this.rangeError = 'Choose dates within the last 3 months, up to today.';
    else                this.rangeError = '';
    return !this.rangeError;
  }

  submit(): void {
    if (!this.checkRange()) { this.cdr.markForCheck(); return; }
    this.page = 1;
    this.load();
  }

  reset(): void {
    this.selectedMachine = null;
    this.fromDate = this.istDate(-6);
    this.toDate = this.istDate(0);
    this.rangeError = '';
    this.search = '';
    this.page = 1;
    this.load();
  }

  /** From the shared pager: jump to a page, or change how many rows a page holds. */
  goTo(p: number): void { this.page = p; this.load(); }
  setLimit(n: number): void { this.limit = n || 10; this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.tickets?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getPreventive({
      from: this.fromDate,
      to: this.toDate,
      machine_id: this.selectedMachine,
      search: this.search,
      page: this.page,
      limit: this.limit
    })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load preventive maintenance data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No preventive maintenance data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    this.trendCategories = (d.alarm_trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{ name: 'Critical alarms', data: (d.alarm_trend || []).map((t: any) => t.critical) }];

    this.machineCategories = (d.alarms_by_machine || []).map((m: any) => m.machine_serial_no);
    this.machineSeries = [{ name: 'Critical alarms', data: (d.alarms_by_machine || []).map((m: any) => m.critical) }];

    /* Donuts take a flat number array; the {name,data} series shape
       renders an empty chart with no error. */
    this.severitySeries = [
      Number(d.alarm_severity.critical) || 0,
      Number(d.alarm_severity.non_critical) || 0,
      Number(d.alarm_severity.information) || 0
    ];
    this.severityTotal = this.severitySeries.reduce((a, b) => a + b, 0);

    const reasons = (d.top_alarm_reasons || []).slice(0, 5);
    this.reasonCategories = reasons.map((r: any) => r.alarm_type || r.alarm_name || 'Unnamed');
    this.reasonSeries = reasons.length
      ? [{ name: 'Occurrences', data: reasons.map((r: any) => r.occurrences ?? r.critical ?? 0) }] : [];

    this.cdr.markForCheck();
  }

  /*
   * Fill in anything the payload is missing before it reaches the template.
   *
   * A template expression that throws does not just blank its own section —
   * the exception aborts the whole change-detection pass, so every other
   * component on the page stops re-rendering too. A partial response here
   * once left the header's dropdowns frozen, which looked like a broken
   * menu rather than a broken dashboard. Defend at the boundary, not in
   * thirty separate template expressions.
   */
  private normalise(d: any): any {
    return {
      ...d,
      filters:  d?.filters  ?? { from: this.fromDate, to: this.toDate, machine_id: null, search: null },
      kpis: {
        critical_alarms: 0, critical_alarms_open: 0, pm_generated: 0, pm_open: 0,
        pm_completed: 0, pm_overdue: 0, avg_resolution_hours: null, resolved_count: 0,
        ...(d?.kpis ?? {})
      },
      alarm_trend:       d?.alarm_trend       ?? [],
      alarm_severity:    { critical: 0, non_critical: 0, information: 0, ...(d?.alarm_severity ?? {}) },
      alarms_by_machine: d?.alarms_by_machine ?? [],
      top_alarm_reasons: d?.top_alarm_reasons ?? [],
      ticket_status:     { open: 0, in_progress: 0, completed: 0, ...(d?.ticket_status ?? {}) },
      tickets:           { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.tickets ?? {}) },
      alarm_triggers:    d?.alarm_triggers    ?? []
    };
  }

  /* ── threshold rules ── */

  loadThresholds(): void {
    this.svc.getThresholds()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.thresholds = res?.data ?? [];
        this.cdr.markForCheck();
      });
  }

  blankRule() {
    return { alarm_type: '', machine_id: null, threshold_count: 3, window_hours: 24, due_hours: 48, priority: 'MEDIUM', is_active: true };
  }

  saveRule(): void {
    if (!this.ruleForm.alarm_type?.trim()) {
      this.toast.error('Alarm name is required');
      return;
    }
    this.savingRule = true;
    this.cdr.markForCheck();
    this.svc.saveThreshold(this.ruleForm)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingRule = false;
          this.ruleForm = this.blankRule();
          this.toast.success('Rule saved');
          this.loadThresholds();
          this.load();
        },
        error: err => {
          this.savingRule = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not save the rule');
        }
      });
  }

  deleteRule(r: any): void {
    if (!confirm(`Delete the rule for "${r.alarm_type}"? Tickets it already raised are kept.`)) return;
    this.svc.deleteThreshold(r.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.toast.success('Rule deleted'); this.loadThresholds(); this.load(); },
        error: err => this.toast.error(err?.error?.message || 'Could not delete the rule')
      });
  }

  runEngine(): void {
    this.running = true;
    this.cdr.markForCheck();
    this.svc.runEngine()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.running = false;
          this.toast.success(res?.message || 'Rules evaluated');
          this.load();
        },
        error: err => {
          this.running = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not run the rules');
        }
      });
  }

  /* ── view helpers ── */

  /** True when there is genuinely nothing to report yet, as opposed to a
   *  filter that happens to match nothing. */
  get isUnconfigured(): boolean {
    return !!this.data && this.thresholds.length === 0 && (this.data.kpis?.pm_generated ?? 0) === 0;
  }

  hours(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    if (v < 24) return `${v}h`;
    return `${(v / 24).toFixed(1)}d`;
  }

  age(h: number | null | undefined): string {
    const n = Number(h || 0);
    return n < 24 ? `${n}h` : `${Math.floor(n / 24)}d ${n % 24}h`;
  }

  /* Colour reinforces the badge text; it is never the only cue. */
  priorityClass(p: string): string {
    switch (String(p).toUpperCase()) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'HIGH':     return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      case 'MEDIUM':   return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      default:         return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  statusClass(s: string): string {
    switch (String(s).toUpperCase()) {
      case 'OPEN':        return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
      case 'ASSIGNED':
      case 'IN_PROGRESS': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      default:            return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    }
  }

  /** A date in plant time, `offset` days from today. The old helper
   *  converted back to UTC, so before 05:30 IST "today" was yesterday. */
  private istDate(offset: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
      .format(new Date(Date.now() + offset * 86_400_000));
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
    return {
      chart:  { type: 'area', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 2, curve: 'smooth' },
      fill:   { type: 'gradient', gradient: { shadeIntensity: 0.3, opacityFrom: 0.4, opacityTo: 0.05 } },
      colors: ['#dc2626'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'Critical alarms' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' }
    };
  });
  }

  /* Machine-wise alarms is a column chart in the design, matching the
     other "by machine" panels; reasons stay horizontal because the
     labels are sentences. */
  get machineChart(): any {
    return this.charts.memo('machineChart', () => {
    return {
      chart:  { type: 'bar', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '55%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: false },
      // distributed repeats every machine in the legend; the axis names them
      legend: { show: false },
      xaxis:  { categories: this.machineCategories },
      yaxis:  { title: { text: 'No. of Alarms' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No critical alarms in this period' }
    };
  });
  }

  private readonly palette = ['#2f2d8f', '#4a76c8', '#9b7ec8', '#17b3a3', '#6b7280'];

  /** Completed over raised. Null-safe: nothing raised is not 0% compliant. */
  get compliance(): string {
    const raised = Number(this.data?.kpis?.pm_generated) || 0;
    if (!raised) return '--';
    return `${Math.round((Number(this.data.kpis.pm_completed) / raised) * 1000) / 10}%`;
  }

  /* MEXA pill classes. The older Tailwind helpers are left in place for
     any call site still using them. */
  priorityBadge(p: string): string {
    switch (String(p).toUpperCase()) {
      case 'CRITICAL':
      case 'HIGH':   return 'mexa-badge-bad';
      case 'MEDIUM': return 'mexa-badge-warn';
      default:       return 'mexa-badge-good';
    }
  }

  statusBadge(s: string): string {
    switch (String(s).toUpperCase()) {
      case 'OPEN':        return 'mexa-badge-warn';
      case 'ASSIGNED':
      case 'IN_PROGRESS': return 'mexa-badge-violet';
      default:            return 'mexa-badge-info';
    }
  }

  /** IN_PROGRESS reads badly in a pill; the underscore is not for users. */
  statusWord(s: string): string {
    const v = String(s || '').toUpperCase();
    if (v === 'IN_PROGRESS') return 'In Progress';
    return v ? v.charAt(0) + v.slice(1).toLowerCase() : '--';
  }

  get severityDonut(): any {
    return this.charts.memo('severityDonut', () => {
    return {
      chart: { type: 'donut', height: 240, fontFamily: 'inherit' },
      labels: ['Critical', 'Non critical', 'Information'],
      colors: ['#e03131', '#17b3a3', '#f5a623'],
      plotOptions: {
        pie: { donut: { size: '62%', labels: {
          show: true,
          total: { show: true, label: 'Total', fontSize: '.8rem',
                   formatter: () => String(this.severityTotal) }
        } } }
      },
      dataLabels: { enabled: true, formatter: (v: number) => `${Math.round(v)}%` },
      // the key list beside the donut already names every severity
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this period' }
    };
  });
  }

  get reasonChart(): any {
    return this.charts.memo('reasonChart', () => {
    return {
      chart: { type: 'bar', height: 240, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '62%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: true, style: { fontSize: '.72rem', fontWeight: 700, colors: ['#fff'] } },
      legend: { show: false },
      xaxis: { categories: this.reasonCategories, title: { text: 'Occurrences' } },
      grid:  { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark' },
      noData: { text: 'No critical alarms in this period' }
    };
  });
  }
}
