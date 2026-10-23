import { BillDay } from './energy-dashboard.service';

/*
 * The Energy Dashboard's "This bill" — what the page draws from the
 * forecast (GET /dashboard/energy/bill), kept out of the component so it is
 * tested on its own. The server does the sums; this only lays them out.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Oct" from "2026-10-12" — the date as written, never moved by the viewer's time zone. */
export function billDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "12 Oct – 11 Nov 2026", or "12 Dec 2026 – 11 Jan 2027" across a year end. */
export function billPeriod(start: string, end: string): string {
  const ys = start.slice(0, 4), ye = end.slice(0, 4);
  return ys === ye ? `${billDay(start)} – ${billDay(end)} ${ye}` : `${billDay(start)} ${ys} – ${billDay(end)} ${ye}`;
}

/** The number of days from first to last, both counted (what the bill dates form shows as it is filled in). */
export function billLength(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** What is wrong with the dates typed, in the words the server would use, or ''. */
export function billDatesProblem(start: string, end: string): string {
  const n = billLength(start, end);
  if (n === null) return 'Enter the bill\'s first and last day.';
  if (n < 7) return 'A bill runs at least 7 days: the last day must be 6 or more days after the first.';
  if (n > 93) return 'A bill runs at most 3 months: the last day must be within 92 days of the first.';
  return '';
}

/**
 * The running total of the bill, day by day: what was used (a solid line to
 * today), the forecast from there to the bill's last day (dashed, starting
 * where the used line ends) and its likely range (a band). In ₹ when there
 * is a tariff, else kWh.
 */
export function billChart(days: BillDay[], money: boolean) {
  const used = (d: BillDay) => (money ? d.to_date_cost : d.to_date_kwh);
  const ahead = (d: BillDay) => (money ? d.forecast_cost : d.forecast_kwh);
  const low = (d: BillDay) => (money ? d.low_cost : d.low_kwh);
  const high = (d: BillDay) => (money ? d.high_cost : d.high_kwh);

  const firstAhead = days.findIndex(d => ahead(d) != null);
  // the forecast starts from the last day already over, so the two lines meet
  const anchor = firstAhead > 0 ? firstAhead - 1 : -1;
  const categories = days.map(d => billDay(d.day));
  return {
    categories,
    used: days.map(d => used(d)),
    forecast: days.map((d, i) => (i === anchor ? used(d) : ahead(d))),
    range: days.map((d, i) => {
      const y = i === anchor ? [used(d), used(d)] : low(d) != null && high(d) != null ? [low(d), high(d)] : null;
      return { x: categories[i], y: y as [number, number] | null };
    })
  };
}

/** "+4.2%" / "−3.1%" against the bill before; '' when there is none to compare. */
export function changeText(now: number | null | undefined, before: number | null | undefined): string {
  if (now == null || before == null || before <= 0) return '';
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** How close the method came on the last 7 days, in words. */
export function accuracyText(errorPct: number | null | undefined): string {
  if (errorPct == null) return '';
  const off = Math.abs(errorPct);
  return off < 0.5 ? 'Checked on the last 7 days: on the mark' : `Checked on the last 7 days: within ${off}%`;
}
