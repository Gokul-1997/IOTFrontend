import { Component, OnInit, OnDestroy, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, takeUntil, catchError, of } from 'rxjs';
import { OeeDashboardService } from './oee-dashboard.service';
import { ThemeService } from '../../core/services/theme.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 8 — OEE Dashboard

   OEE here is recomputed from totals rather than averaged from the
   stored hourly values. Averaging a ratio across hours with different
   denominators does not give the ratio for the period, and an hour with
   no production scores zero on performance and quality — so averaging
   reports 0% for a fleet that is genuinely running at 19%.

   Where a cycle time is missing, performance and OEE are null rather
   than zero. Zero is a judgement about the machine; null is the truth
   about our configuration.

   Layout (2026-09-24): the KPI row; "Where OEE is lost" beside the
   trend; then every machine as a tile. Two charts that repeated the
   tiles (Machines by OEE, and A/P/Q by machine) are gone — the tiles
   carry the same figures, ranked, with Top 5 / Bottom 5 views.
───────────────────────────────────────────────────────────── */

/** One OEE loss, in percentage points of planned time. */
interface Loss { key: 'a' | 'p' | 'q'; name: string; label: string; note: string; verdict: string; pts: number; }

@Component({
  selector: 'app-oee-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './oee-dashboard.component.html'
})
export class OeeDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  machines: any[] = [];
  shifts: any[] = [];
  f: any = this.blankFilters();
  page = 1;
  /* Every machine in one response: the tiles page through them on screen. */
  readonly limit = 200;

  /** Machine tiles: all of them ten to a page, or the design's Top 5 / Bottom 5. */
  readonly cardsPerPage = 10;
  cardPage = 1;
  machineView: 'all' | 'top' | 'bottom' = 'all';

  data: any = null;
  loading = false;
  errorMsg = '';
  updatedAt = '';

  trendSeries: any[] = [];
  trendCategories: string[] = [];

  /** Where the planned time went: good output, then the three losses. */
  loss: { oee: number; items: Loss[]; biggest: Loss } | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private svc: OeeDashboardService,
    private theme: ThemeService,
    private cdr: ChangeDetectorRef
  ) {
    /* The trend's OEE line is navy, which disappears on the dark ground;
       rebuild the chart options whenever the theme flips. */
    effect(() => {
      this.theme.isDark();
      this.charts.bump();
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];
        this.cdr.markForCheck();
      });

    this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  blankFilters() {
    return { from: this.istDate(-6), to: this.istDate(0), machine_id: null, shift_id: null };
  }

  submit(): void { this.page = 1; this.load(); }
  reset(): void { this.f = this.blankFilters(); this.page = 1; this.load(); }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.svc.getOee({ ...this.f, page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load OEE data.';
        return of(null);
      }))
      .subscribe(res => this.apply(res));
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;
    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No OEE data available.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = this.normalise(res.data);
    this.updatedAt = d.updated_at ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true }) : '';

    this.trendCategories = (d.trend || []).map((t: any) =>
      new Date(t.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    // each day worked out from its own totals by the API. Drawn whenever any
    // factor has a value: availability is worth seeing even on days when no
    // machine had a cycle time and OEE itself could not be computed.
    const series = (name: string, key: string) => ({ name, data: (d.trend || []).map((t: any) => t[key] ?? null) });
    const keys = ['oee_pct', 'availability_pct', 'performance_pct', 'quality_pct'];
    this.trendSeries = (d.trend || []).some((t: any) => keys.some(k => t[k] != null)) ? [
      series('OEE', 'oee_pct'),
      series('Availability', 'availability_pct'),
      series('Performance', 'performance_pct'),
      series('Quality', 'quality_pct')
    ] : [];

    this.loss = this.lossBreakdown(d.kpis);
    this.cardPage = 1;
    this.cdr.markForCheck();
  }

  /**
   * OEE = Availability × Performance × Quality, so the planned time splits
   * exactly into four parts that sum to 100: what availability lost, what
   * performance lost of the time that was left, what quality lost of the
   * output, and the good output that remains. The fleet figures are the
   * API's own (fleetOee), so this agrees with the KPI row to the decimal.
   */
  private lossBreakdown(k: any): { oee: number; items: Loss[]; biggest: Loss } | null {
    const A = k?.availability_pct, P = k?.performance_pct, Q = k?.quality_pct;
    if (A == null || P == null || Q == null) return null;
    const a = A / 100, p = P / 100, q = Q / 100;

    /* Planned time not running is idle time (on, not cutting — the Total
       Downtime card) plus time the machine was off or not reporting. Both
       figures are on screen, so the note says how one becomes the other. */
    const notRunning = Math.max(0, (Number(k.planned_seconds) || 0) - (Number(k.run_seconds) || 0));
    const idle = Math.min(notRunning, Number(k.idle_seconds) || 0);
    const off = notRunning - idle;
    const split = off >= 3600 ? ` (${this.longHours(idle)} idle, ${this.longHours(off)} off or not reporting)` : '';
    const items: Loss[] = [
      { key: 'a', name: 'Availability', label: 'Availability loss',
        note: notRunning ? `Planned but not running: ${this.longHours(notRunning)}${split}` : 'Planned but not running',
        verdict: `the machines were not running for ${Math.round((1 - a) * 100)}% of their planned time.`,
        pts: (1 - a) * 100 },
      { key: 'p', name: 'Performance', label: 'Performance loss',
        note: 'Running slower than the ideal cycle time',
        verdict: `while running, the machines made ${Math.round((1 - p) * 100)}% fewer parts than their cycle times allow.`,
        pts: a * (1 - p) * 100 },
      { key: 'q', name: 'Quality', label: 'Quality loss',
        note: `${(Number(k.rejected) || 0).toLocaleString('en-IN')} parts rejected`,
        verdict: `${Math.round((1 - q) * 100)}% of the parts made were rejected.`,
        pts: a * p * (1 - q) * 100 }
    ];
    const biggest = items.reduce((m, i) => (i.pts > m.pts ? i : m));
    return { oee: a * p * q * 100, items, biggest };
  }

  private normalise(d: any): any {
    return {
      ...d,
      thresholds: { good: 85, fair: 60, ...(d?.thresholds ?? {}) },
      kpis: {
        availability_pct: null, performance_pct: null, quality_pct: null, oee_pct: null,
        band: 'UNKNOWN', produced: 0, good: 0, rejected: 0,
        run_seconds: 0, planned_seconds: 0, idle_seconds: 0, downtime_seconds: 0, alarm_count: 0,
        machines_measurable: 0, machines_total: 0, ...(d?.kpis ?? {})
      },
      coverage: { machines: 0, with_cycle_time: 0, oee_computable: 0, note: '', ...(d?.coverage ?? {}) },
      status_counts: { RUNNING: 0, IDLE: 0, ALARM: 0, OFFLINE: 0, ...(d?.status_counts ?? {}) },
      trend:           d?.trend           ?? [],
      machines: { data: [], total: 0, page: 1, limit: this.limit, totalPages: 1, ...(d?.machines ?? {}) }
    };
  }

  /* ── machine tiles ──
     The API sends them best OEE first, machines with no OEE last. Top 5 and
     Bottom 5 rank only machines with an OEE: a machine with no cycle time
     is not the worst machine, it is an unconfigured one. */
  private get measured(): any[] {
    return (this.data?.machines?.data || []).filter((m: any) => m.oee_pct !== null && m.oee_pct !== undefined);
  }

  get pageCards(): any[] {
    if (this.machineView === 'top') return this.measured.slice(0, 5);
    if (this.machineView === 'bottom') return [...this.measured].reverse().slice(0, 5);
    const rows = this.data?.machines?.data || [];
    return rows.slice((this.cardPage - 1) * this.cardsPerPage, this.cardPage * this.cardsPerPage);
  }

  get cardTotalPages(): number {
    return Math.max(1, Math.ceil((this.data?.machines?.data?.length || 0) / this.cardsPerPage));
  }

  cardGo(p: number): void { this.cardPage = Math.min(Math.max(1, p), this.cardTotalPages); this.cdr.markForCheck(); }

  setView(v: 'all' | 'top' | 'bottom'): void {
    this.machineView = v;
    this.cardPage = 1;
    this.cdr.markForCheck();
  }

  /* ── view helpers ── */

  /** Unknown shows as a dash, never 0% — they are different claims. */
  pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '--' : `${v}%`;
  }

  /** A gap in percentage points: "61 pts". */
  pts(v: number): string {
    return `${Math.abs(Number(v.toFixed(1)))} pts`;
  }

  /** "1,594 h 15 m" — the fleet total over a week, readable at a glance. */
  longHours(seconds: number | null | undefined): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60);
    if (!h) return `${m} m`;
    return `${h.toLocaleString('en-IN')} h ${m} m`;
  }

  /** HH:MM:SS, hours running past 24, as the design writes durations. */
  hms(seconds: number | null | undefined): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
  }

  /** "↑ 3.18%" / "↓ 1.32%" from a signed change in percentage points. */
  change(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return `${v > 0 ? '↑' : v < 0 ? '↓' : ''} ${Math.abs(v)}%`;
  }

  statusWord(s: string): string {
    return ({ RUNNING: 'Running', IDLE: 'Idle', ALARM: 'Alarm', OFFLINE: 'Offline' } as any)[s] || 'Offline';
  }
  /** The same four colours as the status chips in the title bar. */
  statusDot(s: string): string {
    return ({ RUNNING: '#22c55e', IDLE: '#f5a623', ALARM: '#e03131' } as any)[s] || '#94a3b8';
  }

  /** How far average OEE sits from the target, or null when unmeasured. */
  get gapToTarget(): number | null {
    const oee = this.data?.kpis?.oee_pct;
    const target = this.data?.thresholds?.good;
    if (oee === null || oee === undefined || target === undefined) return null;
    return Number((oee - target).toFixed(2));
  }

  /* ── the design's four grades, on OEE ──
     > 85 Excellent · 75–85 Good · 60–75 Avg · < 60 Needs Improvement */
  grade(m: any): string {
    const v = m?.oee_pct;
    if (v === null || v === undefined) return 'UNKNOWN';
    return v >= 85 ? 'EXCELLENT' : v >= 75 ? 'GOOD' : v >= 60 ? 'AVG' : 'POOR';
  }
  gradeTile(g: string): string {
    return ({ EXCELLENT: 'mexa-grade-excellent', GOOD: 'mexa-grade-good', AVG: 'mexa-grade-avg', POOR: 'mexa-grade-poor' } as any)[g] || 'mexa-grade-unknown';
  }
  gradeWord(g: string): string {
    return ({ EXCELLENT: 'Excellent', GOOD: 'Good', AVG: 'Avg', POOR: 'Needs Improvement' } as any)[g] || 'No cycle time';
  }

  /** A date in plant time, `offset` days from today. Converting back through
   *  toISOString() gave yesterday's date before 05:30 IST. */
  private istDate(offset: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
      .format(new Date(Date.now() + offset * 86_400_000));
  }

  get trendChart(): any {
    return this.charts.memo('trendChart', () => {
      const dark = this.theme.isDark();
      const oee = dark ? '#8b88f0' : '#2f2d8f';
      const target = this.data?.thresholds?.good ?? 85;
      const fmt = (v: number | null) => (v == null ? '--' : `${v}%`);
      return {
        chart:  { type: 'line', height: 300, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
        // OEE is the line being read; the three factors sit behind it, thinner
        stroke: { width: [3, 1.75, 1.75, 1.75], curve: 'straight' },
        markers: { size: [5, 0, 0, 0], hover: { size: 6 } },
        colors: [oee, '#17b3a3', '#3b9ae1', '#9b7ec8'],
        dataLabels: { enabled: true, enabledOnSeries: [0], formatter: (v: number | null) => (v == null ? '' : `${v}%`),
                      offsetY: -7, background: { enabled: false }, style: { fontSize: '.72rem', colors: [oee] } },
        legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '12px' },
        annotations: {
          yaxis: [{
            y: target, borderColor: '#15803d', strokeDashArray: 5,
            label: { text: `Target ${target}%`, position: 'left', textAnchor: 'start', offsetX: 6,
                     borderColor: '#15803d',
                     style: { background: '#15803d', color: '#fff', fontSize: '11px', fontWeight: 600 } }
          }]
        },
        xaxis:  { categories: this.trendCategories },
        yaxis:  { min: 0, max: 100, tickAmount: 5, labels: { formatter: (v: number) => `${v?.toFixed(0)}%` } },
        grid:   { borderColor: 'rgba(148,163,184,.25)' },
        tooltip:{ theme: 'dark', shared: true, intersect: false, y: { formatter: fmt } },
        noData: { text: 'No production recorded for this period' }
      };
    });
  }
}
