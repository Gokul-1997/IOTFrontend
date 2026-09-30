/*
 * Each page's identity key. The layout writes it onto <html data-page="…">
 * on every navigation; styles/theme/_pages.scss turns the key into the
 * page's accent colours, the label above its title and its header
 * illustration. The header uses the same keys to colour each menu entry
 * with the page it opens.
 *
 * Most keys are simply the address's first segment; these are the ones
 * whose address says it at more length.
 */
const KEYS: Record<string, string> = {
  'dashboard': 'live',
  'maintenance-dashboard': 'maint-dash',
  'preventive-maintenance': 'preventive',
  'periodic-maintenance': 'periodic',
  'operator-performance': 'operator-perf',
  'oee-dashboard': 'oee',
  'oee-reports': 'reports',
  'energy-dashboard': 'energy',
  'energy-tariff': 'tariff',
  'maintenance-report': 'maint-report',
};

/** '/dashboard/live/7?x=1' → 'machine'; '/machines/create' → 'machines'; '/admin/users' → 'admin'. */
export function pageKey(url: string): string {
  const [first = '', second] = url.split(/[?#]/)[0].replace(/^\/+/, '').split('/');
  if (first === 'dashboard' && second === 'live') return 'machine';
  return KEYS[first] ?? first;
}
