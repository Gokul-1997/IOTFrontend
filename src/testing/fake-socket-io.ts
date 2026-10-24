/*
 * One stand-in for socket.io-client, shared by every spec that mocks it.
 *
 * Three specs each defined their own with vi.mock; run together, the module
 * mock of one could serve another, whose own `sockets` list then stayed
 * empty — the suite failed now and then depending on the order the files
 * ran in. Every spec now mocks the module with this file and reads the same
 * list, so whichever registers first serves them all the same.
 *
 *   vi.mock('socket.io-client', () => import('../../../testing/fake-socket-io'));
 *   beforeEach(() => { fakeSockets.length = 0; fakeSocketIo.autoConnect = true; });
 *
 * autoConnect: socket.connect() fires 'connect' at once (true), or waits for
 * the test to trigger it (false). trigger / fire: what the server would send.
 */
// Angular can emit this helper into both a spec bundle and a dynamic mock
// chunk. Share one registry inside the test environment in either case.
const registryKey = Symbol.for('mexa.test.socket-io');
const registry = ((globalThis as any)[registryKey] ??= {
  sockets: [] as any[], config: { autoConnect: true }
});
export const fakeSockets: any[] = registry.sockets;
export const fakeSocketIo: { autoConnect: boolean } = registry.config;

export function io(_url: string, opts: any = {}): any {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  const socket: any = {
    opts,
    connected: false,
    auth: opts.auth ?? {},
    on: vi.fn((event: string, callback: (...args: any[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(callback);
      return socket;
    }),
    off: vi.fn((event: string, callback: (...args: any[]) => void) => {
      handlers.get(event)?.delete(callback);
      return socket;
    }),
    emit: vi.fn(),
    connect: vi.fn(() => {
      if (fakeSocketIo.autoConnect) socket.trigger('connect');
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      socket.trigger('disconnect', 'io client disconnect');
      return socket;
    }),
    removeAllListeners: vi.fn(() => { handlers.clear(); return socket; }),
    trigger(event: string, ...args: any[]) {
      if (event === 'connect') socket.connected = true;
      if (event === 'disconnect') socket.connected = false;
      for (const callback of [...(handlers.get(event) ?? [])]) callback(...args);
    },
    listeners: (event: string) => handlers.get(event)?.size ?? 0
  };
  socket.fire = socket.trigger;
  fakeSockets.push(socket);
  return socket;
}
