import { dayText, pctText, pctTone } from './report-value';

test('a percentage reads "82.35%", and an unknown one "--" — never "--%" or "null%"', () => {
  expect(pctText('82.35')).toBe('82.35%');
  expect(pctText(0)).toBe('0%');
  for (const unknown of [null, undefined, '', 'abc']) expect(pctText(unknown)).toBe('--');
});

test("the dashboards' bands: good from 85, fair from 60; unknown is muted, not poor", () => {
  expect(pctTone('85')).toBe('text-green-600');
  expect(pctTone(84.99)).toBe('text-yellow-600');
  expect(pctTone('60.00')).toBe('text-yellow-600');
  expect(pctTone(59.9)).toBe('text-red-500');
  expect(pctTone(null)).toBe('muted');
});

test('a day reads 21-Oct-2026, whatever form it came in', () => {
  expect(dayText('2026-10-21')).toBe('21-Oct-2026');
  expect(dayText('2026-01-05')).toBe('05-Jan-2026');
  expect(dayText(null)).toBe('--');
  // an older API's timestamp, read in the browser's own time
  const local = new Date(2026, 3, 27, 0, 0, 0);
  expect(dayText(local.toISOString())).toBe('27-Apr-2026');
});
