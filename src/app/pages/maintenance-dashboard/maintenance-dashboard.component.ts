import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgApexchartsModule } from 'ng-apexcharts';
import { Subject, interval, startWith, switchMap, takeUntil, catchError, of } from 'rxjs';
import { MaintenanceDashboardService } from './maintenance-dashboard.service';
import { ChartMemo } from '../../shared/chart-memo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { ConditionGaugeComponent, ConditionZone } from './condition-gauge.component';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { updatedLabel } from '../../shared/updated-label';
import { SEVERITY } from '../../shared/severity';

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

/** A fan tile: one the controller reports, or one of the design's positions. */
interface FanTile { name: string; place: string; reading: string; status: string; }

/* The six fan positions the design shows, as a FANUC cabinet has them. */
const DESIGN_FANS = [
  { name: 'Internal Fan 1', place: 'Power Supply · Spindle Motor' },
  { name: 'Internal Fan 1', place: 'Servo Amplifier' },
  { name: 'Internal Fan 2', place: 'Power Supply · Spindle Motor' },
  { name: 'Internal Fan 2', place: 'Servo Amplifier' },
  { name: 'Radiator Fan 1', place: 'Servo & Spindle Amplifier' },
  { name: 'Radiator Fan 2', place: 'Servo & Spindle Amplifier' }
];

/** API key → the words a maintenance engineer would use. */
const SIGNAL_LABELS: Record<string, string> = {
  servo_load_per_axis:   'Servo load per axis',
  servo_temperature:     'Servo motor temperature',
  spindle_temperature:   'Spindle motor temperature',
  encoder_temperature:   'Encoder temperature',
  battery_status:        'CNC / APC battery',
  insulation_resistance: 'Insulation resistance',
  fan_amplifier_status:  'Cooling fan & amplifier status'
};

