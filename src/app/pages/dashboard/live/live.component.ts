import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { DashboardService } from '../dashboard.service';
import { ChartComponent } from "ng-apexcharts";
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [
    CommonModule,
    NgApexchartsModule         
  ],
  templateUrl: './live.component.html',
  styleUrls: ['./live.component.scss']
})
export class LiveComponent implements OnInit, OnDestroy {

  machineId!: number;
  liveSub!: Subscription;

  machine: any = {};
  shift: any = null;
  job: any = {};
  production: any = {};
  oee: any = {};

  liveStatus: string = '';
  liveRPM: number = 0;
  liveFeed: number = 0;
  currentDate: Date = new Date();

  runningprogress = 0;
  spindleValue = 0;
  spindleNeedleAngle = 0;


  timelineOptions: any;
  spindleOptions: any;
  radialOptions: any;
  oeeOptions: any;

  constructor(
    private route: ActivatedRoute,
    private dashboardService: DashboardService,
     private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {

    const idParam = this.route.snapshot.paramMap.get('id');

    if (!idParam) {
      console.error("Machine ID missing in route");
      return;
    }

    this.machineId = Number(idParam);

    if (!this.machineId) {
      console.error("Invalid machine ID:", idParam);
      return;
    }

    console.log("Machine ID:", this.machineId);

    this.initCharts();
    this.loadMachineDetail();
    this.loadTimeline();
    this.loadTrend();
    this.loadLive();

  }

  ngOnDestroy(): void {
    if (this.liveSub) this.liveSub.unsubscribe();
  }

  /* ---------------- MACHINE DETAIL ---------------- */

  loadMachineDetail() {
    this.dashboardService.getMachineDetail(this.machineId)
      .subscribe((res: any) => {

        const data = res.data;

        this.machine = data.machine;
        this.shift = data.shift;
        this.job = data.job;
        this.production = data.production;
        this.oee = data.oee;

        const run = this.production?.run_minutes || 0;
        const idle = this.production?.idle_minutes || 0;
        const off = this.production?.off_minutes || 0;
        const total = run + idle + off;

        this.runningprogress = total > 0
          ? Math.round((run / total) * 100)
          : 0;

        if (this.oee?.oee) {
          this.oeeOptions.series = [Number(this.oee.oee)];
        }

        if (this.job?.target_qty) {
          const percent =
            (this.job.achieved_qty / this.job.target_qty) * 100;
          this.radialOptions.series = [Math.round(percent)];
        }
    this.cdr.markForCheck();

      });
  }

  /* ---------------- LIVE ---------------- */

  /* ---------------- LIVE ---------------- */

  loadLive() {
    this.dashboardService.getMachineLive(this.machineId)
      .subscribe((res: any) => {

        const live = res.data;
        if (!live) return;

        // 🔹 Update machine status
        this.liveStatus = live.machine_status || 'UNKNOWN';

        // 🔹 Update RPM
        if (live.rpm !== undefined && live.rpm !== null) {
          this.liveRPM = live.rpm;

          const percent = Math.min((live.rpm / 3000) * 100, 100);
          this.spindleOptions.series = [percent];
          this.updateSpindleNeedle(percent);
        }

        // 🔹 Update Feed Rate
        if (live.feed_rate !== undefined && live.feed_rate !== null) {
          this.liveFeed = live.feed_rate;
        }

        // 🔹 Optional: Live part counter update
        if (live.parts_count !== undefined) {
          this.job.achieved_qty = live.parts_count;
        }

        // 🔹 Update current time
        this.currentDate = new Date();

      }, (err) => {
        console.error('Live API error:', err);
      });
  }

  /* ---------------- TIMELINE ---------------- */

  loadTimeline() {
    this.dashboardService.getTimeline(this.machineId)
      .subscribe((res: any) => {

        const rows = res.data;
        const formatted = this.convertTimeline(rows);

        this.timelineOptions.series = [{
          name: "Machine",
          data: formatted
        }];
      });
  }

  convertTimeline(rows: any[]) {

    const blocks: any[] = [];

    for (let i = 0; i < rows.length - 1; i++) {

      const start = new Date(rows[i].bucket).getTime();
      const end = new Date(rows[i + 1].bucket).getTime();

      const status = rows[i].machine_status;

      let color = "#16a34a";

      if (['READY', 'HOLD'].includes(status)) color = "#f59e0b";
      if (['STOP', 'ALARM', 'EMERGENCY'].includes(status)) color = "#ef4444";

      blocks.push({
        x: "Machine",
        y: [start, end],
        fillColor: color,
        status: status
      });
    }

    return blocks;
  }

  /* ---------------- TREND ---------------- */

  loadTrend() {
    this.dashboardService.getTrend(this.machineId)
      .subscribe();
  }

  /* ---------------- CHART INIT ---------------- */

  initCharts() {

    this.radialOptions = {
      series: [0],
      chart: { type: "radialBar", height: 200 },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135,
          dataLabels: {
            value: {
              formatter: (val: any) => val + "%"
            }
          }
        }
      }
    };

    this.oeeOptions = {
      series: [0],
      chart: { type: "radialBar", height: 250 },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135
        }
      }
    };

    this.timelineOptions = {
      series: [],
      chart: { type: "rangeBar", height: 130 },
      plotOptions: { bar: { horizontal: true } },
      xaxis: { type: "datetime" }
    };

    this.spindleOptions = {
      series: [0],
      chart: { type: "radialBar", height: 200 },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle: 90
        }
      }
    };
  }

  updateSpindleNeedle(value: number) {
    this.spindleNeedleAngle = (value * 180) / 100 - 90;
  }
}