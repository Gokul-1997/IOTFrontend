import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';
import {
  Subject,
  interval,
  switchMap,
  startWith,
  takeUntil
} from 'rxjs';
import { CommonModule } from '@angular/common';

/* ─────────────────────────────────────────
   SOCKET  → machine_status, rpm, feed_rate ONLY
             instant live needle updates

   API 30s → run_time, idle_time, utilization,
             achieved_qty, target_qty, oee,
             quality, production data
───────────────────────────────────────── */

const POLL_MS = 30_000;

/* Gauge max values — adjust to match your machine specs */
const RPM_MAX      = 8000;   // max spindle RPM
const FEED_MAX     = 50000;  // max feed rate (mm/min) — covers 30043 comfortably

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [NgApexchartsModule, CommonModule],
  templateUrl: './live.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machineId!: number;

  /* ── Gauge scale constants (exposed for template) ── */
  readonly RPM_MAX  = RPM_MAX;
  readonly FEED_MAX = FEED_MAX;

  /* ── API-owned state ── */
  machine:  any = {};
  operator: any = {};
  job:      any = {};
  oee:      any = {};
  shift:    any = {};
  quality:  any = {};
  power:    any = {};

  runTime   = '00:00:00';
  idleTime  = '00:00:00';
  utilization = 0;

  /* ── Socket-owned state ── */
  liveStatus    = 'UNKNOWN';
  liveRPM       = 0;
  liveFeed       = 0;
  livePartCount = 0;

  /* ── UI helpers ── */
  currentDate      = new Date();
  socketHasUpdated = false;   // true after first socket message for this machine

  /* ── Chart series ── */
  utilSeries:    number[] = [0];
  oeeSeries:     number[] = [0];
  spindleSeries: number[] = [0];
  feedSeries:    number[] = [0];
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
    private cdr:              ChangeDetectorRef
  ) {}

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  async ngOnInit(): Promise<void> {

    const id      = this.route.snapshot.paramMap.get('id');
    this.machineId = Number(id);

    this.initCharts();

    /* ── Connect socket first, then join plant room ──
       Must await connect() before joinPlant() —
       otherwise socket is not ready and join is silently ignored */
    console.log('[SOCKET] connecting...');
    await this.socketService.connect();
    console.log('[SOCKET] connected ✅');

    const user    = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;
    if (plantId) {
      this.socketService.joinPlant(plantId);
      console.log(`[SOCKET] joined plant room: plant:${plantId}`);
    } else {
      console.warn('[SOCKET] ⚠ no plant_id in localStorage — cannot join room');
    }

    console.log(`[SOCKET] listening for machine_id: ${this.machineId}`);

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
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.socketService.disconnect();
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

    this.machine  = d.machine  || this.machine;
    this.operator = d.operator || this.operator;
    this.job      = d.job      || this.job;
    this.oee      = d.oee      || this.oee;
    this.shift    = d.shift    || this.shift;
    this.quality  = d.quality  || this.quality;
    this.power    = d.power    || this.power;

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

    /* Seed live values from API on first load only.
       After first socket message arrives, socket owns these fields.
       We use a flag so API never overwrites socket-updated values. */
    if (d.live && !this.socketHasUpdated) {
      this.liveStatus    = d.live.machine_status || 'UNKNOWN';
      this.liveRPM       = Number(d.live.rpm       || 0);
      this.liveFeed      = Number(d.live.feed_rate  || 0);
      this.livePartCount = Number(d.live.parts_count || 0);
      this.spindleSeries = [this.rpmToPercent(this.liveRPM)];
      this.feedSeries    = [this.feedToPercent(this.liveFeed)];
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

    console.log('[SOCKET] raw message received:', data);

    /* Ensure Number comparison — socket payload may send id as string */
    if (Number(data.machine_id) !== this.machineId) {
      console.log(`[SOCKET] ignored — machine_id ${data.machine_id} !== current ${this.machineId}`);
      return;
    }

    console.log(`[SOCKET] ✅ matched machine ${this.machineId} — applying:`, {
      status:      data.machine_status,
      rpm:         data.rpm,
      feed_rate:   data.feed_rate,
      parts_count: data.parts_count,
      alarm:       data.alarm
    });

    this.zone.run(() => {

      /* Mark that socket is now active for this machine —
         API will no longer seed live values after this point */
      this.socketHasUpdated = true;

      /* ── Status ── */
      if (data.machine_status !== undefined) {
        console.log(`[SOCKET] status: ${this.liveStatus} → ${data.machine_status}`);
        this.liveStatus = data.machine_status;
      }

      /* ── RPM → gauge percent ── */
      if (data.rpm !== undefined) {
        this.liveRPM       = Number(data.rpm);
        this.spindleSeries = [this.rpmToPercent(this.liveRPM)];
        console.log(`[SOCKET] rpm: ${this.liveRPM} → gauge: ${this.spindleSeries[0]}%`);
      }

      /* ── Feed rate → gauge percent ── */
      if (data.feed_rate !== undefined) {
        this.liveFeed   = Number(data.feed_rate);
        this.feedSeries = [this.feedToPercent(this.liveFeed)];
        console.log(`[SOCKET] feed_rate: ${this.liveFeed} → gauge: ${this.feedSeries[0]}%`);
      }

      /* ── parts_count → achieved qty (real-time counter) ── */
      if (data.parts_count !== undefined) {
        this.livePartCount = Number(data.parts_count);
        console.log(`[SOCKET] parts_count (achieved): ${this.livePartCount}`);
      }

      this.currentDate = new Date();
      this.cdr.markForCheck();

      console.log('[SOCKET] cdr.markForCheck() called — UI should update');
    });
  }

  /* ════════════════════════════════════════
     GAUGE HELPERS
     Convert raw values to 0–100% for ApexCharts
     radialBar, while keeping true value for display
  ════════════════════════════════════════ */

  /** RPM → 0–100% of RPM_MAX */
  private rpmToPercent(rpm: number): number {
    return Math.min(Number(((rpm / RPM_MAX) * 100).toFixed(1)), 100);
  }

  /** Feed rate → 0–100% of FEED_MAX */
  private feedToPercent(feed: number): number {
    return Math.min(Number(((feed / FEED_MAX) * 100).toFixed(1)), 100);
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

  /* ════════════════════════════════════════
     CHART INIT
     Enterprise speedometer style:
     • Utilization / OEE  → full radialBar (–135° to 135°)
     • Spindle / Feed     → half-arc gauge (–90° to 90°)
       with colour zones: green → amber → red
  ════════════════════════════════════════ */
  private initCharts(): void {

    /* Shared gauge colour stops */
    const gaugeColors = (hex: string) => [hex];

    /* ── Utilization ── */
    this.utilChart = {
      chart: { type: 'radialBar', height: 220, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '62%' },
          track: { background: '#e8eaf0', strokeWidth: '97%' },
          dataLabels: {
            name:  { show: false },
            value: { show: false }   // we render value in template
          }
        }
      },
      colors: ['#2B3990'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          gradientToColors: ['#9B3F70'], stops: [0, 100]
        }
      }
    };

    /* ── OEE ── */
    this.oeeChart = {
      chart: { type: 'radialBar', height: 240, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle:    135,
          hollow: { size: '62%' },
          track: { background: '#e8eaf0', strokeWidth: '97%' },
          dataLabels: {
            name:  { show: false },
            value: { show: false }
          }
        }
      },
      colors: ['#1BC98E'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          gradientToColors: ['#1E88E5'], stops: [0, 100]
        }
      }
    };

    /* ── Spindle RPM speedometer ──
       Half-arc, colour zones via gradient:
       0–50% green, 50–80% amber, 80–100% red
       Tick marks via track offsetY
    ── */
    this.spindleChart = {
      chart: { type: 'radialBar', height: 220, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle:    90,
          hollow: { size: '60%' },
          track: {
            background: '#e8eaf0',
            strokeWidth: '97%',
            margin: 4
          },
          dataLabels: {
            name:  { show: false },
            value: { show: false }
          }
        }
      },
      colors: ['#1E88E5'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          gradientToColors: ['#E53935'],
          colorStops: [
            { offset: 0,   color: '#1BC98E', opacity: 1 },
            { offset: 50,  color: '#FFA726', opacity: 1 },
            { offset: 100, color: '#E53935', opacity: 1 }
          ],
          stops: [0, 50, 100]
        }
      }
    };

    /* ── Feed Override speedometer ── */
    this.feedChart = {
      chart: { type: 'radialBar', height: 220, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle:    90,
          hollow: { size: '60%' },
          track: {
            background: '#e8eaf0',
            strokeWidth: '97%',
            margin: 4
          },
          dataLabels: {
            name:  { show: false },
            value: { show: false }
          }
        }
      },
      colors: ['#7B1FA2'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark', type: 'horizontal',
          colorStops: [
            { offset: 0,   color: '#1BC98E', opacity: 1 },
            { offset: 50,  color: '#FFA726', opacity: 1 },
            { offset: 100, color: '#E53935', opacity: 1 }
          ],
          stops: [0, 50, 100]
        }
      }
    };

    /* ── Time Pie ── */
    this.timePieChart = {
      chart:       { type: 'pie', height: 260 },
      labels:      ['Running', 'Idle'],
      colors:      ['#1E88E5', '#1BC98E'],
      legend:      { position: 'right' },
      dataLabels:  { formatter: (v: any) => `${v.toFixed(1)}%` }
    };
  }
}