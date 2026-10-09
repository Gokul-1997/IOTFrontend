import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { MaintenanceReportService } from './maintenance-report.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { DashPart, DashTab, DashViewHooks, DashViews, viewInUrl } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';

/** Charts | Ticket Details (Machine Summary and Maintenance Tickets), under the tiles both share. */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',         icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Ticket Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

/* ─────────────────────────────────────────────────────────────
   Maintenance Report

   The Maintenance Dashboard answers "what is the floor doing now".
   This answers "what did maintenance do over this period, and what did
   it cost in stopped time" — so it reads the ticket record, and every
   figure on it is exportable to Excel, CSV and PDF, which is the form
   the agreement asks for.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-maintenance-report',
  standalone: true,
  imports: [DashViewTabsComponent, MexaPagerComponent, MetricHelpComponent, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './maintenance-report.component.html'
})
export class MaintenanceReportComponent implements OnInit, OnDestroy, DashViewHooks {

  /* ── Charts | Ticket Details ──
     Each part of the page is asked for only while it is on screen and out
     of date (shared/dash-view). */
  private url = viewInUrl(TABS);
  readonly views = new DashViews(this, TABS, this.url.initial);

  private charts = new ChartMemo();

  readonly STATUSES   = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  readonly ISSUES     = ['BREAKDOWN', 'ALARM', 'INSPECTION', 'OTHER'];
  readonly PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  machines: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  /** The page's data, each part merged in as it arrives. */
  data: any = null;
  /** Something on screen is waiting for its data ("Updating…"). */
  get loading(): boolean { return this.views.loading; }
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  trendSeries: any[] = [];      trendCategories: string[] = [];
  downtimeSeries: any[] = [];   downtimeCategories: string[] = [];
  typeSeries: number[] = [];    typeLabels: string[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: MaintenanceReportService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('maintenance-report', 'export'); }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.cdr.markForCheck();
      });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.load();
  }

  ngOnDestroy(): void { this.views.cancel(); this.destroy$.next(); this.destroy$.complete(); }

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
    const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    return { from: monthAgo, to: today, machine_id: null, status: '', issue_type: '', priority: '', search: '' };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

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
    this.cdr.markForCheck();
  }

  /* What each part depends on: the tiles and charts on the filters (the
     ticket search narrows them too); the tables on those and the page. */
  partKeys(): Record<DashPart, string> {
    const shared = JSON.stringify(this.f);
    return { kpis: shared, charts: shared, table: JSON.stringify([shared, this.page, this.limit]) };
  }

  fetchParts(parts: DashPart[]) {
    const paging = parts.includes('table') ? { page: this.page, limit: this.limit } : {};
    return this.svc.getReport({ ...this.f, ...paging, part: parts.join(',') }).pipe(takeUntil(this.destroy$));
  }

  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load the maintenance report.' : 'No maintenance data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next: any = { ...(this.data ?? {}) };
    if (parts.includes('kpis')) next.kpis = {
      tickets: 0, open: 0, settled: 0, breakdowns: 0, critical: 0,
      downtime_minutes: 0, downtime_unrecorded: 0, mttr_hours: null,
      mttr_basis: 0, mttr_basis_note: '', downtime_note: null, ...(d.kpis ?? {})
    };
    if (parts.includes('charts') || parts.includes('table')) next.by_machine = d.by_machine ?? [];
    if (parts.includes('charts')) Object.assign(next, this.normalise(d));
    if (parts.includes('table')) next.tickets = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.tickets ?? {}) };
    this.data = next;
    if (parts.includes('charts')) this.applyCharts(next);
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  /** The charts' series, built once per answer rather than in getters. */
  private applyCharts(d: any): void {
    this.charts.bump();

    const trend = d.trend || [];
    this.trendCategories = trend.map((t: any) => this.dayLabel(t.day));
    this.trendSeries = trend.length ? [
      { name: 'Raised',   data: trend.map((t: any) => t.raised) },
      { name: 'Resolved', data: trend.map((t: any) => t.resolved) }
    ] : [];

    /* Machines with no recorded stopped time are left out rather than
       drawn as a zero bar — nothing recorded is not the same claim as
       nothing lost. */
    const down = (d.by_machine || []).filter((r: any) => Number(r.downtime_minutes) > 0).slice(0, 8);
    this.downtimeCategories = down.map((r: any) => r.machine_serial_no);
    this.downtimeSeries = down.length
      ? [{ name: 'Downtime', data: down.map((r: any) => +(r.downtime_minutes / 60).toFixed(2)) }] : [];

    const types = Object.entries(d.by_type || {}).filter(([, n]) => Number(n) > 0);
    this.typeLabels = types.map(([k]) => this.words(k));
    this.typeSeries = types.map(([, n]) => Number(n));
  }

  /* A template expression that throws aborts the whole change-detection
     pass, freezing unrelated components. Defend at the boundary. (The tiles
     and the tables are filled in by applyParts.) */
  private normalise(d: any): any {
    return {
      by_type:    d?.by_type    ?? {},
      by_status:  d?.by_status  ?? {},
      trend:      d?.trend      ?? []
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
          a.href = url; a.download = `maintenance_report_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No maintenance tickets match these filters');
        }
      });
  }

  /* ── view helpers ── */

  /** Unmeasured shows as a dash, never as 0 — they are different claims. */
  num(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : String(v);
  }

  /** Minutes as the hours-and-minutes a maintenance log is actually read in. */
  minutes(min: number | null | undefined): string {
    const n = Number(min) || 0;
    if (!n) return '0m';
    const h = Math.floor(n / 60);
    const m = n % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  hours(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}h`;
  }

  words(k: string): string {
    return k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  statusBadge(status: string): string {
    if (status === 'CLOSED' || status === 'RESOLVED') return 'mexa-badge-good';
    if (status === 'IN_PROGRESS' || status === 'ASSIGNED') return 'mexa-badge-info';
    return 'mexa-badge-warn';
  }

  priorityBadge(priority: string): string {
    if (priority === 'CRITICAL') return 'mexa-badge-bad';
    if (priority === 'HIGH')     return 'mexa-badge-warn';
    if (priority === 'MEDIUM')   return 'mexa-badge-info';
    return 'mexa-badge-neutral';
  }

  private dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => ({
      chart:  { type: 'line', height: 200, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      colors: ['#c8384b', '#2f9e6f'],
      dataLabels: { enabled: false },
      markers: { size: 3 },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis:  { categories: this.trendCategories, title: { text: 'Day' } },
      yaxis:  { title: { text: 'Tickets' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
      noData: { text: 'No tickets in this period' }
    }));
  }

  get downtimeChart(): any {
    return this.charts.memo('downtimeChart', () => ({
      chart:  { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%' } },
      colors: ['#c8384b'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.downtimeCategories, title: { text: 'Hours stopped' } },
      yaxis:  { labels: { style: { fontSize: '12px' } } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light', y: { formatter: (v: number) => `${v} h` } },
      noData: { text: 'No downtime recorded' }
    }));
  }

  get typeChart(): any {
    return this.charts.memo('typeChart', () => ({
      chart:  { type: 'donut', height: 200, fontFamily: 'inherit' },
      labels: this.typeLabels,
      colors: ['#c8384b', '#e0a341', '#4a76c8', '#9b7ec8'],
      plotOptions: {
        pie: { donut: { size: '64%', labels: {
          show: true,
          total: { show: true, label: 'Tickets', fontSize: '.75rem',
                   formatter: () => String(this.data?.kpis?.tickets ?? 0) }
        } } }
      },
      /* The count, drawn inside its own slice. Apex's default percentage
         labels are white and sit outside a thin slice, where they land on
         the page background and disappear — in either theme. */
      dataLabels: {
        enabled: true,
        dropShadow: { enabled: false },
        formatter: (_v: number, o: any) => String(o.w.config.series[o.seriesIndex])
      },
      legend: { position: 'bottom' },
      tooltip:{ theme: 'light', y: { formatter: (v: number) => `${v} ticket${v === 1 ? '' : 's'}` } },
      noData: { text: 'No tickets in this period' }
    }));
  }
}
