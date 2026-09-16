import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlarmService } from '../../core/services/alarm.service';
import { TicketService } from '../../core/services/ticket.service';

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
    private cdr: ChangeDetectorRef
  ) {}

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
      error: () => { this.resolvingId = null; this.cdr.markForCheck(); }
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
      // Alarm severity and ticket priority share the same LOW/MEDIUM/HIGH/CRITICAL set.
      priority: alarm.severity
    }).subscribe({
      next: () => {
        this.ticketedAlarmIds.add(alarm.id);
        this.creatingTicketId = null;
        this.cdr.markForCheck();
      },
      error: () => { this.creatingTicketId = null; this.cdr.markForCheck(); }
    });
  }

  severityClass(severity: string) {
    const map: any = { CRITICAL: 'bg-red-100 text-red-700', HIGH: 'bg-orange-100 text-orange-700', MEDIUM: 'bg-yellow-100 text-yellow-700', LOW: 'bg-blue-100 text-blue-700' };
    return map[severity] || 'bg-gray-100 text-gray-700';
  }
}
