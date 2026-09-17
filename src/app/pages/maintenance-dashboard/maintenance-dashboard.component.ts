import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, interval, startWith, switchMap, takeUntil, catchError, of } from 'rxjs';
import { MaintenanceDashboardService } from './maintenance-dashboard.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';

/* ─────────────────────────────────────────────────────────────
   Phase 2 · Screen 2 — Maintenance Dashboard

   Machine-condition view over GET /dashboard/maintenance,
   filterable by Shift / Machine / Date.

   Servo load per axis, servo and spindle temperature, encoder
   temperature, batteries, insulation resistance and fans come from
   the FOCAS collector (migration 021). Controllers differ in what
   they supply — some report a temperature for one servo only — so
   every per-axis value is independently nullable and shows as "--",
   never as 0. The API names the signals no machine has reported in
   `unavailable`, measured from the data rather than declared.
───────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;

/** API key → the words a maintenance engineer would use. */
const SIGNAL_LABELS: Record<string, string> = {
  servo_load_per_axis:   'Servo load per axis',
  servo_temperature:     'Servo motor temperature',
  spindle_temperature:   'Spindle motor temperature',
  encoder_temperature:   'Encoder temperature',
  battery_status:        'CNC / APC battery voltage',
  insulation_resistance: 'Insulation resistance',
  fan_amplifier_status:  'Cooling fan & amplifier status'
};

@Component({
  selector: 'app-maintenance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent],
  templateUrl: './maintenance-dashboard.component.html'
})
export class MaintenanceDashboardComponent implements OnInit, OnDestroy {

  /** Chart options keep the same reference until apply() bumps this. */
  private charts = new ChartMemo();

  /* ── filters ── */
  machines: any[] = [];
  shifts:   any[] = [];
  selectedMachine: number | null = null;
  selectedShift:   number | null = null;
  selectedDate = this.todayStr();
  today        = this.todayStr();

  /* ── state ── */
  data: any = null;
  loading   = false;
  errorMsg  = '';
  updatedAt = '';

  /* ── chart ── */
  cycleSeries:     any[] = [];
  cycleCategories: string[] = [];
  alarmSeries:     number[] = [];
  spindleSeries:   number[] = [];

  /* Machine condition for the machine the card describes. Built once per
     response rather than in getters, so change detection does not hand the
     charts a fresh array — and a redraw — on every pass. */
  servoLoadAxes:   { axis: string; value: number | null }[] = [];
  servoTempAxes:   { axis: string; value: number | null }[] = [];
  encoderTempAxes: { axis: string; value: number | null }[] = [];
  servoLoadSeries: any[] = [];
  servoTempSeries: any[] = [];
  servoTempMissing = '';
  hasEncoderTemp   = false;
  fanList: { name: string; value: string }[] = [];
  conditionCategories: string[] = [];
  /* One row per axis. The three per-axis readings were three separate
     charts of three numbers each; as rows they compare across the axis,
     which is the question a maintenance engineer actually has. */
  axisRows: { axis: string; load: number | null; temp: number | null; encoder: number | null }[] = [];
  tempTrendSeries: any[] = [];
  irTrendSeries:   any[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private svc: MaintenanceDashboardService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.svc.getMeta()
      .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe(res => {
        this.machines = res?.data?.machines ?? [];
        this.shifts   = res?.data?.shifts   ?? [];

        /* This screen describes the condition of ONE machine: a servo
           temperature averaged over a fleet describes no motor, and the API
           only returns a condition trend when a machine is named — so with
           "All" selected the trend cards were permanently empty. A machine is
           therefore always selected, the first one until the user picks
           another. */
        if (this.selectedMachine === null && this.machines.length) {
          this.selectedMachine = this.machines[0].id;
        }
        this.cdr.markForCheck();
        this.startPolling();
      });
  }

