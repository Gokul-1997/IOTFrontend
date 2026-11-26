import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import { BehaviorSubject, Subject, catchError, filter, of, switchMap, takeUntil } from 'rxjs';
import { DashboardService } from '../dashboard.service';
import { visibleRefresh } from '../../../shared/visible-refresh';
import { ReportDateDirective } from '../../../shared/report-date.directive';

export function cycleChartData(points: any[]) {
  const rows = (Array.isArray(points) ? points : []).filter(point => Number.isFinite(Date.parse(point?.hour_start)));
  const values = rows.map(point => point.cycle_seconds !== null && point.cycle_seconds !== undefined &&
    Number.isFinite(Number(point.cycle_seconds)) && Number(point.cycle_seconds) >= 0 ? Number(point.cycle_seconds) : null);
  const divisor = values.some(value => value !== null && value > 600) ? 60 : 1;
  const unit = divisor === 60 ? 'Min' : 'Sec';
  return { unit,
    points: rows.map((point, i) => ({ x: Date.parse(point.hour_start), y: values[i] === null ? null : Math.round(values[i]! / divisor * 10) / 10 })),
    latest: [...values].reverse().find(value => value !== null) === undefined ? null :
      Math.round([...values].reverse().find(value => value !== null)! / divisor * 10) / 10
  };
}

@Component({
  selector: 'app-cycle-time-panel', standalone: true,
  imports: [CommonModule, NgApexchartsModule, ReportDateDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host { display:block; min-width:0; } .ct-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:.75rem; } apx-chart { display:block; min-width:0; }`],
  template: `
    <section class="mexa-lift rounded-xl p-4 mt-2" aria-labelledby="cycleTimeTitle">
      <div class="ct-head">
        <h2 id="cycleTimeTitle" class="mexa-card-title mexa-card-title-left">Cycle Time ({{ unit }})</h2>
        <label class="mexa-filter-set">Date
          <input #cycleDate class="mexa-date" type="date" appReportDate [value]="date" (change)="setDate(cycleDate.value)">
        </label>
      </div>
      <p class="mexa-card-hint">Latest hourly average: <strong>{{ latest === null ? '--' : latest + ' ' + unit }}</strong></p>
      <p *ngIf="error" class="mexa-note mexa-note-bad" role="alert">{{ error }}</p>
      <p *ngIf="loading && !series.length" class="mexa-empty" role="status">Loading cycle times…</p>
      <apx-chart *ngIf="series.length" [series]="series" [chart]="chart" [xaxis]="xaxis" [yaxis]="yaxis"
        [stroke]="stroke" [markers]="markers" [dataLabels]="dataLabels" [colors]="colors" [tooltip]="tooltip"></apx-chart>
      <p *ngIf="!loading && !series.length && !error" class="mexa-empty">No parts produced on this date, so no cycle time is available.</p>
      <p class="mexa-card-hint">Recorded running time ÷ parts produced in each hour. Hours without parts remain gaps.</p>
    </section>`
})
export class CycleTimePanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() machineId!: number;
  date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  unit = 'Sec'; latest: number | null = null;
  series: any[] = []; loading = true; error = '';
  chart: any = { type: 'line', height: 280, toolbar: { show: false }, animations: { enabled: false }, zoom: { enabled: false } };
  stroke: any = { width: 3, curve: 'straight' };
  markers: any = { size: 4 };
  dataLabels: any = { enabled: false };
  colors = ['#2f2d8f'];
  xaxis: any = { type: 'datetime', labels: { datetimeUTC: false, formatter: (_value: string, at: number) =>
    new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) } };
  yaxis: any = { min: 0, title: { text: 'Sec' } };
  tooltip: any = { x: { formatter: (at: number) => new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) } };
  private selection = new BehaviorSubject<{ machineId: number; date: string } | null>(null);
  private destroy = new Subject<void>();
  constructor(private svc: DashboardService, private cdr: ChangeDetectorRef) {}
  ngOnChanges(): void { this.reload(); }
  ngOnInit(): void {
    this.selection.pipe(filter((value): value is { machineId: number; date: string } => value !== null),
      switchMap(value => visibleRefresh(() => this.svc.getCycleTime(value.machineId, value.date).pipe(
        catchError(() => of(null))), 30_000)), takeUntil(this.destroy)).subscribe(response => {
      this.loading = false;
      this.error = response?.status === 'success' ? '' : 'Unable to load cycle times.';
      const view = cycleChartData(response?.data?.points || []);
      this.unit = view.unit; this.latest = view.latest;
      this.series = view.points.some(point => point.y !== null) ? [{ name: 'Cycle Time', data: view.points }] : [];
      this.yaxis = { min: 0, title: { text: this.unit } };
      this.cdr.markForCheck();
    });
    if (!this.selection.value) this.reload();
  }
  setDate(date: string): void { if (date && date !== this.date) { this.date = date; this.reload(); } }
  private reload(): void {
    this.series = []; this.latest = null; this.error = ''; this.loading = true;
    if (Number.isSafeInteger(this.machineId) && this.machineId > 0) this.selection.next({ machineId: this.machineId, date: this.date });
  }
  ngOnDestroy(): void { this.destroy.next(); this.destroy.complete(); this.selection.complete(); }
}
