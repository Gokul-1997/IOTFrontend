import { EbForecast } from './energy-dashboard.service';

/*
 * The electricity (EB) bill — what the Energy Dashboard's "This Bill" and the
 * bills on Tariff & Rates show, kept out of the components so it is tested on
 * its own. The server works the forecast out; this lays it out and checks a
 * bill as it is typed, the way the server will.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Sep" from "2026-09-26" — the date as written, never moved by the viewer's time zone. */
export function billDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "26 Sep – 26 Oct 2026", or "26 Dec 2026 – 26 Jan 2027" across a year end. */
export function billPeriod(start: string, end: string): string {
  const ys = start.slice(0, 4), ye = end.slice(0, 4);
  return ys === ye ? `${billDay(start)} – ${billDay(end)} ${ye}` : `${billDay(start)} ${ys} – ${billDay(end)} ${ye}`;
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

/** A bill's days, From to To — the To day starts the next bill: 26 Jul → 26 Aug is 31. */
export function ebDays(from: string, to: string): number | null {
  if (!isDay(from) || !isDay(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A bill as typed into the form: figures may still be blank. */
export interface EbBillForm {
  from: string; to: string;
  units: number | null; rate: number | null;
  electricity_charges: number | null; peak_charges: number | null; fixed_charges: number | null;
  penalty_charges: number | null; welding_charges: number | null; tax_charges: number | null;
  other_charges: number | null; net_amount: number | null;
}

export const blankEbBill = (): EbBillForm => ({
  from: '', to: '', units: null, rate: null, electricity_charges: null, peak_charges: null, fixed_charges: null,
  penalty_charges: null, welding_charges: null, tax_charges: null, other_charges: null, net_amount: null
});

const n = (v: number | null | undefined) => (v === null || v === undefined || (v as any) === '' ? 0 : Number(v));
const given = (v: number | null | undefined) => v !== null && v !== undefined && (v as any) !== '' && Number.isFinite(Number(v));

/**
 * The sums the form shows as it is filled in: electricity charges (units ×
 * rate when left blank), what the charges add up to, and how far that is from
 * the net bill typed — a typing slip shows at once.
 */
export function ebSums(f: EbBillForm) {
  const electricity = given(f.electricity_charges) ? n(f.electricity_charges)
    : given(f.units) && given(f.rate) ? Math.round(n(f.units) * n(f.rate)) : null;
  const sum = electricity === null ? null : electricity + n(f.peak_charges) + n(f.fixed_charges) + n(f.penalty_charges)
    + n(f.welding_charges) + n(f.tax_charges) + n(f.other_charges);
  const rounded = sum === null ? null : Math.round(sum * 100) / 100;
  return {
    electricity,
    sum: rounded,
    net_difference: rounded !== null && given(f.net_amount) ? Math.round((n(f.net_amount) - rounded) * 100) / 100 : null,
    rate_difference: given(f.units) && given(f.rate) && given(f.electricity_charges)
      ? Math.round((n(f.electricity_charges) - n(f.units) * n(f.rate)) * 100) / 100 : null
  };
}

/** What is wrong with the bill typed, in the words the server would use, or ''. */
export function ebBillProblem(f: EbBillForm, today: string): string {
  const days = ebDays(f.from, f.to);
  if (days === null) return 'Enter the billing period From and To dates, as on the bill.';
  if (days <= 0) return 'The To date must be after the From date.';
  if (days > 93) return 'A bill covers at most 3 months: check the dates.';
  if (f.to > today) return 'A bill\'s To date cannot be in the future.';
  if (!given(f.units) || n(f.units) <= 0) return 'Enter the units (more than 0).';
  if (!given(f.electricity_charges) && !given(f.rate)) return 'Enter the electricity charges, or the rate per unit.';
  for (const k of ['rate', 'electricity_charges', 'peak_charges', 'fixed_charges', 'penalty_charges', 'welding_charges', 'tax_charges', 'net_amount'] as const) {
    if (given(f[k]) && n(f[k]) < 0) return 'Charges cannot be negative (only Other charges, for a credit).';
  }
  return '';
}

/** "+4.2%" / "−3.1%" against the bill before; '' when there is none to compare. */
export function changeText(now: number | null | undefined, before: number | null | undefined): string {
  if (now == null || before == null || before <= 0) return '';
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** Where a supply's units come from, in words — an estimate always says so. */
export function unitsText(c: EbForecast): string {
  const u = c.units;
  if (!u) return '';
  const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (c.source === 'readings') return `${fmt(u.so_far)} units so far, from EB meter readings to ${billDay(u.as_of!)}; the rest at ${fmt(u.per_day ?? 0)} a day`;
  if (c.source === 'meter') return `${fmt(u.so_far)} units so far, from the meter on ${c.meter?.machine || 'the supply'}; the rest at its usual use`;
  return `Estimate: ${fmt(u.per_day ?? 0)} units a day, as on the last ${u.bills && u.bills > 1 ? u.bills + ' bills' : 'bill'}. Enter EB meter readings for exact units.`;
}
