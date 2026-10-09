import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, Subscription, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { PeriodicDashboardService } from './periodic-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { DashPart, DashTab, DashViewHooks, DashViews, revealWhenShown, viewInUrl } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';

/** Charts | Maintenance Details (upcoming, by type, the tickets and the plan), under the tiles both share. */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',              icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Maintenance Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 4 — Periodic Maintenance Dashboard

   The calendar half of maintenance. Screen 3 raises work because a
   machine started alarming; this raises work because the date arrived —
   greasing, filter changes, calibration, the annual service.

   Not polled. The engine evaluates every 15 minutes and the shortest
   frequency is daily, so a 60-second refresh would add load to numbers
   that cannot have moved.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-periodic-dashboard',
  standalone: true,
  imports: [DashViewTabsComponent, MexaPagerComponent, AutoApplyDirective, FilterPanelDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './periodic-dashboard.component.html'
})
export class PeriodicDashboardComponent implements OnInit, OnDestroy, DashViewHooks {

  /* ── Charts | Maintenance Details ──
     Each part of the page is asked for only while it is on screen and out
     of date (shared/dash-view). */
  private url = viewInUrl(TABS);
  readonly views = new DashViews(this, TABS, this.url.initial);

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  /* ── filters ── */
  machines: any[] = [];
  selectedMachine: number | null = null;
  search = '';
  statusFilter = '';
  /** 'overdue' | 'today' | '' — set by the Attention Required panel. */
  dueFilter = '';
  page = 1;
  readonly limit = 10;

