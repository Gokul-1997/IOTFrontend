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
import { Subject } from 'rxjs';

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

  /* ===== SOCKET FLOOD PROTECTION ===== */
  private updateQueue: any[] = [];
  private updateScheduled = false;

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
      this.socketService.joinPlant(plantId);  // 🔥 VERY IMPORTANT
    }

    this.load();

    /* ===== SOCKET LISTENER ===== */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });
  }

  /* ================= LOAD API ================= */

  load(): void {
    this.service.getLive()
      .subscribe((res: any) => {
        this.lines = res.lines || [];
        this.summary = res.summary || {};
        this.shift = res.shift || {};
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

  private applyLiveUpdate(data: any): void {

    for (const line of this.lines) {

      const index = line.machines.findIndex(
        (m: any) => m.machine_id === data.machine_id
      );

      if (index !== -1) {

        const rawStatus = data.machine_status;

        let status = 'STOPPED';

        if (['RUN','RUNNING','CUTTING'].includes(rawStatus)) {
          status = 'RUNNING';
        } else if (['READY','HOLD'].includes(rawStatus)) {
          status = 'IDLE';
        }

        line.machines[index] = {
          ...line.machines[index],
          status
        };

        break;
      }
    }
  }

  /* ================= NAVIGATION ================= */

  goToLive(id: number): void {
    this.router.navigate(['dashboard/live', id]);
  }

  trackByMachine(index: number, item: any): number {
    return item.machine_id;
  }

  /* ================= DESTROY ================= */

  ngOnDestroy(): void {

    this.destroy$.next();
    this.destroy$.complete();

    this.socketService.disconnect();  // 🔥 Prevent memory leak
  }
}