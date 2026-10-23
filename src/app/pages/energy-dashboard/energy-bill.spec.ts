import { accuracyText, billChart, billDatesProblem, billDay, billLength, billPeriod, changeText } from './energy-bill';
import { BillDay } from './energy-dashboard.service';

/* "This bill" on the Energy Dashboard and the bill dates on Tariff & Rates. */

const day = (d: string, kind: BillDay['kind'], used: number | null, ahead: number | null, lo = ahead, hi = ahead): BillDay => ({
  day: d, kind,
  to_date_kwh: used, to_date_cost: used == null ? null : used * 10,
  forecast_kwh: ahead, forecast_cost: ahead == null ? null : ahead * 10,
  low_kwh: lo, high_kwh: hi, low_cost: lo == null ? null : lo * 10, high_cost: hi == null ? null : hi * 10
});

test('dates read as the bill prints them, whatever the viewer\'s time zone', () => {
  expect(billDay('2026-10-12')).toBe('12 Oct');
  expect(billPeriod('2026-10-12', '2026-11-11')).toBe('12 Oct – 11 Nov 2026');
  expect(billPeriod('2026-12-12', '2027-01-11')).toBe('12 Dec 2026 – 11 Jan 2027');
});

test('the dates form says the length as it is filled in, and what the server would refuse', () => {
  expect(billLength('2026-10-12', '2026-11-11')).toBe(31);
  expect(billLength('', '2026-11-11')).toBeNull();
  expect(billDatesProblem('2026-10-12', '2026-11-11')).toBe('');
  expect(billDatesProblem('2026-10-12', '2026-10-17')).toMatch(/at least 7 days/);
  expect(billDatesProblem('2026-10-12', '2027-01-13')).toMatch(/at most 3 months/);
  expect(billDatesProblem('', '')).toMatch(/first and last day/);
});

test('the chart: used to today, the forecast from where it ends, the range around the forecast', () => {
  const days = [
    day('2026-10-12', 'past', 100, null),
    day('2026-10-13', 'past', 210, null),
    day('2026-10-14', 'today', 260, 320, 300, 330),
    day('2026-10-15', 'coming', null, 430, 400, 450)
  ];
  const kwh = billChart(days, false);
  expect(kwh.categories).toEqual(['12 Oct', '13 Oct', '14 Oct', '15 Oct']);
  expect(kwh.used).toEqual([100, 210, 260, null]);
  // the dashed line starts at the last day already over, so the two lines meet
  expect(kwh.forecast).toEqual([null, 210, 320, 430]);
  expect(kwh.range.map(r => r.y)).toEqual([null, [210, 210], [300, 330], [400, 450]]);

  const money = billChart(days, true);
  expect(money.used).toEqual([1000, 2100, 2600, null]);
  expect(money.forecast[3]).toBe(4300);
});

test('a bill on its first day: the forecast starts there', () => {
  const kwh = billChart([day('2026-10-12', 'today', 40, 120), day('2026-10-13', 'coming', null, 240)], false);
  expect(kwh.forecast).toEqual([120, 240]);
});

test('against the bill before, and how close the method came', () => {
  expect(changeText(48551, 45210)).toBe('+7.4%');
  expect(changeText(42000, 45210)).toBe('−7.1%');
  expect(changeText(100, null)).toBe('');
  expect(accuracyText(0.2)).toBe('Checked on the last 7 days: on the mark');
  expect(accuracyText(-2.1)).toBe('Checked on the last 7 days: within 2.1%');
  expect(accuracyText(null)).toBe('');
});
