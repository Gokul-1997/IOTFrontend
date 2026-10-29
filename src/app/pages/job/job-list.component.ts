import { ChangeDetectorRef, Component, DestroyRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';

import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator, PageEvent } from '@angular/material/paginator';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MEXA_TABLE } from '../../shared/table/mexa-table';
import { TableState } from '../../shared/table/table-state';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { JobService } from './job.service';
import { JobCreateModalComponent } from './job-create-modal.component';
import { AuthService } from '../../core/services/auth.service';

import { StateComponent } from '../../shared/state/state.component';
@Component({
  standalone: true,
  selector: 'app-job-list',
  imports: [
    CommonModule,
    MatTableModule, MatPaginatorModule, ...MEXA_TABLE,
    MatButtonModule, MatIconModule,
    JobCreateModalComponent, StateComponent
  ],
  templateUrl: './job-list.component.html'
})
export class JobListComponent implements OnInit {

  activeColumns  = ['machine', 'part', 'target', 'started_at', 'action'];
  historyColumns = ['machine', 'part', 'target', 'started_at', 'ended_at', 'status'];

  activeSource  = new MatTableDataSource<any>();
  historySource = new MatTableDataSource<any>();

  /* The tables' headers (shared/table, 29 Oct 2026). Running jobs are all
     here, so they sort and filter here; the history is paged by the API. */
  private activeRows: any[] = [];
  readonly activeTable = new TableState<any>([
    { key: 'machine', value: r => r.machine_serial_no, filter: 'list' },
    { key: 'part', value: r => r.part_name },
    { key: 'target', value: r => r.target_qty, type: 'number' },
    { key: 'started_at', type: 'date' }
  ], { onChange: () => { this.activeSource.data = this.activeTable.view(this.activeRows); this.cdr.markForCheck(); } });
  readonly historyTable = new TableState<any>([
    { key: 'machine' }, { key: 'part' }, { key: 'target' },
    { key: 'started_at' }, { key: 'ended_at' },
    { key: 'status', filter: 'list', options: [{ value: 'true', label: 'Running' }, { value: 'false', label: 'Completed' }] }
  ], { mode: 'server', onChange: () => { this.historyPage = 1; this.loadHistory(); } });

  /* A failed request is not an empty list: "No jobs running" after a network
     error told the floor every machine was free. */
  activeState:  'loading' | 'ready' | 'error' = 'loading';
  historyState: 'loading' | 'ready' | 'error' = 'loading';
  historyPage = 1;
  historyLimit = 10;
  historyTotal = 0;
  historyLoaded = false;
  private historyDirty = true;
  private historyFetchedAt = 0;
  private historyRequest?: Subscription;
  private activeRequest?: Subscription;
  private destroyRef = inject(DestroyRef);

  showModal     = false;
  tab: 'active' | 'history' = 'active';

  // Stop confirmation
  confirmRow:  any    = null;
  stopping     = false;
  stopError    = '';

  /*
   * Setter-based ViewChild, not a plain one.
   *
   * Each paginator lives inside an *ngIf on the tab, so on first load only
   * the active one exists — historyPaginator was undefined when loadHistory()
   * ran, the `if (this.historyPaginator)` guard silently skipped the
   * assignment, and nothing ever re-attached it when the tab was switched.
   * History pagination could therefore never work. Active had the same race
   * against ngAfterViewInit.
   *
   * A setter fires every time the view creates or destroys the element, so
   * the paginator attaches whenever its tab is shown, however late that is.
   */
  @ViewChild('activePaginator') set activePaginator(p: MatPaginator) {
    if (p) { this.activeSource.paginator = p; this.cdr.markForCheck(); }
  }

  constructor(
    private service: JobService,
    public auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadActive();
  }

profileTab: 'account' | 'password' | 'security' = 'account';

setProfileTab(tab: 'account' | 'password' | 'security'): void {
  this.profileTab = tab;
}

  /** Switch which list is on screen. */
  setTab(tab: 'active' | 'history') {
    if (this.tab === tab) return;
    this.tab = tab;
    if (tab === 'history' && (this.historyDirty || Date.now() - this.historyFetchedAt > 60_000)) this.loadHistory();
    if (tab === 'active') this.historyRequest?.unsubscribe();
    this.cdr.markForCheck();
  }
  

  /*
   * The app runs zoneless (Angular 21, no zone.js), so assigning .data inside
   * an HTTP callback schedules no render on its own — the tables stayed empty
   * until the user happened to click something else.
   */
  loadActive() {
    this.activeRequest?.unsubscribe();
    this.activeState = 'loading'; this.cdr.markForCheck();
    this.activeRequest = this.service.getJobs().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        this.activeRows = res.data || [];
        this.activeSource.data = this.activeTable.view(this.activeRows);
        this.activeState = 'ready'; this.cdr.markForCheck();
      },
      error: () => { this.activeRows = []; this.activeSource.data = []; this.activeState = 'error'; this.cdr.markForCheck(); }
    });
  }

  loadHistory() {
    if (this.tab !== 'history') return;
    this.historyRequest?.unsubscribe();
    this.historyDirty = true;
    this.historyState = 'loading'; this.cdr.markForCheck();
    this.historyRequest = this.service.getJobHistory(this.historyPage, this.historyLimit, this.historyTable.params()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        this.historySource.data = res.data || []; this.historyTotal = res.total ?? this.historySource.data.length;
        this.historyPage = res.page ?? this.historyPage;
        this.historyLoaded = true; this.historyDirty = false; this.historyFetchedAt = Date.now();
        this.historyState = 'ready'; this.cdr.markForCheck();
      },
      error: () => { this.historySource.data = []; this.historyState = 'error'; this.cdr.markForCheck(); }
    });
  }

  changeHistoryPage(event: PageEvent) {
    this.historyPage = event.pageIndex + 1; this.historyLimit = event.pageSize; this.loadHistory();
  }

  openCreate() { this.showModal = true; }

  closeModal(created = false) {
    this.showModal = false;
    if (created) { this.loadActive(); this.historyDirty = true; }
  }

  // Show confirmation dialog
  requestStop(row: any) {
    this.confirmRow = row;
    this.stopError  = '';
  }

  cancelStop() {
    this.confirmRow = null;
    this.stopping   = false;
    this.stopError  = '';
  }

  confirmStop() {
    if (!this.confirmRow || this.stopping) return;
    this.stopping  = true;
    this.stopError = '';
    this.service.stopJob(this.confirmRow.machine_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.stopping   = false;
        this.confirmRow = null;
        this.cdr.markForCheck();
        this.loadActive();
        this.historyDirty = true;
      },
      error: (err: any) => {
        this.stopping  = false;
        this.stopError = err?.error?.message || 'Failed to stop job.';
        this.cdr.markForCheck();
      }
    });
  }

  fmt(dt: string | null): string {
    if (!dt) return '--';
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return '--';
    // "1 Oct 2026, 4:25 PM", as every table in the app writes a time
    return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}, `
         + d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
}