@Component({
  selector: 'app-maintenance-dashboard',
  standalone: true,
  imports: [AutoApplyDirective, FilterPanelDirective, ReportDateDirective, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, ConditionGaugeComponent],
  templateUrl: './maintenance-dashboard.component.html',
  styleUrl: './maintenance-dashboard.component.scss'
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
  alarmSeries:     number[] = [];

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
  conditionCategories: string[] = [];
  /* One row per axis. The three per-axis readings were three separate
     charts of three numbers each; as rows they compare across the axis,
     which is the question a maintenance engineer actually has. */
  axisRows: { axis: string; load: number | null; temp: number | null; encoder: number | null }[] = [];
  tempTrendSeries: any[] = [];
  irTrendSeries:   any[] = [];

  /* Cycle time, hour by hour (the design's bottom-left chart) */
  cycleSeries: any[] = [];
  cycleCategories: string[] = [];
  cycleUnit: 'Sec' | 'Min' = 'Sec';
  currentCycle: number | null = null;

  /* Fan tiles: the controller's own list when it sends one, else the six
     positions the design names, each marked "Not reported". */
  fanTiles: FanTile[] = [];
  fansReported = false;
  /** Columns in the fan card: three, or fewer when fewer fans report, so two fans fill the card. */
  fanCols = 3;
  /* The APC battery tile: volts when the controller sends them, else the
     battery flag it keeps per axis. */
  apcBattery: { value: string; word: string } = { value: '--', word: '' };

  private destroy$ = new Subject<void>();
  /** A filter change: fetch now, and start the minute's polling again from here. */
  private refresh$ = new Subject<void>();

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
        if (this.selectedMachine !== null || !this.machines.length) {
          this.cdr.markForCheck();
          this.startPolling();
          return;
        }
        /* Open on a machine that is reporting now. The first in the list was
           often an offline one, so the page opened on a wall of "No data"
           while the machines next to it were streaming every reading. */
        this.svc.getMaintenance({ date: this.selectedDate })
          .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
          .subscribe(res => {
            this.selectedMachine = this.pickReporting(res?.data?.rows || []) ?? this.machines[0].id;
            this.cdr.markForCheck();
            this.startPolling();
          });
      });
  }

  /** A running machine first, then any other that is reporting. */
  private pickReporting(rows: any[]): number | null {
    const known = new Set(this.machines.map(m => m.id));
    const live = rows.filter(r => known.has(r.machine_id) && this.rowStatus(r) !== 'OFFLINE');
    return (live.find(r => this.rowStatus(r) === 'RUNNING') || live[0])?.machine_id ?? null;
  }

  /* Polling starts only once the default machine is known, so the first
     request is already scoped to it rather than fetching the whole fleet and
     then immediately refetching. */
  private polling = false;
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    /* A filter change fetches at once and restarts the clock; a request
       still on its way is dropped for the newer one (switchMap). */
    this.refresh$
      .pipe(
        startWith(undefined),
        switchMap(() => interval(POLL_MS).pipe(startWith(0))),
        switchMap(() => this.fetch$()),
        takeUntil(this.destroy$)
      )
      .subscribe(res => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The filters changed (they apply themselves): fetch now with them.
   *  Before the first machine is chosen there is nothing to refresh yet;
   *  polling starts with whatever the filters say by then. */
  submit(): void {
    this.refresh$.next();
  }

  reset(): void {
    this.selectedMachine = this.pickReporting(this.data?.rows || []) ?? this.machines[0]?.id ?? null;
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
    this.updatedAt = updatedLabel(d.updated_at);

    /* Donuts and gauges take a flat number array; the {name,data} series
       shape renders an empty chart with no error. */
    this.alarmSeries = [
      Number(d.alarms.critical) || 0,
      Number(d.alarms.non_critical) || 0,
      Number(d.alarms.information) || 0
    ];

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
    const reported = fans && typeof fans === 'object' && !Array.isArray(fans)
      ? Object.entries(fans).map(([k, v]) => this.fanTile(k, v)).filter((f): f is FanTile => f !== null)
      : [];
    this.fansReported = reported.length > 0;
    this.fanTiles = this.fansReported
      ? reported.slice(0, 6)
      : DESIGN_FANS.map(f => ({ ...f, reading: '', status: 'Not reported' }));
    this.fanCols = Math.min(3, this.fanTiles.length);
    this.apcBattery = this.batteryTile(this.focusRow?.apc_battery_voltage, this.focusRow?.apc_battery_status);

    /* Cycle time: run time per part in each hour. Hours with no part are
       left as gaps. Long-cycle machines (an HMC part can take an hour) read
       in minutes; the design's seconds would put 4,000 on the axis. */
    const cyc = (d.cycle_trend || []) as { hour_start: string; cycle_seconds: number | null }[];
    const withParts = cyc.filter(c => c.cycle_seconds != null);
    const maxSec = withParts.reduce((m, c) => Math.max(m, Number(c.cycle_seconds)), 0);
    this.cycleUnit = maxSec > 600 ? 'Min' : 'Sec';
    const k = this.cycleUnit === 'Min' ? 60 : 1;
    // only hours that finished a part: a gap per idle hour broke the line into dots
    this.cycleCategories = withParts.map(c => this.clockLabel(c.hour_start));
    this.cycleSeries = withParts.length
      ? [{ name: 'Cycle Time', data: withParts.map(c => Math.round((Number(c.cycle_seconds) / k) * 10) / 10) }]
      : [];
    const last = withParts[withParts.length - 1];
    this.currentCycle = last ? Math.round((Number(last.cycle_seconds) / k) * 10) / 10 : null;

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
    // the API sends percentages; a value under 1 is a small percentage, not a fraction
    return `${Number(v).toFixed(1)}%`;
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

  readonly SEV = SEVERITY;

  get alarmDonut(): any {
    return this.charts.memo('alarmDonut', () => {
    return {
      chart: { type: 'donut', height: 180, fontFamily: 'inherit' },
      labels: [SEVERITY.critical.label, SEVERITY.noncritical.label, SEVERITY.info.label],
      colors: [SEVERITY.critical.color, SEVERITY.noncritical.color, SEVERITY.info.color],
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

  /* ── gauges and bands, as the design draws them ──

     Healthy / Stable / Critical, the legend in the title bar. Load is a
     percentage of rated load; temperatures are motor and encoder
     temperatures in °C. A reading the machine did not send gets no gauge —
     a needle at 0 would read as a cold, idle motor. */
  readonly LOAD_BANDS = { stable: 60, critical: 85 };
  readonly TEMP_BANDS = { stable: 60, critical: 80 };
  /* Insulation resistance and battery voltage are the other way round: a
     low reading is the risk. FANUC flags motor insulation under 10 MΩ and
     starts warning under 100 MΩ; a 3 V lithium cell is due for change
     below 2.8 V. */
  readonly IR_BANDS      = { stable: 100, critical: 10 };
  readonly BATTERY_BANDS = { stable: 3.0, critical: 2.8 };

  /* The gauges' three colours, in order of value */
  readonly LOAD_ZONES: ConditionZone[] = [
    { to: 60, color: '#22c55e' }, { to: 85, color: '#f5a623' }, { to: 150, color: '#e03131' }];
  readonly TEMP_ZONES: ConditionZone[] = [
    { to: 60, color: '#22c55e' }, { to: 80, color: '#f5a623' }, { to: 120, color: '#e03131' }];
  readonly IR_ZONES: ConditionZone[] = [
    { to: 10, color: '#e03131' }, { to: 100, color: '#f5a623' }, { to: 200, color: '#22c55e' }];

  /** Healthy / Stable / Critical for a reading where lower is worse. */
  bandLow(v: number | null | undefined, b: { stable: number; critical: number }): 'Healthy' | 'Stable' | 'Critical' | '' {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '';
    const n = Number(v);
    return n < b.critical ? 'Critical' : n < b.stable ? 'Stable' : 'Healthy';
  }

  /**
   * One reported fan as its tile says it. The collector stores a fan as
   * {on, fault, rpm} (cnc_fans) — a fault is Critical, a fan that is off but
   * not faulted is Stable — or, from older controllers, a bare number or
   * word, read as before.
   */
  private fanTile(key: string, v: any): FanTile | null {
    const name = this.fanName(key);
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'object') return { name, place: '', reading: '', status: this.fanWord(String(v)) };
    if (Array.isArray(v)) return null;

    const rpm = typeof v.rpm === 'number' && Number.isFinite(v.rpm)
      ? `${Math.round(v.rpm).toLocaleString('en-IN')} rpm` : '';
    const reading = (state: string) => [state, rpm].filter(Boolean).join(' · ');
    if (v.fault === true) return { name, place: '', reading: reading('Fault'), status: 'Critical' };
    if (v.on === false)   return { name, place: '', reading: reading('Off'), status: 'Stable' };
    if (v.on === true || v.fault === false || rpm) return { name, place: '', reading: rpm || 'Running', status: 'Healthy' };
    return null;
  }

  /** "CNC_FAN1" → "CNC Fan 1", "radiator_fan2" → "Radiator Fan 2", the way the design names fans. */
  private fanName(key: string): string {
    return String(key).replace(/[_-]+/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2').trim().split(/\s+/)
      .map(w => /^fan$/i.test(w) ? 'Fan' : w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * The APC battery tile. Volts, banded as before, when the controller sends
   * them; otherwise the battery flag per axis — true is a battery alarm on
   * that axis (`battery: {"X": false, ...}` from the collector).
   */
  private batteryTile(volts: any, flags: any): { value: string; word: string } {
    const axes = flags && typeof flags === 'object' && !Array.isArray(flags)
      ? Object.entries(flags).filter(([, low]) => typeof low === 'boolean') as [string, boolean][]
      : [];
    const low = axes.filter(([, isLow]) => isLow).map(([axis]) => axis);
    const flagWord = axes.length ? (low.length ? 'Critical' : 'Healthy') : '';

    if (volts !== null && volts !== undefined && Number.isFinite(Number(volts))) {
      const voltWord = this.bandLow(volts, this.BATTERY_BANDS);
      const rank = (w: string) => ['', 'Healthy', 'Stable', 'Critical'].indexOf(w);
      return { value: `${Number(volts).toFixed(2)} v`, word: rank(flagWord) > rank(voltWord) ? flagWord : voltWord };
    }
    if (!axes.length) return { value: '--', word: '' };
    return { value: low.length ? `${low.join(', ')} low` : `${axes.map(([axis]) => axis).join(' ')} OK`, word: flagWord };
  }

  /** A controller's fan value in the design's words. */
  private fanWord(v: string): string {
    const s = String(v).toLowerCase();
    if (['ok', 'true', 'normal', 'healthy', '1', 'on'].includes(s)) return 'Healthy';
    if (['warn', 'warning', 'stable', 'low'].includes(s)) return 'Stable';
    if (['ng', 'alarm', 'fail', 'failed', 'false', 'critical', 'error', 'stop', '0', 'off'].includes(s)) return 'Critical';
    return v;
  }

  /** The fans as one word, for the "CNC Fans" tile: the worst of them. */
  get fansOverall(): string {
    if (!this.fansReported) return 'Not reported';
    const words = this.fanTiles.map(f => f.status);
    return words.includes('Critical') ? 'Critical' : words.includes('Stable') ? 'Stable' : 'Healthy';
  }

  /** The machine's state as the design's pill says it. */
  stateWord(s: string): string {
    return s === 'BREAKDOWN' ? 'Alarm' : this.statusWord(s);
  }

  /** "5 (8%)", as the design's alarm list reads. */
  alarmShare(n: number): string {
    const total = Number(this.data?.alarms?.total) || 0;
    return total ? `${n} (${Math.round((n / total) * 100)}%)` : String(n);
  }

  /** "9:00 AM", as the design labels its hour axis. */
  private clockLabel(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  }

  get cycleChart(): any {
    return this.charts.memo('cycleChart', () => ({
      chart: { type: 'line', height: 250, toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false } },
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4, strokeWidth: 2, colors: ['#fff'], strokeColors: '#2f2d8f' },
      colors: ['#2f2d8f'],
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      xaxis: { categories: this.cycleCategories, title: { text: 'Hour' }, labels: { rotate: -45, hideOverlappingLabels: true } },
      yaxis: { min: 0, title: { text: this.cycleUnit }, labels: { formatter: (v: number) => v == null ? '' : String(Math.round(v)) } },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark', y: { formatter: (v: number | null) => v == null ? 'no part this hour' : `${v} ${this.cycleUnit.toLowerCase()}` } },
      noData: { text: 'No parts made in this window' }
    }));
  }

  /** The design's middle chart: insulation resistance when a controller
   *  sends it, else the servo temperatures that are sent. */
  get trendIsIr(): boolean { return this.irTrendSeries.length > 0; }

  band(v: number | null | undefined, b: { stable: number; critical: number }): 'Healthy' | 'Stable' | 'Critical' | '' {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '';
    const n = Number(v);
    return n >= b.critical ? 'Critical' : n >= b.stable ? 'Stable' : 'Healthy';
  }
  bandColour(word: string): string {
    return word === 'Critical' ? '#e03131' : word === 'Stable' ? '#f5a623' : word === 'Healthy' ? '#22c55e' : '#94a3b8';
  }
  bandText(word: string): string {
    // the 700 shades: 4.8–5.5:1 on white (the 600s were 3.2–3.8)
    return word === 'Critical' ? 'text-red-700 dark:text-red-400'
         : word === 'Stable'   ? 'text-amber-700 dark:text-amber-400'
         : word === 'Healthy'  ? 'text-emerald-700 dark:text-emerald-400' : 'text-[--mexa-ink-3]';
  }

  /** X / Y / Z as three bars, one colour per axis as in the design. */
  axisBars(key: string, values: (number | null)[], labels: string[], unit: string): any {
    return this.charts.memo(`bars:${key}`, () => ({
      series: [{ name: unit, data: values }],
      chart: { type: 'bar', height: 190, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 4, distributed: true, dataLabels: { position: 'top' } } },
      colors: ['#2f2d8f', '#4a76c8', '#9b7ec8'],
      dataLabels: { enabled: true, offsetY: -18, formatter: (v: number | null) => v == null ? '--' : Number(v).toFixed(0),
                    style: { fontSize: '.72rem', colors: [document.documentElement.classList.contains('dark') ? '#e8ebf2' : '#1f2430'] } },
      legend: { show: false },
      // two lines ("Encoder" / "Temp X"), as the design sets them, so no label is dropped
      xaxis: { categories: labels.map(l => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]),
               labels: { rotate: 0, hideOverlappingLabels: false, trim: false } },
      yaxis: { min: 0, max: (m: number) => Math.max(50, Math.ceil((m || 0) / 10) * 10 + 10), title: { text: unit === '°C' ? 'Celsius' : unit } },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'dark', y: { formatter: (v: number | null) => v == null ? 'not reported' : `${v} ${unit}` } }
    }));
  }

  /** Whether any of these readings was sent. */
  anyReading(values: (number | null | undefined)[]): boolean {
    return values.some(v => v !== null && v !== undefined);
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

}
