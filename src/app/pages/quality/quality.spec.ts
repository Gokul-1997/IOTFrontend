import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
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
it('lists every machine in one list, with no line filter or line groups, and opens on the first', () => {
  const machines = [{ id: 3, machine_serial_no: 'HMC - 7 - F', line_id: 15 }, { id: 4, machine_serial_no: 'NEW MACHINE', line_id: null }];
  const service = {
    getAllMachines: vi.fn().mockReturnValue(of({ data: machines })),
    getShifts: vi.fn().mockReturnValue(of({ data: [{ id: 5, shift_name: 'Morning' }] })),
    getDashboard: vi.fn().mockReturnValue(of({ success: true, data: { production: {}, hourly: [] } }))
  };
  const page = new Quality(service as any, cdr as any, auth as any);
  page.selectedDate = '2026-10-21';
  page.loadInitialData();
  expect(page.machines).toEqual(machines);
  expect('lines' in page).toBe(false);
  expect(page.selectedMachine).toBe(3);
  expect(service.getDashboard).toHaveBeenCalledWith({ machine_id: 3, shift_id: 5, date: '2026-10-21' });
  page.ngOnDestroy();
});
