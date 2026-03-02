import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from './dashboard.service';
import { RouterModule, Router } from '@angular/router';
import { SocketService } from '../../core/services/socket.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machines: any[] = [];
  summary: any = {};

  page = 1;
  total = 0;
  perPage = 6;
  today: Date = new Date();

  constructor(
    private service: DashboardService,
    private router: Router,
    private socketService: SocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  /* ================= INIT ================= */

  async ngOnInit(): Promise<void> {

    const token = localStorage.getItem('token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;

    await this.initializeSocket(plantId);

    this.loadSummary();
    this.load(this.page);
  }

  /* ================= SOCKET ================= */

  private async initializeSocket(plantId: number): Promise<void> {

    await this.socketService.connect();

    if (plantId) {
      this.socketService.joinPlant(plantId);
    }

    this.socketService.onMachineUpdate((data: any) => {
      this.zone.run(() => {
        console.log('🔥 LIVE UPDATE:', data);
        this.handleLiveUpdate(data);
        this.cdr.markForCheck();
      });
    });
  }

  /* ================= API LOAD ================= */

  load(page: number = 1): void {

    this.service.getLive(page, this.perPage)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.page = page;
          this.total = res.total || 0;
          this.machines = res.machines || [];
          this.cdr.markForCheck();
        },
        error: () => {
          console.error('Failed to load machines');
        }
      });
  }

  loadSummary(): void {
    this.service.getSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.summary = res || {};
        },
        error: () => {
          console.error('Failed to load summary');
        }
      });
  }

  /* ================= LIVE UPDATE ================= */

  private handleLiveUpdate(data: any): void {

    const index = this.machines.findIndex(
      m => m.machine_id === data.machine_id
    );

    if (index === -1) return;

    const rawStatus = data.machine_status;

    let status = 'IDLE';
    let alarm = false;

    switch (rawStatus) {
      case 'RUN':
      case 'RUNNING':
      case 'CUTTING':
        status = 'RUNNING';
        break;

      case 'ALARM':
        status = 'IDLE';
        alarm = true;
        break;

      default:
        status = 'IDLE';
    }

    const updatedMachine = {
      ...this.machines[index],
      status,
      alarm,
      rpm: data.rpm,
      feed_rate: data.feed_rate,
      parts_count: data.parts_count
    };

    // Immutable update for change detection
    this.machines = [
      ...this.machines.slice(0, index),
      updatedMachine,
      ...this.machines.slice(index + 1)
    ];
  }

  /* ================= PAGINATION ================= */

  next(): void {
    if (this.page * this.perPage < this.total) {
      this.load(this.page + 1);
    }
  }

  prev(): void {
    if (this.page > 1) {
      this.load(this.page - 1);
    }
  }

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
  }
}