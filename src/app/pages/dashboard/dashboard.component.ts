import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from './dashboard.service';
import { MachineCardComponent } from './machine-card.component';



@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, MachineCardComponent],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {

  machines: any[] = [];
  timer!: any;

  constructor(private service: DashboardService,private cdr: ChangeDetectorRef) { }

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
}