  /* ── state ── */
  /** The page's data, each part merged in as it arrives. */
  data: any = null;
  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.views.loading; }
  errorMsg = '';
  updatedAt = '';
  running = false;
  exporting = '';

  /* ── the plan ── */
  schedules: any[] = [];
  showPlan = false;
  /** The machine the plan's schedules were asked for; null until the plan is opened. */
  private plansFor: string | null = null;
  private plansSub = Subscription.EMPTY;
  savingSchedule = false;
  scheduleForm: any = this.blankSchedule();

  /* ── charts ── */
  trendSeries: any[] = [];
  trendCategories: string[] = [];
  workloadSeries: number[] = [];

  readonly FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'];
  readonly STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: PeriodicDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('analytics-periodic', 'export'); }

  /** Upcoming Maintenance: the design's Today | This Week | This Month. */
  upcomingWindow: 'today' | 'week' | 'month' = 'week';

  get upcomingRows(): any[] {
    const now = new Date();
    const end = new Date(now);
    if (this.upcomingWindow === 'today') end.setHours(23, 59, 59, 999);
    else if (this.upcomingWindow === 'week') { end.setDate(end.getDate() + 7); end.setHours(23, 59, 59, 999); }
    else { end.setMonth(end.getMonth() + 1, 0); end.setHours(23, 59, 59, 999); }
    // overdue items stay in every view — they are the most urgent of all
    return (this.data?.upcoming || []).filter((u: any) => new Date(u.due_date) <= end);
  }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.cdr.markForCheck();
      });

    /* debounced so typing in the search box does not fire a request per
       keystroke against a paginated endpoint */
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

  /** The title bar's plan button: the plan is on Maintenance Details, so opening it goes there. */
  togglePlan(): void {
    this.showPlan = !this.showPlan;
    if (this.showPlan) {
      this.setView('details');
      this.ensureSchedules();
      revealWhenShown('pePlan', 'pePlanTitle');
    }
    this.cdr.markForCheck();
  }

  onSearchInput(): void { this.search$.next(this.search); }

  submit(): void { this.page = 1; this.load(); }

  reset(): void {
    this.selectedMachine = null;
    this.search = '';
    this.statusFilter = '';
    this.dueFilter = '';
    this.page = 1;
    this.load();
  }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.tickets?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  /** Bring what is on screen up to date with the filters; the other tab follows when it is opened. */
  load(): void {
    this.errorMsg = '';
    this.views.load();
    this.ensureSchedules();
    this.cdr.markForCheck();
  }

  /** Something changed the tickets or the plan (saved, stopped, generated): every part loads again. */
  private reloadAll(): void {
    this.views.stale();
    this.load();
  }

  /* What each part depends on: the tiles and charts on the machine alone;
     the tables on it and the ticket search, status, due and page. */
  partKeys(): Record<DashPart, string> {
    const machine = JSON.stringify([this.selectedMachine]);
    return {
      kpis: machine, charts: machine,
      table: JSON.stringify([this.selectedMachine, this.search, this.statusFilter, this.dueFilter, this.page, this.limit])
    };
  }

  fetchParts(parts: DashPart[]) {
    const table = parts.includes('table')
      ? { search: this.search, status: this.statusFilter, due: this.dueFilter, page: this.page, limit: this.limit } : {};
    return this.svc.getPeriodic({ machine_id: this.selectedMachine, ...table, part: parts.join(',') })
      .pipe(takeUntil(this.destroy$));
  }

  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load periodic maintenance data.' : 'No periodic maintenance data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next: any = { ...(this.data ?? {}) };
    if (parts.includes('kpis')) next.kpis = {
      scheduled: 0, due_today: 0, due_this_week: 0, overdue: 0, completed: 0,
      compliance_pct: null, compliance_basis: { on_time: 0, judged: 0 }, ...(d.kpis ?? {})
    };
    if (parts.includes('kpis') || parts.includes('charts')) next.technician_workload = d.technician_workload ?? [];
    if (parts.includes('charts')) Object.assign(next, this.normalise(d));
    if (parts.includes('table')) {
      next.by_frequency = d.by_frequency ?? [];
      next.upcoming     = d.upcoming     ?? [];
      next.tickets      = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.tickets ?? {}) };
    }
    this.data = next;
    if (parts.includes('charts')) this.applyCharts(next);
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  /** The charts' series, built once per answer rather than in getters. */
  private applyCharts(d: any): void {
    this.charts.bump();

    this.trendCategories = (d.compliance_trend || []).map((t: any) =>
      new Date(t.week_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{
      name: 'Compliance %',
      data: (d.compliance_trend || []).map((t: any) => t.compliance_pct)
    }];

    /* Donuts take a flat number array; the {name,data} series shape
       renders an empty chart with no error. */
    this.workloadSeries = (d.technician_workload || []).map((w: any) => Number(w.open) || 0);
  }

  /*
   * Fill in anything the payload is missing before it reaches the template.
   *
   * A template expression that throws does not just blank its own section —
   * the exception aborts the whole change-detection pass, so every other
   * component on the page stops re-rendering too. A partial response once
   * left the header's dropdowns frozen, which read as a broken menu rather
   * than a broken dashboard. Defend at the boundary, not in thirty
   * separate template expressions.
   */
  private normalise(d: any): any {
    return {
      filters: d?.filters ?? { machine_id: null, search: null, status: null },
      compliance_trend:    d?.compliance_trend    ?? [],
      technician_workload: d?.technician_workload ?? []
    };
  }

  /* ── the plan ── */

  /**
   * The plan's schedules, asked for only while the plan is open and only
   * when the machine has changed since — never on landing, and never by
   * paging the tickets.
   */
  private ensureSchedules(): void {
    const key = JSON.stringify([this.selectedMachine]);
    if (!this.showPlan || this.plansFor === key) return;
    this.plansFor = key;
    this.plansSub.unsubscribe();
    this.plansSub = this.svc.getSchedules(this.selectedMachine)
      .pipe(takeUntil(this.destroy$), catchError(() => { this.plansFor = null; return of(null); }))
      .subscribe(res => {
        this.schedules = res?.data ?? [];
        this.cdr.markForCheck();
      });
  }

  /** A schedule was saved, stopped or generated from: the plan loads again when it is (or next is) open. */
  private reloadSchedules(): void {
    this.plansFor = null;
    this.ensureSchedules();
  }

  blankSchedule() {
    return {
      id: null, machine_id: null, title: '', description: '',
      frequency: 'MONTHLY', next_due_at: this.todayStr(),
      grace_days: 0, assigned_user_id: null, is_active: true
    };
  }

  editSchedule(s: any): void {
    this.scheduleForm = {
      ...s,
      next_due_at: s.next_due_at ? String(s.next_due_at).slice(0, 10) : this.todayStr()
    };
    this.showPlan = true;
    this.ensureSchedules();
    this.cdr.markForCheck();
  }

  saveSchedule(): void {
    const f = this.scheduleForm;
    if (!f.machine_id)      { this.toast.error('Choose a machine'); return; }
    if (!f.title?.trim())   { this.toast.error('A task name is required'); return; }
    if (!f.next_due_at)     { this.toast.error('Set the first due date'); return; }

    this.savingSchedule = true;
    this.cdr.markForCheck();

    this.svc.saveSchedule({ ...f, grace_days: Number(f.grace_days) || 0 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingSchedule = false;
          this.scheduleForm = this.blankSchedule();
          this.toast.success('Schedule saved');
          this.reloadSchedules();
          this.reloadAll();
        },
        error: err => {
          this.savingSchedule = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not save the schedule');
        }
      });
  }

  deleteSchedule(s: any): void {
    if (!confirm(`Stop scheduling "${s.title}"? Tickets it already raised are kept.`)) return;
    this.svc.deleteSchedule(s.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.toast.success('Schedule stopped'); this.reloadSchedules(); this.reloadAll(); },
        error: err => this.toast.error(err?.error?.message || 'Could not stop the schedule')
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
          this.toast.success(res?.message || 'Schedules evaluated');
          this.reloadSchedules();
          this.reloadAll();
        },
        error: err => {
          this.running = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not run the schedules');
        }
      });
  }

  /* ── export ── */

  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format;
    this.cdr.markForCheck();

    this.svc.exportAs(format, {
      machine_id: this.selectedMachine, search: this.search, status: this.statusFilter
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.exporting = '';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `periodic_maintenance_${this.todayStr()}.${format}`;
          a.click();
          // revoke on the next tick, not immediately — Safari has not
          // started reading the blob when click() returns
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('Nothing to export for these filters');
        }
      });
  }

  /** Attention Required rows. Clicking the active one clears the filter,
   *  so a user cannot get stuck inside a filter they did not notice. */
  focusDue(kind: 'overdue' | 'today'): void {
    this.dueFilter = this.dueFilter === kind ? '' : kind;
    this.statusFilter = '';
    this.page = 1;
    // a narrowing opens the tickets, on Maintenance Details; clearing it stays where it is
    if (this.dueFilter && this.views.tab !== 'details') {
      this.setView('details');
      revealWhenShown('peTickets', 'peTicketsTitle');
    } else {
      this.load();
    }
  }

  /** Technicians carrying at least one overdue ticket. */
  get overloadedTechnicians(): number {
    return (this.data?.technician_workload || [])
      .filter((w: any) => Number(w.overdue) > 0).length;
  }

  private readonly palette = ['#e8618c', '#17b3a3', '#f5a623', '#2f2d8f', '#4a76c8', '#9b7ec8'];

  donutColour(i: number): string { return this.palette[i % this.palette.length]; }

  /* MEXA pill classes. The Tailwind helpers below are left for any call
     site still using them. */
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

  get workloadDonut(): any {
    return this.charts.memo('workloadDonut', () => {
    const total = this.workloadSeries.reduce((a, b) => a + b, 0);
    return {
      chart: { type: 'donut', height: 250, fontFamily: 'inherit' },
      labels: (this.data?.technician_workload || []).map((w: any) => w.technician),
      colors: this.palette,
      plotOptions: {
        pie: { donut: { size: '64%', labels: {
          show: true,
          total: { show: true, label: 'Total', fontSize: '.8rem', formatter: () => String(total) }
        } } }
      },
      dataLabels: { enabled: true, formatter: (_v: number, o: any) => String(o.w.config.series[o.seriesIndex]) },
      // the key list beside the donut already names every technician
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} open` } },
      noData: { text: 'No open tickets to assign' }
    };
  });
  }

  /* ── view helpers ── */

  /** True when there is genuinely no plan yet, as opposed to a filter that
   *  happens to match nothing. */
  get isUnconfigured(): boolean {
    // how many schedules the company has comes with the tiles, so the plan need not be loaded to know
    return !!this.data && this.data.kpis?.plans === 0 && (this.data.kpis?.scheduled ?? 0) === 0;
  }

  /** Compliance has no value until something has actually come due. */
  get complianceLabel(): string {
    const pct = this.data?.kpis?.compliance_pct;
    return pct === null || pct === undefined ? '--' : `${pct}%`;
  }

  frequencyLabel(f: string): string {
    return String(f || '').replace('_', '-').toLowerCase()
      .replace(/^./, c => c.toUpperCase());
  }

  dueLabel(due: string, isOverdue: boolean): string {
    if (!due) return '--';
    const d = new Date(due);
    if (Number.isNaN(d.getTime())) return '--';
    const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
    if (isOverdue) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    /* A date can be in the past without being overdue — the schedule's
       grace days have not run out yet. Without this branch that case
       formats as "in -82d". */
    if (days < 0) return `${Math.abs(days)}d ago`;
    return `in ${days}d`;
  }

  /* Colour reinforces the text; it is never the only cue. */
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

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
    return {
      chart:  { type: 'line', height: 200, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      colors: ['#0f766e'],
      markers: { size: 4 },
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { min: 0, max: 100, title: { text: 'Compliance %' },
                labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      // a week with nothing due is a gap in the line, not a zero
      tooltip:{ theme: 'light' },
      noData: { text: 'No completed cycles yet' }
    };
  });
  }
}
