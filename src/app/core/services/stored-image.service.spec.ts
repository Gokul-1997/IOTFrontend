import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { StoredImageService } from './stored-image.service';
import { AuthService } from './auth.service';
import { AuthInterceptor } from '../interceptors/auth.interceptor';
import { environment } from '../../../environments/environment';

const path = '/api/files/companies/4/images/machines/80e8bcb4-c6f7-4f2e-a3aa-3d0a4f4a4cc1.jpg';
const url = environment.apiUrl + path.slice('/api'.length);
let images: StoredImageService, auth: AuthService, requests: HttpTestingController;
let created: ReturnType<typeof vi.fn>, revoked: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'company-4-token');
  localStorage.setItem('user', JSON.stringify({ id: 7, company_id: 4, auth_revision: 1, roles: ['ADMIN'] }));
  created = vi.fn().mockImplementation(() => `blob:image-${created.mock.calls.length}`);
  revoked = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: created });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoked });
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(withInterceptors([AuthInterceptor])), provideHttpClientTesting(),
    { provide: Router, useValue: { navigate: vi.fn() } }
  ] });
  auth = TestBed.inject(AuthService);
  vi.spyOn(auth, 'scheduleRefresh').mockImplementation(() => {});
  requests = TestBed.inject(HttpTestingController);
  images = TestBed.inject(StoredImageService);
});
afterEach(() => { requests.verify({ ignoreCancelled: true }); TestBed.resetTestingModule(); localStorage.clear(); vi.restoreAllMocks(); });

test('canonical paths resolve to the API origin and reject other tenants, query tokens, traversal and foreign hosts', () => {
  expect(images.protectedUrl(path)).toBe(url);
  expect(images.protectedUrl(url)).toBe(url);
  for (const value of [path.replace('/4/', '/5/'), path + '?token=secret', path + '#x', path.replace('machines/', 'machines/../'), 'https://foreign.example' + path]) {
    expect(images.protectedUrl(value)).toBeNull();
  }
  requests.expectNone(() => true);
});

test('simultaneous views share one authenticated download and one URL; releasing one does not break another', () => {
  const first = images.acquire(url), second = images.acquire(url);
  const a: (string | null)[] = [], b: (string | null)[] = [];
  first.source$.subscribe(value => a.push(value)); second.source$.subscribe(value => b.push(value));
  const request = requests.expectOne(url);
  expect(request.request.headers.get('Authorization')).toBe('Bearer company-4-token');
  request.flush(new Blob(['image'], { type: 'image/jpeg' }));
  expect(a).toEqual([null, 'blob:image-1']); expect(b).toEqual(a);
  first.release(); expect(revoked).not.toHaveBeenCalled();
  second.release();
  const cached = images.acquire(url);
  requests.expectNone(url);
  cached.release();
});

test('sign-out revokes visible images and cancels pending downloads before the next company signs in', () => {
  const lease = images.acquire(url);
  const seen: (string | null)[] = [];
  lease.source$.subscribe(value => seen.push(value));
  requests.expectOne(url).flush(new Blob(['image'], { type: 'image/jpeg' }));
  const pending = images.acquire(url.replace('cc1.jpg', 'cc2.jpg'));
  const download = requests.expectOne(url.replace('cc1.jpg', 'cc2.jpg'));
  auth.logout();
  expect(revoked).toHaveBeenCalledWith('blob:image-1');
  expect(seen.at(-1)).toBeNull();
  expect(download.cancelled).toBe(true);
  lease.release(); pending.release();
});

test('authorization revision alone immediately clears and rechecks a displayed image with refreshed credentials', () => {
  const lease = images.acquire(url), seen: (string | null)[] = [];
  lease.source$.subscribe(value => seen.push(value));
  requests.expectOne(url).flush(new Blob(['image'], { type: 'image/jpeg' }));
  auth.refreshToken().subscribe();
  requests.expectOne(environment.apiUrl + '/auth/refresh').flush({ accessToken: 'new-token', auth_revision: 2 });
  expect(revoked).toHaveBeenCalledWith('blob:image-1');
  expect(seen.at(-1)).toBeNull();
  const recheck = requests.expectOne(url);
  expect(recheck.request.headers.get('Authorization')).toBe('Bearer new-token');
  recheck.flush(new Blob(['forbidden'], { type: 'text/plain' }), { status: 403, statusText: 'Forbidden' });
  expect(seen).not.toContain('blob:image-2');
  lease.release();
});

test('a stale unused image is reauthorized instead of keeping an old permission indefinitely', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const first = images.acquire(url);
  requests.expectOne(url).flush(new Blob(['image'], { type: 'image/jpeg' }));
  first.release();
  clock.mockReturnValue(161_000);
  const second = images.acquire(url);
  expect(revoked).toHaveBeenCalledWith('blob:image-1');
  requests.expectOne(url).flush(new Blob(['denied'], { type: 'text/plain' }), { status: 403, statusText: 'Forbidden' });
  second.release();
});

test('another tab changing both grants and revision rechecks once without a duplicate invalidation', () => {
  const lease = images.acquire(url);
  requests.expectOne(url).flush(new Blob(['image'], { type: 'image/jpeg' }));
  localStorage.setItem('user', JSON.stringify({ ...auth.getUser(), permissions: ['page:machines:view'], auth_revision: 2 }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'user' }));
  requests.expectOne(url).flush(new Blob(['image'], { type: 'image/jpeg' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'user' }));
  requests.expectNone(url);
  expect(revoked).toHaveBeenCalledTimes(1);
  lease.release();
});

test('unused image cache has a byte budget, while active consumers keep their image', () => {
  const active = images.acquire(url);
  requests.expectOne(url).flush(new Blob(['active'], { type: 'image/jpeg' }));
  for (let i = 2; i <= 7; i++) {
    const other = url.replace('cc1.jpg', `cc${i}.jpg`);
    const lease = images.acquire(other);
    requests.expectOne(other).flush(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' }));
    lease.release();
  }
  expect(revoked).toHaveBeenCalledWith('blob:image-2');
  expect(revoked).not.toHaveBeenCalledWith('blob:image-1');
  active.release();
});

test('invalid blob types and oversized responses never become display URLs', () => {
  const first = images.acquire(url);
  requests.expectOne(url).flush(new Blob(['<script>bad</script>'], { type: 'text/html' }));
  first.release();
  const second = images.acquire(url);
  requests.expectOne(url).flush(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' }));
  expect(created).not.toHaveBeenCalled();
  second.release();
});
