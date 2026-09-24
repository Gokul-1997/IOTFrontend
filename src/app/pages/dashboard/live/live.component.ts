import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { ActivatedRoute, RouterModule } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  Subject,
  interval,
  switchMap,
  startWith,
  takeUntil
} from 'rxjs';
import { CommonModule } from '@angular/common';
import { NeedleGaugeComponent, GaugeZone } from '../../../shared/needle-gauge/needle-gauge.component';
import { ShiftTimelineComponent } from './shift-timeline.component';

/* ─────────────────────────────────────────
   SOCKET  → machine_status, rpm, feed_rate ONLY
             instant live needle updates

   API 30s → run_time, idle_time, utilization,
             achieved_qty, target_qty, oee,
             quality, production data
───────────────────────────────────────── */

const POLL_MS = 30_000;


@Component({
  standalone: true,
  selector: 'app-live',
  imports: [NgApexchartsModule, CommonModule, RouterModule, NeedleGaugeComponent, ShiftTimelineComponent],
  templateUrl: './live.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machineId!: number;

  /* ── Gauge scale constants (exposed for template) ── */

  /* ── API-owned state ── */
  machine:    any = {};
  operator:   any = {};
  job:        any = {};
  oee:        any = {};
  shift:      any = {};
  quality:    any = {};
  power:      any = {};
  production: any = {};

  runTime   = '00:00:00';
  idleTime  = '00:00:00';
  utilization = 0;

  /* ── Socket-owned state ── */
  liveStatus       = 'UNKNOWN';
  liveMode         = '';

  /* The alarm flag, kept apart from Running / Idle exactly as the machine
     list keeps it: a CNC in alarm usually stops, so its status reads IDLE
     while the alarm is on. This page used to show only the status, so a
     machine the list was flashing red read a plain "IDLE" here. */
  liveAlarm        = false;
  /** Open alarms on this machine (code, text, since when), from the API. */
  activeAlarms: any[] = [];
  /** When the socket last delivered for this machine (ms). While that is
   *  under a minute old the socket owns status, mode, spindle, feed and the
   *  alarm; after a minute's silence the 30 s poll takes them back — the
   *  same rule as the machine list, so the two pages cannot disagree. */
  private lastSocketMs = 0;
  private get socketLive(): boolean { return Date.now() - this.lastSocketMs < 60_000; }
  liveSpindleLoad  = 0;
  liveFeed         = 0;
  livePartCount    = 0;


  /* ── UI helpers ── */
  currentDate      = new Date();
  currentTime      = '';
  currentDateStr   = '';
  private clockInterval: any;

  /* ── Chart series ── */
  utilSeries:    number[] = [0];
  oeeSeries:     number[] = [0];
  timePieSeries: number[] = [0, 0];

  /* ── Chart configs ── */
  utilChart:    any;
  oeeChart:     any;
  spindleChart: any;
  feedChart:    any;
  timePieChart: any;

  constructor(
    private route:            ActivatedRoute,
    private dashboardService: DashboardService,
    private socketService:    SocketService,
    private zone:             NgZone,
    private cdr:              ChangeDetectorRef,
    public  auth:             AuthService
  ) {}

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  async ngOnInit(): Promise<void> {

    const id      = this.route.snapshot.paramMap.get('id');
    this.machineId = Number(id);

    this.initCharts();

    /* ── Socket: connect, then join the plant room ──
       joinPlant() must wait for the connection or the join is ignored — but
       nothing else may wait on it. The socket is websocket-only; where that
       cannot connect (a proxy or firewall on the shop network, the server
       restarting) connect() rejects, and awaiting it here stopped ngOnInit
       before the poll below was set up: the page stayed empty, never
       refreshing. The 30 s poll is the floor; live updates are on top. */
    const user    = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;
    if (!plantId) console.warn('[SOCKET] ⚠ no plant_id in localStorage — cannot join room');
    this.socketService.connect()
      .then(() => { if (plantId) this.socketService.joinPlant(plantId); })
      .catch(err => console.warn('Live updates unavailable; refreshing every 30 s:', err?.message || err));

    // console.log(`[SOCKET] listening for machine_id: ${this.machineId}`);

    /* ── 30s API poll ── */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.dashboardService.getMachineDetail(this.machineId)),
        takeUntil(this.destroy$)
      )
      .subscribe((res: any) => this.applyApiData(res));

    /* ── Socket → status + rpm + feed ONLY ── */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocket(data);
    });

    /* ── Live clock (IST) ── */
    const tick = () => {
      const now = new Date();
      this.currentTime = now.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'Asia/Kolkata'
      });
      this.currentDateStr = now.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      this.cdr.markForCheck();
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.socketService.offMachineUpdate();
    clearInterval(this.clockInterval);
  }

  /* ════════════════════════════════════════
     API DATA
     ✅ Owns: run_time, idle_time, utilization,
              achieved_qty, target, oee, quality,
              production, operator, job
     ❌ Never touches: liveStatus, liveRPM, liveFeed
  ════════════════════════════════════════ */
  private applyApiData(res: any): void {

    const d = res?.data;
    if (!d) return;

    this.machine    = d.machine    || this.machine;
    this.operator   = d.operator  || this.operator;
    this.job        = d.job       || this.job;
    this.oee        = d.oee       || this.oee;
    this.shift      = d.shift     || this.shift;
    this.quality    = d.quality   || this.quality;
    this.power      = d.power     || this.power;
    this.production = d.production || this.production;

    /* Metric fields — API is source of truth */
    if (d.production) {
      this.runTime  = d.production.run_time  || this.runTime;
      this.idleTime = d.production.idle_time || this.idleTime;
    }

    /* Utilization: achieved/target × 100, capped at 100 */
    const target   = d.job?.target_qty   || 0;
    const achieved = d.job?.achieved_qty || 0;
    this.utilization = target > 0
      ? Math.min(Number(((achieved * 100) / target).toFixed(2)), 100)
      : 0;

    /* Seed live values from API.
       status/rpm/feed: the socket owns them while it is live (instant
                        updates); after a minute's silence this poll does.
       livePartCount:   API owns ALWAYS — socket sends raw counter which
                        doesn't include reset offsets, so would show wrong
                        values (e.g. 29 instead of 59 after a mid-shift reset).
                        30s API refresh is accurate enough for a part counter. */
    if (d.live) {
      if (!this.socketLive) {
        this.liveStatus      = d.live.machine_status || 'UNKNOWN';
        this.liveMode        = d.live.mode           || '';
        this.liveSpindleLoad = Number(d.live.spindle_load || 0);
        this.liveFeed        = Number(d.live.feed_rate    || 0);
      }

      // Always update from API — adjusted for mid-shift counter resets
      this.livePartCount = Number(d.live.parts_count || 0);

      /* Alarm: the socket owns the flag while it is live, as on the list;
         otherwise this poll does. Which alarm it is always comes from the
         API — the socket carries only the flag. */
      if (!this.socketLive) this.liveAlarm = d.live.alarm === true;
      this.activeAlarms = Array.isArray(d.live.active_alarms) ? d.live.active_alarms : [];
    }

    /* Update chart series */
    this.utilSeries = [this.utilization];
    this.oeeSeries  = [Math.min(Number(this.oee?.oee || 0), 100)];

    this.updateTimePie();
    this.currentDate = new Date();

    this.cdr.markForCheck();
  }

  /* ════════════════════════════════════════
     SOCKET → machine_status, rpm, feed_rate,
              parts_count (achieved_qty)
     ❌ run_time    → NOT touched (API owns)
     ❌ idle_time   → NOT touched (API owns)
     ❌ utilization → NOT touched (API owns)
  ════════════════════════════════════════ */
  handleSocket(data: any): void {

    // console.log('[SOCKET] raw message received:', data);

    /* Ensure Number comparison — socket payload may send id as string */
    if (Number(data.machine_id) !== this.machineId) {
      // console.log(`[SOCKET] ignored — machine_id ${data.machine_id} !== current ${this.machineId}`);
      return;
    }

    // console.log(`[SOCKET] ✅ matched machine ${this.machineId} — applying:`, {
    //   status:      data.machine_status,
    //   rpm:         data.rpm,
    //   feed_rate:   data.feed_rate,
    //   parts_count: data.parts_count,
    //   alarm:       data.alarm
    // });

    this.zone.run(() => {

      /* The socket is live for this machine: for the next minute the API
         poll leaves status, mode, spindle, feed and alarm to it */
      this.lastSocketMs = Date.now();

      /* ── Status + Mode ── */
      if (data.machine_status !== undefined) {
        this.liveStatus = data.machine_status;
      }
      if (data.mode !== undefined) {
        this.liveMode = data.mode || '';
      }

      /* ── Alarm flag — the same test the list applies to the same message ── */
      if (data.alarm !== undefined) {
        this.liveAlarm = data.alarm === true;
      }

      /* ── Spindle load, % of rated — past 100 is an overload ── */
      if (data.spindle_load !== undefined) {
        this.liveSpindleLoad = Number(data.spindle_load);
      }

      /* ── Feed rate, mm/min ── */
      if (data.feed_rate !== undefined) {
        this.liveFeed   = Number(data.feed_rate);
      }

      /* ── Energy → update total_kwh in real-time ── */
      if (data.energy != null) {
        this.power = {
          ...this.power,
          total_kwh: Number(Number(data.energy).toFixed(3))
        };
      }

      /* ── parts_count: API owns this (reset-adjusted) — socket skips ── */

      this.currentDate = new Date();
      this.cdr.markForCheck();

      // console.log('[SOCKET] cdr.markForCheck() called — UI should update');
    });
  }

  /* ════════════════════════════════════════
     GAUGES (app-needle-gauge)
     Spindle load on 0–150%: the load meter passes 100% on an overload
     (226% has been recorded), and the old 0–100% dial clamped it away.
     Feed is the actual feed in mm/min — no controller sends the override
     %. 0–6,000 holds almost all cutting (90% of samples are under 2,500);
     rapids run far past it, and the needle pins while the number stays true.
  ════════════════════════════════════════ */
  readonly SPINDLE_ZONES: GaugeZone[] = [
    { from: 80,  to: 100, color: '#f5a623' },   // high
    { from: 100, to: 150, color: '#e03131' }    // overload
  ];
  readonly FEED_SCALE = 6000;

  readonly pctTick   = (v: number) => `${v}%`;
  readonly kTick     = (v: number) => (v === 0 ? '0' : `${v / 1000}k`);
  readonly spindleText = (v: number | null) => (v === null ? '--' : `${Math.round(v)}%`);
  readonly feedText    = (v: number | null) => (v === null ? '--' : `${Math.round(v).toLocaleString('en-IN')} mm/min`);

  get spindleState(): { word: string; cls: string } {
    const v = this.liveSpindleLoad;
    if (v > 100) return { word: 'Overload', cls: 'text-red-700 dark:text-red-400' };
    if (v >= 80) return { word: 'High', cls: 'text-amber-700 dark:text-amber-400' };
    return { word: 'Normal', cls: 'text-green-700 dark:text-green-400' };
  }

  /* ════════════════════════════════════════
     TIME PIE
  ════════════════════════════════════════ */
  private updateTimePie(): void {

    const r     = this.timeToSec(this.runTime);
    const i     = this.timeToSec(this.idleTime);
    const total = r + i;

    if (total === 0) {
      this.timePieSeries = [0, 100];
      return;
    }

    this.timePieSeries = [
      Number(((r / total) * 100).toFixed(1)),
      Number(((i / total) * 100).toFixed(1))
    ];
  }

  private timeToSec(t: string): number {
    if (!t) return 0;
    const p = t.split(':').map(Number);
    return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
  }

  /** "HH:MM:SS" → "06h 07m 00s" */
  formatDuration(t: string): string {
    if (!t) return '00h 00m 00s';
    const p = t.split(':').map(Number);
    const h = p[0] || 0;
    const m = p[1] || 0;
    const s = p[2] || 0;
    return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }

  get setupTime(): string {
    // Primary: MANUAL-mode seconds accumulated this shift (from production_hourly)
    const manualSec = Number((this.production as any)?.manual_seconds || 0);
    if (manualSec > 0) {
      return this.formatDuration(String(manualSec));
    }
    // Fallback: setting_time_start/end from job
    const start = this.job?.setting_time_start;
    const end   = this.job?.setting_time_end;
    if (start && end) {
      const diffMs = new Date(end).getTime() - new Date(start).getTime();
      if (diffMs > 0) {
        const totalSec = Math.floor(diffMs / 1000);
        return this.formatDuration(
          `${String(Math.floor(totalSec/3600)).padStart(2,'0')}:` +
          `${String(Math.floor((totalSec%3600)/60)).padStart(2,'0')}:` +
          `${String(totalSec%60).padStart(2,'0')}`
        );
      }
    }
    return '--';
  }

  /* ════════════════════════════════════════
     CHART INIT
     Enterprise speedometer style:
     • Utilization / OEE  → full radialBar (–135° to 135°)
     • Spindle / Feed     → half-arc gauge (–90° to 90°)
       with colour zones: green → amber → red
  ════════════════════════════════════════ */
  private initCharts(): void {

    /* ── Utilization ── */
    this.utilChart = {
      chart: { type: 'radialBar', height: 180},
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '58%' },
          track: { background: '#e8eaf0', strokeWidth: '97%' },
          dataLabels: {
            name: {
              show: true,
              offsetY: 18,
              fontSize: '11px',
              color: '#6b7280',
              fontFamily: 'inherit'
            },
            value: {
              show: true,
              offsetY: -15,
              fontSize: '24px',
              fontWeight: '700',
              color: '#3B4CCA',
              fontFamily: 'inherit',
              formatter: (val: number) => val + '%'
            }
          }
        }
      },
      colors: ['#3B4CCA'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          gradientToColors: ['#9B3F70'], stops: [0, 100]
        }
      }
    };

    /* ── OEE — dashed-segment radialBar ── */
    this.oeeChart = {
      chart: { type: 'radialBar', height: 250, sparkline: { enabled: true } },
      labels: ['OEE'],
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '42%' },
          track: {
            show: true,
            background: '#E0E0E0', // background: isDark ? '#1f2937' : '#e5e7eb',
            strokeWidth: '100%',
            opacity: 0.5,
            margin: 0
          },
          dataLabels: {
            name:  { show: false },
            value: { show: false }   // value overlaid via HTML
          }
        }
      },
      dataLabels: { enabled: false },
      fill:   { type: 'solid', colors: ['#3B4CCA'] },
      stroke: { dashArray: 4 }
    };

    // const isDark = document.body.classList.contains('dark');
    
    /* ── Time Pie ── */
    this.timePieChart = {
  chart: { type: 'pie', height: 180 },
  labels: ['Running', 'Idle'],
  colors: ['#0CAD5D', '#dfb400'],
  legend: { show: false },
  stroke: { width: 1 },
  dataLabels: {
    minAngleToShowLabel: 15,
    formatter: (v: any) => `${v.toFixed(1)}%`,
    offset: -25,
    style: {
      fontSize: '14px',
      fontWeight: 600,
      colors: ['#fff'],

    }
  }
};
  }
}