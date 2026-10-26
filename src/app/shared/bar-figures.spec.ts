import { barAxisMax, barFigures, figureFits } from './bar-figures';

/* 26 Oct 2026, the user on Energy: one big bar left the others tiny — their
   figures did not fit, and a tiny bar could not be hovered. */
test('the axis ends on a round number at or past the longest bar, in at most six steps', () => {
  expect(barAxisMax(233.13)).toEqual({ max: 250, ticks: 5 });
  expect(barAxisMax(1.84)).toEqual({ max: 2, ticks: 4 });
  expect(barAxisMax(7)).toEqual({ max: 8, ticks: 4 });
  expect(barAxisMax(3)).toEqual({ max: 3, ticks: 6 });
  expect(barAxisMax(3, true)).toEqual({ max: 3, ticks: 3 });       // counts: whole steps
  expect(barAxisMax(0)).toEqual({ max: 1, ticks: 1 });
  for (const v of [0.3, 3.3, 19.3, 45, 233.13, 5120]) {
    const a = barAxisMax(v);
    expect(a.max).toBeGreaterThanOrEqual(v);
    expect(a.ticks).toBeLessThanOrEqual(6);
    const w = barAxisMax(Math.ceil(v), true);
    expect(Number.isInteger(w.max / w.ticks)).toBe(true);
  }
});

test('a figure shows inside its bar only when the bar can hold it', () => {
  expect(figureFits(233.13, '233.13', 250, 540)).toBe(true);     // ~500 px
  expect(figureFits(19.3, '19.3', 250, 540)).toBe(true);         // ~42 px for 4 characters
  expect(figureFits(1.84, '1.84', 250, 540)).toBe(false);        // ~4 px: on hover only
  expect(figureFits(1, '1', 1, 0)).toBe(true);                   // not drawn yet: nothing to judge by
});

test('the chart parts: the axis, the figure for a bar that fits and none for one that does not, a row-wide tooltip', () => {
  const fig = barFigures([233.13, 32, 1.84], v => `${v}`, { distributed: true });
  expect(fig.plotOptions.bar).toMatchObject({ horizontal: true, distributed: true });
  expect(fig.xaxis).toEqual({ min: 0, max: 250, tickAmount: 5 });
  const w = { w: { globals: { gridWidth: 540 } } };
  expect(fig.dataLabels.formatter(233.13, w)).toBe('233.13');
  expect(fig.dataLabels.formatter(1.84, w)).toBe('');
  expect(fig.dataLabels.style.fontSize).toBe('12px');
  expect(fig.tooltip).toMatchObject({ shared: false, intersect: false });
  expect(fig.tooltip.y.formatter(1.84)).toBe('1.84');
});
