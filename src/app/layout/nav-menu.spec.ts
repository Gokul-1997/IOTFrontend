import { NAV_MENUS, pathMatches } from './nav-menu';

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

describe('NAV_MENUS', () => {
  it('gives every menu entry an icon', () => {
    for (const m of NAV_MENUS) {
      expect(m.icon, m.label).toBeTruthy();
      for (const c of m.children ?? []) expect(c.icon, c.label).toBeTruthy();
    }
  });
});
