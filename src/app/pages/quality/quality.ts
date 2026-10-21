import { StoredImageDirective } from '../../shared/stored-image.directive';
import { Component, ViewChild, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgApexchartsModule, ChartComponent } from "ng-apexcharts";
import { QualityService } from './quality.service';
import { AuthService } from '../../core/services/auth.service';
import { ReportDateDirective, plantToday } from '../../shared/report-date.directive';
import { MetricHelpComponent } from '../../shared/metric-help/metric-help.component';
import { StateComponent } from '../../shared/state/state.component';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { Subscription, forkJoin, catchError, of } from 'rxjs';

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [StoredImageDirective, MetricHelpComponent, StateComponent, ReportDateDirective, AutoApplyDirective, CommonModule, FormsModule, NgApexchartsModule],
  templateUrl: './quality.html',
  styleUrl: './quality.scss'
})
export class Quality implements OnInit, OnDestroy {
  private dashSub?: Subscription;
  private initSub?: Subscription;
  private saveSub?: Subscription;
  savingQuality = false;
  qualitySaveError = '';
  ngOnDestroy(): void { [this.dashSub, this.initSub, this.saveSub].forEach(s => s?.unsubscribe()); }


  @ViewChild("chart") chart!: ChartComponent;

  /* Every machine of the company, by name — one list, as on every other page
     (21 Oct 2026: no Line filter and no "Bay 1 / Bay 2" groups here). */
  machines: any[] = [];
  shifts: any[] = [];

  selectedMachine!: number;
  selectedShift!: number;

  today = plantToday();
  selectedDate!: string;

  dashboardData: any = null;

  // Shown on the tiles; edited in the dialog (it used to turn the tile's figure into an input)
  rejectedValue: number = 0;
  reworkValue: number = 0;
  editingQuality = false;
  qualityForm: { reject: any; rework: any } = { reject: 0, rework: 0 };
  qualityInvalid = { reject: false, rework: false };

  /** The last load: an empty shift is an answer, a failed request is not. */
  loadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  hourCount = 0;

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
     handler, so one refused request left the whole page empty; now a failed
     list simply shows as empty. */
  loadInitialData() {
    this.initSub?.unsubscribe();
    this.initSub = forkJoin({
      machines: this.service.getAllMachines().pipe(catchError(() => of({ data: [] }))),
      shifts: this.service.getShifts().pipe(catchError(() => of({ data: [] })))
    }).subscribe(({ machines, shifts }) => {
      this.machines = machines.data || []; this.shifts = shifts.data || [];
      this.selectedMachine = this.machines[0]?.id;
      this.selectedShift = this.shifts[0]?.id;
      this.loadDashboard(); this.cdr.detectChanges();
    });
  }

  ////////////////////////////////////////////////////
  // DASHBOARD API
  ////////////////////////////////////////////////////

  loadDashboard() {

    if (!this.selectedMachine || !this.selectedShift || !this.selectedDate) return;

    this.loadState = 'loading';
    /* The filters apply themselves, so a newer choice can come while the last
       answer is on its way: the older request is dropped and only the latest
       machine, shift and date are ever shown. */
    this.dashSub?.unsubscribe();
    this.dashSub = this.service.getDashboard({
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      date: this.selectedDate
    }).subscribe({
      next: res => {
        if (!res?.success) { this.loadState = 'error'; this.cdr.detectChanges(); return; }

        this.dashboardData = res.data;
        this.loadState = 'ready';

        this.rejectedValue = res.data.production?.reject ?? 0;
        this.reworkValue = res.data.production?.rework ?? 0;

        this.updateChart(res.data.hourly || []);
        this.cdr.detectChanges();
      },
      // a failed read must not leave the previous machine's figures up
      error: () => { this.dashboardData = null; this.loadState = 'error'; this.updateChart([]); this.cdr.detectChanges(); }
    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  ////////////////////////////////////////////////////
  // REJECTED / REWORK EDITING
  ////////////////////////////////////////////////////

  openQualityEdit() {
    if (!this.auth.hasAction('quality', 'edit') || !this.dashboardData) return;
    this.qualityForm = { reject: this.rejectedValue, rework: this.reworkValue };
    this.qualityInvalid = { reject: false, rework: false };
    this.qualitySaveError = '';
    this.editingQuality = true;
  }

  closeQualityEdit() {
    if (this.savingQuality) return;
    this.editingQuality = false;
    this.qualitySaveError = '';
  }

  /** "VMC - 2 - F · Shift A · 15 Oct 2026": which counts the dialog changes. */
  get qualityContext(): string {
    const machine = this.dashboardData?.machine?.machine_serial_no;
    const shift = this.shifts.find(s => s.id == this.selectedShift)?.shift_name;
    const [y, m, d] = String(this.selectedDate || '').split('-').map(Number);
    const day = y && m && d ? new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return [machine, shift, day].filter(Boolean).join(' · ');
  }

  saveQualityEdit() {
    const whole = (v: any) => v !== null && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0;
    this.qualityInvalid = { reject: !whole(this.qualityForm.reject), rework: !whole(this.qualityForm.rework) };
    if (this.qualityInvalid.reject || this.qualityInvalid.rework) {
      document.getElementById(this.qualityInvalid.reject ? 'qe-reject' : 'qe-rework')?.focus();
      return;
    }
    this.saveQuality(Number(this.qualityForm.reject), Number(this.qualityForm.rework));
  }

  private saveQuality(reject: number, rework: number) {
    if (this.savingQuality || !this.auth.hasAction('quality', 'edit')) return;
    const machine = this.selectedMachine, shift = this.selectedShift, date = this.selectedDate;
    this.savingQuality = true; this.qualitySaveError = '';
    this.saveSub = this.service.saveQuality({ machine_id: machine, shift_id: shift, date,
      reject_qty: reject, rework_qty: rework }).subscribe({
      next: res => {
        this.savingQuality = false;
        if (res?.success) {
          this.editingQuality = false;
          this.rejectedValue = reject;
          this.reworkValue = rework;
          if (machine === this.selectedMachine && shift === this.selectedShift && date === this.selectedDate) this.loadDashboard();
        } else {
          this.qualitySaveError = res?.message || 'Could not save quality counts. Try again.';
        }
        this.cdr.detectChanges();
      },
      error: error => {
        this.savingQuality = false;
        this.qualitySaveError = error.error?.message || 'Could not save quality counts. Try again.';
        this.cdr.detectChanges();
      }
    });
  }

  ////////////////////////////////////////////////////
  // CHART UPDATE
  ////////////////////////////////////////////////////

  updateChart(hourly: any[]) {
    this.hourCount = hourly.length;

    const categories = hourly.map(h =>
      new Date(h.hour)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );

    this.hourPerformOptions.series = [
      { name: "OEE", data: hourly.map(h => this.chartNumber(h.oee)) },
      { name: "Availability", data: hourly.map(h => this.chartNumber(h.availability)) },
      { name: "Performance", data: hourly.map(h => this.chartNumber(h.performance)) },
      { name: "Quality", data: hourly.map(h => this.chartNumber(h.quality)) }
    ];

    this.hourPerformOptions.xaxis = { categories };
  }

  percent(value: unknown): string { const number = this.chartNumber(value); return number == null ? '—' : `${number}%`; }
  private chartNumber(value: unknown): number | null { return value == null || !Number.isFinite(Number(value)) ? null : Number(value); }
}