  /* Polling starts only once the default machine is known, so the first
     request is already scoped to it rather than fetching the whole fleet and
     then immediately refetching. */
  private polling = false;
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    interval(POLL_MS)
      .pipe(startWith(0), switchMap(() => this.fetch$()), takeUntil(this.destroy$))
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    this.fetch$().pipe(takeUntil(this.destroy$)).subscribe(res => this.apply(res));
  }

  reset(): void {
    this.selectedMachine = this.machines[0]?.id ?? null;
    this.selectedShift   = null;
    this.selectedDate    = this.todayStr();
    this.submit();
  }

  private fetch$() {
    this.loading  = true;
    this.errorMsg = '';
    this.cdr.markForCheck();
    return this.svc.getMaintenance({
      date:       this.selectedDate,
      shift_id:   this.selectedShift,
      machine_id: this.selectedMachine
    }).pipe(
      catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load the maintenance dashboard.';
        return of(null);
      })
    );
  }

  private apply(res: any): void {
    this.charts.bump();
    this.loading = false;

    if (!res || res.status !== 'success' || !res.data) {
      if (!this.errorMsg) this.errorMsg = 'No maintenance data available for this selection.';
      this.cdr.markForCheck();
      return;
    }

    const d = this.data = res.data;
    this.updatedAt = d.updated_at
      ? new Date(d.updated_at).toLocaleString('en-IN', { hour12: true })
      : '';

    const trend = d.cycle_time_trend || [];
    this.cycleCategories = trend.map((t: any) => this.hourLabel(t.hour_start));
    // null for hours with no production — Apex leaves a gap rather than
    // dropping the line to zero, which would read as an impossibly fast cycle
    this.cycleSeries = [{
      name: 'Avg cycle time (s)',
      data: trend.map((t: any) => t.avg_cycle_seconds ?? null)
    }];

    /* Donuts and gauges take a flat number array; the {name,data} series
       shape renders an empty chart with no error. */
    this.alarmSeries = [
      Number(d.alarms.critical) || 0,
      Number(d.alarms.non_critical) || 0,
      Number(d.alarms.information) || 0
    ];

    /* A spindle at 0% and a spindle with no sensor look identical on a
       gauge, so an absent reading gets no gauge at all. */
    const load = this.focusRow?.spindle_load;
    this.spindleSeries = load === null || load === undefined ? [] : [Number(load)];

    const axes = (prefix: string) => ['x', 'y', 'z'].map(a => ({
      axis: a.toUpperCase(),
      value: (this.focusRow?.[`${prefix}_${a}`] ?? null) as number | null
    }));
    const hasAny = (list: { value: number | null }[]) => list.some(a => a.value !== null);

    this.servoLoadAxes = axes('servo_load');
    this.servoLoadSeries = hasAny(this.servoLoadAxes)
      ? [{ name: 'Load %', data: this.servoLoadAxes.map(a => a.value) }] : [];

    this.servoTempAxes = axes('servo_temp');
    this.servoTempSeries = hasAny(this.servoTempAxes)
      ? [{ name: 'Temperature °C', data: this.servoTempAxes.map(a => a.value) }] : [];
    /* Some controllers report a temperature for one servo only. The silent
       axes are named in words rather than drawn as 0 °C. */
    this.servoTempMissing = hasAny(this.servoTempAxes)
      ? this.servoTempAxes.filter(a => a.value === null).map(a => a.axis).join(', ') : '';

    this.encoderTempAxes = axes('encoder_temp');
    this.hasEncoderTemp  = hasAny(this.encoderTempAxes);

    this.axisRows = ['X', 'Y', 'Z'].map((axis, i) => ({
      axis,
      load:    this.servoLoadAxes[i]?.value   ?? null,
      temp:    this.servoTempAxes[i]?.value   ?? null,
      encoder: this.encoderTempAxes[i]?.value ?? null
    }));

    const fans = this.focusRow?.fan_status;
    this.fanList = fans && typeof fans === 'object' && !Array.isArray(fans)
      ? Object.entries(fans).map(([k, v]) => ({ name: k.replace(/_/g, ' '), value: String(v) }))
      : [];

    /* Condition trend exists only when one machine is selected — averaging
       servo temperatures across a fleet describes no motor. A series is
       drawn only if it has at least one reading in the window. */
    const ct = d.condition_trend || [];
    this.conditionCategories = ct.map((t: any) => this.hourLabel(t.hour_start));
    const lines = (defs: [string, string][]) => defs
      .filter(([, key]) => ct.some((t: any) => t[key] != null))
      .map(([name, key]) => ({ name, data: ct.map((t: any) => t[key] ?? null) }));
    this.tempTrendSeries = lines([
      ['Servo X', 'servo_temp_x'], ['Servo Y', 'servo_temp_y'],
      ['Servo Z', 'servo_temp_z'], ['Spindle', 'spindle_motor_temp']
    ]);
    this.irTrendSeries = lines([
      ['IR X', 'servo_insulation_res_x'], ['IR Y', 'servo_insulation_res_y'],
      ['IR Z', 'servo_insulation_res_z']
    ]);

    this.cdr.markForCheck();
  }

  /* ── view helpers ── */

  /** The machine the detail card describes: the filtered one, else the
   *  first that is actually reporting, else the first row. */
  get focusRow(): any {
    return this.charts.memo('focusRow', () => {
    const rows = this.data?.rows || [];
    if (!rows.length) return null;
    /* The machine the data was loaded for, not the dropdown: a user who picks
       another machine but has not pressed Submit must not see this card
       relabel itself over the previous machine's readings. */
    const loadedFor = this.data?.filters?.machine_id ?? null;
    if (loadedFor) {
      return rows.find((r: any) => r.machine_id === loadedFor) || null;
    }
    return rows.find((r: any) => r.received_at) || rows[0];
  });
  }

  /** An hour label, or blank. A malformed timestamp must never reach a
   *  shop-floor display as the words "Invalid Date". */
  private hourLabel(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /** Whether any axis reported anything at all. */
  get hasAxisData(): boolean {
    return this.axisRows.some(r => r.load !== null || r.temp !== null || r.encoder !== null);
  }

  /** Servo load as a share of full load, for the inline meter. */
  loadPct(v: number | null): number {
    return v === null || v === undefined ? 0 : Math.max(0, Math.min(100, Number(v)));
  }

  /** The trend card only earns its space when a line can be drawn. */
  get hasConditionTrend(): boolean {
    return this.tempTrendSeries.length > 0 || this.irTrendSeries.length > 0;
  }

  /** The serial of the machine on screen, for the title bar. */
  get focusName(): string {
    return this.focusRow?.machine_serial_no
      || this.machines.find(m => m.id === this.selectedMachine)?.machine_serial_no
      || '';
  }

  /** Unmeasured shows as a dash, never 0% — they are different claims. */
  pct(v: number | null | undefined): string {
    if (v === null || v === undefined) return '--';
    const n = Number(v);
    // the OEE view returns fractions; the tiles show percentages
    return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
  }

  /* MEXA pill classes. statusClass below is left for any call site still
     using the Tailwind variants. */
  statusBadge(s: string): string {
    switch (s) {
      case 'RUNNING':   return 'mexa-badge-good';
      case 'IDLE':      return 'mexa-badge-warn';
      case 'BREAKDOWN': return 'mexa-badge-bad';
      default:          return 'mexa-badge-neutral';
    }
  }

  statusWord(s: string): string {
    return s ? s.charAt(0) + s.slice(1).toLowerCase() : '--';
  }

  get alarmDonut(): any {
    return this.charts.memo('alarmDonut', () => {
    return {
      chart: { type: 'donut', height: 240, fontFamily: 'inherit' },
      labels: ['Critical', 'Non critical', 'Information'],
      colors: ['#e03131', '#22c55e', '#f5a623'],
      plotOptions: {
        pie: { donut: { size: '64%', labels: {
          show: true,
          total: { show: true, label: 'Total Alarms', fontSize: '.75rem',
                   formatter: () => String(this.data?.alarms?.total ?? 0) }
        } } }
      },
      dataLabels: { enabled: true, formatter: (_v: number, o: any) => String(o.w.config.series[o.seriesIndex]) },
      // the key list beside the donut already names every class
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this window' }
    };
  });
  }

  get spindleGauge(): any {
    return this.charts.memo('spindleGauge', () => {
    const load = Number(this.spindleSeries[0] ?? 0);
    return {
      chart: { type: 'radialBar', height: 215, fontFamily: 'inherit' },
      labels: ['Spindle Load'],
      // the band the reading falls in, so colour and number agree
      colors: [load >= 85 ? '#e03131' : load >= 60 ? '#f5a623' : '#22c55e'],
      plotOptions: {
        radialBar: {
          hollow: { size: '62%' },
          track: { background: 'rgba(148,163,184,.22)' },
          dataLabels: {
            name: { fontSize: '.8rem', offsetY: 18 },
            value: { fontSize: '1.6rem', fontWeight: 700, offsetY: -12,
                     formatter: (v: number) => `${Math.round(v)}%` }
          }
        }
      },
      stroke: { lineCap: 'round' },
      legend: { show: false },
      noData: { text: 'Not reporting' }
    };
  });
  }

/** A reading with its unit, or a dash. A missing sensor is never "0". */
  reading(v: number | null | undefined, unit: string, digits = 1): string {
    if (v === null || v === undefined) return '--';
    const n = Number(v);
    if (!Number.isFinite(n)) return '--';
    return unit ? `${n.toFixed(digits)} ${unit}` : n.toFixed(digits);
  }

  private trendOptions(unit: string, colors: string[]): any {
    return {
      chart: { type: 'line', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 3 },
      colors,
      dataLabels: { enabled: false },
      legend: { position: 'bottom' },
      xaxis: { categories: this.conditionCategories, title: { text: 'Hour' } },
      yaxis: { title: { text: unit }, labels: { formatter: (v: number) => v == null ? '' : v.toFixed(0) } },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark', y: { formatter: (v: number | null) => v == null ? 'no reading' : `${v} ${unit}` } },
      noData: { text: 'No reading in this window' }
    };
  }

  get tempTrendChart(): any {
    return this.charts.memo('tempTrendChart', () => { return this.trendOptions('°C', ['#2f2d8f', '#4a76c8', '#9b7ec8', '#e8618c']); });
  }
  get irTrendChart(): any   {
    return this.charts.memo('irTrendChart', () => { return this.trendOptions('Resistance', ['#4a76c8', '#2f2d8f', '#9b7ec8']); });
  }

  get hasCycleData(): boolean {
    return this.cycleSeries.some(s => (s.data || []).some((v: number | null) => v != null));
  }

  /** Signals the API says it cannot supply, in readable form. */
  get missingSignals(): string[] {
    return (this.data?.unavailable || []).map((k: string) => SIGNAL_LABELS[k] || k);
  }

  /** Seconds → "8h 12m", the format the shop floor reads fastest. */
  hm(seconds: number | null | undefined): string {
    const s = Number(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** A machine's state, derived the same way the API counts it. */
  rowStatus(r: any): 'RUNNING' | 'IDLE' | 'BREAKDOWN' | 'OFFLINE' {
    if (!r.received_at) return 'OFFLINE';
    const ageSec = (Date.now() - new Date(r.received_at).getTime()) / 1000;
    if (ageSec > 60) return 'OFFLINE';
    if (r.alarm) return 'BREAKDOWN';
    return String(r.machine_status).toUpperCase() === 'RUNNING' ? 'RUNNING' : 'IDLE';
  }

  /* Badge styling. Colour is never the only cue — the badge always carries
     its own text label, so this is reinforcement, not meaning. */
  statusClass(s: string): string {
    switch (s) {
      case 'RUNNING':   return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'IDLE':      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'BREAKDOWN': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:          return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    }
  }

  /** Health band. Paired with the number itself, never colour alone. */
  healthClass(percent: number): string {
    if (percent >= 85) return 'text-emerald-600 dark:text-emerald-400';
    if (percent >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  }

  private todayStr(): string {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    ).toISOString().split('T')[0];
  }

  get cycleChart(): any {
    return this.charts.memo('cycleChart', () => {
    return {
      chart:  { type: 'line', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      stroke: { width: 3, curve: 'smooth' },
      colors: ['#2563eb'],
      dataLabels: { enabled: false },
      markers: { size: 3 },
      xaxis:  { categories: this.cycleCategories, title: { text: 'Hour' } },
      yaxis:  { title: { text: 'Seconds per part' }, labels: { formatter: (v: number) => v?.toFixed(0) } },
      grid:   { borderColor: 'rgba(148,163,184,.25)' },
      tooltip:{ theme: 'dark', y: { formatter: (v: number) => v == null ? 'no production' : `${v.toFixed(1)} s` } },
      noData: { text: 'No production in this window' }
    };
  });
  }
}
