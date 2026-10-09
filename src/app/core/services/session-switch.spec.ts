/**
 * Signing out and in again in the same tab — possibly as another company's
 * user — must not carry anything of the first session into the second:
 * not the live-data socket (it stays in the company room it was opened for),
 * not the unread count, and not this tab's pages when another tab switches
 * user.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SocketService } from './socket.service';
import { NotificationService } from './notification.service';

const sockets: any[] = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, opts: any) => {
    const handlers: Record<string, Function[]> = {};
    const s: any = {
      opts, connected: false, auth: opts.auth,
      on: vi.fn((ev: string, fn: Function) => { (handlers[ev] ||= []).push(fn); }),
      once: vi.fn((ev: string, fn: Function) => { (handlers[ev] ||= []).push(fn); }),
      off: vi.fn(), emit: vi.fn(),
      removeAllListeners: vi.fn(), disconnect: vi.fn(() => { s.connected = false; }),
      connect: vi.fn(() => { s.connected = true; (handlers['connect'] || []).forEach(f => f()); }),
    };
    sockets.push(s);
    return s;
  })
}));

const signIn = (id: number, company_id: number) => ({
  accessToken: `token-${id}`, refreshToken: `refresh-${id}`,
  user: { id, company_id, roles: ['COMPANY_ADMIN'], permissions: [] }
});

let auth: AuthService;
let http: HttpTestingController;

beforeEach(() => {
  localStorage.clear();
  sockets.length = 0;
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [{ provide: Router, useValue: { navigate: vi.fn() } }]
  });
  auth = TestBed.inject(AuthService);
  http = TestBed.inject(HttpTestingController);
  vi.spyOn(auth, 'scheduleRefresh').mockImplementation(() => {});
});

afterEach(() => localStorage.clear());

function login(id: number, company_id: number) {
  auth.login({ email: 'x', password: 'y' }).subscribe();
  http.expectOne(r => r.url.endsWith('/auth/login')).flush(signIn(id, company_id));
}

describe('sign-in and sign-out are announced', () => {
  test('signed-in after a login, signed-out after a logout', () => {
    const seen: string[] = [];
    auth.sessionChanged$.subscribe(e => seen.push(e));
    login(11, 1);
    auth.logout();
    http.match(() => true).forEach(r => r.flush({}));
    expect(seen).toEqual(['signed-in', 'signed-out']);
  });
});

describe('the live-data socket belongs to one session', () => {
  test('signing out closes it; the next user gets a socket opened with their own token', async () => {
    const socket = TestBed.inject(SocketService);
    login(11, 1);
    await socket.connect();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].opts.auth.token).toBe('token-11');

    auth.logout();
    http.match(() => true).forEach(r => r.flush({}));
    expect(sockets[0].disconnect).toHaveBeenCalled();

    login(22, 2);                          // another company's user, same tab
    await socket.connect();
    expect(sockets).toHaveLength(2);
    expect(sockets[1].opts.auth.token).toBe('token-22');
  });

  test('a socket opened for someone else is replaced even without a sign-out event', async () => {
    const socket = TestBed.inject(SocketService);
    localStorage.setItem('token', 'token-11');
    localStorage.setItem('user', JSON.stringify({ id: 11 }));
    await socket.connect();
    localStorage.setItem('token', 'token-22');
    localStorage.setItem('user', JSON.stringify({ id: 22 }));
    await socket.connect();
    expect(sockets[0].disconnect).toHaveBeenCalled();
    expect(sockets[1].opts.auth.token).toBe('token-22');
  });
});

describe('another tab switching user', () => {
  test('starts this tab over; a token refresh by the same person does not', () => {
    login(11, 1);
    const startOver = vi.spyOn(auth, 'startOver').mockImplementation(() => {});

    window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
    localStorage.setItem('user', JSON.stringify({ id: 11, permissions: ['page:x'] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'user' }));
    expect(startOver).not.toHaveBeenCalled();

    localStorage.setItem('user', JSON.stringify({ id: 22 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'user' }));
    expect(startOver).toHaveBeenCalledTimes(1);

    localStorage.clear();                  // the other tab signed out
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(startOver).toHaveBeenCalledTimes(2);
  });
});

describe('the unread count', () => {
  /* How it is kept up to date — once, then the live connection, polling only
     without one — is notification.service.spec.ts; here, only that it
     belongs to one session. */
  test('is not asked for while signed out, is asked for at sign-in, and resets with the session', async () => {
    vi.useFakeTimers();
    const notes = TestBed.inject(NotificationService);
    await vi.advanceTimersByTimeAsync(60000);             // signed out: nothing asked
    http.expectNone(r => r.url.endsWith('/unread-count'));

    login(11, 1);
    http.expectOne(r => r.url.endsWith('/unread-count')).flush({ count: 4 });
    expect(notes.unreadCount$.value).toBe(4);

    auth.logout();
    http.match(r => r.url.endsWith('/logout')).forEach(r => r.flush({}));
    expect(notes.unreadCount$.value).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    http.expectNone(r => r.url.endsWith('/unread-count'));

    login(22, 2);                                         // the next person starts from their own count
    http.expectOne(r => r.url.endsWith('/unread-count')).flush({ count: 1 });
    expect(notes.unreadCount$.value).toBe(1);
    vi.useRealTimers();
  });
});
