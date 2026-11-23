import { LiveComponent } from './live.component';

const now = Date.parse('2026-11-24T04:00:00Z');
function make() {
  const socket = { setMachineScope: vi.fn(), clearMachineScope: vi.fn() };
  const c = new LiveComponent({} as any, {} as any, socket as any,
    { run: (fn: () => void) => fn() } as any, { markForCheck: vi.fn() } as any, {} as any);
  (c as any).showMachine(19);
  return c;
}
const event = (value: unknown, extra: any = {}) => ({ machine_id: 19, machine_status: 'IDLE',
  received_at: now / 1000, controller_downtime_observed_at: now / 1000, controller_downtime_value: value, ...extra });
const api = (value: unknown, extra: any = {}) => ({ data: { machine: { id: 19 },
  live: { machine_status: 'IDLE', controller_downtime_value: value,
    controller_downtime_observed_at: now / 1000, ...extra } } });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

test('VMC19 displays its raw signal independently from its explicit alarm description', () => {
  const c = make();
  (c as any).applyApiData(api(4, { alarm: true, active_alarms: [
    { alarm_code: 'EX1071', message: 'AIR PRESSURE NOT OK' }
  ] }));
  expect(c.controllerDowntimeSignal).toBe(4);
  expect(c.activeAlarms).toEqual([{ alarm_code: 'EX1071', message: 'AIR PRESSURE NOT OK' }]);
});

test.each([0, null, undefined, NaN, Infinity, '4', {}, false])('a socket value of %j clears an earlier signal', value => {
  const c = make();
  c.handleSocket(event(4));
  expect(c.controllerDowntimeSignal).toBe(4);
  c.handleSocket(event(value));
  expect(c.controllerDowntimeSignal).toBeNull();
});

test('another machine cannot set or clear this machine signal and switching machines resets it', () => {
  const c = make();
  c.handleSocket(event(4));
  c.handleSocket(event(0, { machine_id: 20 }));
  expect(c.controllerDowntimeSignal).toBe(4);
  (c as any).showMachine(20);
  expect(c.controllerDowntimeSignal).toBeNull();
  (c as any).applyApiData(api(4));
  expect(c.controllerDowntimeSignal).toBeNull();
  c.handleSocket(event(4));
  expect(c.controllerDowntimeSignal).toBeNull();
});

test('a stale, future, missing-clock or offline signal is never presented as current', () => {
  const c = make();
  for (const extra of [
    { controller_downtime_observed_at: (now - 60_001) / 1000 }, { controller_downtime_observed_at: (now + 1000) / 1000 },
    { controller_downtime_observed_at: undefined }, { controller_downtime_observed_at: 'invalid' }, { machine_status: 'OFFLINE' }
  ]) {
    c.handleSocket(event(4, extra));
    expect(c.controllerDowntimeSignal).toBeNull();
  }
  c.handleSocket(event(4));
  expect(c.controllerDowntimeSignal).toBe(4);
  vi.advanceTimersByTime(60_001);
  expect(c.controllerDowntimeSignal).toBeNull();
});

test('the API accepts the source ISO clock, clears a missing signal and respects a newer socket snapshot', () => {
  const c = make();
  (c as any).applyApiData(api(4, { controller_downtime_observed_at: new Date(now).toISOString() }));
  expect(c.controllerDowntimeSignal).toBe(4);
  (c as any).applyApiData(api(undefined));
  expect(c.controllerDowntimeSignal).toBeNull();
  c.handleSocket(event(5));
  (c as any).applyApiData(api(4));
  expect(c.controllerDowntimeSignal).toBe(5);
});
