import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, takeUntil, catchError, of } from 'rxjs';
import { OeeDashboardService } from '../oee-dashboard/oee-dashboard.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { ReportDateDirective } from '../../shared/report-date.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { AssistantService } from '../../core/services/assistant.service';

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
  imports: [ReportDateDirective, AutoApplyDirective, SkeletonRowsComponent, CommonModule, FormsModule, MexaPagerComponent],
  template: `
  <!-- The filters apply themselves, as on the dashboards. The same filter bar
       as the Reports page's other tabs (reports.html) — grid, labels, fields
       and Reset — so switching tabs does not change how the filters look.
       No search or export row here: the Reports toolbar exports this tab. -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end mb-4" appAutoApply (autoApply)="load()">
    <div class="flex flex-col gap-1">
      <label class="label_custom" for="moFrom">Date From</label>
      <input type="date" id="moFrom" name="moFrom" appReportDate [rdBefore]="f.to" [(ngModel)]="f.from" class="filter-date" />
    </div>
    <div class="flex flex-col gap-1">
      <label class="label_custom" for="moTo">Date To</label>
      <input type="date" id="moTo" name="moTo" appReportDate [rdAfter]="f.from" [(ngModel)]="f.to" class="filter-date" />
    </div>
    <div class="flex flex-col gap-1">
      <label class="label_custom" for="moShift">Shift</label>
      <select id="moShift" name="moShift" [(ngModel)]="f.shift_id" class="filter-select">
        <option [ngValue]="null">All Shifts</option>
        <option *ngFor="let s of shifts" [ngValue]="s.id">{{ s.shift_name || s.name }}</option>
      </select>
    </div>
    <!-- Reset: the last seven days, every shift — what the tab opens on -->
    <div class="flex gap-2">
      <button type="button" (click)="reset()"
        class="btn-clear flex-1 min-w-0 inline-flex items-center justify-center gap-1">
        <span class="material-icons text-[18px]" aria-hidden="true">restart_alt</span> Reset
      </button>
    </div>
  </div>

  <p *ngIf="errorMsg" class="mexa-note mexa-note-bad" role="alert">{{ errorMsg }}</p>

  <div class="mexa-tablewrap" tabindex="0" role="region" aria-label="Machine OEE table — scroll sideways to see every column">
  <div class="table-wrap">
    <table class="mexa-table is-dense is-striped">
      <caption class="sr-only">OEE by machine</caption>
      <thead>
        <tr>
          <th scope="col" class="col-index">#</th>
          <th scope="col" *ngFor="let c of columns" [class]="$any(c).cls || ''" [attr.aria-sort]="aria(c.key)">
            <button type="button" class="mexa-sort" (click)="sortBy(c.key)" [attr.aria-current]="sort === c.key">
              {{ c.label }}
              <span class="mexa-sort-arrow" aria-hidden="true">{{ sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '⇅' }}</span>
            </button>
          </th>
        </tr>
      </thead>
      <!-- every load, as the other tabs: the old rows never stand in for the new filters -->
      <tbody *ngIf="loading" appSkeletonRows [cols]="columns.length + 1" label="Loading the machine OEE report…"></tbody>
      <tbody *ngIf="!loading">
        <tr *ngFor="let m of pageRows; let i = index">
          <td class="num col-index">{{ (page - 1) * limit + i + 1 }}</td>
          <td class="strong">{{ m.machine_serial_no }}</td>
          <td><span class="mexa-badge" [ngClass]="statusClass(m.status)">{{ m.status | titlecase }}</span></td>
          <td class="num qty col-md">{{ pct(m.availability_pct) }}</td>
          <td class="num qty col-md">{{ pct(m.performance_pct) }}</td>
          <td class="num qty col-md">{{ pct(m.quality_pct) }}</td>
          <td class="num strong qty">{{ pct(m.oee_pct) }}</td>
          <td class="num qty col-md">{{ m.produced }}</td>
          <td class="num qty col-lg">{{ m.good }}</td>
          <td class="num qty col-lg">{{ m.rejected }}</td>
          <td class="num qty col-lg">{{ m.rework }}</td>
          <td class="num qty col-lg">{{ pct(m.rejection_rate_pct) }}</td>
          <td class="num whitespace-nowrap qty col-md">{{ hms(m.idle_seconds) }}</td>
        </tr>
        <tr *ngIf="!loading && !pageRows.length">
          <td [attr.colspan]="columns.length + 1" class="mexa-empty">No machines match these filters.</td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>
  <app-mexa-pager [page]="page" [totalPages]="totalPages" [total]="filtered.length" [shown]="pageRows.length"
                  [limit]="limit" (pageChange)="page = $event" (limitChange)="limit = $event; page = 1"></app-mexa-pager>
  <p class="mexa-card-hint !mt-2">Downtime is measured idle time: the machine on, not running. OEE needs a cycle time on the machine's current job; without one it reads --.</p>
  `
})
export class MachineOeeReportComponent implements OnInit, OnDestroy {
  f: any = this.defaults();
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
    // col-md / col-lg: the columns that give way on a tablet / a laptop (the cells carry the same)
    { key: 'machine_serial_no', label: 'Machine' }, { key: 'status', label: 'Status' },
    { key: 'availability_pct', label: 'Availability (%)', cls: 'qty col-md' }, { key: 'performance_pct', label: 'Performance (%)', cls: 'qty col-md' },
    { key: 'quality_pct', label: 'Quality (%)', cls: 'qty col-md' }, { key: 'oee_pct', label: 'OEE (%)', cls: 'qty' },
    { key: 'produced', label: 'Produced', cls: 'qty col-md' }, { key: 'good', label: 'Good', cls: 'qty col-lg' },
    { key: 'rejected', label: 'Rejected', cls: 'qty col-lg' }, { key: 'rework', label: 'Rework', cls: 'qty col-lg' },
    { key: 'rejection_rate_pct', label: 'Rejected (%)', cls: 'qty col-lg' }, { key: 'idle_seconds', label: 'Downtime', cls: 'qty col-md' }
  ];

  private destroy$ = new Subject<void>();

  constructor(private svc: OeeDashboardService, private auth: AuthService,
              private toast: ToastService, private cdr: ChangeDetectorRef,
              private route: ActivatedRoute, private assistant: AssistantService) {}

  get canExport(): boolean { return this.auth.hasAction('analytics-oee', 'export'); }

  ngOnInit(): void {
    this.svc.getMeta().pipe(takeUntil(this.destroy$), catchError(() => of(null)))
      .subscribe((res: any) => { this.shifts = res?.data?.shifts ?? []; this.cdr.markForCheck(); });
    this.takeLinkedFilters();
    this.load();
  }

  /** An OEE Dashboard tile opens this table on its dates and shift, ranked by its figure. */
  private takeLinkedFilters(): void {
    const q = this.route.snapshot.queryParamMap;
    const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = date(q.get('from')), to = date(q.get('to'));
    if (from && to && from <= to) this.f = { ...this.f, from, to };
    const shift = Number(q.get('shift_id'));
    if (Number.isInteger(shift) && shift > 0) this.f = { ...this.f, shift_id: shift };
    const sort = q.get('sort');
    if (sort && this.columns.some(c => c.key === sort)) {
      this.sort = sort;
      // the biggest first, as each tile reads; downtime too — the worst on top
      this.dir = sort === 'machine_serial_no' || sort === 'status' ? 'asc' : 'desc';
    }
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
  private loadSub?: Subscription;

  load(): void {
    this.loading = true; this.errorMsg = ''; this.cdr.markForCheck();
    // the report assistant answers about what is on screen when a question does not say
    const shift = this.shifts.find(s => s.id === this.f.shift_id);
    this.assistant.setContext({ report: 'machine-oee', title: 'Machine OEE', from: this.f.from, to: this.f.to,
                                machine: null, shift: shift ? (shift.shift_name || shift.name) : null });
    // a newer choice of filters drops the request still on its way
    this.loadSub?.unsubscribe();
    this.loadSub = this.svc.getOee({ ...this.f, page: 1, limit: 200 })
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

  /** Reset: back to the filters the tab opens on. The ranking is the table's, not a filter: it stays. */
  reset(): void {
    this.f = this.defaults();
    this.load();
  }
  /** The last seven days, every shift. */
  private defaults() { return { from: this.daysAgo(6), to: this.daysAgo(0), shift_id: null }; }

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

  /** Called by the Reports toolbar: Excel or CSV (no PDF). */
  export(format: 'xlsx' | 'csv'): void {
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
