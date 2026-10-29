import { ChangeDetectorRef, Component, DestroyRef, Injector, OnInit, afterNextRender, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AlarmService } from '../../core/services/alarm.service';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { MasterDataService } from '../../core/services/master-data.service';
import { FilterPanelDirective } from '../../shared/filter-panel.directive';
import { SEVERITY, severityOf } from '../../shared/severity';
import { MexaPagerComponent } from '../../shared/mexa-pager/mexa-pager';
import { takeLinkedRecord } from '../../shared/linked-record';
import { SkeletonRowsComponent } from '../../shared/skeleton-rows.component';
import { StateComponent } from '../../shared/state/state.component';
import { SearchSelectDirective } from '../../shared/search-select.directive';
import { EnumLabelPipe } from '../../shared/enum-label.pipe';
import { alarmText, isOpenTicket } from '../../shared/alarm-text';
import { RouterLink } from '@angular/router';

/** The same alarms counted without the severity filter (GET /api/alarms → summary). */
interface AlarmSummary { total: number; critical: number; still_on: number; machines: number; }

/*
 * Machine Alarms (29 Oct 2026, the user: "this page looks unprofessional").
 * Same MEXA page — title bar, one card, THE table — with what was wrong
 * with it taken out:
 *  - the alarm text said itself twice ("Alarm type: X X") and the Code
 *    column repeated it again, cut at 50 characters: the text is said once,
 *    the code column holds the code;
 *  - "Active" on every row of the Active list said nothing: the Status
 *    column now says whether the alarm is still on the machine or the
 *    machine has cleared it, and Started says for how long;
 *  - every row had two grey buttons and Resolve opened a text box inside
 *    the row: Resolve is one small button that opens THE dialog, and the
 *    ticket is an icon that opens the ticket form;
 *  - nothing said how many, or how bad: a strip above the table counts
 *    them, and All | Critical | Non-critical narrows the list;
 *  - a Machine filter, the flat list with search, as on every page.
 * Severity is also a stripe at the row's start, so a critical alarm stands
 * out on a phone where the Severity column is hidden.
 */
@Component({
  selector: 'app-alarms',
  standalone: true,
  imports: [FilterPanelDirective, CommonModule, FormsModule, RouterLink, MexaPagerComponent, SkeletonRowsComponent, StateComponent, SearchSelectDirective, EnumLabelPipe],
  templateUrl: './alarms.component.html'
})
export class AlarmsComponent implements OnInit {
  alarms: any[] = [];
  pagination: any = {};
  summary: AlarmSummary | null = null;
  machines: { id: number; machine_serial_no: string }[] = [];
  loading = false;
  loadError = false;
  filter: { is_resolved: string; machine_id: number | null; severity: '' | 'CRITICAL' | 'NORMAL'; page: number; limit: number } =
    { is_resolved: 'false', machine_id: null, severity: '', page: 1, limit: 20 };
  /** When the rows were read: "for 2 h" is measured to it, and stays put between renders. */
  now = Date.now();

  /** The alarm whose Resolve dialog is open. */
  resolving: any = null;
  resolveNote = '';
  resolveSaving = false;
  resolveError = '';

  /*
   * Raising a ticket (29 Oct 2026, the user: "the ticket flow is not working
   * properly"). It was one click that made an unassigned ticket nobody was
   * told about, offered again after a reload (a second ticket for the same
   * fault), shown to whoever could resolve alarms rather than to who may
   * create tickets (the API refused the rest), and the alarm stayed Active
   * after the ticket was done. Now: the ticket form, filled in from the
   * alarm, with Priority and Assign to; the API keeps one open ticket per
   * alarm and resolves the alarm when its ticket is resolved; the row shows
   * the ticket and its status, and opens it in Maintenance.
   */
  ticketFor: any = null;
  ticketForm = { title: '', priority: 'MEDIUM', assigned_to: null as number | null, description: '' };
  ticketMissingTitle = false;
  ticketSaving = false;
  ticketError = '';
  assignees: { id: number; username: string }[] | null = null;
  readonly priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  /** The alarm a notification opened (?alarm_id=): its row is marked and brought into view. */
  linkedAlarmId: number | null = null;
  private lookedInAll = false;
  private loadSub?: Subscription;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly master = inject(MasterDataService);

