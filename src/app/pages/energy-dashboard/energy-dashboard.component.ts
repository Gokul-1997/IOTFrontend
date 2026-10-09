import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { EnergyDashboardService } from './energy-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { compactQty, qty } from '../../shared/format-number';
import { MeterPanelComponent } from '../../shared/meter-panel/meter-panel.component';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { DashPart, DashTab, DashViewHooks, DashViews, viewInUrl } from '../../shared/dash-view/dash-view';
import { DashViewTabsComponent } from '../../shared/dash-view/dash-view-tabs.component';

/** Charts | Machine Detail | Energy Meter, under the tiles all three share. The meter
 *  panel fetches its own readings, so its tab needs nothing more from this page. */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',         icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Machine Detail', icon: 'table_rows', parts: ['kpis', 'table'] },
  { key: 'meter',   label: 'Energy Meter',   icon: 'bolt',       parts: ['kpis'] }
];

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 9 — Energy Monitoring

   Devices report energy as a cumulative kWh counter, so consumption is
   a difference between readings, never a sum of them. No machine sends
   that counter yet, so this screen reports "not reporting" rather than
   zeros that would read as a remarkably efficient factory.

   Kept to what can be read at a glance (6 Oct 2026): a value and at most
   one short line per tile, the definitions behind each (i). A chart is
   drawn again only when its own figures change, and Day / Week / Month
   regroup what is already loaded — no request.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-energy-dashboard',
  standalone: true,
  imports: [DashViewTabsComponent, MexaPagerComponent, MetricHelpComponent, AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, RouterModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, MeterPanelComponent],
  templateUrl: './energy-dashboard.component.html'
})
export class EnergyDashboardComponent implements OnInit, OnDestroy, DashViewHooks {

  /* ── Charts | Machine Detail | Energy Meter ──
     Each part of the page is asked for only while it is on screen and out
     of date (shared/dash-view). */
  private url = viewInUrl(TABS);
  readonly views = new DashViews(this, TABS, this.url.initial);
  /** Chart options keep their reference until their own figures change (deps). */
  private charts = new ChartMemo();

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


  trendSeries: any[] = [];
  trendCategories: string[] = [];
  machineSeries: any[] = [];
  machineCategories: string[] = [];
  shiftDonutSeries: number[] = [];
  shiftTotal = 0;
  monthSeries: any[] = [];
  monthCategories: string[] = [];

  private destroy$ = new Subject<void>();
  private search$ = new RxSubject<string>();

  constructor(
    private svc: EnergyDashboardService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    private auth: AuthService
  ) {}

  /** Export is its own grant — a company can have this page without being able to take data off it. */
  get canExport(): boolean { return this.auth.hasAction('analytics-energy', 'export'); }
  get canEditSettings(): boolean { return this.auth.hasAction('analytics-energy', 'settings'); }

