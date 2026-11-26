import { of, Subject, throwError } from 'rxjs';
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

const reason = { id: 25, company_id: 4, code: '4', name: 'TEA', category: 'PLANNED' };
function makeReasonPage(actions = ['create', 'edit', 'delete']) {
  const service = {
    getReasons: vi.fn(() => of({ data: [reason] })), getEvents: vi.fn(() => of({ data: [], pagination: {} })),
    createReason: vi.fn(() => of({ data: reason })), updateReason: vi.fn(() => of({ data: reason })), deleteReason: vi.fn(() => of({ data: reason }))
  };
  const toast = { success: vi.fn() };
  const auth = { getCompanyId: () => 4, hasAction: (_module: string, action: string) => actions.includes(action) };
  const page = new DowntimeComponent(service as any, auth as any, toast as any, { markForCheck: vi.fn() } as any);
  return { page, service, toast };
}

test('editing prefills a copy and saves code, name and category through PUT', () => {
  const { page, service } = makeReasonPage();
  page.openReasonForm(reason);
  expect(page.editingReasonId).toBe(25);
  expect(page.reasonForm).toEqual({ code: '4', name: 'TEA', category: 'PLANNED' });
  page.reasonForm.code = ' 14 '; page.reasonForm.name = ' Tea break ';
  page.saveReason();
  expect(service.updateReason).toHaveBeenCalledWith(25, { code: '14', name: 'Tea break', category: 'PLANNED' });
  expect(service.createReason).not.toHaveBeenCalled();
  expect(reason.code).toBe('4');
  expect(page.showReasonForm).toBe(false);
  expect(service.getEvents).toHaveBeenCalled();
});

test('a duplicate-code failure keeps the edit form and entered values available for correction', () => {
  const { page, service } = makeReasonPage();
  service.updateReason.mockReturnValue(throwError(() => ({ error: { message: 'Reason code 6 already exists' } })));
  page.openReasonForm(reason); page.reasonForm.code = '6'; page.saveReason();
  expect(page.showReasonForm).toBe(true);
  expect(page.reasonSaving).toBe(false);
  expect(page.reasonForm.code).toBe('6');
  expect(page.reasonError).toBe('Reason code 6 already exists');
});

test('delete waits for confirmation, allows cancel, and refreshes choices on success', () => {
  const { page, service } = makeReasonPage();
  page.confirmDeleteReason(reason);
  expect(service.deleteReason).not.toHaveBeenCalled();
  page.cancelDeleteReason();
  expect(page.deleteTarget).toBeNull();
  page.confirmDeleteReason(reason); page.deleteReason();
  expect(service.deleteReason).toHaveBeenCalledWith(25);
  expect(service.getReasons).toHaveBeenCalled();
  expect(page.deleteTarget).toBeNull();
});

test('failed deletion stays open and pending saves cannot be submitted twice or dismissed', () => {
  const { page, service } = makeReasonPage();
  service.deleteReason.mockReturnValue(throwError(() => ({ error: { message: 'Connection unavailable' } })));
  page.confirmDeleteReason(reason); page.deleteReason();
  expect(page.deleteTarget).toBe(reason);
  expect(page.deleteError).toBe('Connection unavailable');
  const pending = new Subject<any>();
  service.updateReason.mockReturnValue(pending);
  page.openReasonForm(reason); page.saveReason(); page.saveReason(); page.closeReasonForm();
  expect(service.updateReason).toHaveBeenCalledTimes(1);
  expect(page.showReasonForm).toBe(true);
  pending.complete();
});

test('shared, foreign-company and unauthorized reasons cannot be modified', () => {
  const { page, service } = makeReasonPage(['create', 'edit']);
  expect(page.canManageReason(reason, 'delete')).toBe(false);
  expect(page.canManageReason({ ...reason, company_id: null }, 'edit')).toBe(false);
  expect(page.canManageReason({ ...reason, company_id: 5 }, 'edit')).toBe(false);
  page.openReasonForm({ ...reason, company_id: null });
  page.confirmDeleteReason(reason); page.deleteReason();
  expect(page.showReasonForm).toBe(false);
  expect(service.deleteReason).not.toHaveBeenCalled();
});
