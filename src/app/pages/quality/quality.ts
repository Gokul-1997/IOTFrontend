import { Component, ViewChild, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule, ChartComponent } from "ng-apexcharts";
import { QualityService } from './quality.service';

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './quality.html',
  styleUrl: './quality.scss'
})
export class Quality implements OnInit {

  @ViewChild("chart") chart!: ChartComponent;

  lines: any[] = [];
  machines: any[] = [];
  shifts: any[] = [];

  selectedLine!: number;
  selectedMachine!: number;
  selectedShift!: number;

  fromDate!: string;
  toDate!: string;

  dashboardData: any = null;

  public hourPerformOptions: any = {
    series: [],
    chart: {
      type: "area",
      height: 350,
      toolbar: { show: false }
    },
    stroke: { curve: "smooth", width: 3 },
    dataLabels: { enabled: false },
    xaxis: { categories: [] }
  };

  constructor(private service: QualityService,
    private cdr: ChangeDetectorRef

  ) { }

  ngOnInit() {
    const today = new Date().toISOString().split('T')[0];
    this.fromDate = today;
    this.toDate = today;

    this.loadInitialData();

  }

  ////////////////////////////////////////////////////
  // INITIAL LOAD FLOW
  ////////////////////////////////////////////////////

  loadInitialData() {
    this.service.getLines().subscribe(res => {
      this.lines = res.data;

      if (this.lines.length > 0) {
        this.selectedLine = this.lines[0].id;

        this.loadMachinesAndContinue();
      }
      this.cdr.detectChanges();

    });
  }

  loadMachinesAndContinue() {
    this.service.getMachinesByLine(this.selectedLine).subscribe(res => {
      this.machines = res.data;

      if (this.machines.length > 0) {
        this.selectedMachine = this.machines[0].id;

        this.loadShiftsAndContinue();
      }
      this.cdr.detectChanges();

    });
  }

  loadShiftsAndContinue() {
    this.service.getShifts().subscribe(res => {
      this.shifts = res.data;

      if (this.shifts.length > 0) {
        this.selectedShift = this.shifts[0].id;

        // Finally call dashboard
        this.loadDashboard();
      }
      this.cdr.detectChanges();

    });
  }

  ////////////////////////////////////////////////////
  // MANUAL SUBMIT
  ////////////////////////////////////////////////////

  submit() {
    this.loadDashboard();
  }

  ////////////////////////////////////////////////////
  // DASHBOARD API
  ////////////////////////////////////////////////////

  loadDashboard() {

    this.service.getDashboard({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      from: this.fromDate,
      to: this.toDate
    }).subscribe(res => {

      if (!res.success) return;

      this.dashboardData = res.data;

      this.updateChart(res.data.hourly || []);
      this.cdr.detectChanges();

    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  updateChart(hourly: any[]) {

    const categories = hourly.map(h =>
      new Date(h.hour_start)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );

    this.hourPerformOptions.series = [
      { name: "OEE", data: hourly.map(h => Number(h.oee)) },
      { name: "Availability", data: hourly.map(h => Number(h.availability)) },
      { name: "Performance", data: hourly.map(h => Number(h.performance)) },
      { name: "Quality", data: hourly.map(h => Number(h.quality)) }
    ];

    this.hourPerformOptions.xaxis = { categories };
  }

  ////////////////////////////////////////////////////
  // WHEN LINE CHANGED MANUALLY
  ////////////////////////////////////////////////////

  onLineChange() {
    this.service.getMachines(this.selectedLine).subscribe(res => {
      this.machines = res.data;
      this.selectedMachine = this.machines[0]?.id;

      this.loadDashboard();
    });
  }
}