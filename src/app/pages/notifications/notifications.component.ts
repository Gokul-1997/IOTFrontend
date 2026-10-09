import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';

/**
 * The full notification list.
 *
 * The header's bell panel has linked here ("View all") since before this
 * page existed — routerLink="/notifications" pointed at nothing, so that
 * link has been dead in production.
 */
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications.component.html',
  styles: [`
    .nt-pad { padding: 1rem; }
    .nt-retry { margin-top: .75rem; }
    .nt-list { list-style: none; margin: 0; padding: 0; }
    .nt-list li + li { border-top: 1px solid var(--mexa-rule); }
    .nt-item { width: 100%; display: flex; align-items: flex-start; gap: .75rem; padding: .9rem 1.1rem; text-align: left;
               background: none; border: 0; font: inherit; cursor: pointer; color: inherit; }
    .nt-item:hover { background: var(--mexa-row-alt); }
    .nt-item:focus-visible { outline: 2px solid var(--mexa-submit); outline-offset: -2px; }
    .nt-item.is-unread { background: #f1f2fb; }
    :host-context(.dark) .nt-item.is-unread { background: #1d2133; }
    .nt-dot { margin-top: .4rem; width: .55rem; height: .55rem; border-radius: 999px; flex: none; }
    .nt-dot.is-alarm { background: var(--mexa-bad); }
    .nt-dot.is-warning { background: var(--mexa-warn); }
    .nt-dot.is-info { background: var(--mexa-info); }
    .nt-body { min-width: 0; flex: 1; }
    .nt-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
    .nt-title { font-size: .9rem; font-weight: 600; color: var(--mexa-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nt-item.is-unread .nt-title { font-weight: 700; }
    .nt-time { font-size: .78rem; color: var(--mexa-ink-3); flex: none; }
    .nt-msg { display: block; font-size: .85rem; color: var(--mexa-ink-2); margin-top: .15rem; }
  `]
})
export class NotificationsComponent implements OnInit {

  notifications: any[] = [];
  loading = false;
  errorMsg = '';
  unreadOnly = false;

  page = 1;
  readonly limit = 20;
  total = 0;
  totalPages = 1;

  constructor(
    private notif: NotificationService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    this.notif.getNotifications({
      page: this.page, limit: this.limit,
      ...(this.unreadOnly ? { unread_only: 'true' } : {})
    }).subscribe({
      next: (res: any) => {
        this.notifications = res.data || [];
        this.total = res.pagination?.total ?? this.notifications.length;
        this.totalPages = res.pagination?.totalPages ?? 1;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMsg = err?.error?.message || 'Unable to load notifications.';
        this.cdr.markForCheck();
      }
    });
  }

  setUnreadOnly(value: boolean): void {
    if (this.unreadOnly === value) return;
    this.unreadOnly = value;
    this.page = 1;
    this.load();
  }

  changePage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || next > this.totalPages) return;
    this.page = next;
    this.load();
  }

  open(n: any): void {
    if (!n.is_read) {
      // the unread count drops at once, in the service; the row when the server agrees
      this.notif.markRead(n.id).subscribe({
        next: () => {
          n.is_read = true;
          n.read_at = new Date().toISOString();
          this.cdr.markForCheck();
        },
        error: () => {}
      });
    }
    // A notification's link is server-supplied application-relative data
    // (e.g. "/maintenance?ticket=42"), so Router.navigateByUrl is the right
    // tool — never a raw location.href, which would treat it as a full URL.
    if (n.link) this.router.navigateByUrl(n.link);
  }

  markAllRead(): void {
    this.notif.markAllRead().subscribe({
      next: () => {
        this.notifications.forEach(n => { n.is_read = true; n.read_at = new Date().toISOString(); });
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  dotClass(type: string): string {
    switch (type) {
      case 'ALARM':   return 'is-alarm';
      case 'WARNING': return 'is-warning';
      default:        return 'is-info';
    }
  }
}
