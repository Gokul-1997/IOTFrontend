import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlarmService } from '../../core/services/alarm.service';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-alarms',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alarms.component.html'
})
export class AlarmsComponent implements OnInit {
  alarms: any[] = [];
  pagination: any = {};
  loading = false;
  filter = { is_resolved: 'false', machine_id: '', page: 1, limit: 20 };
  resolveNote = '';
  resolvingId: number | null = null;
  ticketedAlarmIds = new Set<number>();
  creatingTicketId: number | null = null;

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
  ) {}

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

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.cdr.markForCheck();

    const params: any = { ...this.filter };
    Object.keys(params).forEach(k => !params[k] && delete params[k]);
    this.alarmService.getAlarms(params).subscribe({
      next: res => {
        this.alarms = res.data || [];
        this.pagination = res.pagination || {};
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  resolve(id: number) {
    this.alarmService.resolveAlarm(id, this.resolveNote).subscribe({
      next: () => { this.resolvingId = null; this.resolveNote = ''; this.load(); },
      /* A failure used to leave the resolve box open forever with no hint
         that nothing had happened. */
      error: err => {
        this.resolvingId = null;
        this.toast.error(err?.error?.message || 'Could not resolve this alarm.');
        this.cdr.markForCheck();
      }
    });
  }

  createTicketFromAlarm(alarm: any) {
    this.creatingTicketId = alarm.id;
    this.cdr.markForCheck();
    this.ticketService.createTicket({
      machine_id: alarm.machine_id,
      alarm_id: alarm.id,
      title: `${alarm.alarm_type} on ${alarm.machine_serial_no}`,
      description: alarm.message || undefined,
      issue_type: 'ALARM',
      priority: this.priorityFor(alarm.severity)
    }).subscribe({
      next: () => {
        this.ticketedAlarmIds.add(alarm.id);
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

  /* The machines send CRITICAL and NORMAL; INFORMATION and the older
     LOW/MEDIUM/HIGH wording are kept so no severity shows up unstyled. */
  severityClass(severity: string) {
    const map: any = {
      CRITICAL: 'bg-red-100 text-red-700', HIGH: 'bg-orange-100 text-orange-700',
      NORMAL: 'bg-yellow-100 text-yellow-700', MEDIUM: 'bg-yellow-100 text-yellow-700',
      LOW: 'bg-blue-100 text-blue-700', INFORMATION: 'bg-blue-100 text-blue-700'
    };
    return map[String(severity || '').toUpperCase()] || 'bg-gray-100 text-gray-700';
  }
}
