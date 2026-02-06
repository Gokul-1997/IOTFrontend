import { Component } from '@angular/core';
import { HeaderComponent } from '../../layout/header/header.component';
import { MachineCardComponent } from './machine-card.component';
import { CommonModule } from '@angular/common';

@Component({
    standalone: true,
  selector: 'app-dashboard',
  imports: [HeaderComponent,MachineCardComponent,CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  machines = Array.from({ length: 6 });

}
