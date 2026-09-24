import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, catchError, of } from 'rxjs';
import { OeeDashboardService } from '../oee-dashboard/oee-dashboard.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { ReportDateDirective } from '../../shared/report-date.directive';

/**
 * Machine Wise OEE Summary — one row per machine over a date range.
 *
 * It lived as a "Report" tab on the OEE Dashboard, next to the OEE Reports
 * page and the Reports page's own OEE tabs: three places for OEE reporting.
 * Reports now hold every report, so it is a tab there. The figures are the
 * OEE Dashboard's own (/dashboard/oee), so the two screens always agree.
 */
@Component({
  selector: 'app-machine-oee-report',
  standalone: true,
  imports: [ReportDateDirective, CommonModule, FormsModule, MexaPagerComponent],
  template: `
  <div class="flex flex-wrap items-end gap-3 mb-4">
    <label class="flex flex-col text-xs font-semibold text-[--mexa-ink-2] gap-1">From
      <input type="date" appReportDate [rdBefore]="f.to" class="ui-input" [(ngModel)]="f.from" name="moFrom">
    </label>
    <label class="flex flex-col text-xs font-semibold text-[--mexa-ink-2] gap-1">To
      <input type="date" appReportDate [rdAfter]="f.from" class="ui-input" [(ngModel)]="f.to" name="moTo">
    </label>
    <label class="flex flex-col text-xs font-semibold text-[--mexa-ink-2] gap-1">Shift
      <select class="ui-input" [(ngModel)]="f.shift_id" name="moShift">
        <option [ngValue]="null">All</option>
        <option *ngFor="let s of shifts" [ngValue]="s.id">{{ s.shift_name || s.name }}</option>
      </select>
    </label>
    <button type="button" class="ui-btn ui-btn-primary" (click)="load()" [disabled]="loading">{{ loading ? 'Loading…' : 'Apply' }}</button>
    <!-- no search or export row here: the Reports toolbar exports this tab -->
  </div>

  <p *ngIf="errorMsg" class="mexa-note mexa-note-bad" role="alert">{{ errorMsg }}</p>

  <div class="mexa-tablewrap" tabindex="0" role="region" aria-label="Machine OEE table — scroll sideways to see every column">
    <table class="mexa-table">
      <caption class="sr-only">OEE by machine</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col" *ngFor="let c of columns" [attr.aria-sort]="aria(c.key)">
            <button type="button" class="mexa-sort" (click)="sortBy(c.key)" [attr.aria-current]="sort === c.key">
              {{ c.label }}
              <span class="mexa-sort-arrow" aria-hidden="true">{{ sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '⇅' }}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr *ngIf="loading && !rows.length"><td [attr.colspan]="columns.length + 1" class="mexa-empty">Loading…</td></tr>
        <tr *ngFor="let m of pageRows; let i = index">
          <td class="num">{{ (page - 1) * limit + i + 1 }}</td>
          <td class="strong">{{ m.machine_serial_no }}</td>
          <td><span class="mexa-badge" [ngClass]="statusClass(m.status)">{{ m.status | titlecase }}</span></td>
          <td class="num">{{ pct(m.availability_pct) }}</td>
          <td class="num">{{ pct(m.performance_pct) }}</td>
          <td class="num">{{ pct(m.quality_pct) }}</td>
          <td class="num strong">{{ pct(m.oee_pct) }}</td>
          <td class="num">{{ m.produced }}</td>
          <td class="num">{{ m.good }}</td>
          <td class="num">{{ m.rejected }}</td>
          <td class="num">{{ m.rework }}</td>
          <td class="num">{{ pct(m.rejection_rate_pct) }}</td>
          <td class="num whitespace-nowrap">{{ hms(m.idle_seconds) }}</td>
        </tr>
        <tr *ngIf="!loading && !pageRows.length">
          <td [attr.colspan]="columns.length + 1" class="mexa-empty">No machines match these filters.</td>
        </tr>
      </tbody>
    </table>
  </div>
  <app-mexa-pager [page]="page" [totalPages]="totalPages" [total]="filtered.length" [shown]="pageRows.length"
                  [limit]="limit" (pageChange)="page = $event" (limitChange)="limit = $event; page = 1"></app-mexa-pager>
  <p class="mexa-card-hint !mt-2">Downtime is measured idle time: the machine on, not running. OEE needs a cycle time on the machine's current job; without one it reads --.</p>
  `
})
export class MachineOeeReportComponent implements OnInit, OnDestroy {
  f: any = { from: this.daysAgo(6), to: this.daysAgo(0), shift_id: null };
  shifts: any[] = [];
  rows: any[] = [];
  loading = false;
  errorMsg = '';
  exporting = '';
  sort = 'oee_pct';
  dir: 'asc' | 'desc' = 'desc';
  page = 1;
  limit = 10;

