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

  /* ===== MACHINE INDEX MAP ===== */
  private machineMap = new Map<number, any>();

  /* ===== SOCKET FLOOD PROTECTION ===== */
  private updateQueue: any[] = [];
  private updateScheduled = false;

  /* ===== TAB VISIBILITY ===== */
  private visibilityHandler = () => {
    if (document.hidden) {
      this.socketService.pauseUpdates();
    } else {
      this.socketService.resumeUpdates();
    }
  };

  constructor(
    private service: DashboardService,
    private socketService: SocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

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

        /* build machine map for fast socket updates */
        this.machineMap.clear();
        for (const m of this.machines) {
          this.machineMap.set(m.machine_id, m);
        }

        this.cdr.markForCheck();
      });
  }

  /* ================= SOCKET HANDLING ================= */

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

            /* status update */
            if (update.machine_status === 'RUNNING') {
              machine.status = 'RUNNING';
            } 
            else if (update.alarm) {
              machine.status = 'STOPPED';
            } 
            else {
              machine.status = 'IDLE';
            }

            machine.alarm = update.alarm === true;
          }

          /* summary recalculation */

          let running = 0;
          let idle = 0;

          for (const m of this.machines) {
            if (m.status === 'RUNNING') running++;
            else idle++;
          }

          this.summary.running = running;
          this.summary.idle = idle;
          this.summary.total = this.machines.length;

          this.cdr.markForCheck();

        });

        this.updateScheduled = false;

      });
    }
  }

  /* ================= NAVIGATION ================= */

  goToLive(id: number): void {
    this.router.navigate(['/dashboard/live', id]);
  }

  /* ================= TRACKBY ================= */

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