import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';

import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';

import { Subject, takeUntil } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [
    CommonModule,
    NgApexchartsModule
  ],
  templateUrl: './live.component.html',
  styleUrls: ['./live.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machineId!: number;

  machine: any = {};
  operator: any = {};
  job: any = {};
  time: any = {};
  quality: any = {};
  oee: any = {};
  shift: any = {};

  liveStatus = 'UNKNOWN';
  liveRPM = 0;
  liveFeed = 0;

  runTime = '00:00:00';
  idleTime = '00:00:00';
  utilization = 0;
  cuttingSpeed = 0;

  currentDate = new Date();

  radialOptions: any;
  oeeOptions: any;
  timelineOptions: any;
  spindleOptions: any;

  spindleNeedleAngle = 0;

  private updateQueue: any[] = [];
  private updateScheduled = false;

  feedSeries: any[] = [
    {
      name: 'Feed Rate',
      data: []
    }
  ];

  feedChart: any;
  private feedBuffer: any[] = [];

  constructor(
    private route: ActivatedRoute,
    private dashboardService: DashboardService,
    private socketService: SocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  /* =====================================================
     INIT
  ===================================================== */

  async ngOnInit(): Promise<void> {

    const id = this.route.snapshot.paramMap.get('id');
    this.machineId = Number(id);

    this.initCharts();

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;

    await this.socketService.connect();

    if (plantId) {
      this.socketService.joinPlant(plantId);
    }

    this.loadMachineDetail();

    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });

  }

  ngOnDestroy(): void {

    this.destroy$.next();
    this.destroy$.complete();

  }

  /* =====================================================
     LOAD MACHINE DETAIL
  ===================================================== */

  loadMachineDetail(): void {

    this.dashboardService
      .getMachineDetail(this.machineId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((res: any) => {

        const d = res.data;

        this.machine = d.machine;
        this.operator = d.operator;
        this.job = d.job;
        this.time = d.production;
        this.oee = d.oee;
        this.shift = d.shift;

        this.runTime = d.production.run_time;
        this.idleTime = d.production.idle_time;

        this.liveStatus = d.live.machine_status;
        this.liveRPM = d.live.rpm;
        this.liveFeed = d.live.feed_rate;

        this.oeeOptions.series = [
          Number(this.oee.oee || 0)
        ];

        const percent =
          this.job.target_qty > 0
            ? (this.job.achieved_qty / this.job.target_qty) * 100
            : 0;

        this.radialOptions.series = [
          Math.round(percent)
        ];

        this.updateSpindleGauge(this.liveRPM);

        this.cdr.markForCheck();

      });

  }

  /* =====================================================
     SOCKET LIVE UPDATE
  ===================================================== */

  private handleSocketUpdate(data: any): void {

    if (data.machine_id !== this.machineId) return;

    this.updateQueue.push(data);

    if (!this.updateScheduled) {

      this.updateScheduled = true;

      requestAnimationFrame(() => {

        const updates = [...this.updateQueue];
        this.updateQueue = [];

        this.zone.run(() => {

          for (const update of updates) {

            if (update.machine_status !== undefined) {
              this.liveStatus = update.machine_status;
            }

            if (update.rpm !== undefined) {

              this.liveRPM = update.rpm;

              const percent = Math.min((update.rpm / 3000) * 100, 100);

              this.spindleOptions.series = [percent];

              this.updateSpindleNeedle(percent);
            }

            if (update.feed_rate !== undefined) {

              this.liveFeed = update.feed_rate;

              const point = {
                x: new Date().getTime(),
                y: update.feed_rate
              };

              this.feedBuffer.push(point);

              if (this.feedBuffer.length > 60) {
                this.feedBuffer.shift();
              }

              this.feedSeries = [
                {
                  name: 'Feed Rate',
                  data: [...this.feedBuffer]
                }
              ];

            }

            if (update.run_time !== undefined) {
              this.runTime = update.run_time;
            }

            if (update.idle_time !== undefined) {
              this.idleTime = update.idle_time;
            }

            if (update.achieved_qty !== undefined) {
              this.job.achieved_qty = update.achieved_qty;
            }

            if (update.utilization !== undefined) {

              this.utilization = update.utilization;

              this.radialOptions.series = [
                Math.round(update.utilization)
              ];
            }

            if (update.cutting_speed !== undefined) {
              this.cuttingSpeed = update.cutting_speed;
            }

          }

          this.currentDate = new Date();

          this.cdr.markForCheck();

        });

        this.updateScheduled = false;

      });

    }

  }

  /* =====================================================
     SPINDLE GAUGE
  ===================================================== */

  updateSpindleGauge(rpm: number) {

    if (!this.spindleOptions) return;

    const percent = Math.min((rpm / 3000) * 100, 100);

    this.spindleOptions.series = [percent];

    this.updateSpindleNeedle(percent);

  }

  updateSpindleNeedle(value: number) {

    this.spindleNeedleAngle = (value * 180) / 100 - 90;

  }

  /* =====================================================
     CHART INIT
  ===================================================== */

  initCharts() {

    this.radialOptions = {
      series: [0],
      chart: { type: 'radialBar', height: 220 },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135,
          dataLabels: {
            value: {
              formatter: (v: any) => `${v}%`
            }
          }
        }
      }
    };

    this.oeeOptions = {
      series: [0],
      chart: { type: 'radialBar', height: 250 },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135
        }
      }
    };

    this.spindleOptions = {
      series: [0],
      chart: { type: 'radialBar', height: 200 },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle: 90
        }
      }
    };

    this.feedChart = {

      chart: {
        type: 'line',
        height: 220,
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'linear',
          dynamicAnimation: { speed: 300 }
        }
      },

      stroke: { curve: 'smooth', width: 3 },

      dataLabels: { enabled: false },

      xaxis: {
        type: 'datetime',
        range: 60000
      },

      yaxis: {
        min: 0,
        max: 500,
        tickAmount: 5
      },

      tooltip: {
        x: { format: 'HH:mm:ss' }
      }

    };

  }

}