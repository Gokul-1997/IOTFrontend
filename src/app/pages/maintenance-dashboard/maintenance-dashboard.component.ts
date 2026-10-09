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
import { PauseOffscreenDirective } from '../../shared/pause-offscreen.directive';
import { SupplyVoltageComponent, SupplyView, supplyView } from './supply-voltage.component';
import { AxisBatteriesComponent, AxisBattery, axisBatteries } from './axis-batteries.component';

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

/** A fan tile: one the controller reports, or one of the design's positions.
 *  `running` — the controller says it is turning; only then does its icon turn,
 *  `spin` long a turn takes: a slower fan turns visibly slower. */
interface FanTile { name: string; place: string; reading: string; status: string; running: boolean; spin: string; }

type Band = 'Healthy' | 'Stable' | 'Critical' | '';

/** A reading with a band: what the attention line lists and new alerts are found in. */
interface Watched { key: string; label: string; value: string; band: Band; }

const BAND_RANK: Record<string, number> = { '': 0, Healthy: 1, Stable: 2, Critical: 3 };

/* Axes in the order a machine names them, then anything else alphabetically:
   a 4-axis machine's battery flags come back from JSONB as B, X, Y, Z. */
const AXIS_ORDER = ['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W'];
const axisRank = (a: string) => { const i = AXIS_ORDER.indexOf(a); return i < 0 ? AXIS_ORDER.length : i; };

/** A battery tile: its reading, its band, and how full its icon is drawn (0–1). */
interface BatteryTile { value: string; word: string; level: number; }

/** How full a battery icon is drawn, by band: the word under it says the same. */
const BATTERY_LEVEL: Record<string, number> = { Healthy: 1, Stable: 0.55, Critical: 0.22 };

