import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { EMPTY, Subject, Subscription, catchError, distinctUntilChanged, map, merge, switchMap, takeUntil, timer } from 'rxjs';
import { DashboardService } from '../dashboard.service';
import { ChartsService } from '../../charts/charts.service';
import { SocketService } from '../../../core/services/socket.service';
import { AuthService } from '../../../core/services/auth.service';
import { ProductionChartComponent, HourlyReading } from './production-chart.component';
import { ShiftTimelineComponent } from './shift-timeline.component';
import { NeedleGaugeComponent, GaugeZone } from '../../../shared/needle-gauge/needle-gauge.component';
import { CncMachineComponent } from '../../../shared/cnc-machine/cnc-machine.component';
import { MatIconModule } from '@angular/material/icon';

const POLL_MS = 30_000;
const SOCKET_FRESH_MS = 45_000;

/** Numeric sensors may be absent. Keep missing data distinct from a measured zero. */
export function reading(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function durationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) return reading(value);
  const match = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) : null;
}

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [CommonModule, RouterModule, MatIconModule, ProductionChartComponent, NeedleGaugeComponent, ShiftTimelineComponent, CncMachineComponent],
  templateUrl: './live.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private refresh$ = new Subject<void>();
  private hourlyRequest?: Subscription;
  private clockInterval?: ReturnType<typeof setInterval>;
  private socketFields = new Map<string, number>();

  machineId = 0;
  machine: any = {};
  operator: any = {};
  job: any = {};
  oee: any = {};
  shift: any = {};
  quality: any = {};
  power: any = {};
  production: any = {};
  runTime: string | number | null = null;
  idleTime: string | number | null = null;
  liveStatus = 'UNKNOWN';
  liveMode = '';
  liveSpindleLoad: number | null = null;
  liveFeed: number | null = null;
  livePartCount: number | null = null;
  alarmActive = false;
  /** Open alarms on this machine (code, text, since when), from the API; the socket carries only the flag. */
  activeAlarms: any[] = [];
  loading = true;
  loadError = false;
  lastUpdated: Date | null = null;
  currentTime = '';
  currentDateStr = '';
  hourlyDate = '';
  hourly: HourlyReading[] = [];
  hourlyLoading = false;
  hourlyError = false;
  /* Spindle load on 0–150%: the load meter passes 100% on an overload.
     Feed is the actual feed in mm/min; 0–6,000 holds almost all cutting
     (90% of samples are under 2,500) — rapids pin the needle while the
     number stays true. */
  readonly FEED_SCALE = 6000;
  readonly SPINDLE_ZONES: GaugeZone[] = [
    { from: 80,  to: 100, color: 'var(--st-idle)' },    // high
    { from: 100, to: 150, color: 'var(--st-alarm)' }    // overload
  ];
  readonly pctTick = (v: number) => `${v}%`;
  readonly kTick = (v: number) => (v === 0 ? '0' : `${v / 1000}k`);
  readonly spindleText = (v: number | null) => (v === null ? '--' : `${Math.round(v)}%`);
  readonly feedText = (v: number | null) => (v === null ? '--' : `${Math.round(v).toLocaleString('en-IN')} mm/min`);
  readonly number = reading;

  constructor(
    private route: ActivatedRoute,
    private dashboardService: DashboardService,
    private socketService: SocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    public auth: AuthService,
    private chartsService: ChartsService
  ) {}

  ngOnInit(): void {
    // REST remains available even when the independent socket cannot connect.
    void this.socketService.connect().catch(() => {});
    const plantId = this.auth.getUser()?.plant_id;
    if (plantId) this.socketService.joinPlant(plantId);
    this.socketService.onMachineUpdate((data: any) => this.handleSocket(data));

    // Angular can reuse this component when moving directly between machine URLs.
    this.route.paramMap.pipe(
      map(params => Number(params.get('id'))), distinctUntilChanged(),
      switchMap(id => {
        this.resetMachine(id);
        if (!Number.isInteger(id) || id <= 0) {
          this.loading = false;
          this.loadError = true;
          return EMPTY;
        }
        return merge(timer(0, POLL_MS), this.refresh$).pipe(
          switchMap(() => this.dashboardService.getMachineDetail(id).pipe(
            catchError(() => {
              this.loading = false;
              this.loadError = true;
              this.cdr.markForCheck();
              return EMPTY;
            })
          ))
        );
      }), takeUntil(this.destroy$)
    ).subscribe(res => this.applyApiData(res));

    const tick = () => {
      const now = new Date();
      this.currentTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      this.currentDateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      this.cdr.markForCheck();
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  private resetMachine(id: number): void {
    this.hourlyRequest?.unsubscribe();
    this.machineId = id;
    this.machine = {}; this.operator = {}; this.job = {}; this.oee = {};
    this.shift = {}; this.quality = {}; this.power = {}; this.production = {};
    this.runTime = null; this.idleTime = null;
    this.liveStatus = 'UNKNOWN'; this.liveMode = '';
    this.liveSpindleLoad = null; this.liveFeed = null; this.livePartCount = null;
    this.alarmActive = false; this.activeAlarms = [];
    this.socketFields.clear();
    this.loading = true; this.loadError = false; this.lastUpdated = null;
    this.hourly = []; this.hourlyLoading = false; this.hourlyError = false;
    this.hourlyDate = this.todayIST();
    this.cdr.markForCheck();
  }

  refresh(): void {
    if (this.machineId <= 0) return;
    this.loading = true;
    this.refresh$.next();
  }

  private applyApiData(res: any): void {
    const data = res?.data ?? res;
    this.loading = false;
    if (!data || Array.isArray(data) || typeof data !== 'object' || !data.machine) {
      this.loadError = true;
      this.cdr.markForCheck();
      return;
    }
    this.loadError = false;
    this.machine = data.machine;
    this.operator = data.operator || {};
    this.job = data.job || {};
    this.oee = data.oee || {};
    this.shift = data.shift || {};
    this.quality = data.quality || {};
    this.power = data.power || {};
    this.production = data.production || {};
    this.runTime = data.production?.run_time ?? null;
    this.idleTime = data.production?.idle_time ?? null;

    // Counters from REST include reset offsets. Never replace them with raw socket counts.
    this.livePartCount = reading(data.live?.parts_count) ?? reading(this.job.achieved_qty);
    const live = data.live || {};
    const fresh = (field: string) => Date.now() - (this.socketFields.get(field) ?? 0) < SOCKET_FRESH_MS;
    if (!fresh('machine_status')) this.liveStatus = this.normalizeStatus(live.machine_status);
    if (!fresh('mode')) this.liveMode = live.mode || '';
    if (!fresh('alarm')) this.alarmActive = this.isAlarm(live.alarm);
    // which alarm it is always comes from the API
    this.activeAlarms = Array.isArray(live.active_alarms) ? live.active_alarms : [];
    if (!fresh('spindle_load')) this.liveSpindleLoad = reading(live.spindle_load);
    if (!fresh('feed_rate')) this.liveFeed = reading(live.feed_rate);
    this.lastUpdated = new Date();
    this.loadHourly();
    this.cdr.markForCheck();
  }

  handleSocket(data: any): void {
    if (!data || Number(data.machine_id) !== this.machineId) return;
    this.zone.run(() => {
      for (const key of ['machine_status', 'mode', 'alarm', 'spindle_load', 'feed_rate']) {
        if (data[key] !== undefined) this.socketFields.set(key, Date.now());
      }
      if (data.machine_status !== undefined) this.liveStatus = this.normalizeStatus(data.machine_status);
      if (data.mode !== undefined) this.liveMode = data.mode || '';
      if (data.alarm !== undefined) this.alarmActive = this.isAlarm(data.alarm);
      if (data.spindle_load !== undefined) this.liveSpindleLoad = reading(data.spindle_load);
      if (data.feed_rate !== undefined) this.liveFeed = reading(data.feed_rate);
      if (data.energy !== undefined) this.power = { ...this.power, total_kwh: reading(data.energy) };
      this.cdr.markForCheck();
    });
  }

  get canViewHourly(): boolean {
    // Match the existing Charts page permission, including the legacy ADMIN role.
    const company = this.auth.getCompanyPermissions();
    const allowedByCompany = !company.length || company.some(p => p === 'page:charts' || p.startsWith('page:charts:'));
    return allowedByCompany && (this.auth.isAdmin() || this.auth.hasPermission('page:charts'));
  }

  loadHourly(): void {
    if (!this.canViewHourly || this.machineId <= 0) return;
    this.hourlyRequest?.unsubscribe();
    const date = this.todayIST();
    if (this.hourlyDate !== date) this.hourly = [];
    this.hourlyDate = date;
    this.hourlyLoading = true;
    // Daily history is explicitly labeled Today; do not mix an overnight shift with a calendar day.
    this.hourlyRequest = this.chartsService.getChartData({ machine_id: this.machineId, date }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const rows = res?.data?.hourlyCount;
        this.hourly = Array.isArray(rows) ? rows.map(row => ({ hour: String(row.hour ?? ''), produced: reading(row.produced) })) : [];
        this.hourlyLoading = false;
        this.hourlyError = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.hourlyLoading = false;
        this.hourlyError = true;
        this.cdr.markForCheck();
      }
    });
  }

  private todayIST(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
  private normalizeStatus(value: unknown): string {
    const status = String(value || 'UNKNOWN').toUpperCase();
    return ['RUNNING', 'IDLE', 'OFFLINE', 'ALARM'].includes(status) ? status : 'UNKNOWN';
  }
  private isAlarm(value: unknown): boolean { return value === true || value === 1 || value === '1' || value === 'true'; }
  /** The status pill's colour for a machine status. */
  statePill(status: string): string {
    return ({ RUNNING: 'run', IDLE: 'idle', ALARM: 'alarm' } as Record<string, string>)[status] || 'disc';
  }
  get displayStatus(): string { return this.alarmActive ? 'ALARM' : this.liveStatus; }
  get spindleState(): { word: string; cls: string } {
    const v = this.liveSpindleLoad;
    if (v === null) return { word: 'Not reported', cls: 'text-gray-600 dark:text-gray-400' };
    if (v > 100) return { word: 'Overload', cls: 'text-red-700 dark:text-red-400' };
    if (v >= 80) return { word: 'High', cls: 'text-amber-700 dark:text-amber-400' };
    return { word: 'Normal', cls: 'text-green-700 dark:text-green-400' };
  }
  get target(): number | null { return reading(this.job?.target_qty); }
  get attainment(): number | null { return this.target && this.livePartCount !== null ? this.livePartCount / this.target * 100 : null; }
  get remaining(): number | null { return this.target && this.livePartCount !== null ? Math.max(0, this.target - this.livePartCount) : null; }
  get overTarget(): number { return this.target && this.livePartCount !== null ? Math.max(0, this.livePartCount - this.target) : 0; }
  get recordedSeconds(): number { return (durationSeconds(this.runTime) ?? 0) + (durationSeconds(this.idleTime) ?? 0); }
  get runningShare(): number { return this.recordedSeconds ? (durationSeconds(this.runTime) ?? 0) / this.recordedSeconds * 100 : 0; }
  get timeComplete(): boolean { return durationSeconds(this.runTime) !== null && durationSeconds(this.idleTime) !== null; }
  get qualityTotal(): number | null {
    const accepted = reading(this.quality?.accepted), rejected = reading(this.quality?.rejected);
    return accepted !== null && rejected !== null ? accepted + rejected : null;
  }
  get acceptedShare(): number { return this.qualityTotal ? Number(this.quality.accepted) / this.qualityTotal * 100 : 0; }
  get oeeFactors(): { label: string; value: number | null; color: string }[] {
    return [
      { label: 'Availability', value: reading(this.oee?.availability), color: 'var(--chart-blue)' },
      { label: 'Performance', value: reading(this.oee?.performance), color: 'var(--chart-violet)' },
      { label: 'Quality', value: reading(this.oee?.quality), color: 'var(--chart-green)' }
    ];
  }
  boundedPercent(value: unknown): number { return Math.max(0, Math.min(100, reading(value) ?? 0)); }
  formatDuration(value: unknown): string {
    const seconds = durationSeconds(value);
    if (seconds === null) return '—';
    const total = Math.floor(seconds);
    return `${String(Math.floor(total / 3600)).padStart(2, '0')}h ${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}m ${String(total % 60).padStart(2, '0')}s`;
  }
  get setupTime(): string {
    const seconds = reading(this.production?.manual_seconds);
    if (seconds !== null) return this.formatDuration(seconds);
    const start = this.job?.setting_time_start, end = this.job?.setting_time_end;
    const delta = start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 1000 : null;
    return this.formatDuration(delta);
  }
  usePlaceholder(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallback = new URL('images/product/machine-placeholder.svg', document.baseURI).href;
    if (image.src !== fallback) image.src = fallback;
  }
  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
    this.hourlyRequest?.unsubscribe();
    this.socketService.offMachineUpdate();
    clearInterval(this.clockInterval);
  }
}
