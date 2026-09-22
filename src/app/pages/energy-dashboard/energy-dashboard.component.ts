import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of, Subject as RxSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { EnergyDashboardService } from './energy-dashboard.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 9 — Energy Monitoring

   Devices report energy as a cumulative kWh counter, so consumption is
   a difference between readings, never a sum of them. No machine sends
   that counter yet, so this screen reports "not reporting" rather than
   zeros that would read as a remarkably efficient factory.
───────────────────────────────────────────────────────────── */

@Component({
  selector: 'app-energy-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './energy-dashboard.component.html'
})
export class EnergyDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  machines: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  readonly limit = 20;

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';
  exporting = '';

  showSettings = false;
  savingSettings = false;
  settingsForm: any = { machine_id: null, cost_per_kwh: null, currency: 'INR', overload_kw: null };
  settings: any[] = [];

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

  /** Open Tariff & limits and bring it into view — it sits below the machine
   *  table, so opening it without scrolling looked like nothing happened. */
  openSettings(): void {
    this.showSettings = true;
    this.cdr.detectChanges();
    document.getElementById('energySettings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => { this.machines = res?.data?.machines ?? []; this.cdr.markForCheck(); });

    this.search$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page = 1; this.load(); });

    this.loadSettings();
    this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

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

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getEnergy({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load energy data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No energy data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';

    this.trendCategories = (d.trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    this.trendSeries = [{ name: 'kWh', data: (d.trend || []).map((t: any) => t.kwh) }];

    /* Only machines that actually report a counter go on the chart —
       plotting a non-reporting machine as a zero bar would read as a
       machine using no electricity. */
    const reporting = (d.machines?.data || []).filter((m: any) => m.kwh !== null);
    this.machineCategories = reporting.map((m: any) => m.machine_serial_no);
    this.machineSeries = [{ name: 'kWh', data: reporting.map((m: any) => m.kwh) }];

    /* A donut needs a flat array of numbers, not a {name,data} series —
       passing the series shape renders an empty chart with no error. */
    this.shiftDonutSeries = (d.by_shift || []).map((s: any) => Number(s.kwh) || 0);
    this.shiftTotal = this.shiftDonutSeries.reduce((a, b) => a + b, 0);

    this.buildCostTrend();

    this.cdr.markForCheck();
  }

  private normalise(d: any): any {
    return {
      ...d,
      currency: d?.currency || 'INR',
      kpis: {
        total_kwh: null, total_operating_seconds: 0, total_produced: 0,
        kwh_per_part: null, total_cost: null, overload_alerts: 0, ...(d?.kpis ?? {})
      },
      coverage: { machines: 0, reporting: 0, tariff_configured: false, note: '', ...(d?.coverage ?? {}) },
      trend:     d?.trend     ?? [],
      by_shift:  d?.by_shift  ?? [],
      by_month:  d?.by_month  ?? [],
      top_consumers: d?.top_consumers ?? [],
      overloads: d?.overloads ?? [],
      machines: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.machines ?? {}) }
    };
  }

  loadSettings(): void {
    this.svc.getSettings()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => { this.settings = res?.data ?? []; this.cdr.markForCheck(); });
  }

  saveSettings(): void {
    this.savingSettings = true;
    this.cdr.markForCheck();
    this.svc.saveSettings(this.settingsForm)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingSettings = false;
          this.toast.success('Energy settings saved');
          this.loadSettings();
          this.load();
        },
        error: err => {
          this.savingSettings = false;
          this.cdr.markForCheck();
          this.toast.error(err?.error?.message || 'Could not save the settings');
        }
      });
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
    return !!this.data && this.data.coverage.reporting === 0;
  }

  /** Unknown shows as a dash, never 0 — they are different claims. */
  num(v: number | null | undefined, unit = ''): string {
    return v === null || v === undefined ? '--' : `${v}${unit}`;
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
      chart:  { type: 'area', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 2, curve: 'smooth' },
      fill:   { type: 'gradient', gradient: { shadeIntensity: 0.3, opacityFrom: 0.35, opacityTo: 0.05 } },
      colors: ['#b45309'],
      dataLabels: { enabled: false },
      xaxis:  { categories: this.trendCategories },
      yaxis:  { title: { text: 'kWh' }, labels: { formatter: (v: number) => v?.toFixed(1) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark' },
      noData: { text: 'No machine is reporting an energy counter yet' }
    };
  });
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
      tooltip:{ theme: 'dark' },
      noData: { text: 'No machine is reporting an energy counter yet' }
    };
  });
  }

  get shiftDonut(): any {
    return this.charts.memo('shiftDonut', () => {
    return {
      chart: { type: 'donut', height: 260, fontFamily: 'inherit' },
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
  });
  }

  /** Energy Cost Trend grouping: the design's Day | Week | Month. */
  costBy: 'day' | 'week' | 'month' = 'day';

  setCostBy(p: string): void {
    this.costBy = p as any;
    this.buildCostTrend();
    this.charts.bump();
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
    this.monthCategories = rows.map(r => r.label);
    this.monthSeries = rows.length ? [{ name: rate != null ? 'Cost' : 'kWh', data: rows.map(r => price(r.kwh)) }] : [];
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
      yaxis: { title: { text: this.data?.rate_per_kwh != null ? `Cost (${this.data?.currency || 'INR'})` : 'kWh' } },
      grid:  { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark' },
      noData: { text: 'Nothing recorded by month' }
    };
  });
  }
}
