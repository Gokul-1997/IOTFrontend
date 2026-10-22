import { convertToParamMap } from '@angular/router';
import { takeLinkedFilters } from './linked-filters';

/* The filters a link from another screen brings: taken once, checked, dropped from the address. */
const route = (params: Record<string, string>) => ({ snapshot: { queryParamMap: convertToParamMap(params) } }) as any;
const routerSpy = () => ({ navigate: vi.fn(() => Promise.resolve(true)) });

test('a link with nothing to take leaves the address alone', () => {
  const router = routerSpy();
  expect(takeLinkedFilters(route({ view: 'details' }), router as any)).toEqual({});
  expect(router.navigate).not.toHaveBeenCalled();
});

test('day, shift, machine and status are taken, and dropped from the address (the tab stays)', () => {
  const router = routerSpy();
  const r = route({ from: '2026-10-21', to: '2026-10-21', shift_id: '10', machine_id: '2', status: 'idle', tab: 'production' });
  expect(takeLinkedFilters(r, router as any)).toEqual({ from: '2026-10-21', to: '2026-10-21', shift_id: 10, machine_id: 2, status: 'idle' });
  expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
    replaceUrl: true, queryParamsHandling: 'merge',
    queryParams: { from: null, to: null, machine_id: null, shift_id: null, status: null }
  }));
});

test.each([
  [{ from: '2026-10-22', to: '2026-10-21' }, 'a range that runs backwards'],
  [{ from: '21-10-2026', to: '2026-10-21' }, 'a date not in ISO form'],
  [{ machine_id: '-3', shift_id: 'abc' }, 'ids that are not positive whole numbers'],
  [{ status: 'IDLE; DROP' }, 'a status that is not a plain word']
])('%j is ignored: %s', (params, _why) => {
  expect(takeLinkedFilters(route(params as any), routerSpy() as any)).toEqual({});
});
