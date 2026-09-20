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
  templateUrl: './notifications.component.html'
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
      this.notif.markRead(n.id).subscribe({
        next: () => {
          n.is_read = true;
          n.read_at = new Date().toISOString();
          const count = this.notif.unreadCount$.value;
          if (count > 0) this.notif.unreadCount$.next(count - 1);
          this.cdr.markForCheck();
        }
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
        this.notif.unreadCount$.next(0);
        this.cdr.markForCheck();
      }
    });
  }

  dotClass(type: string): string {
    switch (type) {
      case 'ALARM':   return 'bg-red-500';
      case 'WARNING': return 'bg-amber-500';
      default:        return 'bg-blue-500';
    }
  }
}
