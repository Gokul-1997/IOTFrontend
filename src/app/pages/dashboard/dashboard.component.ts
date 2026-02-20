import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from './dashboard.service';
import { RouterModule, Router } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon';  // adjust path if needed

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule,IconComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  page = 1;
  total = 0;
  perPage = 6;
  timer: any;

  constructor(
    private service: DashboardService,
    private router: Router
  ) {}

  ngOnInit() {
    this.load(this.page);

    // auto refresh current page only
    this.timer = setInterval(() => {
      this.load(this.page);
    }, 10000);
  }

  ngOnDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  load(page: number = 1) {

    this.service.getLive(page).subscribe({
      next: (res: any) => {

        this.page = page;
        this.total = res.total || 0;

        if (!res.machines || res.machines.length === 0) {
          this.machines = this.getDummyData();
          return;
        }

        this.machines = res.machines;
      },
      error: () => {
        this.machines = this.getDummyData();
      }
    });
  }

  // Pagination
  next() {
    if (this.page * this.perPage < this.total) {
      this.load(this.page + 1);
    }
  }

  prev() {
    if (this.page > 1) {
      this.load(this.page - 1);
    }
  }

  goToLive(id: number) {
    this.router.navigate(['dashboard/live', id]);
  }

  // ===== Dummy fallback =====
  getDummyData() {
    return Array(6).fill(null).map((_, i) => ({
      machine_id: i + 1,
      machine_name: 'CNC136',
      oee: 63,
      production: {
        run_minutes: 480,
        idle_minutes: 30,
        off_minutes: 60
      },
      live: {
        machine_status: 'RUN'
      }
    }));
  }

  // ===== Counts (Top Stats) =====
  get totalMachines() {
    return this.total || this.machines.length;
  }

  get runningCount() {
    return this.machines.filter(
      m => m.live?.machine_status === 'RUN'
    ).length;
  }

  get stoppedCount() {
    return this.machines.filter(
      m => ['STOP','ALARM','EMERGENCY'].includes(m.live?.machine_status)
    ).length;
  }

  get idleCount() {
    return this.machines.filter(
      m => m.live?.machine_status === 'IDLE'
    ).length;
  }
}
