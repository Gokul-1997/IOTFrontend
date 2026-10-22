import { Component, OnInit, OnDestroy, ChangeDetectorRef, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { OeeReportsService } from './oee.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ReportDateDirective, plantToday } from '../../shared/report-date.directive';
import { AutoApplyDirective } from '../../shared/auto-apply.directive';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { dayText, pctText, pctTone } from '../../shared/report-value';
import { downloadError, saveOrMessage } from '../../shared/report-file';

interface RecordColumn {
  key: string;
  label: string;
  sort?: string;     // what the API sorts by
  cls?: string;      // qty (right-aligned), col-md / col-lg (give way on a tablet / a laptop)
  widget?: string;   // shown only with this oee-reports widget
  pct?: boolean;
}

/** The table's columns, in order. The export writes the same ones under the same headings (Backend oee.service COLUMNS). */
const COLUMNS: RecordColumn[] = [
  { key: 'shift_date',        label: 'Date',             sort: 'shift_date' },
  { key: 'machine_serial_no', label: 'Machine',          sort: 'machine_serial_no', cls: 'strong' },
  { key: 'shift_code',        label: 'Shift',            sort: 'shift_code', cls: 'col-md' },
  { key: 'operator_name',     label: 'Operator',         cls: 'col-lg' },
  { key: 'oee',               label: 'OEE (%)',          sort: 'oee',          cls: 'qty',        widget: 'oee',          pct: true },
  { key: 'availability',      label: 'Availability (%)', sort: 'availability', cls: 'qty col-md', widget: 'availability', pct: true },
  { key: 'performance',       label: 'Performance (%)',  sort: 'performance',  cls: 'qty col-md', widget: 'performance',  pct: true },
  { key: 'quality',           label: 'Quality (%)',      sort: 'quality',      cls: 'qty col-md', widget: 'quality',      pct: true }
];

/**
 * Reports → OEE Records: one row per machine and completed shift.
 *
 * It began as a page of its own (OEE Reports) with its own filter box,
 * Material pager, bars under the figures and a CSV-only export, and kept all
 * of it when it became a Reports tab — so it looked and exported unlike the
 * tabs beside it (21 Oct 2026). It now has the Reports page's filter bar,
 * table, pager and figures, and the toolbar's CSV and Excel export every
 * record for the filters — a large export is emailed instead (report-file.ts).
 * The rows are Shift OEE's: the same summary, the same operator rule.
 */
@Component({
  standalone: true,
  selector: 'app-oee-reports',
  imports: [ReportDateDirective, AutoApplyDirective, SkeletonRowsComponent, MexaPagerComponent, CommonModule, FormsModule],
  templateUrl: './oee-reports.html',
  styleUrl: './oee-reports.scss'
})
export class OeeReportsComponent implements OnInit, OnDestroy {
  /** How many records the filters hold: the Reports toolbar offers the export only when there are some. */
  @Output() totalChange = new EventEmitter<number>();
  /** "This report is large … check your email in 10–15 minutes": the Reports page shows it. */
  @Output() notice = new EventEmitter<string>();

  private destroy$ = new Subject<void>();
  private reportSub?: Subscription;

  columns: RecordColumn[] = [];
  machines: any[] = [];
  shifts: any[] = [];
  rows: any[] = [];

  selectedMachine: number | null = null;
  selectedShift: number | null = null;
  fromDate = plantToday();
  toDate = plantToday();

  page = 1;
  limit = 15;
  total = 0;
  readonly sizes = [10, 15, 25, 50, 100];

  sortBy = 'shift_date';
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  loading = false;
  loadingMeta = false;
  exporting: '' | 'csv' | 'xlsx' = '';
  error = '';

  constructor(private service: OeeReportsService, private cdr: ChangeDetectorRef,
              public auth: AuthService, private toast: ToastService) {}

  get totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }

  ngOnInit(): void {
    this.columns = COLUMNS.filter(c => !c.widget || this.auth.hasWidget('oee-reports', c.widget));
    this.loadMeta();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadMeta(): void {
    this.loadingMeta = true;
    this.service.getMeta().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.machines = res?.data?.machines || [];
        this.shifts = res?.data?.shifts || [];
        this.loadingMeta = false;
        this.loadReports();
      },
      error: () => {
        // the lists only fill the dropdowns: the records still load, unfiltered
        this.error = 'The machine and shift lists could not be loaded.';
        this.loadingMeta = false;
        this.loadReports();
      }
    });
  }

  /** The filters as the API reads them — the page and the export ask for the same records. */
  private filterParams(): Record<string, unknown> {
    return {
      machine_id: this.selectedMachine, shift_id: this.selectedShift,
      from_date: this.fromDate, to_date: this.toDate, sort_by: this.sortBy, sort_order: this.sortOrder
    };
  }

  loadReports(): void {
    this.loading = true;
    this.cdr.markForCheck();
    /* Filters apply on change, so a newer request can overtake an older one:
       the older is dropped, and only the latest choice is shown. */
    this.reportSub?.unsubscribe();
    this.reportSub = this.service.getReports({ ...this.filterParams(), page: this.page, limit: this.limit })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.rows = res?.data || [];
          this.total = res?.pagination?.total || 0;
          this.loading = false;
          if (!this.loadingMeta && this.error.startsWith('The OEE records')) this.error = '';
          this.totalChange.emit(this.total);
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.rows = [];
          this.total = 0;
          this.error = err?.error?.message || 'The OEE records could not be loaded. Try again.';
          this.loading = false;
          this.totalChange.emit(0);
          this.cdr.markForCheck();
        }
      });
  }

  /** A filter changed (appAutoApply): the first page of the new records. */
  applyFilters(): void { this.page = 1; this.loadReports(); }

  /** Reset: today, every machine and shift — what the tab opens on. The order stays. */
  reset(): void {
    this.selectedMachine = null;
    this.selectedShift = null;
    this.fromDate = plantToday();
    this.toDate = plantToday();
    this.applyFilters();
  }

  changePage(p: number): void { this.page = p; this.loadReports(); }
  changeLimit(n: number): void { this.limit = n; this.page = 1; this.loadReports(); }

  changeSort(column: string): void {
    if (this.sortBy === column) this.sortOrder = this.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    else { this.sortBy = column; this.sortOrder = 'ASC'; }
    this.page = 1;
    this.loadReports();
  }

  ariaSort(column: string): 'ascending' | 'descending' | 'none' {
    if (this.sortBy !== column) return 'none';
    return this.sortOrder === 'ASC' ? 'ascending' : 'descending';
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return '⇅';
    return this.sortOrder === 'ASC' ? '▲' : '▼';
  }

  /** A cell as the Reports tables write it: 21-Oct-2026, 82.35%, "--" for nothing. */
  cell(c: RecordColumn, row: any): string {
    const v = row[c.key];
    if (c.key === 'shift_date') return dayText(v);
    if (c.pct) return pctText(v);
    return v === null || v === undefined || v === '' ? '--' : String(v);
  }

  /** A figure's colour (the dashboards' bands); nothing known is muted. */
  tone(c: RecordColumn, row: any): string {
    const v = row[c.key];
    if (c.pct) return pctTone(v);
    return v === null || v === undefined || v === '' ? 'muted' : '';
  }

  /**
   * Called by the Reports toolbar: every record for these filters, in the
   * table's columns and order. A large export is not downloaded — it is
   * emailed, and the message saying so is all that is shown.
   */
  export(format: 'csv' | 'xlsx'): void {
    if (this.exporting) return;
    this.exporting = format;
    this.cdr.markForCheck();
    const params = { ...this.filterParams(), columns: this.columns.map(c => c.key).join(',') };
    this.service.export(format, params).pipe(takeUntil(this.destroy$)).subscribe({
      next: async res => {
        const message = await saveOrMessage(res, `oee-records_${this.fromDate}_to_${this.toDate}.${format}`);
        this.exporting = '';
        if (message) this.notice.emit(message);
        this.cdr.markForCheck();
      },
      error: async err => {
        this.exporting = '';
        this.toast.error(await downloadError(err, 'The OEE records could not be exported. Try again.'));
        this.cdr.markForCheck();
      }
    });
  }
}
