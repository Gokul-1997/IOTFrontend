import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DowntimeService } from '../../core/services/downtime.service';

@Component({
  selector: 'app-downtime',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './downtime.component.html',
  styles: [`
    .num-col { text-align: right; }
    .reason-form { margin-bottom: 1rem; }
    .reason-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
    .reason-actions { margin-top: .9rem; }
    .reason-cards { display: grid; gap: .85rem; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
    .reason-cards .mexa-card + .mexa-card { margin-top: 0; }
    .reason-card { display: flex; align-items: center; gap: .8rem; }
    .reason-code { width: 2.75rem; height: 2.75rem; flex: none; border-radius: 12px; display: grid; place-items: center;
                   background: var(--mexa-row-alt); color: var(--mexa-submit); font-weight: 700; font-size: .85rem; }
    .reason-body { min-width: 0; }
    .reason-name { margin: 0 0 .25rem; font-weight: 600; color: var(--mexa-ink); }
  `]
})
export class DowntimeComponent implements OnInit {
  activeTab: 'events' | 'reasons' | 'summary' = 'events';
  reasons: any[] = [];
  events: any[] = [];
  summary: any[] = [];
  pagination: any = {};
  loading = false;
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
    this.svc.getReasons().subscribe({
      next: r => { this.reasons = r.data || []; this.cdr.markForCheck(); }
    });
  }

  loadEvents() {
    this.loading = true;
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
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  loadSummary() {
    const params: any = {};
    if (this.filter.from_date) params['from_date'] = this.filter.from_date;
    if (this.filter.to_date)   params['to_date']   = this.filter.to_date;
    this.svc.getSummary(params).subscribe({
      next: r => { this.summary = r.data || []; this.cdr.markForCheck(); }
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

  categoryClass(cat: string) {
    const m: any = { UNPLANNED: 'mexa-badge-bad', PLANNED: 'mexa-badge-info', QUALITY: 'mexa-badge-violet', CHANGEOVER: 'mexa-badge-warn' };
    return m[cat] || 'mexa-badge-neutral';
  }
}
