/**
 * The unread count: asked for once, then kept by the live connection; polled
 * every 30 s (one timer, never while hidden) only while there is no live
 * connection; changed at once by reading; never two requests at a time; and
 * the same for any number of badges and re-renders.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { NotificationBellComponent } from '../../shared/notification-bell/notification-bell.component';
import { NotificationsComponent } from '../../pages/notifications/notifications.component';

/* A socket that connects at once (or never), and lets a test fire what the server would send. */
import { fakeSockets as sockets, fakeSocketIo } from '../../../testing/fake-socket-io';
vi.mock('socket.io-client', () => import('../../../testing/fake-socket-io'));
const never = () => { fakeSocketIo.autoConnect = false; };

const UNREAD = (r: any) => r.url.endsWith('/notifications/unread-count');
const LIST = (r: any) => r.url.endsWith('/notifications');
let hidden = false;
let auth: AuthService;
let http: HttpTestingController;

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

function login(id = 11, roles = ['COMPANY_ADMIN']) {
  auth.login({ email: 'x', password: 'y' }).subscribe();
  http.expectOne(r => r.url.endsWith('/auth/login')).flush({
    accessToken: `token-${id}`, refreshToken: `refresh-${id}`, user: { id, company_id: 1, roles, permissions: [] }
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sockets.length = 0;
  fakeSocketIo.autoConnect = true;
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [provideRouter([])]
  });
  auth = TestBed.inject(AuthService);
  http = TestBed.inject(HttpTestingController);
  vi.spyOn(auth, 'scheduleRefresh').mockImplementation(() => {});
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  localStorage.clear();
  delete (document as any).hidden;
});

describe('with the live connection', () => {
  test('asked for once at sign-in; after that every change comes over the connection, not by asking', async () => {
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ success: true, count: 4 });
    expect(notes.unreadCount$.value).toBe(4);

    sockets[0].fire('unreadCount', { count: 9 });
    expect(notes.unreadCount$.value).toBe(9);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    http.expectNone(UNREAD);
  });

  test('when it drops: one 30 s timer meanwhile, and asked once when it is back', async () => {
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 1 });

    sockets[0].fire('disconnect');
    sockets[0].fire('disconnect');                      // told twice: still one timer
    await vi.advanceTimersByTimeAsync(30_000);
    http.expectOne(UNREAD).flush({ count: 2 });
    await vi.advanceTimersByTimeAsync(30_000);
    http.expectOne(UNREAD).flush({ count: 3 });
    expect(notes.unreadCount$.value).toBe(3);

    sockets[0].fire('connect');                         // back: ask once for what was missed
    http.expectOne(UNREAD).flush({ count: 5 });
    expect(notes.unreadCount$.value).toBe(5);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    http.expectNone(UNREAD);
  });
});

describe('without a live connection', () => {
  test('every 30 s while shown; nothing while hidden; once as soon as it is shown again', async () => {
    never();
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 1 });

    await vi.advanceTimersByTimeAsync(15_000);          // the connection attempt gives up
    http.expectNone(UNREAD);
    await vi.advanceTimersByTimeAsync(30_000);
    http.expectOne(UNREAD).flush({ count: 2 });

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    http.expectNone(UNREAD);

    setHidden(false);
    http.expectOne(UNREAD).flush({ count: 7 });
    expect(notes.unreadCount$.value).toBe(7);
    await vi.advanceTimersByTimeAsync(30_000);
    http.expectOne(UNREAD).flush({ count: 7 });
  });

  test('a failed request is skipped; the next tick asks again', async () => {
    never();
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush('down', { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(45_000);
    http.expectOne(UNREAD).flush({ count: 5 });
    expect(notes.unreadCount$.value).toBe(5);
  });
});

describe('never more requests than needed', () => {
  test('never two at a time: a request on its way is not sent again', async () => {
    never();
    TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(15_000);
    // the first is still unanswered: the 30 s tick and a return to the tab do not add a second
    await vi.advanceTimersByTimeAsync(30_000);
    setHidden(true); setHidden(false);
    expect(http.match(UNREAD)).toHaveLength(1);
  });

  test('any number of badges, re-rendered any number of times, ask for the count once', async () => {
    @Component({ standalone: true, imports: [NotificationBellComponent],
                 template: '<app-notification-bell></app-notification-bell><app-notification-bell></app-notification-bell>' })
    class TwoBells {}

    login();
    const fixtures = [TestBed.createComponent(TwoBells), TestBed.createComponent(TwoBells)];
    for (let i = 0; i < 20; i++) fixtures.forEach(f => f.detectChanges());
    await vi.advanceTimersByTimeAsync(0);

    expect(http.match(UNREAD)).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].listeners('unreadCount')).toBe(1);
  });

  test('signing out and in again keeps one listener and asks once per session', async () => {
    const notes = TestBed.inject(NotificationService);
    login(11);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 3 });

    auth.logout();
    http.match(r => r.url.endsWith('/logout')).forEach(r => r.flush({}));
    expect(notes.unreadCount$.value).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    http.expectNone(UNREAD);

    login(22);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 1 });
    const seen: number[] = [];
    notes.unreadCount$.subscribe(n => seen.push(n));
    sockets[1].fire('unreadCount', { count: 6 });
    expect(seen).toEqual([1, 6]);                       // delivered once, not once per session
  });

  test('S&T gets no notifications, so nothing is asked and no connection opened for them', async () => {
    TestBed.inject(NotificationService);
    login(1, ['SNT_SUPER']);
    await vi.advanceTimersByTimeAsync(60_000);
    http.expectNone(UNREAD);
    expect(sockets).toHaveLength(0);
  });
});

