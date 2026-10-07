import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

const api = environment.apiUrl;
let http: HttpClient, requests: HttpTestingController, auth: AuthService;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'old-token');
  localStorage.setItem('refreshToken', 'old-refresh');
  localStorage.setItem('user', JSON.stringify({ id: 1, company_id: 1 }));
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(withInterceptors([AuthInterceptor])), provideHttpClientTesting(),
    { provide: Router, useValue: { navigate: vi.fn() } }
  ] });
  http = TestBed.inject(HttpClient);
  requests = TestBed.inject(HttpTestingController);
  auth = TestBed.inject(AuthService);
  vi.spyOn(auth, 'scheduleRefresh').mockImplementation(() => {});
});
afterEach(() => { requests.verify(); localStorage.clear(); });

function rejectedPair() {
  const failures: any[] = [];
  http.get(`${api}/dashboard`).subscribe({ error: error => failures.push(error) });
  http.get(`${api}/machines`).subscribe({ error: error => failures.push(error) });
  requests.expectOne(`${api}/dashboard`).flush({}, { status: 401, statusText: 'Expired' });
  requests.expectOne(`${api}/machines`).flush({}, { status: 401, statusText: 'Expired' });
  return failures;
}

test('concurrent 401s share refresh and all settle on an outage without signing out', () => {
  const failures = rejectedPair();
  const logout = vi.spyOn(auth, 'logout');
  requests.expectOne(`${api}/auth/refresh`).flush({}, { status: 503, statusText: 'Unavailable' });
  expect(failures).toHaveLength(2);
  expect(logout).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBe('old-token');
  // Failure releases the shared request so a subsequent call can recover.
  const recovered: any[] = [];
  http.get(`${api}/dashboard`).subscribe(value => recovered.push(value));
  requests.expectOne(`${api}/dashboard`).flush({}, { status: 401, statusText: 'Expired' });
  requests.expectOne(`${api}/auth/refresh`).flush({ accessToken: 'fresh-token' });
  const retry = requests.expectOne(`${api}/dashboard`);
  expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-token');
  retry.flush({ machines: [] });
  expect(recovered).toHaveLength(1);
});

test('revoked refresh credentials settle all waiters and clear the session', () => {
  const failures = rejectedPair();
  requests.expectOne(`${api}/auth/refresh`).flush({}, { status: 401, statusText: 'Revoked' });
  requests.expectOne(`${api}/auth/logout`).flush({});
  expect(failures).toHaveLength(2);
  expect(localStorage.getItem('token')).toBeNull();
});

test('a late refresh cannot overwrite or log out a newly signed-in company', () => {
  const failures: any[] = [];
  http.get(`${api}/dashboard`).subscribe({ error: error => failures.push(error) });
  requests.expectOne(`${api}/dashboard`).flush({}, { status: 401, statusText: 'Expired' });
  const oldRefresh = requests.expectOne(`${api}/auth/refresh`);
  auth.login({}).subscribe();
  requests.expectOne(`${api}/auth/login`).flush({ accessToken: 'new-company-token', refreshToken: 'new-refresh', user: { id: 2, company_id: 2 } });
  oldRefresh.flush({ accessToken: 'old-company-refreshed-token' });
  expect(failures[0]?.code).toBe('SESSION_CHANGED');
  expect(localStorage.getItem('token')).toBe('new-company-token');
  expect(auth.getUser().company_id).toBe(2);
});

test('an old data response is rejected after the account changes', () => {
  const results: any[] = [], failures: any[] = [];
  http.get(`${api}/dashboard`).subscribe({ next: value => results.push(value), error: error => failures.push(error) });
  const pending = requests.expectOne(`${api}/dashboard`);
  auth.login({}).subscribe();
  requests.expectOne(`${api}/auth/login`).flush({ accessToken: 'new-token', refreshToken: 'new-refresh', user: { id: 2 } });
  pending.flush({ machines: ['old company'] });
  expect(results).toEqual([]);
  expect(failures[0]?.code).toBe('SESSION_CHANGED');
});

test('requests outside the API do not carry a company token', () => {
  http.get('https://example.invalid/asset').subscribe();
  const request = requests.expectOne('https://example.invalid/asset');
  expect(request.request.headers.has('Authorization')).toBe(false);
  request.flush({});
});
