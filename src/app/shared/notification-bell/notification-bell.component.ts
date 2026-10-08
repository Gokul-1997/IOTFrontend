import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';

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
               bg-white rounded-xl shadow-2xl border border-gray-100 z-50">
        <div class="flex items-center justify-between gap-2 p-4 border-b">
          <h3 class="font-semibold text-gray-800">Notifications</h3>
          <button type="button" (click)="markAllRead()" class="ui-btn ui-btn-ghost ui-btn-sm">
          <span class="ui-tab-icon material-icons" aria-hidden="true">done_all</span>
          Mark all read</button>
        </div>
        <div class="max-h-80 overflow-y-auto divide-y divide-gray-50">
          <ng-container *ngIf="notifications.length > 0; else noNotifs">
            <!-- each one is a button: Enter or a tap marks it read -->
            <button type="button" *ngFor="let n of notifications"
              class="w-full text-left flex items-start gap-3 p-3 transition-colors hover:bg-gray-50"
              [class.bg-blue-50]="!n.is_read"
              (click)="onRead(n)">
              <span class="material-icons text-[20px] flex-shrink-0 mt-0.5" aria-hidden="true"
                [ngClass]="n.type === 'ALARM' ? 'text-red-600' : n.type === 'WARNING' ? 'text-amber-700' : 'text-blue-700'">
                {{ n.type === 'ALARM' ? 'error' : n.type === 'WARNING' ? 'warning_amber' : 'info' }}
              </span>
              <span class="flex-1 min-w-0">
                <span class="sr-only">{{ n.type === 'ALARM' ? 'Alarm' : n.type === 'WARNING' ? 'Warning' : 'Information' }}{{ n.is_read ? '' : ', unread' }}: </span>
                <span class="block text-sm font-medium text-gray-800 truncate">{{ n.title }}</span>
                <span class="block text-xs text-gray-600 mt-0.5">{{ n.message }}</span>
                <span class="block text-xs text-gray-600 mt-1">{{ n.created_at | date:'d MMM, h:mm a' }}</span>
              </span>
              <span *ngIf="!n.is_read" class="w-2 h-2 mt-2 rounded-full bg-blue-600 flex-shrink-0" aria-hidden="true"></span>
            </button>
          </ng-container>
          <ng-template #noNotifs>
            <div class="p-6 text-center text-gray-600 text-sm">
              <span class="material-icons block text-[28px] text-gray-400 mb-1" aria-hidden="true">notifications_none</span>
              No notifications yet. Alarms and warnings from your machines will show here.
            </div>
          </ng-template>
        </div>
        <div class="p-3 border-t text-center">
          <a routerLink="/notifications" class="text-sm font-medium text-blue-700 hover:underline" (click)="open=false">View all notifications</a>
        </div>
      </div>
    </div>
  `
})
export class NotificationBellComponent implements OnInit {
  open = false;
  notifications: any[] = [];

  @ViewChild('bellBtn') bellBtn?: ElementRef<HTMLButtonElement>;

  constructor(public notifService: NotificationService, private host: ElementRef<HTMLElement>) {}

  /** A click anywhere else closes the panel. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(ev.target as Node)) this.open = false;
  }

  close(returnFocus: boolean): void {
    this.open = false;
    if (returnFocus) this.bellBtn?.nativeElement.focus();
  }

  ngOnInit() { this.load(); }

  load() {
    this.notifService.getNotifications({ limit: 10 }).subscribe({
      next: res => this.notifications = res.data || [],
      error: () => {}
    });
  }

  togglePanel() {
    this.open = !this.open;
    if (this.open) this.load();
  }

  onRead(n: any) {
    if (!n.is_read) {
      this.notifService.markRead(n.id).subscribe();
      n.is_read = true;
      const count = this.notifService.unreadCount$.value;
      if (count > 0) this.notifService.unreadCount$.next(count - 1);
    }
  }

  markAllRead() {
    this.notifService.markAllRead().subscribe({
      next: () => { this.notifications.forEach(n => n.is_read = true); this.notifService.unreadCount$.next(0); }
    });
  }
}
