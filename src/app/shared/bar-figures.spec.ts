import { BAR_HOVER, barAxisMax, barFigures, columnFigure, columnFigures, figureFits, wrapLabel } from './bar-figures';

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
  const fig = barFigures([233.13, 32, 1.84], v => `${v}`, { bar: { distributed: true } });
  expect(fig.plotOptions.bar).toMatchObject({ horizontal: true, distributed: true });
  expect(fig.xaxis).toEqual({ min: 0, max: 250, tickAmount: 5 });
  const w = { w: { globals: { gridWidth: 540 } } };
  expect(fig.dataLabels.formatter(233.13, w)).toBe('233.13');
  expect(fig.dataLabels.formatter(1.84, w)).toBe('');
  expect(fig.dataLabels.style.fontSize).toBe('12px');
  expect(fig.tooltip).toMatchObject({ shared: false, intersect: false });
  expect(fig.tooltip.y.formatter(1.84)).toBe('1.84');
});

test('a column shows its figure only when it is tall enough; a stacked piece the same', () => {
  const f = columnFigure(v => `${v}m`, 14);
  const g = (maxY: number, gridHeight: number) => ({ w: { globals: { maxY, gridHeight } } });
  expect(f(40, g(100, 300))).toBe('40m');          // 120 px
  expect(f(3, g(100, 300))).toBe('');              // 9 px: on hover only
  expect(f(0, g(100, 300))).toBe('');              // nothing to say
  expect(f(5, undefined)).toBe('5m');              // not drawn yet: nothing to judge by
});

test('every bar chart answers a hover anywhere in a bar\'s row or column', () => {
  expect(BAR_HOVER).toEqual({ shared: false, intersect: false });
});

test('a column too narrow for its figure shows none; a second axis is read for its own series', () => {
  const f = columnFigure(v => `${Math.round(v)}%`);
  const g = (barWidth: number) => ({ w: { globals: { maxY: 100, barWidth }, layout: { gridHeight: 300 } } });
  expect(f(87, g(40))).toBe('87%');
  expect(f(87, g(20))).toBe('');                   // 3 characters need ~27 px
  const pareto = columnFigure(v => v.toFixed(1));
  const axes = { seriesIndex: 0, w: { globals: { maxY: 100, maxYArr: [6, 100], barWidth: 80 }, layout: { gridHeight: 300 } } };
  expect(pareto(1.3, axes)).toBe('1.3');           // 1.3 of 6 h, not of 100 %: 65 px
});

test('the column chart part: white, 12px, on the series asked for', () => {
  const d = columnFigures(v => `${v}`, [0]);
  expect(d).toMatchObject({ enabled: true, enabledOnSeries: [0], style: { fontSize: '12px', colors: ['#fff'] } });
  expect(columnFigures(v => `${v}`)).not.toHaveProperty('enabledOnSeries');
});

test('a fixed axis end (a score runs to 100 %) is the one figures are judged against', () => {
  const fig = barFigures([91, 52], v => `${v}%`, { axisMax: 100 });
  expect(fig.xaxis).toEqual({ min: 0, max: 100, tickAmount: 5 });
  expect(fig.dataLabels.formatter(52, { w: { layout: { gridWidth: 600 } } })).toBe('52%');   // 312 px of 600
  expect(fig.dataLabels.formatter(3, { w: { layout: { gridWidth: 600 } } })).toBe('');       // 18 px
});

test('a narrow card asks for fewer ticks', () => {
  expect(barAxisMax(122, true)).toEqual({ max: 125, ticks: 5 });
  expect(barAxisMax(122, true, 4)).toEqual({ max: 150, ticks: 3 });
});

test('a long name on two lines, never cut mid-word unless one word is too long', () => {
  expect(wrapLabel('Spindle Overload')).toBe('Spindle Overload');
  expect(wrapLabel('PRESS SERVO ON FOR MORE THAN 5 SEC')).toEqual(['PRESS SERVO ON FOR', 'MORE THAN 5 SEC']);
  expect(wrapLabel('(Z)+ OVERTRAVEL ( SOFT 1) ON THE FOURTH AXIS DRIVE')).toEqual(['(Z)+ OVERTRAVEL (', 'SOFT 1) ON THE FO…']);
  expect(wrapLabel('SUPERCALIFRAGILISTICEXPIALIDOCIOUS')).toEqual(['SUPERCALIFRAGILIS…']);
});
