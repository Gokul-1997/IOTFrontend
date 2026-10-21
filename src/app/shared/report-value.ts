/*
 * How a Reports table writes its values — one place, so OEE Records, OEE
 * Hourly and Shift OEE write the same figure the same way.
 */

/** A percentage as the table shows it: "82.35%", or "--" when it is not known (never "--%" or "null%"). */
export function pctText(v: unknown): string {
  return isKnown(v) ? `${v}%` : '--';
}

/**
 * Its colour: good at 85 and above, fair from 60, poor below — the OEE
 * Dashboard's bands. An unknown figure is muted, not "poor".
 */
export function pctTone(v: unknown): string {
  if (!isKnown(v)) return 'muted';
  const n = Number(v);
  return n >= 85 ? 'text-green-600' : n >= 60 ? 'text-yellow-600' : 'text-red-500';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day as the reports write it: 21-Oct-2026. From YYYY-MM-DD as sent —
 * no time zone to move it a day — or, from an older API, a timestamp read
 * in the browser's own time.
 */
export function dayText(v: unknown): string {
  if (typeof v !== 'string' || !v) return '--';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function isKnown(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}
