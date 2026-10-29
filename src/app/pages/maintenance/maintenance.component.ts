import { ChangeDetectorRef, Component, Injector, OnInit, afterNextRender, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MaintenanceService } from '../../core/services/maintenance.service';
import { TicketService } from '../../core/services/ticket.service';
import { MachinesService } from '../machines/machines.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { EnumLabelPipe } from '../../shared/enum-label.pipe';
import { SearchSelectDirective } from '../../shared/search-select.directive';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { takeLinkedRecord } from '../../shared/linked-record';
import { alarmText } from '../../shared/alarm-text';
import { SEVERITY, severityOf } from '../../shared/severity';
import { MEXA_TABLE } from '../../shared/table/mexa-table';
import { BLANK, TableState, codes, words } from '../../shared/table/table-state';
import { StateComponent } from '../../shared/state/state.component';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EnumLabelPipe, SearchSelectDirective, MexaPagerComponent, StateComponent, ...MEXA_TABLE],
  templateUrl: './maintenance.component.html',
  styles: [`
    /* a block, not the default inline: the page's blocks inside an inline host
       hit-test oddly (the host answers for its own row buttons) */
    :host { display: block; }
    .num-col { text-align: right; }
    .mt-upcoming { margin-bottom: 1rem; }
    .mt-upcoming ul { list-style: none; margin: .5rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: .4rem; }
    .row-link { background: none; border: 0; padding: 0; font: inherit; color: var(--mexa-ink); cursor: pointer; text-align: left; }
    .row-link:hover { text-decoration: underline; }
    .row-link:focus-visible { outline: 2px solid var(--mexa-submit); outline-offset: 2px; border-radius: 4px; }
    tr.is-clickable { cursor: pointer; }
  `]
})
export class MaintenanceComponent implements OnInit {
  activeTab: 'tickets' | 'schedules' | 'logs' | 'mttr' = 'tickets';
  schedules: any[] = [];
  logs: any[] = [];
  mttr: any[] = [];
  upcoming: any[] = [];
  loading = false;

  /* The three forms (ticket, schedule, log) open in the same dialog as every
     other form in the app; they used to open in the page above the table. */
  showForm = false;
  form: any = blankSchedule();
  scheduleMissing = { title: false, machine: false, when: false };
  scheduleSaving = false;
  scheduleError = '';

  showLogForm = false;
  logForm: any = blankLog();
  logMissing = { title: false, machine: false, start: false };
  logSaving = false;
  logError = '';

  // ── Tickets ──────────────────────────────────────────────
  tickets: any[] = [];
  ticketFilter: 'open' | 'all' = 'open';
  /* Paged by the API: Open asked for the newest 20 tickets of any status and
     hid the finished ones here, so an open ticket older than those 20 never
     showed (29 Oct 2026). */
  ticketPage = 1;
  ticketLimit = 20;
  ticketPagination: any = {};

