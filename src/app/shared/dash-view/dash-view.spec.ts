import { Subject, throwError } from 'rxjs';
import { DashPart, DashTab, DashViews } from './dash-view';

/*
 * The rules a dashboard's tabs live by: a part is asked for only while it is
 * on screen and out of date, what is needed at once goes in one request, and
 * an answer for filters that have since changed never lands.
 */
const TABS: DashTab[] = [
  { key: 'charts',  label: 'Charts',  icon: 'bar_chart',  parts: ['kpis', 'charts'] },
  { key: 'details', label: 'Details', icon: 'table_rows', parts: ['kpis', 'table'] }
];

/** A page with one filter for every part, and one the table alone depends on. */
function page() {
  const p = {
    machine: 'all',
    tablePage: 1,
    asked: [] as { parts: DashPart[]; answer: Subject<any> }[],
    applied: [] as { parts: DashPart[]; ok: boolean }[],
    accept: true,
    partKeys: () => ({ kpis: p.machine, charts: p.machine, table: `${p.machine}|${p.tablePage}` }),
    fetchParts(parts: DashPart[]) {
      const answer = new Subject<any>();
      p.asked.push({ parts, answer });
      return answer;
    },
    applyParts(parts: DashPart[], res: any) {
      p.applied.push({ parts, ok: !!res });
      return res ? p.accept : false;
    }
  };
  return p;
}
const answer = (req: { answer: Subject<any> }) => { req.answer.next({ status: 'success', data: {} }); req.answer.complete(); };

describe('DashViews', () => {

  it('opens on the first tab and asks for its parts in one request', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load();
    expect(v.tab).toBe('charts');
    expect(p.asked.map(r => r.parts)).toEqual([['kpis', 'charts']]);
    expect(v.loading).toBe(true);
    answer(p.asked[0]);
    expect(v.loading).toBe(false);
    expect(v.has('kpis') && v.has('charts')).toBe(true);
    expect(v.has('table')).toBe(false);
  });

  it('starts on the tab it is given, and ignores one it does not have', () => {
    expect(new DashViews(page(), TABS, 'details').tab).toBe('details');
    expect(new DashViews(page(), TABS, 'nonsense').tab).toBe('charts');
  });

  it('the other tab asks only for what it adds; going back asks nothing', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load(); answer(p.asked[0]);
    v.show('details');
    expect(p.asked[1].parts).toEqual(['table']);
    answer(p.asked[1]);
    v.show('charts'); v.show('details'); v.load();
    expect(p.asked).toHaveLength(2);
  });

  it('a change only the table depends on asks for the table alone', () => {
    const p = page();
    const v = new DashViews(p, TABS, 'details');
    v.load(); answer(p.asked[0]);
    p.tablePage = 2;
    v.load();
    expect(p.asked[1].parts).toEqual(['table']);
  });

  it('a filter changed on one tab leaves the hidden tab for later, once', () => {
    const p = page();
    const v = new DashViews(p, TABS, 'details');
    v.load(); answer(p.asked[0]);
    p.machine = '2';
    v.load();
    expect(p.asked[1].parts).toEqual(['kpis', 'table']);
    answer(p.asked[1]);
    v.show('charts');
    expect(p.asked[2].parts).toEqual(['charts']);
    answer(p.asked[2]);
    v.show('details');
    expect(p.asked).toHaveLength(3);
  });

  it('drops an answer for filters that have since changed, the hidden tab\'s too', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load();                       // charts, machine=all — still on its way
    p.machine = '2';
    v.show('details');              // details, machine=2
    expect(p.asked[0].answer.observed).toBe(false);   // the old request was unsubscribed
    expect(p.asked[1].parts).toEqual(['kpis', 'table']);
    answer(p.asked[0]);
    expect(p.applied).toHaveLength(0);
    answer(p.asked[1]);
    expect(p.applied).toEqual([{ parts: ['kpis', 'table'], ok: true }]);
    v.show('charts');
    expect(p.asked[2].parts).toEqual(['charts']);
  });

  it('a part still on its way for the same filters is not asked for twice', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load();
    v.load();
    expect(p.asked).toHaveLength(1);
  });

  it('a failed request, or an answer that cannot be shown, is asked for again next time', () => {
    const p = page();
    const failing = { ...p, fetchParts: () => throwError(() => ({ status: 500 })) };
    const v = new DashViews(failing, TABS);
    v.load();
    expect(p.applied).toEqual([{ parts: ['kpis', 'charts'], ok: false }]);
    expect(v.loading).toBe(false);
    expect(v.has('kpis')).toBe(false);

    const q = page();
    q.accept = false;
    const w = new DashViews(q, TABS);
    w.load(); answer(q.asked[0]);
    expect(w.has('charts')).toBe(false);
    q.accept = true;
    w.load();
    expect(q.asked).toHaveLength(2);
  });

  it('stale() loads every part again when it is next on screen', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load(); answer(p.asked[0]);
    v.stale();
    v.load();
    expect(p.asked[1].parts).toEqual(['kpis', 'charts']);
    // what is on screen stays on screen while it reloads
    expect(v.has('charts')).toBe(true);
  });

  it('cancel() drops whatever is still on its way', () => {
    const p = page();
    const v = new DashViews(p, TABS);
    v.load();
    v.cancel();
    expect(p.asked[0].answer.observed).toBe(false);
    expect(v.loading).toBe(false);
  });
});
