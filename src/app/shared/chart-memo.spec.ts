import { ChartMemo } from './chart-memo';

/*
 * The contract this class exists to keep: the *same object reference* comes
 * back until the data changes. Everything else about the chart fix depends on
 * that — ng-apexcharts compares its @Inputs by reference, so a new object,
 * even one with identical contents, forces a full SVG rebuild.
 */
describe('ChartMemo', () => {

  it('hands back the identical reference within a generation', () => {
    const m = new ChartMemo();
    const first = m.memo('trend', () => ({ chart: { type: 'bar' } }));
    expect(m.memo('trend', () => ({ chart: { type: 'bar' } }))).toBe(first);
  });

  it('builds once per generation, however often it is read', () => {
    const m = new ChartMemo();
    let built = 0;
    const build = () => { built++; return { v: built }; };
    for (let i = 0; i < 50; i++) m.memo('trend', build);
    // 50 change-detection passes, one build
    expect(built).toBe(1);
  });

  it('rebuilds after bump, because the underlying data changed', () => {
    const m = new ChartMemo();
    const before = m.memo('trend', () => ({ n: 1 }));
    m.bump();
    const after = m.memo('trend', () => ({ n: 2 }));
    expect(after).not.toBe(before);
    expect(after).toEqual({ n: 2 });
  });

  it('keeps keys independent', () => {
    const m = new ChartMemo();
    const a = m.memo('a', () => ({ k: 'a' }));
    const b = m.memo('b', () => ({ k: 'b' }));
    expect(a).not.toBe(b);
    expect(m.memo('a', () => ({ k: 'other' }))).toBe(a);
  });

  it('does not build anything until the value is actually read', () => {
    const m = new ChartMemo();
    let built = 0;
    const build = () => { built++; return {}; };

    m.memo('trend', build);
    expect(built).toBe(1);

    // a bump invalidates but must not eagerly rebuild: a chart behind a
    // false *ngIf should cost nothing until the template asks for it
    m.bump();
    expect(built).toBe(1);

    m.memo('trend', build);
    expect(built).toBe(2);
  });

  it('survives a bump with no reads in between', () => {
    const m = new ChartMemo();
    m.memo('trend', () => ({ n: 1 }));
    m.bump(); m.bump(); m.bump();
    expect(m.memo('trend', () => ({ n: 4 }))).toEqual({ n: 4 });
  });

  it('caches a falsy build result rather than rebuilding it every pass', () => {
    const m = new ChartMemo();
    let built = 0;
    const build = () => { built++; return null; };
    m.memo('empty', build);
    m.memo('empty', build);
    expect(built).toBe(1);
  });
});