/* The six fan positions the design shows, as a FANUC cabinet has them. */
const DESIGN_FANS = [
  { name: 'Internal Fan 1', place: 'Power Supply · Spindle Motor' },

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
  imports: [AutoApplyDirective, FilterPanelDirective, ReportDateDirective, PauseOffscreenDirective, SupplyVoltageComponent, AxisBatteriesComponent, CommonModule, FormsModule, MatIconModule, NgApexchartsModule, SkeletonComponent, ConditionGaugeComponent],
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
  /** Any reported fan turning: the "CNC Fans" tile's icon turns too. */
  fansRunning = false;
  /** Columns in the fan card: three, or fewer when fewer fans report, so two fans fill the card. */
  fanCols = 3;
  /* The battery tiles: volts when the controller sends them, else (APC) the
     battery flag it keeps per axis; `level` is how full the icon is drawn. */
  apcBattery: BatteryTile = { value: '--', word: '', level: 0 };
  cncBattery: BatteryTile = { value: '--', word: '', level: 0 };
  /* The APC battery axis by axis, as the controller flags them — five or six
     on a machine with A, B or W axes — instead of one line for all. */
  apcAxes: AxisBattery[] = [];
  /** The APC battery's voltage, when a controller sends one besides the flags. */
  apcVolts = '';
  /* The supply voltage from the machine's energy meter, or null when it has none. */
  supply: SupplyView | null = null;

  /* What needs attention on this machine now, worst first — the line under its
     name — and which readings have just got worse since the last refresh,
     which pulse briefly and are told to a screen reader once. */
  attention: Watched[] = [];
  freshAlerts = new Set<string>();
  /** The axes whose APC battery has just gone low, for the per-axis list to pulse. */
  freshAxes = new Set<string>();
  alertNote = '';
  private lastBands = new Map<string, Band>();
  private lastMachine: number | null = null;

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
    this.alarmSeries = this.charts.keep('alarmSeries', [
      Number(d.alarms.critical) || 0,
      Number(d.alarms.non_critical) || 0,
      Number(d.alarms.information) || 0
    ]);

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
      : DESIGN_FANS.map(f => ({ ...f, reading: '', status: 'Not reported', running: false, spin: '1.2s' }));
    this.fanCols = Math.min(3, this.fanTiles.length);
    this.fansRunning = this.fanTiles.some(f => f.running);
    this.apcBattery = this.batteryTile(this.focusRow?.apc_battery_voltage, this.focusRow?.apc_battery_status);
    this.cncBattery = this.batteryTile(this.focusRow?.cnc_battery_voltage, null);
    this.apcAxes = axisBatteries(this.focusRow?.apc_battery_status);
    const volts = this.focusRow?.apc_battery_voltage;
    this.apcVolts = volts !== null && volts !== undefined && Number.isFinite(Number(volts)) ? `${Number(volts).toFixed(2)} v` : '';
    this.supply = supplyView(d.supply);
    this.noteAlerts(this.focusRow);

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
    this.cycleSeries = this.charts.keep('cycleSeries', withParts.length
      ? [{ name: 'Cycle Time', data: withParts.map(c => Math.round((Number(c.cycle_seconds) / k) * 10) / 10) }]
      : []);
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
    this.tempTrendSeries = this.charts.keep('tempTrendSeries', lines([
      ['Servo X', 'servo_temp_x'], ['Servo Y', 'servo_temp_y'],
      ['Servo Z', 'servo_temp_z'], ['Spindle', 'spindle_motor_temp']
    ]));
    this.irTrendSeries = this.charts.keep('irTrendSeries', lines([
      ['IR X', 'servo_insulation_res_x'], ['IR Y', 'servo_insulation_res_y'],
      ['IR Z', 'servo_insulation_res_z']
    ]));

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
    // one slice needs no label on the ring: the centre already says the total
    const slices = this.alarmSeries.filter(n => n > 0).length;
    return this.charts.memo('alarmDonut', () => {
    return {
      chart: { type: 'donut', height: 180, fontFamily: 'inherit', animations: { enabled: false } },
      labels: [SEVERITY.critical.label, SEVERITY.noncritical.label, SEVERITY.info.label],
      colors: [SEVERITY.critical.color, SEVERITY.noncritical.color, SEVERITY.info.color],
      plotOptions: {
        pie: { donut: { size: '64%', labels: {
          show: true,
          total: { show: true, label: 'Total Alarms', fontSize: '.75rem',
                   formatter: () => String(this.data?.alarms?.total ?? 0) }
        } } }
      },
      dataLabels: { enabled: slices > 1, formatter: (_v: number, o: any) => String(o.w.config.series[o.seriesIndex]) },
      // the key list beside the donut already names every class
      legend: { show: false },
      tooltip: { y: { formatter: (v: number) => `${v} alarms` } },
      noData: { text: 'No alarms in this window' }
    };
  }, this.charts.sig('alarmSeries'));
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
    if (typeof v !== 'object') {
      // an older controller's word or number: "OK", 1, or a speed
      const status = this.fanWord(String(v));
      return { name, place: '', reading: '', status, running: status === 'Healthy' || (typeof v === 'number' && v > 1),
               spin: this.spinFor(typeof v === 'number' && v > 1 ? v : null) };
    }
    if (Array.isArray(v)) return null;

    const hasRpm = typeof v.rpm === 'number' && Number.isFinite(v.rpm);
    const rpm = hasRpm ? `${Math.round(v.rpm).toLocaleString('en-IN')} rpm` : '';
    const reading = (state: string) => [state, rpm].filter(Boolean).join(' · ');
    // turning: not faulted, not off, and a speed above 0 (or "on" when no speed is sent)
    const running = v.fault !== true && v.on !== false && (hasRpm ? v.rpm > 0 : v.on === true);
    const spin = this.spinFor(hasRpm ? v.rpm : null);
    if (v.fault === true) return { name, place: '', reading: reading('Fault'), status: 'Critical', running, spin };
    if (v.on === false)   return { name, place: '', reading: reading('Off'), status: 'Stable', running, spin };
    if (v.on === true || v.fault === false || rpm) return { name, place: '', reading: rpm || 'Running', status: 'Healthy', running, spin };
    return null;
  }

  /**
   * How long one turn of the icon takes: 1.2 s at 10,000 rpm, a little slower
   * for a slower fan (2.4 s at most). In 0.2 s steps, so the minute-by-minute
   * wobble of a healthy fan's rpm never restarts the turn.
   */
  private spinFor(rpm: number | null): string {
    if (!rpm || rpm <= 0) return '1.2s';
    const seconds = Math.min(2.4, Math.max(0.8, 12000 / rpm));
    return `${(Math.round(seconds * 5) / 5).toFixed(1)}s`;
  }

  /**
   * The readings this machine is watched on, in the words its card uses, and
   * from them: the attention line (worst first), and the readings that got
   * worse since the last refresh of the same machine — those pulse a few
   * times and are announced once. A first look, or another machine, has no
   * "since", so nothing pulses then.
   */
  private noteAlerts(r: any): void {
    const watched: Watched[] = [];
    if (r) {
      const add = (key: string, label: string, v: any, unit: string, band: Band) =>
        watched.push({ key, label, band, value: v === null || v === undefined ? '' : `${Math.round(Number(v))}${unit}` });
      if (this.rowStatus(r) === 'BREAKDOWN') watched.push({ key: 'machine', label: 'Machine in alarm', value: '', band: 'Critical' });
      add('spindle_load', 'Spindle load', r.spindle_load, '%', this.band(r.spindle_load, this.LOAD_BANDS));
      add('spindle_temp', 'Spindle temp', r.spindle_motor_temp, ' °C', this.band(r.spindle_motor_temp, this.TEMP_BANDS));
      add('spindle_ir', 'Spindle IR', r.spindle_insulation_res, ' MΩ', this.bandLow(r.spindle_insulation_res, this.IR_BANDS));
      for (const a of ['x', 'y', 'z']) {
        const A = a.toUpperCase();
        add(`servo_load_${a}`, `Servo load ${A}`, r[`servo_load_${a}`], '%', this.band(r[`servo_load_${a}`], this.LOAD_BANDS));
        add(`servo_temp_${a}`, `Servo temp ${A}`, r[`servo_temp_${a}`], ' °C', this.band(r[`servo_temp_${a}`], this.TEMP_BANDS));
        add(`encoder_temp_${a}`, `Encoder temp ${A}`, r[`encoder_temp_${a}`], ' °C', this.band(r[`encoder_temp_${a}`], this.TEMP_BANDS));
      }
      if (this.fansReported) {
        for (const f of this.fanTiles) {
          // "Fan 1" sits under the CNC fans heading; on its own the line says "CNC fan 1"
          const label = /^Fan \d+$/.test(f.name) ? `CNC ${f.name.toLowerCase()}` : f.name;
          if (f.status in BAND_RANK) watched.push({ key: `fan:${f.name}`, label, value: f.reading, band: f.status as Band });
        }
      }
      watched.push({ key: 'battery:cnc', label: 'CNC battery', value: this.cncBattery.value, band: this.cncBattery.word as Band });
      if (this.apcAxes.length) {
        // each axis on its own, so the line says which battery to change
        for (const a of this.apcAxes) {
          watched.push({ key: `battery:apc:${a.axis}`, label: `APC battery ${a.axis}`, value: a.low ? 'low' : '', band: a.low ? 'Critical' : 'Healthy' });
        }
      } else {
        watched.push({ key: 'battery:apc', label: 'APC battery', value: this.apcBattery.value, band: this.apcBattery.word as Band });
      }
      if (this.supply) watched.push({ key: 'supply', label: 'Supply voltage', value: this.supply.problem, band: this.supply.word });
    }

    this.attention = watched
      .filter(w => BAND_RANK[w.band] >= BAND_RANK['Stable'])
      .sort((a, b) => BAND_RANK[b.band] - BAND_RANK[a.band]);

    const sameMachine = !!r && r.machine_id === this.lastMachine;
    const fresh = sameMachine
      ? this.attention.filter(w => BAND_RANK[w.band] > BAND_RANK[this.lastBands.get(w.key) ?? ''])
      : [];
    this.freshAlerts = new Set(fresh.map(w => w.key));
    this.freshAxes = new Set(fresh.filter(w => w.key.startsWith('battery:apc:')).map(w => w.key.slice('battery:apc:'.length)));
    this.alertNote = fresh.length
      ? 'Now ' + fresh.map(w => `${w.band.toLowerCase()}: ${w.label}${w.value ? ' ' + w.value : ''}`).join('; ')
      : '';
    this.lastBands = new Map(watched.map(w => [w.key, w.band]));
    this.lastMachine = r?.machine_id ?? null;
  }

  /** After the worst reading's name: its band (unless the name says it) and how many more. */
  get attentionTail(): string {
    const [first] = this.attention;
    if (!first) return '';
    const band = first.key === 'machine' ? '' : ` · ${first.band}`;
    const more = this.attention.length > 1 ? ` · +${this.attention.length - 1} more` : '';
    return band + more;
  }

  /** The attention line's full list, for its tooltip and for a screen reader. */
  get attentionText(): string {
    return this.attention.map(w => `${w.label}${w.value ? ' ' + w.value : ''} (${w.band.toLowerCase()})`).join(', ');
  }

  /** Fan tiles keep their element from one refresh to the next, so a turning
   *  icon carries on turning instead of snapping back every minute. */
  fanKey(_: number, f: FanTile): string {
    return `${f.name}|${f.place}`;
  }


  /**
   * "CNC_FAN1" → "Fan 1" (the card is headed CNC fans, so the number is what
   * tells one from the other), "radiator_fan2" → "Radiator Fan 2".
   */
  private fanName(key: string): string {
    const cnc = /^\s*cnc[\s_-]*fan[\s_-]*(\d+)\s*$/i.exec(String(key));
    if (cnc) return `Fan ${Number(cnc[1])}`;
    return String(key).replace(/[_-]+/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2').trim().split(/\s+/)
      .map(w => /^fan$/i.test(w) ? 'Fan' : w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * The APC battery tile. Volts, banded as before, when the controller sends
   * them; otherwise the battery flag per axis — true is a battery alarm on
   * that axis (`battery: {"X": false, ...}` from the collector).
   */
  private batteryTile(volts: any, flags: any): BatteryTile {
    const axes = flags && typeof flags === 'object' && !Array.isArray(flags)
      ? (Object.entries(flags).filter(([, low]) => typeof low === 'boolean') as [string, boolean][])
          .sort(([a], [b]) => axisRank(a) - axisRank(b) || a.localeCompare(b))
      : [];
    const low = axes.filter(([, isLow]) => isLow).map(([axis]) => axis);
    const flagWord = axes.length ? (low.length ? 'Critical' : 'Healthy') : '';
    const tile = (value: string, word: string): BatteryTile => ({ value, word, level: BATTERY_LEVEL[word] ?? 0 });

    if (volts !== null && volts !== undefined && Number.isFinite(Number(volts))) {
      const voltWord = this.bandLow(volts, this.BATTERY_BANDS);
      const rank = (w: string) => ['', 'Healthy', 'Stable', 'Critical'].indexOf(w);
      return tile(`${Number(volts).toFixed(2)} v`, rank(flagWord) > rank(voltWord) ? flagWord : voltWord);
    }
    if (!axes.length) return tile('--', '');
    // all fine: the axes it covers ("X Y Z B", with "Healthy" under it); else which are low
    return tile(low.length ? `${low.join(', ')} low` : axes.map(([axis]) => axis).join(' '), flagWord);
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
      chart: { type: 'line', height: 270, toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false }, animations: { enabled: false } },
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4, strokeWidth: 2, colors: ['#fff'], strokeColors: '#2f2d8f' },
      colors: ['#2f2d8f'],
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom' },
      xaxis: { categories: this.cycleCategories, 
      title: { text: 'Hour', offsetY: -15}, labels: { rotate: -45, hideOverlappingLabels: true } },
      yaxis: { min: 0, title: { text: this.cycleUnit }, labels: { formatter: (v: number) => v == null ? '' : String(Math.round(v)) } },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'light', y: { formatter: (v: number | null) => v == null ? 'no part this hour' : `${v} ${this.cycleUnit.toLowerCase()}` } },
      noData: { text: 'No parts made in this window' },
//       responsive: [
//   {
//     breakpoint: 1200,
//     options: {
//       chart: {
//         height: 600
//       },
//       title: { text: 'test',offsetY: -5}
//     }

//   }
// ]
    }), this.charts.sig('cycleSeries') + JSON.stringify([this.cycleCategories, this.cycleUnit]));
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
    // kept until the readings or labels change (see ChartMemo.memo on why not updateSeries)
    return this.charts.memo(`bars:${key}`, () => ({ ...this.barOptions(labels, unit), series: [{ name: unit, data: values }] }),
                            JSON.stringify([values, labels, unit]));
  }

  private barOptions(labels: string[], unit: string): any {
    return {
      chart: { type: 'bar', height: 245, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
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
      tooltip: { theme: 'light', y: { formatter: (v: number | null) => v == null ? 'not reported' : `${v} ${unit}` } },
      responsive: [
          {
            breakpoint: 1600,
            options: {
              chart: {
                height: 190
              }
            }
          }
        ]
    };
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
      chart: { type: 'line', height: 260, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 3 },
      colors,
      dataLabels: { enabled: false },
      legend: { position: 'bottom' },
      xaxis: { categories: this.conditionCategories, title: { text: 'Hour' } },
      yaxis: { title: { text: unit === '°C' ? 'Celsius' : unit }, labels: { formatter: (v: number) => v == null ? '' : v.toFixed(0) } },
      grid: { borderColor: 'rgba(148,163,184,.25)' },
      tooltip: { theme: 'light', y: { formatter: (v: number | null) => v == null ? 'no reading' : `${v} ${unit}` } },
      noData: { text: 'No reading in this window' }
    };
  }

  get tempTrendChart(): any {
    return this.charts.memo('tempTrendChart', () => this.trendOptions('°C', this.trendColours(this.tempTrendSeries)),
                            this.charts.sig('tempTrendSeries') + JSON.stringify(this.conditionCategories));
  }
  get irTrendChart(): any   {
    return this.charts.memo('irTrendChart', () => this.trendOptions('Resistance', ['#4a76c8', '#2f2d8f', '#9b7ec8']),
                            this.charts.sig('irTrendSeries') + JSON.stringify(this.conditionCategories));
  }

  /** One colour per line, kept with its line when a line has nothing to draw. */
  private trendColours(lines: { name: string }[]): string[] {
    const colour: Record<string, string> = { 'Servo X': '#2f2d8f', 'Servo Y': '#4a76c8', 'Servo Z': '#9b7ec8', 'Spindle': '#e8618c' };
    return lines.map(l => colour[l.name] ?? '#64748b');
  }

  /** The middle chart's name says what it draws: the spindle's line too, when it has one. */
  get trendTitle(): string {
    if (this.trendIsIr) return 'Servo Motor Insulation Resistance Trend';
    return this.tempTrendSeries.some(l => l.name === 'Spindle') ? 'Servo & Spindle Temperature Trend' : 'Servo Motor Temperature Trend';
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
