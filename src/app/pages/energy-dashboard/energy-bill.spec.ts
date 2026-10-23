import { billDay, billPeriod, blankEbBill, changeText, ebBillProblem, ebDays, ebSums, unitsText } from './energy-bill';
import { EbForecast } from './energy-dashboard.service';

/* The EB bill on Tariff & Rates and the Energy Dashboard — S AND T's July–August bills. */

const sc1212 = { ...blankEbBill(), from: '2026-07-26', to: '2026-08-26', units: 55952, rate: 8.13, peak_charges: 0,
  electricity_charges: 455093, fixed_charges: 91200, penalty_charges: 16372, welding_charges: 68264, tax_charges: 29512, net_amount: 660441 };

test('dates read as the bill prints them, whatever the viewer\'s time zone', () => {
  expect(billDay('2026-09-26')).toBe('26 Sep');
  expect(billPeriod('2026-09-26', '2026-10-26')).toBe('26 Sep – 26 Oct 2026');
  expect(billPeriod('2026-12-26', '2027-01-26')).toBe('26 Dec 2026 – 26 Jan 2027');
});

test('a bill runs reading date to reading date: 26 Jul → 26 Aug is 31 days, 26 Jul → 27 Aug 32', () => {
  expect(ebDays('2026-07-26', '2026-08-26')).toBe(31);
  expect(ebDays('2026-07-26', '2026-08-27')).toBe(32);
  expect(ebDays('', '2026-08-27')).toBeNull();
});

test('as it is typed: the charges add up to the net bill, and the rounded printed rate is shown for what it is', () => {
  expect(ebSums(sc1212)).toEqual({ electricity: 455093, sum: 660441, net_difference: 0, rate_difference: 203.24 });
  // a slip in one figure shows against the net bill
  expect(ebSums({ ...sc1212, tax_charges: 29152 }).net_difference).toBe(360);
  // electricity charges left blank: units × rate
  expect(ebSums({ ...sc1212, electricity_charges: null, rate: 8.25, units: 68988 }).electricity).toBe(569151);
});

test('what the server would refuse is said before sending', () => {
  const today = '2026-10-23';
  expect(ebBillProblem(sc1212, today)).toBe('');
  expect(ebBillProblem({ ...sc1212, to: '2026-07-26' }, today)).toMatch(/after the From/);
  expect(ebBillProblem({ ...sc1212, from: '2026-01-01' }, today)).toMatch(/at most 3 months/);
  expect(ebBillProblem({ ...sc1212, from: '2026-10-20', to: '2026-11-20' }, today)).toMatch(/future/);
  expect(ebBillProblem({ ...sc1212, units: null }, today)).toMatch(/units/);
  expect(ebBillProblem({ ...sc1212, electricity_charges: null, rate: null }, today)).toMatch(/electricity charges, or the rate/);
  expect(ebBillProblem({ ...sc1212, fixed_charges: -1 }, today)).toMatch(/negative/);
  expect(ebBillProblem({ ...sc1212, other_charges: -500 }, today)).toBe('');
});

test('where the units come from is said, and an estimate says so', () => {
  const c = (source: any, units: any): EbForecast => ({ id: 1, sc_number: '1212', name: null, meter: null, status: 'ok', source, units } as any);
  expect(unitsText(c('readings', { so_far: 48700, as_of: '2026-10-23', per_day: 1800 })))
    .toBe('48,700 units so far, from EB meter readings to 23 Oct; the rest at 1,800 a day');
  expect(unitsText(c('bills', { so_far: 0, per_day: 1804.9, bills: 1 })))
    .toBe('Estimate: 1,805 units a day, as on the last bill. Enter EB meter readings for exact units.');
});

test('against the bill before', () => {
  expect(changeText(642079, 660441)).toBe('−2.8%');
  expect(changeText(700000, 660441)).toBe('+6%');
  expect(changeText(100, null)).toBe('');
});
