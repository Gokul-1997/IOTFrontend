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
 *    ticket is an icon that becomes "Ticket raised" (kept after a reload,
 *    from the API's ticket_id);
 *  - nothing said how many, or how bad: a strip above the table counts
 *    them, and All | Critical | Non-critical narrows the list;
 *  - a Machine filter, the flat list with search, as on every page.
 * Severity is also a stripe at the row's start, so a critical alarm stands
 * out on a phone where the Severity column is hidden.
 */
@Component({
  selector: 'app-alarms',
  standalone: true,
  imports: [FilterPanelDirective, CommonModule, FormsModule, MexaPagerComponent, SkeletonRowsComponent, StateComponent, SearchSelectDirective],
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

  ticketedAlarmIds = new Set<number>();
  creatingTicketId: number | null = null;

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

  /** The Action column: only where there is something to do. */
  get showActions(): boolean { return this.canResolve && this.filter.is_resolved !== 'true'; }

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

  /**
   * The alarm in the machine's words, said once. Some controllers send
   * "Alarm type: X X" — a label and the text twice; "UNSPECIFIED" is no text.
   */
  alarmText(alarm: any): string {
    let text = String(alarm?.message || alarm?.alarm_type || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^alarm type\s*:\s*/i, '');
    const twice = /^(.{6,}?)\s+\1$/i.exec(text);
    if (twice) text = twice[1];
    return /^(unspecified|unknown|null|none|-+)$/i.test(text) ? '' : text;
  }

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

  ticketOf(alarm: any): number | null {
    return alarm.ticket_id ?? (this.ticketedAlarmIds.has(alarm.id) ? -1 : null);
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

  createTicketFromAlarm(alarm: any) {
    this.creatingTicketId = alarm.id;
    this.cdr.markForCheck();
    const what = this.alarmText(alarm) || this.kindOf(alarm) || 'Alarm';
    this.ticketService.createTicket({
      machine_id: alarm.machine_id,
      alarm_id: alarm.id,
      title: `${what} on ${alarm.machine_serial_no}`.slice(0, 200),
      description: alarm.message || undefined,
      issue_type: 'ALARM',
      priority: this.priorityFor(alarm.severity)
    }).subscribe({
      next: (r: any) => {
        this.ticketedAlarmIds.add(alarm.id);
        if (r?.data?.id) alarm.ticket_id = r.data.id;
        this.creatingTicketId = null;
        this.toast.success('Maintenance ticket raised');
        this.cdr.markForCheck();
      },
      /* Silence told the user nothing: the button simply stopped spinning
         while the ticket was never created. */
      error: err => {
        this.creatingTicketId = null;
        this.toast.error(err?.error?.message || 'Could not raise a ticket for this alarm.');
        this.cdr.markForCheck();
      }
    });
  }

  /* severity in words, icon and colour (shared/severity.ts) */
  readonly SEV = SEVERITY;
  readonly sevOf = severityOf;
}
