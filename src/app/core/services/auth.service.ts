import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { jwtDecode } from 'jwt-decode';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private api = environment.apiUrl + '/auth';
  private refreshTimer: any;
  private setSession(res: any): void {
    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('user', JSON.stringify(res.user));

    this.scheduleRefresh(res.accessToken);  // start auto refresh
  }
  constructor(private http: HttpClient, private router: Router) { }

  login(data: any) {
    return this.http.post<any>(`${this.api}/login`, data).pipe(
      tap(res => {
        this.setSession(res);   
      })
    );
  }

  refreshToken() {
    const refreshToken = localStorage.getItem('refreshToken');

    return this.http.post<any>(`${this.api}/refresh`, {
      refreshToken
    }).pipe(
      tap(res => {
        localStorage.setItem('token', res.accessToken);
        this.scheduleRefresh(res.accessToken);   
      })
    );
  }

  logout(): void {
    clearTimeout(this.refreshTimer);
    // FIX: was only clearing localStorage — refresh token remained valid on server for 7 days
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      // Fire-and-forget: revoke server-side session
      this.http.post(`${this.api}/logout`, { refreshToken }).subscribe({ error: () => {} });
    }
    localStorage.clear();
    this.router.navigate(['/login']);
  }


  scheduleRefresh(token: string): void {
    clearTimeout(this.refreshTimer);

    try {
      const decoded: any = jwtDecode(token);
      const expiry = decoded.exp * 1000;
      const now = Date.now();
      const refreshTime = expiry - now - 60_000;

      if (refreshTime <= 0) return;

      this.refreshTimer = setTimeout(() => {
        this.refreshToken().subscribe();
      }, refreshTime);

    } catch {
      this.logout();
    }
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  /** Returns the first route the user has permission for, or /no-access if none. */
  getFirstAccessibleRoute(): string {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user.roles?.includes('ADMIN')) return '/dashboard';

      const permissions: string[] = user.permissions || [];
      const pageRoutes = [
        { permission: 'page:dashboard',      path: '/dashboard' },
        { permission: 'page:oee-reports',    path: '/oee-reports' },
        { permission: 'page:reports',        path: '/reports' },
        { permission: 'page:charts',         path: '/charts' },
        { permission: 'page:quality',        path: '/quality' },
        { permission: 'page:machines',       path: '/machines' },
        { permission: 'page:component',      path: '/component' },
        { permission: 'page:job',            path: '/job' },
        { permission: 'page:shifts',         path: '/shifts' },
        { permission: 'page:operators',      path: '/operators' },
        { permission: 'page:assignments',    path: '/assignments' },
        { permission: 'page:machine-shifts', path: '/machine-shifts' },
        { permission: 'page:plants',         path: '/plants' },
      ];

      const first = pageRoutes.find(r => permissions.includes(r.permission));
      return first ? first.path : '/no-access';
    } catch {
      return '/no-access';
    }
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.api}/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post(`${this.api}/reset-password`, { token, password });
  }
}
