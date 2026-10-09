import { DestroyRef, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subscription, defer, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SocketService } from './socket.service';

/** Asking the server, only while the live connection is down: once every 30 s. */
const POLL_MS = 30_000;
/** Back in a tab after this long without hearing the count, it is asked for once. */
const STALE_MS = 5 * 60_000;

/*
 * The unread count every badge shows: one copy for the whole app.
 *
 * It used to be asked for every 30 s by every open tab, hidden ones too —
 * across a plant's open tabs that is a request a second or more, for a
 * number that changes a few times a day. Now, while someone who gets
 * notifications is signed in (S&T gets none):
 *
 *   - it is asked for once, at sign-in or when the app opens;
 *   - after that the live connection (the Socket.IO one the live dashboards
 *     use) brings each change: notifications created for this person, or
 *     read in another tab or on the phone (event `unreadCount`);
 *   - when the connection drops and comes back, it is asked for once, in
 *     case something changed in between;
 *   - only while there is no live connection is it asked for every 30 s —
 *     one timer for the whole app, stopped while the tab is hidden and run
 *     once more as soon as the tab is shown;
 *   - reading one, or marking all read, changes it at once, before the
 *     server has answered;
 *   - never two requests at a time, and an answer to a request sent before a
 *     local change cannot undo that change.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = environment.apiUrl + '/notifications';
  readonly unreadCount$ = new BehaviorSubject<number>(0);

  /** Signed in as someone who gets notifications; this session's number. */
  private active = false;
  private session = 0;
  /** The live connection is up and bringing the count. */
  private live = false;
  /** It dropped since it last came up: ask once when it is back. */
  private dropped = false;
  /** No live connection: ask every 30 s (while the tab is shown). */
  private polling = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Subscription | null = null;
  /** Local changes (read, all read): an answer to a request sent before one is out of date. */
  private changes = 0;
  /** When the count was last known to be current. */
  private heardAt = 0;

  constructor(private http: HttpClient, private auth: AuthService, private socket: SocketService, destroyRef: DestroyRef) {
    const subscriptions = [
      // a new session starts at 0 rather than showing the previous person's count
      auth.sessionChanged$.subscribe(e => { this.stop(); if (e === 'signed-in') this.start(); }),
      socket.connected$.subscribe(() => this.onConnected()),
      socket.disconnected$.subscribe(() => this.onDropped())
    ];
    const stopListening = socket.onUnreadCount(count => { if (this.active) this.apply(count); });
    const onVisibility = () => this.onVisibility();
    document.addEventListener('visibilitychange', onVisibility);

    destroyRef.onDestroy(() => {
      subscriptions.forEach(s => s.unsubscribe());
      stopListening();
      document.removeEventListener('visibilitychange', onVisibility);
      this.stop();
    });

    this.start();
  }

  getNotifications(params: any = {}) {
    return this.http.get<any>(this.api, { params });
  }

  /** Mark one read (callers ask only for unread ones): the count drops at once. */
  markRead(id: number) {
    return defer(() => {
      this.changes++;
      this.apply(Math.max(0, this.unreadCount$.value - 1));
      return this.http.patch(`${this.api}/${id}/read`, {}).pipe(
        catchError(err => { this.refresh(true); return throwError(() => err); })
      );
    });
  }

  /** Mark all read: the count is 0 at once. */
  markAllRead() {
    return defer(() => {
      this.changes++;
      this.apply(0);
      return this.http.post(`${this.api}/mark-all-read`, {}).pipe(
        catchError(err => { this.refresh(true); return throwError(() => err); })
      );
    });
  }

  getPreferences() {
    return this.http.get<any>(`${this.api}/preferences`);
  }

  updatePreferences(patch: Record<string, boolean>) {
    return this.http.put<any>(`${this.api}/preferences`, patch);
  }

  /* ── keeping the count ── */

  private start(): void {
    if (this.active || !this.auth.isLoggedIn() || this.auth.isSntSuper()) return;
    this.active = true;
    const session = ++this.session;
    this.refresh();
    this.socket.connect().then(
      // up already (a live page opened it) or just now: the count comes from it
      () => { if (session === this.session && this.active) { this.live = true; this.stopPolling(); } },
      // no live connection for now: ask every 30 s until there is one
      () => { if (session === this.session && this.active && !this.live) this.startPolling(); }
    );
  }

  private stop(): void {
    this.active = false;
    this.live = false;
    this.dropped = false;
    this.stopPolling();
    this.inFlight?.unsubscribe();
    this.inFlight = null;
    this.changes++;                 // anything still on its way belongs to the session that ended
    this.apply(0);
  }

  private onConnected(): void {
    if (!this.active) return;
    const missed = this.dropped || this.polling;
    this.live = true;
    this.dropped = false;
    this.stopPolling();
    if (missed) this.refresh();     // something may have changed while it was down
  }

  private onDropped(): void {
    if (!this.active) return;
    this.live = false;
    this.dropped = true;
    this.startPolling();
  }

  private onVisibility(): void {
    if (!this.active) return;
    if (document.hidden) { this.stopTimer(); return; }       // a hidden tab asks nothing
    if (this.polling) { this.refresh(); this.startTimer(); }
    else if (Date.now() - this.heardAt > STALE_MS) this.refresh();
  }

  private startPolling(): void {
    this.polling = true;
    this.startTimer();
  }

  private stopPolling(): void {
    this.polling = false;
    this.stopTimer();
  }

  /** The one timer, only while polling and the tab is shown. */
  private startTimer(): void {
    if (this.timer || !this.polling || document.hidden) return;
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ask the server once. Not while a request is already on its way — unless
   * `force` (a failed mark-read must be corrected even then). A failed request
   * is skipped, as before: the sign-in handling is the interceptor's, and the
   * next event, reconnect or tick corrects the count.
   */
  private refresh(force = false): void {
    if (!this.active) return;
    if (this.inFlight && !this.inFlight.closed) {
      if (!force) return;
      this.inFlight.unsubscribe();
    }
    const changes = this.changes;
    this.inFlight = this.http.get<any>(`${this.api}/unread-count`).subscribe({
      next: res => { if (changes === this.changes) this.apply(Number(res?.count) || 0); },
      error: () => {}
    });
  }

  private apply(count: number): void {
    this.heardAt = Date.now();
    if (count !== this.unreadCount$.value) this.unreadCount$.next(count);
  }
}
