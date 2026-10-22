import { ActivatedRoute, Router } from '@angular/router';

/** What a link from another screen may carry: ?from=&to=&machine_id=&shift_id=&status= */
export interface LinkedFilters {
  from?: string;
  to?: string;
  machine_id?: number;
  shift_id?: number;
  status?: string;
}

const KEYS = ['from', 'to', 'machine_id', 'shift_id', 'status'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const positiveId = (v: string | null) => {
  const n = Number(v);
  return v && Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/**
 * The filters another screen's link brought — the Factory Overall tiles open
 * the OEE, Downtime and Energy dashboards, the Live Dashboard and Reports on
 * their own day, shift and machine. Anything malformed is ignored (the page
 * keeps its defaults). Taken once and dropped from the address — the tab
 * (?view=, ?tab=) stays — so the filters on screen are in charge afterwards
 * and a reload does not bring the old ones back.
 */
export function takeLinkedFilters(route: ActivatedRoute, router: Router): LinkedFilters {
  const q = route.snapshot.queryParamMap;
  if (!KEYS.some(k => q.has(k))) return {};

  const out: LinkedFilters = {};
  const from = q.get('from'), to = q.get('to');
  if (from && to && DATE.test(from) && DATE.test(to) && from <= to) { out.from = from; out.to = to; }
  const machine = positiveId(q.get('machine_id'));
  if (machine) out.machine_id = machine;
  const shift = positiveId(q.get('shift_id'));
  if (shift) out.shift_id = shift;
  const status = q.get('status');
  if (status && /^[a-z]{1,20}$/.test(status)) out.status = status;

  void router.navigate([], {
    relativeTo: route, replaceUrl: true, queryParamsHandling: 'merge',
    queryParams: Object.fromEntries(KEYS.map(k => [k, null]))
  });
  return out;
}
