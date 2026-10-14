import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { Quality } from './quality';
const cdr = { detectChanges: vi.fn() };
const auth = { hasAction: () => true };
it('keeps unavailable OEE values as gaps and displays unknown separately from measured zero', () => {
  const page = new Quality({} as any, cdr as any, auth as any);
  page.updateChart([{ hour: '2026-10-13T02:30:00Z', oee: null, quality: null, performance: null, availability: 0 }]);
  expect(page.hourPerformOptions.series[0].data).toEqual([null]);
  expect(page.hourPerformOptions.series[1].data).toEqual([0]);
  expect(page.percent(null)).toBe('—');
  expect(page.percent(0)).toBe('0%');
});
it('switching line cancels the old machine-list response before it can select the wrong machine', () => {
  const first = new Subject<any>(), second = new Subject<any>();
  const service = { getMachinesByLine: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    getDashboard: vi.fn().mockReturnValue(of({ success: true, data: { production: {}, hourly: [] } })) };
  const page = new Quality(service as any, cdr as any, auth as any);
  page.selectedShift = 1; page.selectedDate = '2026-10-13';
  page.selectedLine = 1; page.onLineChange();
  page.selectedLine = 2; page.onLineChange();
  first.next({ data: [{ id: 10 }] });
  expect(page.selectedMachine).toBe(0);
  second.next({ data: [{ id: 20 }] });
  expect(page.selectedMachine).toBe(20);
  expect(service.getDashboard).toHaveBeenCalledTimes(1);
  expect(service.getDashboard).toHaveBeenCalledWith({ machine_id: 20, shift_id: 1, date: '2026-10-13' });
  page.ngOnDestroy();
});
