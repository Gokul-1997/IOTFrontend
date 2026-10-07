import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, tap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  // Credentials belong only to our API. AuthService guards login/refresh results.
  if (!req.url.startsWith(environment.apiUrl + '/') || /\/auth\/(refresh|login|logout|forgot-password|reset-password)(?:[?\/]|$)/.test(req.url)) {
    return next(req);
  }
  const version = auth.sessionVersion;
  const token = localStorage.getItem('token');
  if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  const current = () => auth.assertSession(version);

  return next(req).pipe(
    tap(current),
    catchError(error => {
      current();
      if (error.status !== 401) return throwError(() => error);
      // The service shares this request with sockets, timers and other 401s.
      // Every waiter receives the failure too; none can hang waiting for a token.
      return auth.refreshToken().pipe(
        switchMap(res => {
          current();
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${res.accessToken}` } })).pipe(tap(current));
        }),
        catchError(refreshError => {
          current();
          if (refreshError.status === 401 || refreshError.status === 403) {
            const disabled = refreshError.error?.code === 'COMPANY_DISABLED';
            auth.logout(disabled ? refreshError.error.message : undefined);
          }
          return throwError(() => refreshError);
        })
      );
    })
  );
};