  /* The tables' headers (shared/table): sort any column, filter or search
     it. Tickets are paged by the API, so it sorts and filters them; the
     schedules, logs and MTTR are all here, so they are sorted here. */
  readonly ticketTable = new TableState<any>([
    { key: 'machine', filter: 'list', options: () => this.machines.map(m => ({ value: m.machine_serial_no, label: m.machine_serial_no })) },
    { key: 'title' },
    { key: 'issue', filter: 'list', options: () => codes(this.issueTypes) },
    { key: 'priority', filter: 'list', options: () => codes(this.priorities) },
    { key: 'assigned', filter: 'list', options: () => [{ value: BLANK, label: 'Unassigned' },
      ...this.assignableUsers.map(u => ({ value: u.username, label: u.username }))] },
    { key: 'status', filter: 'list', options: () => codes(this.ticketFilter === 'open' ? ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] : this.ticketStatuses) },
    { key: 'created' }
  ], { mode: 'server', onChange: () => { this.ticketPage = 1; this.loadTickets(); } });

  readonly scheduleTable = new TableState<any>([
    { key: 'machine_serial_no', filter: 'list' },
    { key: 'title' },
    { key: 'maintenance_type', filter: 'list', label: words },
    { key: 'scheduled_at' },
    { key: 'assigned_to', filter: 'list' },
    { key: 'status', filter: 'list', label: words }
  ]);

  readonly logTable = new TableState<any>([
    { key: 'machine_serial_no', filter: 'list' },
    { key: 'title' },
    { key: 'maintenance_type', filter: 'list', label: words },
    { key: 'started_at' },
    { key: 'technician_name', filter: 'list' },
    { key: 'status', filter: 'list', label: words }
  ]);

  readonly mttrTable = new TableState<any>([
    { key: 'machine_serial_no' },
    { key: 'total_events', type: 'number' },
    { key: 'avg_repair_minutes', type: 'number' },
    { key: 'total_downtime_minutes', type: 'number' }
  ]);
  showTicketForm = false;
  ticketForm: any = blankTicket();
  ticketMissing = { machine: false, title: false };
  ticketSaving = false;
  ticketError = '';
  // The company's active users. This used the admin-only user list, which
  // refused every other role — a MAINTENANCE user saw an empty dropdown.
  assignableUsers: any[] = [];
  selectedTicket: any = null;
  statusNote = '';

  // Shared by the Tickets, Schedules and Logs forms — all three used to be a
  // raw "Machine ID" number input (copy-pasted from Schedules originally),
  // which nobody can actually use without knowing IDs by heart.
  machines: any[] = [];

  readonly types = ['PREVENTIVE', 'CORRECTIVE', 'PREDICTIVE', 'INSPECTION'];
  readonly statuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  readonly recurrences = ['NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY'];
  readonly issueTypes = ['BREAKDOWN', 'ALARM', 'INSPECTION', 'OTHER'];
  readonly priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  readonly ticketStatuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  constructor(
    private svc: MaintenanceService,
    private ticketSvc: TicketService,
    private machinesSvc: MachinesService,
    public auth: AuthService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // a ticket opened from Machine Alarms (/maintenance?ticket_id=12)
    const linked = takeLinkedRecord(this.route, this.router, ['ticket_id']).ticket_id;
    if (linked) this.openTicket({ id: linked });
    this.loadTickets();
    this.loadUpcoming();
    this.ticketSvc.getAssignees().subscribe({
      next: (r: any) => { this.assignableUsers = r?.data || []; this.cdr.markForCheck(); },
      error: () => { /* assignment stays optional; the ticket can be created unassigned */ }
    });
    this.machinesSvc.getAllForDropdown().subscribe({
      next: (r: any) => { this.machines = r?.data || []; this.cdr.markForCheck(); }
    });
  }

  setTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    if (tab === 'tickets') this.loadTickets();
    if (tab === 'schedules') this.loadSchedules();
    if (tab === 'logs') this.loadLogs();
    if (tab === 'mttr') this.loadMTTR();
  }

  // ── Tickets ──────────────────────────────────────────────
  loadTickets() {
    this.loading = true;
    this.cdr.markForCheck();
    const params: any = { page: this.ticketPage, limit: this.ticketLimit, ...this.ticketTable.params() };
    if (this.ticketFilter === 'open') params.open = true;
    this.ticketSvc.getTickets(params).subscribe({
      next: (r: any) => {
        const rows = r.data || [];
        // an API from before open=true: it still says which are open
        this.tickets = this.ticketFilter === 'open'
          ? rows.filter((t: any) => t.status !== 'RESOLVED' && t.status !== 'CLOSED')
          : rows;
        this.ticketPagination = r.pagination || {};
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  setTicketFilter(f: 'open' | 'all') { this.ticketFilter = f; this.ticketPage = 1; this.loadTickets(); }

  /* ── the alarm a ticket was raised from ── */
  readonly alarmText = alarmText;
  readonly SEV = SEVERITY;
  readonly sevOf = severityOf;

  openTicketForm() {
    this.ticketForm = blankTicket();
    this.ticketMissing = { machine: false, title: false };
    this.ticketError = '';
    this.showTicketForm = true;
  }

  closeTicketForm() { this.showTicketForm = false; this.ticketError = ''; }

  saveTicket() {
    if (this.ticketSaving) return;
    const title = String(this.ticketForm.title || '').trim();
    this.ticketMissing = { machine: !this.ticketForm.machine_id, title: !title };
    if (this.ticketMissing.machine || this.ticketMissing.title) {
      document.getElementById(this.ticketMissing.machine ? 'tk-machine' : 'tk-title')?.focus();
      return;
    }
    const payload = { ...this.ticketForm, title, assigned_to: this.ticketForm.assigned_to || null };
    this.ticketSaving = true;
    this.ticketError = '';
    this.ticketSvc.createTicket(payload).subscribe({
      next: () => {
        this.ticketSaving = false;
        this.showTicketForm = false;
        this.toast.success('Ticket created');
        this.cdr.markForCheck();
        this.loadTickets();
      },
      /* A failed create used to close nothing and say nothing: say why, keep what was typed. */
      error: err => {
        this.ticketSaving = false;
        this.ticketError = err?.error?.message || 'Could not create the ticket. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  openTicket(t: any) {
    this.ticketSvc.getTicketById(t.id).subscribe({
      next: (r: any) => {
        const first = !this.selectedTicket;
        this.selectedTicket = r.data; this.ticketBusy = false; this.cdr.markForCheck();
        // a ticket opens to be read: focus on the dialog itself, not on its assignee list (which looked mid-edit)
        if (first) afterNextRender(() => document.querySelector<HTMLElement>('.tk-dialog')?.focus(), { injector: this.injector });
      },
      error: err => { this.ticketBusy = false; this.toast.error(err?.error?.message || 'Could not open this ticket.'); this.cdr.markForCheck(); }
    });
  }

  /* ── one ticket, in its dialog (29 Oct 2026, the user: "this looks clumsy") ── */

  /** A ticket's way: Open → Assigned → In progress → Resolved → Closed. */
  readonly flow = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  /** A status change or an assignment on its way: the buttons wait. */
  ticketBusy = false;

  /** Moving and assigning tickets is page:maintenance:edit, as the API checks; without it the dialog only shows. */
  get canEditTickets(): boolean { return this.auth.hasAction('maintenance', 'edit'); }

  stepOf(status: string): number { return Math.max(0, this.flow.indexOf(status)); }

  /** The next steps from here: the likely one as the main button. Reopening keeps the assignee. */
  ticketActions(t: any): { label: string; status: string; primary?: boolean }[] {
    const reopen = { label: 'Reopen', status: t?.assigned_to ? 'ASSIGNED' : 'OPEN' };
    switch (t?.status) {
      case 'OPEN':
      case 'ASSIGNED':    return [{ label: 'Close ticket', status: 'CLOSED' }, { label: 'Mark resolved', status: 'RESOLVED' },
                                  { label: 'Start work', status: 'IN_PROGRESS', primary: true }];
      case 'IN_PROGRESS': return [{ label: 'Close ticket', status: 'CLOSED' }, { label: 'Mark resolved', status: 'RESOLVED', primary: true }];
      case 'RESOLVED':    return [reopen, { label: 'Close ticket', status: 'CLOSED', primary: true }];
      case 'CLOSED':      return [reopen];
      default:            return [];
    }
  }

  /** A history row in words: "Work started", not "ASSIGNED → IN_PROGRESS". */
  historyTitle(h: any): string {
    if (!h?.from_status) return 'Ticket opened';
    const said: Record<string, string> = { OPEN: 'Reopened', ASSIGNED: 'Assigned', IN_PROGRESS: 'Work started', RESOLVED: 'Resolved', CLOSED: 'Closed' };
    return said[h.to_status] || String(h.to_status || '');
  }

  /** The ticket's own notes — not when they only repeat the alarm shown above them. */
  ticketNotes(t: any): string {
    const notes = String(t?.description || '').trim();
    if (!notes || !t.alarm_id) return notes;
    if (alarmText({ message: notes }) === alarmText({ message: t.alarm_message, alarm_type: t.alarm_type })) return '';
    // the alarm's facts as Machine Alarms fills them in (Alarm: / Code: / Severity: / Started:)
    if (notes.split('\n').every(line => /^(Alarm|Code|Severity|Started): /.test(line.trim()))) return '';
    return notes;
  }

  closeTicketDetail() { if (this.ticketBusy) return; this.selectedTicket = null; this.statusNote = ''; }

  changeTicketStatus(status: string) {
    if (!this.selectedTicket || this.ticketBusy) return;
    const fromAlarm = this.selectedTicket.alarm_id && !this.selectedTicket.alarm_is_resolved && (status === 'RESOLVED' || status === 'CLOSED');
    this.ticketBusy = true;
    this.ticketSvc.updateStatus(this.selectedTicket.id, status, this.statusNote.trim() || undefined).subscribe({
      next: () => {
        // the API resolves the alarm a ticket was raised from along with it
        this.toast.success(fromAlarm ? `Ticket ${this.statusWord(status)}; its alarm is resolved too` : `Ticket ${this.statusWord(status)}`);
        this.statusNote = '';
        this.openTicket(this.selectedTicket); this.cdr.markForCheck(); this.loadTickets();
      },
      /* a refused change (no Edit permission, a ticket gone) used to say nothing; the note typed stays */
      error: err => { this.ticketBusy = false; this.toast.error(err?.error?.message || 'Could not change the ticket status.'); this.cdr.markForCheck(); }
    });
  }

  assignTicketTo(userId: number) {
    if (!this.selectedTicket || !userId || this.ticketBusy || userId === this.selectedTicket.assigned_to) return;
    this.ticketBusy = true;
    this.ticketSvc.assignTicket(this.selectedTicket.id, userId).subscribe({
      next: () => { this.toast.success('Ticket assigned'); this.openTicket(this.selectedTicket); this.cdr.markForCheck(); this.loadTickets(); },
      error: err => { this.ticketBusy = false; this.toast.error(err?.error?.message || 'Could not assign the ticket.'); this.cdr.markForCheck(); }
    });
  }

  private statusWord(status: string): string {
    return ({ OPEN: 'reopened', ASSIGNED: 'assigned', IN_PROGRESS: 'in progress', RESOLVED: 'resolved', CLOSED: 'closed' } as any)[status] || 'updated';
  }

  ticketStatusClass(s: string) {
    const m: any = {
      OPEN: 'mexa-badge-bad',
      ASSIGNED: 'mexa-badge-info',
      IN_PROGRESS: 'mexa-badge-warn',
      RESOLVED: 'mexa-badge-good',
      CLOSED: 'mexa-badge-neutral'
    };
    return m[s] || 'mexa-badge-neutral';
  }

  priorityClass(p: string) {
    const m: any = { LOW: 'mexa-badge-neutral', MEDIUM: 'mexa-badge-info', HIGH: 'mexa-badge-warn', CRITICAL: 'mexa-badge-bad' };
    return m[p] || 'mexa-badge-neutral';
  }

  // ── Schedules / Logs / MTTR (unchanged) ─────────────────────
  loadSchedules() {
    this.loading = true;
    this.cdr.markForCheck();
    this.svc.getSchedules().subscribe({
      next: r => { this.schedules = r.data || []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  loadLogs() {
    this.loading = true;
    this.cdr.markForCheck();
    this.svc.getLogs().subscribe({
      next: r => { this.logs = r.data || []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  loadMTTR() { this.svc.getMTTR().subscribe({ next: r => { this.mttr = r.data || []; this.cdr.markForCheck(); } }); }
  loadUpcoming() { this.svc.getUpcoming(7).subscribe({ next: r => { this.upcoming = r.data || []; this.cdr.markForCheck(); } }); }

  openScheduleForm() {
    this.form = blankSchedule();
    this.scheduleMissing = { title: false, machine: false, when: false };
    this.scheduleError = '';
    this.showForm = true;
  }

  closeScheduleForm() { this.showForm = false; this.scheduleError = ''; }

  saveSchedule() {
    if (this.scheduleSaving) return;
    const title = String(this.form.title || '').trim();
    this.scheduleMissing = { title: !title, machine: !this.form.machine_id, when: !this.form.scheduled_at };
    const first = this.scheduleMissing.title ? 'sc-title' : this.scheduleMissing.machine ? 'sc-machine' : this.scheduleMissing.when ? 'sc-when' : '';
    if (first) { document.getElementById(first)?.focus(); return; }
    this.scheduleSaving = true;
    this.scheduleError = '';
    this.svc.createSchedule({ ...this.form, title }).subscribe({
      next: () => {
        this.scheduleSaving = false;
        this.showForm = false;
        this.toast.success('Schedule saved');
        this.cdr.markForCheck();
        this.loadSchedules();
        this.loadUpcoming();
      },
      error: err => {
        this.scheduleSaving = false;
        this.scheduleError = err?.error?.message || 'Could not save the schedule. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  openLogForm() {
    this.logForm = blankLog();
    this.logMissing = { title: false, machine: false, start: false };
    this.logError = '';
    this.showLogForm = true;
  }

  closeLogForm() { this.showLogForm = false; this.logError = ''; }

  saveLog() {
    if (this.logSaving) return;
    const title = String(this.logForm.title || '').trim();
    this.logMissing = { title: !title, machine: !this.logForm.machine_id, start: !this.logForm.started_at };
    const first = this.logMissing.title ? 'lg-title' : this.logMissing.machine ? 'lg-machine' : this.logMissing.start ? 'lg-start' : '';
    if (first) { document.getElementById(first)?.focus(); return; }
    this.logSaving = true;
    this.logError = '';
    this.svc.createLog({ ...this.logForm, title }).subscribe({
      next: () => {
        this.logSaving = false;
        this.showLogForm = false;
        this.toast.success('Maintenance work logged');
        this.cdr.markForCheck();
        this.loadLogs();
      },
      error: err => {
        this.logSaving = false;
        this.logError = err?.error?.message || 'Could not save the log. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  /** Asked in the app's own dialog, not the browser's confirm() box. */
  async deleteSchedule(s: any) {
    const yes = await this.confirm.ask({
      title: `Remove the schedule "${s.title}"?`,
      message: `${s.machine_serial_no} will no longer have this maintenance planned. Work already logged is kept.`,
      confirmText: 'Remove',
      icon: 'delete_forever'
    });
    if (!yes) return;
    this.svc.deleteSchedule(s.id).subscribe({
      next: () => { this.toast.success('Schedule removed'); this.loadSchedules(); this.loadUpcoming(); },
      error: err => this.toast.error(err?.error?.message || 'Could not remove the schedule')
    });
  }

  statusClass(s: string) {
    const m: any = { SCHEDULED: 'mexa-badge-info', IN_PROGRESS: 'mexa-badge-warn', COMPLETED: 'mexa-badge-good', CANCELLED: 'mexa-badge-neutral', OVERDUE: 'mexa-badge-bad' };
    return m[s] || 'mexa-badge-neutral';
  }
}

function blankTicket() {
  return { machine_id: '', title: '', description: '', issue_type: 'BREAKDOWN', priority: 'MEDIUM', assigned_to: '' };
}

function blankSchedule() {
  return { title: '', machine_id: '', maintenance_type: 'PREVENTIVE', scheduled_at: '', estimated_duration_minutes: 60, assigned_to: '', recurrence: 'NONE' };
}

function blankLog() {
  return { title: '', machine_id: '', maintenance_type: 'CORRECTIVE', started_at: '', completed_at: '', technician_name: '', work_performed: '', status: 'COMPLETED' };
}
