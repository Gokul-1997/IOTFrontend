import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaintenanceService } from '../../core/services/maintenance.service';
import { TicketService } from '../../core/services/ticket.service';
import { MachinesService } from '../machines/machines.service';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './maintenance.component.html'
})
export class MaintenanceComponent implements OnInit {
  activeTab: 'tickets' | 'schedules' | 'logs' | 'mttr' = 'tickets';
  schedules: any[] = [];
  logs: any[] = [];
  mttr: any[] = [];
  upcoming: any[] = [];
  loading = false;
  showForm = false;
  form: any = { title: '', machine_id: '', maintenance_type: 'PREVENTIVE', scheduled_at: '', estimated_duration_minutes: 60, assigned_to: '', recurrence: 'NONE' };
  logForm: any = { title: '', machine_id: '', maintenance_type: 'CORRECTIVE', started_at: '', completed_at: '', technician_name: '', work_performed: '', status: 'COMPLETED' };
  showLogForm = false;

  // ── Tickets ──────────────────────────────────────────────
  tickets: any[] = [];
  ticketFilter: 'open' | 'all' = 'open';
  showTicketForm = false;
  ticketForm: any = { machine_id: '', title: '', description: '', issue_type: 'BREAKDOWN', priority: 'MEDIUM', assigned_to: '' };
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

  constructor(
    private svc: MaintenanceService,
    private ticketSvc: TicketService,
    private machinesSvc: MachinesService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
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
    const params = this.ticketFilter === 'open' ? {} : {};
    this.ticketSvc.getTickets(params).subscribe({
      next: (r: any) => {
        const rows = r.data || [];
        this.tickets = this.ticketFilter === 'open'
          ? rows.filter((t: any) => t.status !== 'RESOLVED' && t.status !== 'CLOSED')
          : rows;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  setTicketFilter(f: 'open' | 'all') { this.ticketFilter = f; this.loadTickets(); }

  saveTicket() {
    const payload = { ...this.ticketForm, assigned_to: this.ticketForm.assigned_to || null };
    this.ticketSvc.createTicket(payload).subscribe({
      next: () => {
        this.showTicketForm = false;
        this.ticketForm = { machine_id: '', title: '', description: '', issue_type: 'BREAKDOWN', priority: 'MEDIUM', assigned_to: '' };
        this.cdr.markForCheck();
        this.loadTickets();
      },
      /* A failed create used to close nothing and say nothing. */
      error: () => this.cdr.markForCheck()
    });
  }

  openTicket(t: any) {
    this.ticketSvc.getTicketById(t.id).subscribe({ next: (r: any) => { this.selectedTicket = r.data; this.statusNote = ''; this.cdr.markForCheck(); } });
  }

  closeTicketDetail() { this.selectedTicket = null; this.statusNote = ''; }

  changeTicketStatus(status: string) {
    if (!this.selectedTicket) return;
    this.ticketSvc.updateStatus(this.selectedTicket.id, status, this.statusNote || undefined).subscribe({
      next: () => { this.openTicket(this.selectedTicket); this.statusNote = ''; this.cdr.markForCheck(); this.loadTickets(); }
    });
  }

  assignTicketTo(userId: number) {
    if (!this.selectedTicket || !userId) return;
    this.ticketSvc.assignTicket(this.selectedTicket.id, userId).subscribe({
      next: () => { this.openTicket(this.selectedTicket); this.cdr.markForCheck(); this.loadTickets(); }
    });
  }

  ticketStatusClass(s: string) {
    const m: any = {
      OPEN: 'bg-red-100 text-red-700',
      ASSIGNED: 'bg-blue-100 text-blue-700',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
      RESOLVED: 'bg-green-100 text-green-700',
      CLOSED: 'bg-gray-100 text-gray-700'
    };
    return m[s] || 'bg-gray-100 text-gray-700';
  }

  priorityClass(p: string) {
    const m: any = { LOW: 'bg-gray-100 text-gray-600', MEDIUM: 'bg-blue-100 text-blue-700', HIGH: 'bg-orange-100 text-orange-700', CRITICAL: 'bg-red-100 text-red-700' };
    return m[p] || 'bg-gray-100 text-gray-600';
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

  saveSchedule() {
    this.svc.createSchedule(this.form).subscribe({
      next: () => { this.showForm = false; this.form = { title: '', machine_id: '', maintenance_type: 'PREVENTIVE', scheduled_at: '', estimated_duration_minutes: 60, assigned_to: '', recurrence: 'NONE' }; this.cdr.markForCheck(); this.loadSchedules(); },
      error: () => this.cdr.markForCheck()
    });
  }

  saveLog() {
    this.svc.createLog(this.logForm).subscribe({
      next: () => { this.showLogForm = false; this.logForm = { title: '', machine_id: '', maintenance_type: 'CORRECTIVE', started_at: '', completed_at: '', technician_name: '', work_performed: '', status: 'COMPLETED' }; this.cdr.markForCheck(); this.loadLogs(); },
      error: () => this.cdr.markForCheck()
    });
  }

  deleteSchedule(id: number) {
    if (!confirm('Remove this schedule?')) return;
    this.svc.deleteSchedule(id).subscribe({ next: () => this.loadSchedules() });
  }

  statusClass(s: string) {
    const m: any = { SCHEDULED: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-yellow-100 text-yellow-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-gray-100 text-gray-700', OVERDUE: 'bg-red-100 text-red-700' };
    return m[s] || 'bg-gray-100 text-gray-700';
  }
}