  readonly columns = [
    { key: 'machine_serial_no', label: 'Machine' }, { key: 'status', label: 'Status' },
    { key: 'availability_pct', label: 'Availability (%)' }, { key: 'performance_pct', label: 'Performance (%)' },
    { key: 'quality_pct', label: 'Quality (%)' }, { key: 'oee_pct', label: 'OEE' },
    { key: 'produced', label: 'Actuals' }, { key: 'good', label: 'Good' },
    { key: 'rejected', label: 'Rejections' }, { key: 'rework', label: 'Rework' },
    { key: 'rejection_rate_pct', label: 'Rej (%)' }, { key: 'idle_seconds', label: 'Downtime' }
  ];

  private destroy$ = new Subject<void>();

  constructor(private svc: OeeDashboardService, private auth: AuthService,
              private toast: ToastService, private cdr: ChangeDetectorRef) {}

  get canExport(): boolean { return this.auth.hasAction('analytics-oee', 'export'); }

  ngOnInit(): void {
    this.svc.getMeta().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.shifts = res?.data?.shifts ?? []; this.cdr.markForCheck(); });
    this.load();
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  load(): void {
    this.loading = true; this.errorMsg = ''; this.cdr.markForCheck();
    this.svc.getOee({ ...this.f, page: 1, limit: 200 })
      .pipe(takeUntil(this.destroy$), catchError(err => {
        this.errorMsg = err?.error?.message || 'Unable to load the machine OEE report.';
        return of(null);
      }))
      .subscribe((res: any) => {
        this.loading = false;
        this.rows = res?.data?.machines?.data ?? [];
        this.page = 1;
        this.cdr.markForCheck();
      });
  }

  get filtered(): any[] {
    const k = this.sort, sign = this.dir === 'asc' ? 1 : -1;
    return [...this.rows].sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === 'string' ? sign * x.localeCompare(y) : sign * (x - y);
    });
  }
  get totalPages(): number { return Math.max(1, Math.ceil(this.filtered.length / this.limit)); }
  get pageRows(): any[] { return this.filtered.slice((this.page - 1) * this.limit, this.page * this.limit); }

  sortBy(key: string): void {
    if (this.sort === key) this.dir = this.dir === 'desc' ? 'asc' : 'desc';
    else { this.sort = key; this.dir = key === 'machine_serial_no' || key === 'status' ? 'asc' : 'desc'; }
    this.page = 1;
  }
  aria(key: string): string { return this.sort !== key ? 'none' : this.dir === 'asc' ? 'ascending' : 'descending'; }

  /** Called by the Reports toolbar. */
  export(format: 'xlsx' | 'csv' | 'pdf'): void {
    this.exporting = format; this.cdr.markForCheck();
    this.svc.exportAs(format, this.f).pipe(takeUntil(this.destroy$)).subscribe({
      next: blob => {
        this.exporting = '';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `machine_oee_${this.f.from}_${this.f.to}.${format}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.cdr.markForCheck();
      },
      error: () => { this.exporting = ''; this.cdr.markForCheck(); this.toast.error('No machines match these filters'); }
    });
  }

  pct(v: number | null | undefined): string { return v === null || v === undefined ? '--' : `${v}%`; }
  hms(seconds: number | null | undefined): string {
    const n = Math.max(0, Math.round(Number(seconds) || 0));
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
  }
  statusClass(s: string): string {
    return ({ RUNNING: 'mexa-badge-good', IDLE: 'mexa-badge-warn', ALARM: 'mexa-badge-bad' } as any)[s] || 'mexa-badge-neutral';
  }
  private daysAgo(n: number): string {
    const d = new Date(Date.now() - n * 86_400_000);
    return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().slice(0, 10);
  }
}
