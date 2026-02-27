import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from './dashboard.service';
import { RouterModule, Router } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon';
import { SocketService } from '../../core/services/socket.service';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  summary: any = {};

  page = 1;
  total = 0;
  perPage = 6;
  today: Date = new Date();

  constructor(
    private service: DashboardService,
    private router: Router,
    private socketService: SocketService
  ) {}

async ngOnInit(): Promise<void> {

  this.loadSummary();
  this.load(this.page);

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const plantId = user?.plant_id;

  await this.socketService.connect();   // 🔥 WAIT UNTIL CONNECTED

  if (plantId) {
    this.socketService.joinPlant(plantId);
  }

  this.socketService.onMachineUpdate((data: any) => {
    console.log('🔥 LIVE UPDATE:', data);
    this.handleLiveUpdate(data);
  });
}

  ngOnDestroy(): void {
    this.socketService.disconnect();
  }

  /* ================= HTTP LOAD ================= */

  load(page: number = 1): void {
    this.service.getLive(page).subscribe((res: any) => {
      this.page = page;
      this.total = res.total || 0;
      this.machines = res.machines || [];
    });
  }

  loadSummary(): void {
    this.service.getSummary().subscribe((res: any) => {
      this.summary = res.data || {};
    });
  }

  /* ================= LIVE UPDATE ================= */

  private handleLiveUpdate(data: any): void {

    // Update machine live state immutably
    this.machines = this.machines.map(machine =>
      machine.machine_id === data.machine_id
        ? { ...machine, live: data }
        : machine
    );

    // Optional: live summary adjustment
    this.recalculateSummary();
  }

  private recalculateSummary(): void {

    const total = this.machines.length;

    let running = 0;
    let idle = 0;
    let stopped = 0;

    this.machines.forEach(m => {
      const status = m.live?.machine_status;

      if (status === 'RUN' || status === 'CUTTING') running++;
      else if (status === 'READY' || status === 'HOLD') idle++;
      else if (status) stopped++;
    });

    this.summary = {
      total,
      running,
      idle,
      stopped
    };
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

  trackByMachine(index: number, item: any) {
    return item.machine_id;
  }
}