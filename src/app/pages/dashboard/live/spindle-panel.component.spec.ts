import { niceScale } from './spindle-panel.component';

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
