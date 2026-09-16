import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DowntimeService } from '../../core/services/downtime.service';

@Component({
  selector: 'app-downtime',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './downtime.component.html'
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
    const m: any = { UNPLANNED: 'bg-red-100 text-red-700', PLANNED: 'bg-blue-100 text-blue-700', QUALITY: 'bg-purple-100 text-purple-700', CHANGEOVER: 'bg-yellow-100 text-yellow-700' };
    return m[cat] || 'bg-gray-100 text-gray-700';
  }
}
