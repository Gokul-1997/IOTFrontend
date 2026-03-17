import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DashboardService } from './dashboard.service';
import { SocketService } from '../../core/services/socket.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machines: any[] = [];
  summary: any = {};
  shift: any = {};

  private machineMap = new Map<number, any>();

  private updateQueue: any[] = [];
  private updateScheduled = false;

  private runtimeTimer!: any;

  private visibilityHandler = () => {
    if (document.hidden) {
      this.socketService.pauseUpdates();
    } else {
      this.socketService.resumeUpdates();
    }
  };
  private calculateUtilization(runTime: string): number {

    if (!runTime || !this.shift?.plannedMinutes) return 0;

    const [h, m, s] = runTime.split(':').map(Number);

    const runMinutes = (h * 60) + m + (s / 60);

    const util = (runMinutes * 100) / this.shift.plannedMinutes;

    return Number(util.toFixed(2));
  }

  getLastSeen(last: string | null): string {

  if (!last) return 'No Data';

  const diff =
    (Date.now() - new Date(last).getTime()) / 1000;

  if (diff < 60) return `${Math.floor(diff)} sec ago`;

  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;

  return `${Math.floor(diff/3600)} hr ago`;
}

  
  constructor(
    private service: DashboardService,
    private socketService: SocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) { }

  /* ================= INIT ================= */

  async ngOnInit(): Promise<void> {

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;

    await this.socketService.connect();

    if (plantId) {
      this.socketService.joinPlant(plantId);
    }

    this.load();


    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });

    document.addEventListener(
      'visibilitychange',
      this.visibilityHandler
    );
  }

  /* ================= LOAD API ================= */

  load(): void {

    this.service.getLive()
      .pipe(takeUntil(this.destroy$))
      .subscribe((res: any) => {

        this.machines = res.machines || [];
        this.summary = res.summary || {};
        this.shift = res.shift || {};

        this.machineMap.clear();

        for (const m of this.machines) {

          if (!m.run_time) m.run_time = '00:00:00';
          if (!m.idle_time) m.idle_time = '00:00:00';

          m.received_at = 0;

          /* flag for socket-based updates */
          m.active = false;

          this.machineMap.set(m.machine_id, m);
        }

        this.cdr.markForCheck();
      });
  }

  /* ================= SOCKET ================= */

  private handleSocketUpdate(data: any): void {

    this.updateQueue.push(data);

    if (!this.updateScheduled) {

      this.updateScheduled = true;

      requestAnimationFrame(() => {

        const updates = [...this.updateQueue];
        this.updateQueue = [];

        this.zone.run(() => {

          for (const update of updates) {

            const machine = this.machineMap.get(update.machine_id);
            if (!machine) continue;

            machine.received_at = update.received_at;

            machine.status =
              update.machine_status === 'RUNNING'
                ? 'RUNNING'
                : 'IDLE';

            machine.alarm = update.alarm === true;

            if (update.run_time) {
              machine.run_time = update.run_time;

              /* 🔥 calculate utilization */
              machine.utilization =
                this.calculateUtilization(update.run_time);
            }

            if (update.idle_time) {
              machine.idle_time = update.idle_time;
            }

            if (update.achieved_qty !== undefined) {
              machine.achieved_qty = update.achieved_qty;
            }
          }

          this.recalculateSummary();

          this.cdr.markForCheck();

        });

        this.updateScheduled = false;

      });
    }
  }
  /* ================= TIME HELPER ================= */

  private incrementTime(time: string): string {

    const parts = time.split(':').map(Number);

    let h = parts[0];
    let m = parts[1];
    let s = parts[2];

    s++;

    if (s >= 60) {
      s = 0;
      m++;
    }

    if (m >= 60) {
      m = 0;
      h++;
    }

    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');

    return `${hh}:${mm}:${ss}`;
  }

  /* ================= SUMMARY ================= */

  private recalculateSummary(): void {

    let running = 0;
    let idle = 0;

    for (const m of this.machines) {
      if (m.status === 'RUNNING') running++;
      else idle++;
    }

    this.summary.running = running;
    this.summary.idle = idle;
    this.summary.total = this.machines.length;
  }

  /* ================= NAVIGATION ================= */

  goToLive(id: number): void {
    this.router.navigate(['/dashboard/live', id]);
  }

  trackByMachine(index: number, item: any): number {
    return item.machine_id;
  }

  /* ================= DESTROY ================= */

  ngOnDestroy(): void {

    this.destroy$.next();
    this.destroy$.complete();

    document.removeEventListener(
      'visibilitychange',
      this.visibilityHandler
    );

    this.socketService.disconnect();
  }

}