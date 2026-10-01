/*
 * Large readings, readable. A meter total arrived as "2259911320 kWh" and ran
 * out of its tile; chart axes read "300000000.000".
 *
 * Indian grouping (2,25,99,11,320 — lakh and crore), as the plant reads
 * figures everywhere else in the app (toLocaleString('en-IN')).
 */

/** 2259911320 → "2,25,99,11,320"; at most `digits` decimals; "--" when there is no figure. */
export function qty(v: number | string | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === '') return '--';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: digits }) : '--';
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/** For chart axes, where space is short: 950 → "950", 150000 → "1.5L", 300000000 → "30Cr". */
export function compactQty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return Math.abs(v) < 1000 ? String(Math.round(v * 10) / 10) : compact.format(v);
}
