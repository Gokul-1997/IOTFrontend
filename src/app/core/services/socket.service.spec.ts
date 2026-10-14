import { NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { SocketService } from './socket.service';

import { fakeSockets as sockets, fakeSocketIo } from '../../../testing/fake-socket-io';
vi.mock('socket.io-client', () => import('../../../testing/fake-socket-io'));

let service: SocketService;
let refresh: Subject<any>;
let auth: any;
beforeEach(() => {
  sockets.length = 0;
  fakeSocketIo.autoConnect = false;          // these tests say when the connection comes up
  refresh = new Subject();
  auth = {
    sessionVersion: 0, getUser: () => ({ id: 7 }), sessionChanged$: new Subject(),
    refreshToken: vi.fn(() => refresh), logout: vi.fn()
  };
  service = new SocketService({ run: (callback: Function) => callback() } as unknown as NgZone, auth as AuthService);
});
afterEach(() => { service.disconnect(); vi.useRealTimers(); });

async function connect() {
  const pending = service.connect();
  const socket = sockets[0]; socket.trigger('connect'); await pending; return socket;
}

test('server revocation refreshes once, then reconnects using the current token', async () => {
  const socket = await connect();
  socket.trigger('disconnect', 'io server disconnect');
  socket.trigger('connect_error', Object.assign(new Error('TOKEN_EXPIRED'), { data: { code: 'AUTH_REVISION_CHANGED' } }));
  expect(auth.refreshToken).toHaveBeenCalledOnce();
  refresh.next({ accessToken: 'current-token' }); refresh.complete();
  expect(socket.auth).toEqual({ token: 'current-token' });
  expect(socket.connect).toHaveBeenCalledTimes(2);
});

test('logout during a revocation refresh cannot reconnect the previous socket', async () => {
  const socket = await connect();
  socket.trigger('disconnect', 'io server disconnect');
  auth.sessionVersion++; auth.sessionChanged$.next('signed-out');
  refresh.next({ accessToken: 'old-token' }); refresh.complete();
  expect(socket.connect).toHaveBeenCalledTimes(1);
  expect(auth.logout).not.toHaveBeenCalled();
});

test('intentional disconnect does not refresh or reconnect', async () => {
  const socket = await connect(); service.disconnect();
  expect(auth.refreshToken).not.toHaveBeenCalled();
  expect(socket.connect).toHaveBeenCalledTimes(1);
});

test('a network outage during server revocation retries and sign-out cancels the retry', async () => {
  vi.useFakeTimers();
  const socket = await connect();
  socket.trigger('disconnect', 'io server disconnect');
  refresh.error({ status: 0 });
  expect(auth.logout).not.toHaveBeenCalled();
  refresh = new Subject();
  await vi.advanceTimersByTimeAsync(2000);
  expect(auth.refreshToken).toHaveBeenCalledTimes(2);
  refresh.error({ status: 0 });
  service.disconnect();
  await vi.advanceTimersByTimeAsync(4000);
  expect(auth.refreshToken).toHaveBeenCalledTimes(2);
});
