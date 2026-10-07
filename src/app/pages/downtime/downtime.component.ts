import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DowntimeService } from '../../core/services/downtime.service';
import { StateComponent } from '../../shared/state/state.component';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';

@Component({
  selector: 'app-downtime',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent, SkeletonRowsComponent, MexaPagerComponent],
  templateUrl: './downtime.component.html',
  styles: [`
    .num-col { text-align: right; }
    .reason-form { padding: 1rem 1rem .25rem; border-bottom: 1px solid var(--tbl-rule); }
    .reason-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
    .reason-actions { margin-top: .9rem; }
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
  reasonSort: 'code' | 'name' | 'category' = 'code';
  reasonDir: 'asc' | 'desc' = 'asc';
  showReasonForm = false;
  reasonForm: any = { code: '', name: '', category: 'UNPLANNED' };
  filter: any = { from_date: '', to_date: '', page: 1, limit: 20 };

  readonly categories = ['UNPLANNED', 'PLANNED', 'QUALITY', 'CHANGEOVER'];

  /* The app is zoneless: an HTTP response resolving does not schedule a
     render on its own, so every callback that changes what is on screen has
     to say so. Without this the events arrive and sit in the component while
     the table still reads empty — until an unrelated click (the header
     listens on document:click) forces a change-detection pass, which is why
     the data appeared to need a second click. */
  constructor(private svc: DowntimeService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadReasons(); this.loadEvents(); }

  loadReasons() {
    this.reasonsState = 'loading';
    this.cdr.markForCheck();
    this.svc.getReasons().subscribe({
      next: r => { this.reasons = r.data || []; this.reasonsState = 'ready'; this.cdr.markForCheck(); },
      error: () => { this.reasonsState = 'error'; this.cdr.markForCheck(); }
    });
  }

  /** The reason codes the search matches, in the chosen order. */
  get shownReasons(): any[] {
    const q = this.reasonSearch.trim().toLowerCase();
    const sign = this.reasonDir === 'asc' ? 1 : -1;
    const k = this.reasonSort;
    return this.reasons
      .filter(r => !q || `${r.code} ${r.name}`.toLowerCase().includes(q))
      .sort((a, b) => sign * String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true }));
  }
  sortReasons(k: 'code' | 'name' | 'category') {
    if (this.reasonSort === k) this.reasonDir = this.reasonDir === 'asc' ? 'desc' : 'asc';
    else { this.reasonSort = k; this.reasonDir = 'asc'; }
  }
  reasonArrow(k: string): string { return this.reasonSort === k ? (this.reasonDir === 'asc' ? '▲' : '▼') : '⇅'; }
  reasonAriaSort(k: string): string | null {
    return this.reasonSort === k ? (this.reasonDir === 'asc' ? 'ascending' : 'descending') : null;
  }
  trackReason = (_: number, r: any) => r.id;

  loadEvents() {
    this.loading = true;
    this.eventsError = false;
    this.cdr.markForCheck();

    const params: any = { ...this.filter };
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

  saveReason() {
    this.svc.createReason(this.reasonForm).subscribe({
      next: () => {
        this.showReasonForm = false;
        this.reasonForm = { code: '', name: '', category: 'UNPLANNED' };
        this.loadReasons();
      },
      /* Leaving the form open with the typed values intact is the honest
         outcome of a failed save; silently closing it implies success. */
      error: () => this.cdr.markForCheck()
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
