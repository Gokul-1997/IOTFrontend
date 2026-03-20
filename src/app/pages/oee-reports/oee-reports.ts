import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OeeReportsService } from './oee.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-oee-reports',
  imports: [CommonModule, FormsModule],
  templateUrl: './oee-reports.html',
  styleUrl: './oee-reports.scss'
})
export class OeeReportsComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  // Math for template
  Math = Math;

  // Current date for header display
  today = new Date();

  // Meta data
  lines: any[] = [];
  machines: any[] = [];
  shifts: any[] = [];

  // Report data
  rows: any[] = [];

  // Filters
  selectedLine: number | null = null;
  selectedMachine: number | null = null;
  selectedShift: number | null = null;
  searchText: string = '';
  fromDate: string = '';
  toDate: string = '';

  // Pagination
  page: number = 1;
  limit: number = 6;
  total: number = 0;
  totalPages: number = 0;

  // Sorting
  sortBy: string = 'shift_date';
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  // UI states
  loading: boolean = false;
  exporting: boolean = false;
  loadingMeta: boolean = false;
  error: string = '';

  constructor(private service: OeeReportsService) {}

  ngOnInit(): void {
    console.log('🚀 OEE Reports Component Initialized');
    this.loadMeta();
  }

  /* =======================================
     LOAD METADATA
  ======================================= */
  private loadMeta(): void {

    this.loadingMeta = true;
    this.error = '';

    this.service.getMeta()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {

          this.lines = res.data.lines || [];
          this.machines = res.data.machines || [];
          this.shifts = res.data.shifts || [];

          if (this.machines.length > 0 && !this.selectedMachine) {
            this.selectedMachine = this.machines[0].id;
          }

          if (this.shifts.length > 0 && !this.selectedShift) {
            this.selectedShift = this.shifts[0].id;
          }

          this.loadingMeta = false;
          this.loadReports();

        },
        error: (err: any) => {
          console.error('❌ Error loading metadata:', err);
          this.error = err.error?.message || 'Failed to load metadata';
          this.loadingMeta = false;
        }
      });

  }

  /* =======================================
     LOAD REPORTS
  ======================================= */
  loadReports(): void {

    if (this.loadingMeta) return;

    this.loading = true;
    this.error = '';

    const filters = {
      line_id: this.selectedLine,
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      from_date: this.fromDate,
      to_date: this.toDate,
      search: this.searchText,
      page: this.page,
      limit: this.limit,
      sort_by: this.sortBy,
      sort_order: this.sortOrder
    };

    this.service.getReports(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {

          this.rows = res.data || [];
          this.total = res.pagination?.total || 0;
          this.totalPages = res.pagination?.totalPages || 0;

          this.loading = false;

        },
        error: (err: any) => {
          console.error('❌ Error loading reports:', err);
          this.error = err.error?.message || 'Failed to load reports';
          this.loading = false;
        }
      });

  }

  /* =======================================
     FILTER HANDLERS
  ======================================= */

  onLineChange(): void {
    this.selectedMachine = null;
    this.page = 1;
    this.loadReports();
  }

  onMachineChange(): void {
    this.page = 1;
    this.loadReports();
  }

  onShiftChange(): void {
    this.page = 1;
    this.loadReports();
  }

  onDateChange(): void {
    this.page = 1;
    this.loadReports();
  }

  onSearch(): void {
    this.page = 1;
    this.loadReports();
  }

  clearFilters(): void {
    this.selectedLine = null;
    this.selectedMachine = null;
    this.selectedShift = null;
    this.searchText = '';
    this.fromDate = '';
    this.toDate = '';
    this.page = 1;
    this.loadReports();
  }

  /* =======================================
     SORT HANDLERS
  ======================================= */

  changeSort(column: string): void {

    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy = column;
      this.sortOrder = 'ASC';
    }

    this.page = 1;
    this.loadReports();

  }

  getSortIcon(column: string): string {
    if (this.sortBy !== column) return '⇅';
    return this.sortOrder === 'ASC' ? '↑' : '↓';
  }

  /* =======================================
     PAGINATION HANDLERS
  ======================================= */

  changePage(newPage: number): void {

    if (newPage < 1 || newPage > this.totalPages) {
      return;
    }

    this.page = newPage;
    this.loadReports();

  }

  changeLimit(newLimit: number | string): void {

    this.limit = Number(newLimit);
    this.page = 1;
    this.loadReports();

  }

  getPageNumbers(): number[] {

    const pages: number[] = [];
    const maxVisible = 5;

    if (this.totalPages <= maxVisible) {
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      const halfVisible = Math.floor(maxVisible / 2);

      let start = Math.max(1, this.page - halfVisible);
      let end = Math.min(this.totalPages, start + maxVisible - 1);

      if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;

  }

  /* =======================================
     EXPORT
  ======================================= */

  exportCSV(): void {

    this.exporting = true;

    const filters = {
      line_id: this.selectedLine,
      machine_id: this.selectedMachine,
      shift_id: this.selectedShift,
      from_date: this.fromDate,
      to_date: this.toDate,
      search: this.searchText
    };

    this.service.exportCSV(filters);

    setTimeout(() => {
      this.exporting = false;
    }, 1000);

  }

  /* =======================================
     HELPERS
  ======================================= */

  formatDate(dateStr: string): string {

    if (!dateStr) return '--';

    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

  }

  getOeeColor(oee: number): string {

    if (oee >= 85) return '#10b981';
    if (oee >= 75) return '#3b82f6';
    if (oee >= 60) return '#f59e0b';
    return '#ef4444';

  }

  getBarWidth(value: number): string {

    return `${Math.min(value || 0, 100)}%`;

  }

  goBack(): void {
    window.history.back();
  }

  /* =======================================
     CLEANUP
  ======================================= */

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

}