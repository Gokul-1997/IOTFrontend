import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DowntimeService } from '../../core/services/downtime.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { MEXA_TABLE } from '../../shared/table/mexa-table';
import { TableState } from '../../shared/table/table-state';

@Component({
  selector: 'app-downtime',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent, SkeletonRowsComponent, MexaPagerComponent, ...MEXA_TABLE],
  templateUrl: './downtime.component.html',
  styles: [`
    .num-col { text-align: right; }
  `]
})
export class DowntimeComponent implements OnInit, OnDestroy {
  private refreshTimer?: ReturnType<typeof setInterval>;
  activeTab: 'events' | 'reasons' | 'summary' = 'events';
  reasons: any[] = [];
  events: any[] = [];
  summary: any[] = [];
  pagination: any = {};
  loading = false;
  eventsError = false;
  reasonsState: 'loading' | 'ready' | 'error' = 'loading';
  summaryState: 'loading' | 'ready' | 'error' = 'loading';
  reasonSearch = '';

  /* The tables' headers (shared/table, 29 Oct 2026): sort any column,
     filter or search it. Events are paged by the API, which sorts and
     filters them; reason codes and the summary are all here. */
  readonly eventTable = new TableState<any>([
    { key: 'machine' },
    { key: 'reason', filter: 'list', options: () => this.reasons.map(r => ({ value: r.name, label: r.name })) },
    { key: 'category', filter: 'list', options: () => this.categories.map(c => ({ value: c, label: this.categoryLabel(c) })) },
    { key: 'started' },
    { key: 'duration' },
    { key: 'by' }
  ], { mode: 'server', onChange: () => { this.filter.page = 1; this.loadEvents(); } });

  readonly reasonTable = new TableState<any>([
    { key: 'code' },
    { key: 'name' },
    { key: 'category', filter: 'list', label: c => this.categoryLabel(c) }
  ], { sort: { key: 'code', dir: 'asc' } });

  readonly summaryTable = new TableState<any>([
    { key: 'reason_name' },
    { key: 'category', filter: 'list', label: c => this.categoryLabel(c) },
    { key: 'event_count', type: 'number' },
    { key: 'total_seconds', type: 'number' }
  ]);
  /* Add reason code: a dialog, like every other form in the app (it used to open in the page) */
  showReasonForm = false;
  editingReasonId: number | null = null;
  reasonForm: any = { code: '', name: '', category: 'UNPLANNED' };
  reasonMissing = { code: false, name: false };
  reasonSaving = false;
  reasonError = '';
  deleteTarget: any = null;
  deletingReason = false;
  deleteError = '';
  filter: any = { from_date: '', to_date: '', page: 1, limit: 20 };

  readonly categories = ['UNPLANNED', 'PLANNED', 'QUALITY', 'CHANGEOVER'];

  /* The app is zoneless: an HTTP response resolving does not schedule a
     render on its own, so every callback that changes what is on screen has
     to say so. Without this the events arrive and sit in the component while
     the table still reads empty — until an unrelated click (the header
     listens on document:click) forces a change-detection pass, which is why
     the data appeared to need a second click. */
  constructor(private svc: DowntimeService, public auth: AuthService, private toast: ToastService,
              private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadReasons(); this.loadEvents();
    this.refreshTimer = setInterval(() => {
      if (document.hidden) return;
      if (this.activeTab === 'events' && !this.loading) this.loadEvents();
      else if (this.activeTab === 'summary' && this.summaryState !== 'loading') this.loadSummary();
    }, 15000);
  }
  ngOnDestroy() { clearInterval(this.refreshTimer); }

