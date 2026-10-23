import { ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { notificationTarget } from '../linked-record';
import { Subscription, auditTime, pairwise } from 'rxjs';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="relative" (keydown.escape)="open && close(true)">
      <ng-container *ngIf="{ n: (notifService.unreadCount$ | async) || 0 } as unread">
        <button #bellBtn type="button" (click)="togglePanel()" class="hdr-icon-btn relative"
                [attr.aria-expanded]="open" aria-controls="notif-panel"
                [attr.aria-label]="unread.n ? 'Notifications, ' + unread.n + ' unread' : 'Notifications'">
          <span class="material-icons" aria-hidden="true">{{ unread.n ? 'notifications_active' : 'notifications_none' }}</span>
          <span *ngIf="unread.n" aria-hidden="true"
            class="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold text-white bg-red-600 rounded-full">
            {{ unread.n > 99 ? '99+' : unread.n }}
          </span>
        </button>
      </ng-container>

      <!-- a sheet across the top on a phone, a dropdown from the bell on wider screens -->
      <div *ngIf="open" id="notif-panel" role="region" aria-label="Notifications"
        class="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-80
               bg-white dark:bg-[#031735] rounded-xl shadow-2xl border border-gray-100 dark:border-[#012252] z-50">
        <div class="flex items-center justify-between gap-2 p-4 border-b border-gray-100 dark:border-[#22405e]">
          <h3 class="font-semibold text-gray-800 dark:text-white">Notifications</h3>
          <button type="button" (click)="markAllRead()" class="ui-btn ui-btn-ghost ui-btn-sm">
          <span class="ui-tab-icon material-icons" aria-hidden="true">done_all</span>
          Mark all read</button>
        </div>
        <div class="max-h-80 overflow-y-auto divide-y border-gray-100 dark:divide-[#22405e] ">
          <ng-container *ngIf="notifications.length > 0; else noNotifs">
            <!-- each one is a button: Enter or a tap marks it read and opens what it is about -->
           <button
  type="button"
  *ngFor="let n of notifications"
  class="w-full text-left flex items-start gap-3 p-3 transition-colors
         hover:bg-[#e1e7ed] dark:hover:bg-[#092b5c]"
  [ngClass]="{
    'bg-blue-50 dark:bg-[#102f55]': !n.is_read,
    'bg-white dark:bg-[#071d38]': n.is_read
  }"
  (click)="onRead(n)"
>
              <span class="material-icons text-[20px] flex-shrink-0 mt-0.5" aria-hidden="true"
                [ngClass]="n.type === 'ALARM' ? 'text-red-600' : n.type === 'WARNING' ? 'text-amber-700' : 'text-blue-700'">
                {{ n.type === 'ALARM' ? 'error' : n.type === 'WARNING' ? 'warning_amber' : 'info' }}
              </span>
              <span class="flex-1 min-w-0">
                <span class="sr-only">{{ n.type === 'ALARM' ? 'Alarm' : n.type === 'WARNING' ? 'Warning' : 'Information' }}{{ n.is_read ? '' : ', unread' }}: </span>
                <span class="block text-sm font-medium text-gray-800 dark:text-white truncate">{{ n.title }}</span>
                <span class="block text-xs text-gray-600 dark:text-gray-500 mt-0.5">{{ n.message }}</span>
                <span class="block text-xs text-gray-600 dark:text-gray-500 mt-1">{{ n.created_at | date:'d MMM, h:mm a' }}</span>
              </span>
              <span *ngIf="!n.is_read" class="w-2 h-2 mt-2 rounded-full bg-blue-600 flex-shrink-0" aria-hidden="true"></span>
            </button>
          </ng-container>
          <ng-template #noNotifs>
            <div class="p-6 text-center text-gray-600 text-sm">
              <span class="material-icons block text-[28px] text-gray-400 mb-1" aria-hidden="true">notifications_none</span>
              No notifications yet.
            </div>
          </ng-template>
        </div>
        <div class="p-3 border-t border-gray-100 dark:border-[#22405e] text-center">
          <a routerLink="/notifications" class="text-sm font-medium text-blue-700 hover:underline" (click)="open=false">View all notifications</a>
        </div>
      </div>
    </div>
  `
})
export class NotificationBellComponent implements OnInit {
  open = false;
  notifications: any[] = [];
  private listRequest?: Subscription;

  @ViewChild('bellBtn') bellBtn?: ElementRef<HTMLButtonElement>;

  constructor(public notifService: NotificationService, private host: ElementRef<HTMLElement>,
              private cdr: ChangeDetectorRef, private destroyRef: DestroyRef, private router: Router) {
    this.destroyRef.onDestroy(() => this.listRequest?.unsubscribe());
  }

  /** A click anywhere else closes the panel. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(ev.target as Node)) this.open = false;
  }

  close(returnFocus: boolean): void {
    this.open = false;
    if (returnFocus) this.bellBtn?.nativeElement.focus();
  }

  ngOnInit() {
    this.notifService.unreadCount$.pipe(pairwise(), auditTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.open && !document.hidden) this.load();
    });
  }

  load() {
    this.listRequest?.unsubscribe();
    this.listRequest = this.notifService.getNotifications({ limit: 10 }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.notifications = res.data || [];
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  togglePanel() {
    this.open = !this.open;
    if (this.open) this.load();
  }

  /* The count on the badge changes at once in the service (and, from the
     server, on every other tab and device of this person).

     It then opens what the notification is about, on that very record — the
     alarm, the program file — marked on its page, as the Notifications page
     does. The bell only marked it read, so a click went nowhere (22 Oct
     2026). The link is an app path (navigateByUrl, never location.href). */
  onRead(n: any) {
    if (!n.is_read) {
      this.notifService.markRead(n.id).subscribe({ error: () => {} });
      n.is_read = true;
    }
    const target = notificationTarget(n);
    if (target) {
      this.open = false;
      this.router.navigateByUrl(target);
    }
  }

  markAllRead() {
    this.notifService.markAllRead().subscribe({
      next: () => {
        this.notifications.forEach(n => n.is_read = true);
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }
}
