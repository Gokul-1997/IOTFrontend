import { ActivatedRoute, Router } from '@angular/router';

/**
 * The record a notification points at — /alarms?alarm_id=12,
 * /programs?machine_id=7&file_id=42 (Backend notifications/links.js) — so the
 * page can open on it and mark it (22 Oct 2026, the user: "the notification I
 * select — that record highlighted").
 *
 * Positive whole numbers only; anything else is ignored. Taken once and
 * dropped from the address (the rest of the query stays), so a reload or a
 * shared link does not mark it again.
 */
export function takeLinkedRecord<K extends string>(route: ActivatedRoute, router: Router, keys: readonly K[]): Partial<Record<K, number>> {
  const q = route.snapshot.queryParamMap;
  if (!keys.some(k => q.has(k))) return {};
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const v = q.get(k);
    if (v && /^[1-9]\d{0,9}$/.test(v)) out[k] = Number(v);
  }
  void router.navigate([], {
    relativeTo: route, replaceUrl: true, queryParamsHandling: 'merge',
    queryParams: Object.fromEntries(keys.map(k => [k, null]))
  });
  return out;
}

/**
 * Where a notification opens: its link, an app path. An alarm notification
 * sent before links named the alarm still carries the alarm's id, so it opens
 * on that alarm too. Anything that is not an app path opens nothing.
 */
export function notificationTarget(n: { link?: unknown; alarm_id?: unknown }): string | null {
  const link = typeof n?.link === 'string' ? n.link : '';
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  const alarmId = Number(n?.alarm_id);
  if (link === '/alarms' && Number.isInteger(alarmId) && alarmId > 0) return `/alarms?alarm_id=${alarmId}`;
  return link;
}