describe('reading changes the count at once', () => {
  async function signedInWith(count: number) {
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count });
    return notes;
  }

  test('reading one: down by one before the server answers', async () => {
    const notes = await signedInWith(5);
    notes.markRead(42).subscribe();
    expect(notes.unreadCount$.value).toBe(4);
    http.expectOne(r => r.method === 'PATCH' && r.url.endsWith('/notifications/42/read')).flush({ success: true });
    http.expectNone(UNREAD);
  });

  test('marking all read: 0 before the server answers', async () => {
    const notes = await signedInWith(5);
    notes.markAllRead().subscribe();
    expect(notes.unreadCount$.value).toBe(0);
    http.expectOne(r => r.method === 'POST' && r.url.endsWith('/notifications/mark-all-read')).flush({ success: true });
  });

  test('if the server refuses, the count is asked for again and corrected', async () => {
    const notes = await signedInWith(5);
    notes.markRead(42).subscribe({ error: () => {} });
    expect(notes.unreadCount$.value).toBe(4);
    http.expectOne(r => r.method === 'PATCH').flush('nope', { status: 500, statusText: 'Error' });
    http.expectOne(UNREAD).flush({ count: 5 });
    expect(notes.unreadCount$.value).toBe(5);
  });

  test('an answer to a request sent before marking all read does not bring the old count back', async () => {
    never();
    const notes = TestBed.inject(NotificationService);
    login();
    await vi.advanceTimersByTimeAsync(0);
    const early = http.expectOne(UNREAD);
    notes.markAllRead().subscribe();
    http.expectOne(r => r.url.endsWith('/mark-all-read')).flush({ success: true });
    early.flush({ count: 7 });
    expect(notes.unreadCount$.value).toBe(0);
  });
});

describe('a new sustained alarm reaches visible inboxes over the shared connection', () => {
  const alarm = { id: 41, type: 'ALARM', title: 'CNC-01 sustained alarm', message: 'Door open for 30 seconds',
    is_read: false, created_at: '2026-10-15T10:00:00Z', link: '/alarms' };
  const response = (data: any[], unread_count: number) => ({ data, unread_count,
    pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 } });

  test('the full inbox coalesces a burst into one bounded refresh and renders the alarm', async () => {
    login();
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 0 });
    http.expectOne(LIST).flush(response([], 0));
    sockets[0].fire('unreadCount', { count: 1 });
    sockets[0].fire('unreadCount', { count: 2 });
    await vi.advanceTimersByTimeAsync(249);
    http.expectNone(LIST);
    await vi.advanceTimersByTimeAsync(1);
    http.expectOne(LIST).flush(response([alarm], 2));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('CNC-01 sustained alarm');
    await vi.advanceTimersByTimeAsync(1000);
    http.expectNone(LIST);
  });

  test('a hidden inbox waits until visible, and a destroyed inbox stops listening', async () => {
    login();
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 0 });
    http.expectOne(LIST).flush(response([], 0));
    setHidden(true);
    sockets[0].fire('unreadCount', { count: 1 });
    await vi.advanceTimersByTimeAsync(250);
    http.expectNone(LIST);
    setHidden(false);
    http.expectOne(LIST).flush(response([alarm], 1));
    fixture.destroy();
    sockets[0].fire('unreadCount', { count: 2 });
    await vi.advanceTimersByTimeAsync(250);
    http.expectNone(LIST);
  });

  test('the closed bell does not preload a list; an open bell refreshes once for a burst', async () => {
    login();
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(UNREAD).flush({ count: 0 });
    http.expectNone(LIST);
    fixture.componentInstance.togglePanel();
    http.expectOne(LIST).flush(response([], 0));
    sockets[0].fire('unreadCount', { count: 1 });
    sockets[0].fire('unreadCount', { count: 2 });
    await vi.advanceTimersByTimeAsync(250);
    http.expectOne(LIST).flush(response([alarm], 2));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('CNC-01 sustained alarm');
    fixture.componentInstance.togglePanel();
    sockets[0].fire('unreadCount', { count: 3 });
    await vi.advanceTimersByTimeAsync(250);
    http.expectNone(LIST);
  });
});