  /** Open a tab; nothing is asked for that is already up to date. */
  setView(tab: string): void {
    if (tab === this.views.tab) return;
    this.errorMsg = '';
    this.views.show(tab);
    this.url.write(tab);
    this.cdr.markForCheck();
  }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.load();
  }

  ngOnDestroy(): void { this.views.cancel(); this.destroy$.next(); this.destroy$.complete(); }

  blankFilters() {
    const today = this.todayStr();
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    return { from: weekAgo, to: today, machine_id: null, search: '' };
  }

  onSearchInput(): void { this.search$.next(this.f.search); }
  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > (this.data?.machines?.totalPages || 1)) return;
    this.page = next;
    this.load();
  }

  /** Bring what is on screen up to date with the filters; the other tabs follow when they are opened. */
  load(): void {
    this.errorMsg = '';
    this.views.load();
    this.cdr.markForCheck();
  }

  /* What each part depends on: the tiles and charts on the filters (the
     machine search narrows the totals too); the table on those and its page. */
  partKeys(): Record<DashPart, string> {
    const shared = JSON.stringify(this.f);
    return { kpis: shared, charts: shared, table: JSON.stringify([shared, this.page, this.limit]) };
  }

  fetchParts(parts: DashPart[]) {
    const paging = parts.includes('table') ? { page: this.page, limit: this.limit } : {};
    return this.svc.getEnergy({ ...this.f, ...paging, part: parts.join(',') }).pipe(takeUntil(this.destroy$));
  }

  applyParts(parts: DashPart[], res: any, err?: any): boolean {
    if (!res || res.status !== 'success' || !res.data) {
      this.errorMsg = err?.error?.message || (err ? 'Unable to load energy data.' : 'No energy data available.');
      this.cdr.markForCheck();
      return false;
    }
    const d = res.data;
    const next: any = { ...(this.data ?? {}), currency: d.currency || 'INR', rate_per_kwh: d.rate_per_kwh ?? null };
    if (parts.includes('kpis')) {
      next.kpis = { total_kwh: null, total_operating_seconds: 0, total_produced: 0, kwh_per_part: null,
                    total_cost: null, overload_alerts: 0, ...(d.kpis ?? {}) };
      next.coverage = { machines: 0, reporting: 0, tariff_configured: false, note: '', ...(d.coverage ?? {}) };
    }
    if (parts.includes('charts')) Object.assign(next, this.normalise(d));
    if (parts.includes('table')) next.machines = { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d.machines ?? {}) };
    this.data = next;
    if (parts.includes('charts')) this.applyCharts(next);
    this.updatedAt = updatedLabel(d.updated_at);
    this.cdr.markForCheck();
    return true;
  }

  /** The charts' series: the same arrays while the figures are the same, so no chart is drawn again for nothing. */
  private applyCharts(d: any): void {

    /* keep(): the same arrays as last time when the figures are the same, so
       paging or searching the machine table redraws no chart. */
    this.trendCategories = this.charts.keep('trendCats', (d.trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })));
    this.trendSeries = this.charts.keep('trendSeries', [{ name: 'kWh', data: (d.trend || []).map((t: any) => t.kwh) }]);

    /* The five machines that used the most, over every machine — not the
       table's page. Only machines that report a counter are in it: a zero
       bar would read as a machine using no electricity. */
    const top = d.top_consumers || [];
    this.machineCategories = this.charts.keep('machineCats', top.map((m: any) => m.machine_serial_no));
    this.machineSeries = this.charts.keep('machineSeries', top.length ? [{ name: 'kWh', data: top.map((m: any) => m.kwh) }] : []);

    /* A donut needs a flat array of numbers, not a {name,data} series —
       passing the series shape renders an empty chart with no error. */
    this.shiftDonutSeries = this.charts.keep('shiftSeries', (d.by_shift || []).map((s: any) => Number(s.kwh) || 0));
    this.shiftTotal = this.shiftDonutSeries.reduce((a, b) => a + b, 0);

    this.buildCostTrend();
  }

  /** The charts' part, filled in where the payload is short. (The tiles and the table: applyParts.) */
  private normalise(d: any): any {
    return {
      trend:     d?.trend     ?? [],
      by_shift:  d?.by_shift  ?? [],
      by_month:  d?.by_month  ?? [],
      top_consumers: d?.top_consumers ?? [],
      overloads: d?.overloads ?? []
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
          a.href = url; a.download = `energy_${this.todayStr()}.${format}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.exporting = '';
          this.cdr.markForCheck();
          this.toast.error('No machines match these filters');
        }
      });
  }




  /* ── view helpers ── */

  /** True when not one machine reports a counter — a device gap, not an
   *  empty filter result, and worth saying plainly. */
  get noEnergyData(): boolean {
    return this.data?.coverage?.reporting === 0;
  }

  /** Unknown shows as a dash, never 0 — they are different claims. */
  num(v: number | null | undefined, unit = ''): string {
    return v === null || v === undefined ? '--' : `${qty(v, 3)}${unit}`;
  }

  /** "₹8,926" — rupees as the plant reads them; another currency by its code. */
  money(v: number | null | undefined, digits = 0): string {
    if (v === null || v === undefined) return '--';
    const cur = this.data?.currency || 'INR';
    return `${cur === 'INR' ? '₹' : cur + ' '}${qty(v, digits)}`;
  }

  /** An overload is only judged against a limit; 0 alerts with none set is no all-clear. */
  /** Judged over every machine (the server says), not just the page of the table on show. */
  get overloadLimitSet(): boolean {
    return !!this.data?.kpis?.overload_limit_set;
  }

  hours(seconds: number | null | undefined): string {
    const n = Number(seconds) || 0;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  private todayStr(): string {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString().split('T')[0];
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
    return {
      chart:  { type: 'area', height: 200, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 2, curve: 'smooth' },
      fill:   { type: 'gradient', gradient: { shadeIntensity: 0.3, opacityFrom: 0.35, opacityTo: 0.05 } },
      colors: ['#b45309'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'kWh' }, labels: { formatter: compactQty } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
      noData: { text: 'No machine is sending energy readings yet' }
    };
  }, this.charts.sig('trendCats') + this.charts.sig('trendSeries'));
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

  get machineChart(): any {
    return this.charts.memo('machineChart', () => {
    return {
      chart:  { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: '60%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: true, style: { fontSize: '.72rem', fontWeight: 700, colors: ['#fff'] } },
      // distributed repeats every machine in the legend; the axis names them
      legend: { show: false },
      xaxis:  { categories: this.machineCategories, title: { text: 'kWh' } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'light' },
      noData: { text: 'No machine is sending energy readings yet' }
    };
  }, this.charts.sig('machineCats') + this.charts.sig('machineSeries'));
  }

  get shiftDonut(): any {
    return this.charts.memo('shiftDonut', () => {
    return {
      chart: { type: 'donut', height: 200, fontFamily: 'inherit' },
      labels: (this.data?.by_shift || []).map((s: any) => s.shift_name),
      colors: this.palette,
      plotOptions: {
        pie: { donut: { size: '66%', labels: {
          show: true,
          total: { show: true, label: 'kWh', fontSize: '.8rem',
                   formatter: () => this.shiftTotal.toFixed(0) }
        } } }
      },
      dataLabels: { enabled: false },
      // the key list beside the donut already names every shift
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} kWh` } },
      noData: { text: 'Nothing recorded by shift' }
    };
  }, JSON.stringify(this.data?.by_shift ?? []));
  }

  /** Energy Cost Trend grouping: the design's Day | Week | Month. */
  costBy: 'day' | 'week' | 'month' = 'day';
  readonly costPeriods = [
    { key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }
  ] as const;

  /** Regroups the figures already loaded: no request, and no other chart is redrawn. */
  setCostBy(p: 'day' | 'week' | 'month'): void {
    if (p === this.costBy) return;
    this.costBy = p;
    this.buildCostTrend();
    this.cdr.markForCheck();
  }

  /* Priced at the company tariff when one is set; otherwise the bars are kWh
     and say so. It used to plot kWh under a "Cost" title. Days come from the
     daily trend, weeks are those days summed, months are the API's own. */
  private buildCostTrend(): void {
    const d = this.data;
    const rate = d?.rate_per_kwh ?? null;
    const price = (kwh: number) => rate != null ? Number((kwh * rate).toFixed(2)) : Number(kwh.toFixed(2));
    let rows: { label: string; kwh: number }[] = [];
    if (this.costBy === 'month') {
      rows = (d?.by_month || []).map((m: any) => ({
        label: new Date(m.month).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), kwh: Number(m.kwh) || 0 }));
    } else {
      const days = (d?.trend || []).filter((t: any) => t.machines > 0);
      if (this.costBy === 'day') {
        rows = days.map((t: any) => ({ label: new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), kwh: Number(t.kwh) || 0 }));
      } else {
        const weeks = new Map<string, number>();
        for (const t of days) {
          const dt = new Date(t.day);
          const monday = new Date(dt); monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
          const key = monday.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
          weeks.set(key, (weeks.get(key) || 0) + (Number(t.kwh) || 0));
        }
        rows = [...weeks.entries()].map(([label, kwh]) => ({ label: `Wk ${label}`, kwh }));
      }
    }
    this.monthCategories = this.charts.keep('monthCats', rows.map(r => r.label));
    this.monthSeries = this.charts.keep('monthSeries',
      rows.length ? [{ name: rate != null ? 'Cost' : 'kWh', data: rows.map(r => price(r.kwh)) }] : []);
  }

  /** "↑ 12.5%" / "↓ 3.4%". */
  change(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return `${v > 0 ? '↑' : v < 0 ? '↓' : ''} ${Math.abs(v)}%`;
  }

  get monthChart(): any {
    return this.charts.memo('monthChart', () => {
    return {
      chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '50%', distributed: true } },
      colors: this.palette,
      dataLabels: { enabled: false },
      legend: { show: false },
      xaxis: { categories: this.monthCategories },
      yaxis: { title: { text: this.data?.rate_per_kwh != null ? `Cost (${this.data?.currency || 'INR'})` : 'kWh' },
               labels: { formatter: compactQty } },
      grid:  { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'light', y: { formatter: (v: number) => this.data?.rate_per_kwh != null ? this.money(v) : `${qty(v, 1)} kWh` } },
      noData: { text: 'Nothing recorded for this period' }
    };
  }, `${this.costBy}|${this.data?.rate_per_kwh}|${this.charts.sig('monthCats')}|${this.charts.sig('monthSeries')}`);
  }
}
