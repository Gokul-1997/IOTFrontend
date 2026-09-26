import { Component, ViewChild, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule, ChartComponent } from "ng-apexcharts";
import { QualityService } from './quality.service';
import { AuthService } from '../../core/services/auth.service';
import { ReportDateDirective, plantToday } from '../../shared/report-date.directive';

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [ReportDateDirective, CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './quality.html',
  styleUrl: './quality.scss'
})
export class Quality implements OnInit {

  @ViewChild("chart") chart!: ChartComponent;

  lines: any[] = [];
  machines: any[] = [];
  shifts: any[] = [];

  /* All lines by default. The machine list followed the first line, so the
     page opened on Bay 5 and its 4 machines and the other 16 were only
     found by changing the line. */
  selectedLine: number | null = null;
  selectedMachine!: number;
  selectedShift!: number;

  today = plantToday();
  selectedDate!: string;

  dashboardData: any = null;

  // Editable fields
  rejectedValue: number = 0;
  reworkValue: number = 0;
  editingRejected = false;
  editingRework = false;
  private rejectedSnapshot = 0;
  private reworkSnapshot = 0;

  public hourPerformOptions: any = {
    series: [],
    chart: {
      type: "area",
      height: 250,
      toolbar: { show: false }
    },
    stroke: { curve: "smooth", width: 3 },
    dataLabels: { enabled: false },
    xaxis: { categories: [] }
  };

  constructor(private service: QualityService,
    private cdr: ChangeDetectorRef,
    public  auth: AuthService
  ) { }

  ngOnInit() {
    this.selectedDate = plantToday();   // toISOString() is UTC: yesterday before 05:30 IST

    this.loadInitialData();

  }

  ////////////////////////////////////////////////////
  // INITIAL LOAD FLOW
  ////////////////////////////////////////////////////

  /* Each step hands on to the next. A failed step used to have no error
     handler, so one refused request (the line list, say) left the whole page
     empty; now lines fall back to none (All lines still lists every machine)
     and a failed list simply shows as empty. */
  loadInitialData() {
    this.service.getLines().subscribe({
      next: res => { this.lines = res?.data || []; this.loadMachinesAndContinue(); this.cdr.detectChanges(); },
      error: () => { this.lines = []; this.loadMachinesAndContinue(); this.cdr.detectChanges(); }
    });
  }

  /** All lines, or the chosen one. */
  private machines$() {
    return this.selectedLine === null
      ? this.service.getAllMachines()
      : this.service.getMachinesByLine(this.selectedLine);
  }

  /** With All lines, the machine list is grouped by line so a machine is
   *  found where it stands; machines on no line come last. Built when the
   *  machines load — a getter handed <option>s a new array on every check,
   *  and re-creating the options inside an ngModel select re-set its value
   *  and asked for another check, over and over (NG0103). */
  machineGroups: { label: string; machines: any[] }[] = [];

  private groupMachines(): { label: string; machines: any[] }[] {
    const byLine = new Map<number | null, any[]>();
    for (const m of this.machines) {
      const k = m.line_id ?? null;
      if (!byLine.has(k)) byLine.set(k, []);
      byLine.get(k)!.push(m);
    }
    const named = this.lines
      .filter(l => byLine.has(l.id))
      .map(l => ({ label: l.name, machines: byLine.get(l.id)! }));
    const known = new Set(this.lines.map(l => l.id));
    const rest = this.machines.filter(m => m.line_id == null || !known.has(m.line_id));
    return rest.length ? [...named, { label: 'No line', machines: rest }] : named;
  }

  loadMachinesAndContinue() {
    this.machines$().subscribe({
      next: res => {
        this.machines = res?.data || [];
        this.machineGroups = this.groupMachines();

        if (this.machines.length > 0) {
          this.selectedMachine = this.machines[0].id;

          this.loadShiftsAndContinue();
        }
        this.cdr.detectChanges();
      },
      error: () => { this.machines = []; this.machineGroups = []; this.cdr.detectChanges(); }
    });
  }

  loadShiftsAndContinue() {
    this.service.getShifts().subscribe({
      next: res => {
        this.shifts = res?.data || [];

        if (this.shifts.length > 0) {
          this.selectedShift = this.shifts[0].id;

          // Finally call dashboard
          this.loadDashboard();
        }
        this.cdr.detectChanges();
      },
      error: () => { this.shifts = []; this.cdr.detectChanges(); }
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

    if (!this.selectedMachine || !this.selectedShift || !this.selectedDate) return;

    this.service.getDashboard({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      date: this.selectedDate
    }).subscribe({
      next: res => {
        if (!res?.success) return;

        this.dashboardData = res.data;

        this.rejectedValue = res.data.production?.reject ?? 0;
        this.reworkValue = res.data.production?.rework ?? 0;

        this.updateChart(res.data.hourly || []);
        this.cdr.detectChanges();
      },
      // a failed read must not leave the previous machine's figures up
      error: () => { this.dashboardData = null; this.updateChart([]); this.cdr.detectChanges(); }
    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  ////////////////////////////////////////////////////
  // REJECTED / REWORK EDITING
  ////////////////////////////////////////////////////

  startEditRejected() {
    this.rejectedSnapshot = this.rejectedValue;
    this.editingRejected = true;
  }

  saveRejected() {
    this.editingRejected = false;
    this.saveQuality();
  }

  cancelRejected() {
    this.rejectedValue = this.rejectedSnapshot;
    this.editingRejected = false;
  }

  startEditRework() {
    this.reworkSnapshot = this.reworkValue;
    this.editingRework = true;
  }

  saveRework() {
    this.editingRework = false;
    this.saveQuality();
  }

  cancelRework() {
    this.reworkValue = this.reworkSnapshot;
    this.editingRework = false;
  }

  private saveQuality() {
    this.service.saveQuality({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      date: this.selectedDate,
      reject_qty: this.rejectedValue,
      rework_qty: this.reworkValue
    }).subscribe(res => {
      if (res?.success) {
        this.loadDashboard();
      }
    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  updateChart(hourly: any[]) {

    const categories = hourly.map(h =>
      new Date(h.hour)
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
    this.machines$().subscribe(res => {
      this.machines = res.data || [];
      this.machineGroups = this.groupMachines();
      this.selectedMachine = this.machines[0]?.id;

      if (this.selectedMachine) {
        this.loadDashboard();
      } else {
        this.dashboardData = null;
      }
      this.cdr.detectChanges();
    });
  }
}