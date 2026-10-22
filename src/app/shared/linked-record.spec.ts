import { convertToParamMap } from '@angular/router';
import { notificationTarget, takeLinkedRecord } from './linked-record';

const route = (params: Record<string, string>) => ({ snapshot: { queryParamMap: convertToParamMap(params) } }) as any;
const routerSpy = () => ({ navigate: vi.fn(() => Promise.resolve(true)) });

test('the record ids are taken and dropped from the address; other parameters stay', () => {
  const router = routerSpy();
  expect(takeLinkedRecord(route({ machine_id: '7', file_id: '42', tab: 'x' }), router as any, ['machine_id', 'file_id']))
    .toEqual({ machine_id: 7, file_id: 42 });
  expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
    replaceUrl: true, queryParamsHandling: 'merge', queryParams: { machine_id: null, file_id: null } }));
});

test('nothing to take leaves the address alone; a malformed id is ignored', () => {
  const router = routerSpy();
  expect(takeLinkedRecord(route({ tab: 'x' }), router as any, ['alarm_id'])).toEqual({});
  expect(router.navigate).not.toHaveBeenCalled();
  expect(takeLinkedRecord(route({ alarm_id: '-1' }), routerSpy() as any, ['alarm_id'])).toEqual({});
  expect(takeLinkedRecord(route({ alarm_id: '12; DROP' }), routerSpy() as any, ['alarm_id'])).toEqual({});
});

test('a notification opens its link; an older alarm notification opens on its alarm; anything else opens nothing', () => {
  expect(notificationTarget({ link: '/programs?machine_id=7&file_id=42' })).toBe('/programs?machine_id=7&file_id=42');
  expect(notificationTarget({ link: '/alarms', alarm_id: 91 })).toBe('/alarms?alarm_id=91');
  expect(notificationTarget({ link: '/alarms?alarm_id=5', alarm_id: 91 })).toBe('/alarms?alarm_id=5');
  for (const link of [null, '', 'https://evil.test', '//evil.test', 'javascript:alert(1)']) {
    expect(notificationTarget({ link })).toBeNull();
  }
});
