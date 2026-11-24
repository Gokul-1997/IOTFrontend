import { of } from 'rxjs';
import { DowntimeComponent } from './downtime.component';

test('machine events refresh while the page is visible and stop refreshing after leaving', () => {
  vi.useFakeTimers();
  const service = { getReasons: vi.fn(() => of({ data: [] })),
    getEvents: vi.fn(() => of({ data: [{ reason_name: 'TEA', source: 'controller', duration_seconds: 10 }], pagination: {} })) };
  const c = new DowntimeComponent(service as any, {} as any, {} as any, { markForCheck() {} } as any);
  c.ngOnInit();
  expect(c.events[0].reason_name).toBe('TEA');
  expect(service.getEvents).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(15000);
  expect(service.getEvents).toHaveBeenCalledTimes(2);
  expect(c.eventDuration(10)).toBe('10 sec');
  expect(c.eventDuration(80)).toBe('1 min 20 sec');
  c.ngOnDestroy();
  vi.advanceTimersByTime(15000);
  expect(service.getEvents).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
