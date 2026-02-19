import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from './dashboard.service';
import { IconComponent } from '../../shared/icon/icon';
import { Router } from '@angular/router';
import { RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, IconComponent,RouterModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  timer!: any;
  progress = 63;

  constructor(private service: DashboardService,private cdr: ChangeDetectorRef,private router: Router) { }

  ngOnInit() {
    this.load();
    // this.timer = setInterval(() => this.load(), 15000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  load() {
    this.service.getLive().subscribe({
      next: res => {
        this.machines = res;
        this.cdr.markForCheck();

      },
      error: err => console.error(err)
    });
  }

  goToLive(machineCode: string) {
  this.router.navigate(['dashboard', 'live', machineCode]);
}
}