  eventDuration(value: unknown): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
    const seconds = Math.max(0, Math.floor(Number(value)));
    return seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
  }

  loadReasons() {
    this.reasonsState = 'loading';
    this.cdr.markForCheck();
    this.svc.getReasons().subscribe({
      next: r => { this.reasons = r.data || []; this.reasonsState = 'ready'; this.cdr.markForCheck(); },
      error: () => { this.reasonsState = 'error'; this.cdr.markForCheck(); }
    });
  }

  /** The reason codes the search matches, sorted and filtered by the table's header. */
  get shownReasons(): any[] {
    const q = this.reasonSearch.trim().toLowerCase();
    return this.reasonTable.view(q ? this.reasons.filter(r => `${r.code} ${r.name}`.toLowerCase().includes(q)) : this.reasons);
  }
  trackReason = (_: number, r: any) => r.id;

  loadEvents() {
    this.loading = true;
    this.eventsError = false;
    this.cdr.markForCheck();

    const params: any = { ...this.filter, ...this.eventTable.params() };
    Object.keys(params).forEach(k => !params[k] && delete params[k]);
    this.svc.getEvents(params).subscribe({
      next: r => {
        this.events = r.data || [];
        this.pagination = r.pagination || {};
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.eventsError = true; this.cdr.markForCheck(); }
    });
  }

  goToPage(p: number) { this.filter.page = p; this.loadEvents(); }
  setLimit(n: number) { this.filter.limit = n; this.filter.page = 1; this.loadEvents(); }

  loadSummary() {
    const params: any = {};
    if (this.filter.from_date) params['from_date'] = this.filter.from_date;
    if (this.filter.to_date)   params['to_date']   = this.filter.to_date;
    this.summaryState = 'loading';
    this.cdr.markForCheck();
    /* A failed request says so: the empty "No downtime to summarise" here
       used to cover a server error. */
    this.svc.getSummary(params).subscribe({
      next: r => { this.summary = r.data || []; this.summaryState = 'ready'; this.cdr.markForCheck(); },
      error: () => { this.summaryState = 'error'; this.cdr.markForCheck(); }
    });
  }

  setTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    if (tab === 'summary') this.loadSummary();
  }

  get showReasonActions(): boolean {
    return this.auth.hasAction('downtime', 'edit') || this.auth.hasAction('downtime', 'delete');
  }
  get reasonColumnCount(): number { return this.showReasonActions ? 4 : 3; }

  canManageReason(reason: any, action: 'edit' | 'delete'): boolean {
    const companyId = this.auth.getCompanyId();
    return companyId != null && Number(companyId) > 0 && reason?.company_id != null && Number(reason.company_id) === Number(companyId) &&
      this.auth.hasAction('downtime', action);
  }

  openReasonForm(reason?: any) {
    if (this.reasonSaving || this.deletingReason) return;
    if (reason ? !this.canManageReason(reason, 'edit') : !this.auth.hasAction('downtime', 'create')) return;
    this.editingReasonId = reason ? reason.id : null;
    this.reasonForm = reason ? { code: reason.code, name: reason.name, category: reason.category } :
      { code: '', name: '', category: 'UNPLANNED' };
    this.reasonMissing = { code: false, name: false };
    this.reasonError = '';
    this.showReasonForm = true;
  }

  closeReasonForm() {
    if (this.reasonSaving) return;
    this.showReasonForm = false;
    this.editingReasonId = null;
    this.reasonError = '';
  }

  saveReason() {
    if (this.reasonSaving) return;
    const id = this.editingReasonId;
    if (!this.auth.hasAction('downtime', id === null ? 'create' : 'edit')) return;
    const code = String(this.reasonForm.code || '').trim();
    const name = String(this.reasonForm.name || '').trim();
    this.reasonMissing = { code: !code, name: !name };
    if (!code || !name) { document.getElementById(!code ? 'rc-code' : 'rc-name')?.focus(); return; }

    this.reasonSaving = true;
    this.reasonError = '';
    const payload = { code, name, category: this.reasonForm.category };
    const save = id === null ? this.svc.createReason(payload) : this.svc.updateReason(id, payload);
    save.subscribe({
      next: () => {
        this.reasonSaving = false;
        this.showReasonForm = false;
        this.editingReasonId = null;
        this.toast.success(`Reason code ${code.toUpperCase()} ${id === null ? 'added' : 'updated'}`);
        this.loadReasons();
        if (id !== null) { this.loadEvents(); this.summaryState = 'loading'; }
      },
      /* Leaving the dialog open with the typed values intact is the honest
         outcome of a failed save; closing it would imply success. */
      error: err => {
        this.reasonSaving = false;
        this.reasonError = err?.error?.message || `Could not ${id === null ? 'add' : 'update'} the reason code. Try again.`;
        this.cdr.markForCheck();
      }
    });
  }

  confirmDeleteReason(reason: any) {
    if (!this.canManageReason(reason, 'delete') || this.reasonSaving || this.deletingReason) return;
    this.deleteTarget = reason;
    this.deleteError = '';
  }

  cancelDeleteReason() {
    if (this.deletingReason) return;
    this.deleteTarget = null;
    this.deleteError = '';
  }

  deleteReason() {
    if (!this.deleteTarget || this.deletingReason || !this.canManageReason(this.deleteTarget, 'delete')) return;
    const target = this.deleteTarget;
    this.deletingReason = true;
    this.deleteError = '';
    this.svc.deleteReason(target.id).subscribe({
      next: () => {
        this.deletingReason = false;
        this.deleteTarget = null;
        this.toast.success(`Reason code ${target.code} deleted`);
        this.loadReasons();
      },
      error: err => {
        this.deletingReason = false;
        this.deleteError = err?.error?.message || 'Could not delete this reason code. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  /** UNPLANNED → Unplanned: a badge reads as a word, not a shout. */
  categoryLabel(cat: string): string {
    return cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : '--';
  }

  categoryClass(cat: string) {
    const m: any = { UNPLANNED: 'mexa-badge-bad', PLANNED: 'mexa-badge-info', QUALITY: 'mexa-badge-violet', CHANGEOVER: 'mexa-badge-warn' };
    return m[cat] || 'mexa-badge-neutral';
  }
}