  /* The app is zoneless: an HTTP response resolving does not schedule a
     render on its own, so every callback that changes what is on screen has
     to say so. Without this the rows arrive and sit in the component while
     the page still shows "loading" — until an unrelated click (the header
     listens on document:click) happens to force a change-detection pass,
     which is why the data appeared to need a second click. */
  constructor(
    private alarmService: AlarmService,
    private ticketService: TicketService,
    private toast: ToastService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {
    inject(DestroyRef).onDestroy(() => this.loadSub?.unsubscribe());
  }

  /* A machine says how bad an alarm is in its own words — CRITICAL or NORMAL
     here, INFORMATION on other controllers. A ticket's priority is a different
     list (LOW / MEDIUM / HIGH / CRITICAL), so the severity cannot be sent as
     one: a NORMAL alarm used to fail with a database enum error, and only a
     CRITICAL alarm could be ticketed at all. The server translates too. */
  private priorityFor(severity: string): string {
    const map: Record<string, string> = {
      CRITICAL: 'CRITICAL', FATAL: 'CRITICAL',
      MAJOR: 'HIGH', HIGH: 'HIGH',
      NORMAL: 'MEDIUM', WARNING: 'MEDIUM', MEDIUM: 'MEDIUM', 'NON-CRITICAL': 'MEDIUM',
      MINOR: 'LOW', LOW: 'LOW', INFO: 'LOW', INFORMATION: 'LOW'
    };
    return map[String(severity || '').trim().toUpperCase()] || 'MEDIUM';
  }

  /** Resolving is its own grant, as the API checks it. */
  get canResolve(): boolean { return this.auth.hasAction('alarms', 'resolve'); }

  /** A ticket is Maintenance's: creating one is page:maintenance:create, as the API checks. */
  get canRaiseTicket(): boolean { return this.auth.hasAction('maintenance', 'create'); }
  get canOpenTickets(): boolean { return this.auth.hasAction('maintenance', 'view'); }

  /** The Action column: only where there is something to do. */
  get showActions(): boolean { return (this.canResolve || this.canRaiseTicket) && this.filter.is_resolved !== 'true'; }

  get columns(): number { return this.showActions ? 7 : 6; }

  ngOnInit() {
    this.linkedAlarmId = takeLinkedRecord(this.route, this.router, ['alarm_id']).alarm_id ?? null;
    this.master.get('charts').subscribe({
      next: (r: any) => { this.machines = r?.data?.machines || []; this.cdr.markForCheck(); },
      error: () => { /* the list still works with All machines */ }
    });
    this.load();
  }

  /** The linked alarm on screen: marked, scrolled to and focused. Resolved since the
   *  notification? It is not among the active ones — look once in All. */
  private showLinked(): void {
    const id = this.linkedAlarmId;
    if (!id) return;
    if (!this.alarms.some(a => a.id === id)) {
      if (!this.lookedInAll && this.filter.is_resolved !== '') {
        this.lookedInAll = true;
        this.filter = { ...this.filter, is_resolved: '', page: 1 };
        this.load();
      }
      return;
    }
    afterNextRender(() => {
      const row = document.getElementById(`alarm-${id}`);
      row?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      row?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  /** A filter changed: back to the first page. */
  apply(): void {
    this.filter.page = 1;
    this.load();
  }

  setSeverity(severity: '' | 'CRITICAL' | 'NORMAL'): void {
    if (this.filter.severity === severity) return;
    this.filter.severity = severity;
    this.apply();
  }

  load() {
    // only the latest choice is ever shown
    this.loadSub?.unsubscribe();
    this.loading = true;
    this.loadError = false;
    this.cdr.markForCheck();

    const params: any = { ...this.filter };
    Object.keys(params).forEach(k => (params[k] === '' || params[k] === null || params[k] === undefined) && delete params[k]);
    this.loadSub = this.alarmService.getAlarms(params).subscribe({
      next: res => {
        this.alarms = res.data || [];
        this.pagination = res.pagination || {};
        this.summary = res.summary || null;
        this.now = Date.now();
        this.loading = false;
        this.cdr.markForCheck();
        this.showLinked();
      },
      error: () => { this.loading = false; this.loadError = true; this.alarms = []; this.cdr.markForCheck(); }
    });
  }

  /* ── what a row says ── */

  /** The alarm in the machine's words, said once (shared/alarm-text.ts). */
  alarmText(alarm: any): string { return alarmText(alarm); }

  /** The kind of event (Offline, Low performance) when the text does not already say it. */
  kindOf(alarm: any): string {
    const type = String(alarm?.alarm_type || '').trim();
    if (!type || type.length > 24 || !/^[A-Z_ ]+$/.test(type) || /^(ALARM|UNSPECIFIED|UNKNOWN|NONE)$/.test(type)) return '';
    const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (plain(this.alarmText(alarm)).includes(plain(type))) return '';
    return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  /** On the machine now: the controller has not cleared it and nobody has resolved it. */
  stillOn(alarm: any): boolean { return !alarm.is_resolved && !alarm.ended_at; }

  /** "for 2 h 14 min" while it is on; "lasted 4 min" once the machine cleared it. */
  durationText(alarm: any): string {
    const start = Date.parse(alarm?.started_at);
    if (!Number.isFinite(start)) return '';
    const end = alarm.ended_at ? Date.parse(alarm.ended_at) : (alarm.is_resolved ? NaN : this.now);
    if (!Number.isFinite(end)) return '';
    const span = AlarmsComponent.span(end - start);
    return alarm.ended_at ? `lasted ${span}` : `for ${span}`;
  }

  static span(ms: number): string {
    const min = Math.max(0, Math.floor(ms / 60_000));
    if (min < 1) return 'under a minute';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return `${d} day${d === 1 ? '' : 's'}${rh ? ` ${rh} h` : ''}`;
  }

  /** The year only when it is not this one. */
  dateFormat(value: string | null | undefined): string {
    const d = value ? new Date(value) : null;
    return d && d.getFullYear() !== new Date(this.now).getFullYear() ? 'd MMM y, h:mm a' : 'd MMM, h:mm a';
  }

  /** The ticket still being worked on for this alarm, if there is one. */
  openTicketOf(alarm: any): number | null {
    return alarm.ticket_id && isOpenTicket(alarm.ticket_status) ? Number(alarm.ticket_id) : null;
  }

  /* ── resolve, in THE dialog ── */

  openResolve(alarm: any): void {
    this.resolving = alarm;
    this.resolveNote = '';
    this.resolveError = '';
    this.cdr.markForCheck();
  }

  closeResolve(): void {
    if (this.resolveSaving) return;
    this.resolving = null;
    this.cdr.markForCheck();
  }

  resolve(): void {
    const alarm = this.resolving;
    if (!alarm || this.resolveSaving) return;
    this.resolveSaving = true;
    this.resolveError = '';
    this.cdr.markForCheck();
    this.alarmService.resolveAlarm(alarm.id, this.resolveNote.trim()).subscribe({
      next: () => {
        this.resolveSaving = false;
        this.resolving = null;
        this.toast.success(`Alarm on ${alarm.machine_serial_no} resolved`);
        this.load();
      },
      /* A failure used to leave the resolve box open forever with no hint
         that nothing had happened. It says why, in the dialog. */
      error: err => {
        this.resolveSaving = false;
        this.resolveError = err?.error?.message || 'Could not resolve this alarm. Try again.';
        this.cdr.markForCheck();
      }
    });
  }

  /* ── raise a ticket, in THE dialog, filled in from the alarm ── */

  openTicketForm(alarm: any): void {
    const text = this.alarmText(alarm) || this.kindOf(alarm) || 'Alarm';
    const when = alarm.started_at ? new Date(alarm.started_at).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    this.ticketFor = alarm;
    this.ticketForm = {
      title: `${text} on ${alarm.machine_serial_no}`.slice(0, 200),
      priority: this.priorityFor(alarm.severity),
      assigned_to: null,
      description: [
        `Alarm: ${text}`,
        alarm.alarm_code ? `Code: ${alarm.alarm_code}` : '',
        `Severity: ${SEVERITY[severityOf(alarm.severity)].label}`,
        when ? `Started: ${when}` : ''
      ].filter(Boolean).join('\n')
    };
    this.ticketMissingTitle = false;
    this.ticketError = '';
    this.cdr.markForCheck();
    // who it can go to: asked once, when first needed; without it the ticket is raised unassigned
    if (this.assignees === null && this.canOpenTickets) {
      this.assignees = [];
      this.ticketService.getAssignees().subscribe({
        next: (r: any) => { this.assignees = r?.data || []; this.cdr.markForCheck(); },
        error: () => { this.assignees = []; this.cdr.markForCheck(); }
      });
    }
  }

  closeTicketForm(): void {
    if (this.ticketSaving) return;
    this.ticketFor = null;
    this.cdr.markForCheck();
  }

  raiseTicket(): void {
    const alarm = this.ticketFor;
    if (!alarm || this.ticketSaving) return;
    const title = this.ticketForm.title.trim();
    this.ticketMissingTitle = !title;
    if (!title) { document.getElementById('al-tk-title')?.focus(); return; }
    this.ticketSaving = true;
    this.ticketError = '';
    this.cdr.markForCheck();
    this.ticketService.createTicket({
      machine_id: alarm.machine_id,
      alarm_id: alarm.id,
      title,
      description: this.ticketForm.description.trim() || undefined,
      issue_type: 'ALARM',
      priority: this.ticketForm.priority,
      assigned_to: this.ticketForm.assigned_to || undefined
    }).subscribe({
      next: (r: any) => {
        this.ticketSaving = false;
        this.ticketFor = null;
        alarm.ticket_id = r?.data?.id ?? alarm.ticket_id;
        alarm.ticket_status = r?.data?.status || 'OPEN';
        this.toast.success(r?.data?.id ? `Ticket #${r.data.id} raised` : 'Maintenance ticket raised');
        this.cdr.markForCheck();
      },
      error: err => {
        this.ticketSaving = false;
        const body = err?.error || {};
        // someone raised one already (another person, another tab): show theirs
        if (err?.status === 409 && body.code === 'TICKET_EXISTS' && body.ticket_id) {
          alarm.ticket_id = body.ticket_id;
          alarm.ticket_status = body.ticket_status || 'OPEN';
          this.ticketFor = null;
          this.toast.info(body.message || `Ticket #${body.ticket_id} is already open for this alarm`);
        } else {
          this.ticketError = body.message || 'Could not raise the ticket. Try again.';
        }
        this.cdr.markForCheck();
      }
    });
  }

  /* severity in words, icon and colour (shared/severity.ts) */
  readonly SEV = SEVERITY;
  readonly sevOf = severityOf;
}
