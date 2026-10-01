import { NAV_MENUS, pathMatches, trailFor } from './nav-menu';

describe('pathMatches', () => {
  it('matches the page and pages under it', () => {
    expect(pathMatches('/maintenance', '/maintenance')).toBe(true);
    expect(pathMatches('/maintenance/12', '/maintenance')).toBe(true);
    expect(pathMatches('/reports?tab=oee-records', '/reports')).toBe(true);
  });

  it('does not match a different page that shares a prefix', () => {
    // "Maintenance" used to light up on the Maintenance dashboard
    expect(pathMatches('/maintenance-dashboard', '/maintenance')).toBe(false);
    expect(pathMatches('/dashboard/live/3', '/dashboard')).toBe(true);
    expect(pathMatches('/x', undefined)).toBe(false);
  });
});

describe('trailFor', () => {
  it('places a menu page under its group', () => {
    expect(trailFor('/oee-dashboard')).toEqual([{ label: 'Dashboards' }, { label: 'OEE' }]);
    expect(trailFor('/quality')).toEqual([{ label: 'Analytics' }, { label: 'Quality' }]);
  });

  it('links a machine page back to the Live Dashboard', () => {
    expect(trailFor('/dashboard/live/25')).toEqual([
      { label: 'Dashboards' }, { label: 'Live Dashboard', path: '/dashboard' }, { label: 'Machine' }
    ]);
  });

  it('gives a top-level page no trail', () => {
    expect(trailFor('/alarms')).toEqual([]);
  });

  it('gives every menu entry an icon', () => {
    for (const m of NAV_MENUS) {
      expect(m.icon, m.label).toBeTruthy();
      for (const c of m.children ?? []) expect(c.icon, c.label).toBeTruthy();
    }
  });
});
