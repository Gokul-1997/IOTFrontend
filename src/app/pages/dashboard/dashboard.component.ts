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

  lines: any[] = [];
  summary: any = {};
  shift: any = {};

  /* ===== MACHINE INDEX MAP (O(1) updates) ===== */
  private machineMap = new Map<number, any>();

  /* ===== SOCKET FLOOD PROTECTION ===== */
  private updateQueue: any[] = [];
  private updateScheduled = false;

  /* ===== VISIBILITY HANDLER ===== */
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

    /* SOCKET LISTENER */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });

    /* TAB VISIBILITY OPTIMIZATION */
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

        this.lines = res.lines || [];
        this.summary = res.summary || {};
        this.shift = res.shift || {};

        /* BUILD MACHINE MAP */
        this.machineMap.clear();

        for (const line of this.lines) {
          for (const machine of line.machines) {
            this.machineMap.set(machine.machine_id, machine);
          }
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

          for (const u of updates) {
            this.applyLiveUpdate(u);
          }

          this.cdr.markForCheck();
        });

        this.updateScheduled = false;
      });
    }

  }

  /* ================= APPLY MACHINE UPDATE ================= */

  private applyLiveUpdate(data: any): void {

    const machine = this.machineMap.get(data.machine_id);

    if (!machine) return;

    const rawStatus = data.machine_status;

    let status = 'STOPPED';

    if (['RUN','RUNNING','CUTTING'].includes(rawStatus)) {
      status = 'RUNNING';
    }
    else if (['READY','HOLD'].includes(rawStatus)) {
      status = 'IDLE';
    }

    machine.status = status;

  }

  /* ================= NAVIGATION ================= */

  goToLive(id: number): void {
    this.router.navigate(['dashboard/live', id]);
  }

  /* ================= TRACKBY ================= */

  trackByMachine(index: number, item: any): number {
    return item.machine_id;
  }

  trackByLine(index: number, item: any): number {
    return item.line_id;
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