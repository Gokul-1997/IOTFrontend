import { Component } from '@angular/core';
import { MachineCardComponent } from './machine-card.component';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [ MachineCardComponent, CommonModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
   machines = Array(6).fill({
    name: 'CNC136',
    status: 'Running'
  });

}
