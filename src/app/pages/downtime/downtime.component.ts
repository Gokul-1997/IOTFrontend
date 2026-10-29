import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
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
export class DowntimeComponent implements OnInit {
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
    { key: 'category', filter: 'list', label: c => this.categoryLabel(c) },
    { key: 'source', value: r => (r.company_id ? 'Your company' : 'Built-in'), filter: 'list' }
  ], { sort: { key: 'code', dir: 'asc' } });

  readonly summaryTable = new TableState<any>([
    { key: 'reason_name' },
    { key: 'category', filter: 'list', label: c => this.categoryLabel(c) },
    { key: 'event_count', type: 'number' },
    { key: 'total_seconds', type: 'number' }
  ]);
  /* Add reason code: a dialog, like every other form in the app (it used to open in the page) */
  showReasonForm = false;
  reasonForm: any = { code: '', name: '', category: 'UNPLANNED' };
  reasonMissing = { code: false, name: false };
  reasonSaving = false;
  reasonError = '';
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

  ngOnInit() { this.loadReasons(); this.loadEvents(); }

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

  openReasonForm() {
    this.reasonForm = { code: '', name: '', category: 'UNPLANNED' };
    this.reasonMissing = { code: false, name: false };
    this.reasonError = '';
    this.showReasonForm = true;
  }

  closeReasonForm() {
    this.showReasonForm = false;
    this.reasonError = '';
  }

  saveReason() {
    if (this.reasonSaving) return;
    const code = String(this.reasonForm.code || '').trim();
    const name = String(this.reasonForm.name || '').trim();
    this.reasonMissing = { code: !code, name: !name };
    if (!code || !name) { document.getElementById(!code ? 'rc-code' : 'rc-name')?.focus(); return; }

    this.reasonSaving = true;
    this.reasonError = '';
    this.svc.createReason({ ...this.reasonForm, code, name }).subscribe({
      next: () => {
        this.reasonSaving = false;
        this.showReasonForm = false;
        this.toast.success(`Reason code ${code.toUpperCase()} added`);
        this.loadReasons();
      },
      /* Leaving the dialog open with the typed values intact is the honest
         outcome of a failed save; closing it would imply success. */
      error: err => {
        this.reasonSaving = false;
        this.reasonError = err?.error?.message || 'Could not add the reason code. Try again.';
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
