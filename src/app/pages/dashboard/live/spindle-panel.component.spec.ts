import { niceScale, SpindlePanelComponent } from './spindle-panel.component';

test('Spindle and feed timestamps show hours and minutes without seconds', () => {
  const panel = new SpindlePanelComponent(null!, null!);
  const at = Date.now();
  panel.liveAt = at;
  const expected = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  panel.data = { latest: { at, stale: false } } as any;
  expect(panel.asOf).toBe('As of ' + expected);
  expect(panel.speedAsOf).toBe('As of ' + expected);
  expect(panel.asOf).not.toMatch(/\d+:\d+:\d+/);
});

describe('niceScale', () => {
  it('rounds the top of an axis up to a round step', () => {
    expect(niceScale(182 * 1.05)).toEqual({ max: 200, ticks: 4 });
    expect(niceScale(56719)).toEqual({ max: 60000, ticks: 6 });
    expect(niceScale(7)).toEqual({ max: 8, ticks: 4 });
    expect(niceScale(105)).toEqual({ max: 120, ticks: 6 });
    expect(niceScale(10500)).toEqual({ max: 12000, ticks: 6 });
    expect(niceScale(3)).toEqual({ max: 3, ticks: 3 });
  });
  it('never gives more than six ticks, and copes with nothing', () => {
    for (const v of [1, 7, 42, 99, 151, 999, 56719]) expect(niceScale(v).ticks).toBeLessThanOrEqual(6);
    expect(niceScale(0)).toEqual({ max: 1, ticks: 1 });
  });
});
