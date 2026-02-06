import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MachineService } from './machine.service';
import { RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-machine-list',
  imports: [CommonModule,RouterModule],
  templateUrl: './machine-list.component.html',
  styleUrls: ['./machine-list.component.scss']
})
export class MachineListComponent implements OnInit {
  machines: any[] = [];

  constructor(private service: MachineService) {}

  ngOnInit() {
    this.service.getAll().subscribe(res => (this.machines = res));
  }
}
