import { BLANK, TableState } from './table-state';

const ROWS = [
  { machine: 'VMC - 10 - M', status: 'OPEN', minutes: 12, started: '2026-10-29T06:00:00Z', who: 'ravi' },
  { machine: 'VMC - 2 - F', status: 'CLOSED', minutes: 4, started: '2026-10-28T06:00:00Z', who: null },
  { machine: 'HMC - 1', status: 'OPEN', minutes: null, started: null, who: 'kumar' },
  { machine: 'VMC - 1 - F', status: 'IN_PROGRESS', minutes: '30.5', started: '2026-10-29T09:00:00Z', who: '' }
];
const make = () => new TableState<any>([
  { key: 'machine' },
  { key: 'status', filter: 'list', label: v => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') },
  { key: 'minutes' },
  { key: 'started' },
  { key: 'who', filter: 'list' },
  { key: 'actions', sort: false }
]);
const names = (rows: any[]) => rows.map(r => r.machine);

test('a header click: ascending, descending, then the table\'s own order', () => {
  const t = make();
  expect(names(t.view(ROWS))).toEqual(['VMC - 10 - M', 'VMC - 2 - F', 'HMC - 1', 'VMC - 1 - F']);
  t.toggleSort('machine');
  expect(t.ariaSort('machine')).toBe('ascending');
  expect(names(t.view(ROWS))).toEqual(['HMC - 1', 'VMC - 1 - F', 'VMC - 2 - F', 'VMC - 10 - M']);   // 2 before 10
  t.toggleSort('machine');
  expect(names(t.view(ROWS))).toEqual(['VMC - 10 - M', 'VMC - 2 - F', 'VMC - 1 - F', 'HMC - 1']);
  t.toggleSort('machine');
  expect(t.sort).toBeNull();
  expect(names(t.view(ROWS))).toEqual(['VMC - 10 - M', 'VMC - 2 - F', 'HMC - 1', 'VMC - 1 - F']);
  t.toggleSort('actions');
  expect(t.sort).toBeNull();                                   // not sortable
});

test('numbers as numbers, dates as dates, and rows with no value last either way', () => {
  const t = make();
  t.toggleSort('minutes');
  expect(t.view(ROWS).map(r => r.minutes)).toEqual([4, 12, '30.5', null]);
  t.toggleSort('minutes');
  expect(t.view(ROWS).map(r => r.minutes)).toEqual(['30.5', 12, 4, null]);
  t.setSort({ key: 'started', dir: 'desc' });
  expect(names(t.view(ROWS))).toEqual(['VMC - 1 - F', 'VMC - 10 - M', 'VMC - 2 - F', 'HMC - 1']);
});

test('list filters: ticked values, (Blank) for none; choices from the rows with counts', () => {
  const t = make();
  t.view(ROWS);
  expect(t.options('status')).toEqual([
    { value: 'CLOSED', label: 'Closed', count: 1 },
    { value: 'IN_PROGRESS', label: 'In progress', count: 1 },
    { value: 'OPEN', label: 'Open', count: 2 }
  ]);
  expect(t.options('who').map(o => [o.label, o.count])).toEqual([['kumar', 1], ['ravi', 1], ['(Blank)', 2]]);
  t.setFilter('status', ['OPEN']);
  expect(names(t.view(ROWS))).toEqual(['VMC - 10 - M', 'HMC - 1']);
  t.setFilter('who', [BLANK]);
  expect(t.view(ROWS)).toEqual([]);
  t.setFilter('status', ['OPEN', 'IN_PROGRESS', 'CLOSED']);
  expect(names(t.view(ROWS))).toEqual(['VMC - 2 - F', 'VMC - 1 - F']);
  expect(t.isFiltered('who')).toBe(true);
  t.clearFilter('who');
  expect(t.isFiltered('who')).toBe(false);
});

test('a ticked value no longer in the rows stays on the list, so it can be unticked', () => {
  const t = make();
  t.setFilter('status', ['RESOLVED']);
  t.view(ROWS);
  expect(t.options('status').find(o => o.value === 'RESOLVED')).toEqual({ value: 'RESOLVED', label: 'Resolved', count: 0 });
});

test('the same array back while nothing changed; a change tells whoever listens', () => {
  const t = make();
  const heard = vi.fn();
  t.changed$.subscribe(heard);
  const a = t.view(ROWS);
  expect(t.view(ROWS)).toBe(a);
  t.toggleSort('machine');
  expect(t.view(ROWS)).not.toBe(a);
  expect(heard).toHaveBeenCalledTimes(1);
  t.setSort({ key: 'minutes', dir: 'asc' }, false);              // quietly
  expect(heard).toHaveBeenCalledTimes(1);
});

test('a server table sorts nothing itself; it asks with params()', () => {
  const t = new TableState<any>([{ key: 'machine' }, { key: 'status', filter: 'list' }], { mode: 'server' });
  t.toggleSort('machine'); t.toggleSort('machine');
  t.setFilter('status', ['OPEN', BLANK]);
  expect(t.params()).toEqual({ sort: 'machine', dir: 'desc', f_status: `OPEN,${BLANK}` });
  expect(names(t.view(ROWS))).toEqual(names(ROWS));
});

test('reset: every filter off and the table\'s own sort back', () => {
  const t = new TableState<any>([{ key: 'machine' }, { key: 'status', filter: 'list' }], { sort: { key: 'machine', dir: 'asc' } });
  t.toggleSort('status');
  t.setFilter('status', ['OPEN']);
  expect(t.anyFilter).toBe(true);
  t.reset();
  expect(t.sort).toEqual({ key: 'machine', dir: 'asc' });
  expect(t.anyFilter).toBe(false);
});
