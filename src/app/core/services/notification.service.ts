import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, EMPTY, merge, timer } from 'rxjs';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = environment.apiUrl + '/notifications';
  unreadCount$ = new BehaviorSubject<number>(0);

  constructor(private http: HttpClient, auth: AuthService) {
    /* The unread count, every 30 s and at once on signing in. A failed
       request used to end the poll for good (the error reached subscribe),
       so one network blip froze the badge until a reload; it now skips that
       tick. Nothing is asked while signed out, and a new session starts at 0
       rather than showing the previous person's count. */
    auth.sessionChanged$.subscribe(() => this.unreadCount$.next(0));
    merge(timer(0, 30000), auth.sessionChanged$.pipe(filter(e => e === 'signed-in'))).pipe(
      filter(() => auth.isLoggedIn()),
      switchMap(() => this.http.get<any>(`${this.api}/unread-count`).pipe(catchError(() => EMPTY)))
    ).subscribe(res => this.unreadCount$.next(res?.count || 0));
  }

  getNotifications(params: any = {}) {
    return this.http.get<any>(this.api, { params });
  }

  markRead(id: number) {
    return this.http.patch(`${this.api}/${id}/read`, {});
  }

  markAllRead() {
    return this.http.post(`${this.api}/mark-all-read`, {}).pipe();
  }

  getPreferences() {
    return this.http.get<any>(`${this.api}/preferences`);
  }

  updatePreferences(patch: Record<string, boolean>) {
    return this.http.put<any>(`${this.api}/preferences`, patch);
  }
}
