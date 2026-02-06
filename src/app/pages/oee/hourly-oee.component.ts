import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OeeService } from './oee.service';
import { MachineService } from '../machines/machine.service';

declare const Chart: any;

@Component({
  standalone: true,
  selector: 'app-hourly-oee',
  imports: [CommonModule, FormsModule],
  templateUrl: './hourly-oee.component.html',
  styleUrls: ['./hourly-oee.component.scss']
})
export class HourlyOeeComponent implements OnInit {

  machines: any[] = [];
  machineId!: number;
  date = new Date().toISOString().slice(0, 10);
  chart: any;

  constructor(
    private oee: OeeService,
    private machineService: MachineService
  ) {}

  ngOnInit() {
    this.machineService.getAll().subscribe(d => this.machines = d);
  }

  load() {
    if (!this.machineId) return;

    this.oee.getHourly(this.machineId, this.date).subscribe(data => {
      const labels = data.map(x => x.hour_start.substring(11,16));
      const values = data.map(x => x.oee);

      if (this.chart) this.chart.destroy();

      this.chart = new Chart('oeeChart', {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'OEE %',
            data: values,
            borderColor: '#1890ff',
            fill: false
          }]
        }
      });
    });
  }
}
