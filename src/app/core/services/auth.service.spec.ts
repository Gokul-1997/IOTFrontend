/**
 * Unit tests for AuthService — pure logic methods only.
 * HttpClient and Router are stubbed; no real HTTP calls are made.
 */

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

// ── helpers ──────────────────────────────────────────────────────────────────

function seedUser(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 1,
    email: 'test@example.com',
    roles: ['MANAGER'],
    permissions: ['page:dashboard', 'page:machines'],
    company_permissions: ['page:dashboard', 'page:machines:view'],
    user_type: 'ADMIN',
    company_id: 4,
    plan: { plan_code: 'PRO', tier: 2 },
    ...overrides
  };
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', 'fake-token');
  return user;
}

function clearSession() {
  localStorage.clear();
}

// ── setup ────────────────────────────────────────────────────────────────────

let service: AuthService;
let routerSpy: { navigate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  clearSession();
  routerSpy = { navigate: vi.fn() };

  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [
      AuthService,
      { provide: Router, useValue: routerSpy }
    ]
  });

  service = TestBed.inject(AuthService);
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  clearSession();
});

// ── isLoggedIn ────────────────────────────────────────────────────────────────

describe('AuthService.isLoggedIn', () => {
  test('returns false when no token in localStorage', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  test('returns true when token exists in localStorage', () => {
    localStorage.setItem('token', 'some-jwt');
    expect(service.isLoggedIn()).toBe(true);
  });
});

// ── getUser ───────────────────────────────────────────────────────────────────

describe('AuthService.getUser', () => {
  test('returns empty object when no user in localStorage', () => {
    clearSession();
    expect(service.getUser()).toEqual({});
  });

  test('returns parsed user object', () => {
    seedUser({ email: 'me@example.com' });
    expect(service.getUser().email).toBe('me@example.com');
  });

  test('returns empty object when user JSON is corrupted', () => {
    localStorage.setItem('user', '{ not valid json !!');
    expect(service.getUser()).toEqual({});
  });
});

// ── getRoles / getPermissions ─────────────────────────────────────────────────

describe('AuthService.getRoles / getPermissions', () => {
  test('getRoles returns array from user', () => {
    seedUser({ roles: ['ADMIN', 'VIEWER'] });
    expect(service.getRoles()).toEqual(['ADMIN', 'VIEWER']);
  });

  test('getRoles returns [] when no user', () => {
    expect(service.getRoles()).toEqual([]);
  });

  test('getPermissions returns permissions array', () => {
    seedUser({ permissions: ['page:dashboard', 'page:machines'] });
    expect(service.getPermissions()).toEqual(['page:dashboard', 'page:machines']);
  });

  test('getPermissions returns [] when no user', () => {
    expect(service.getPermissions()).toEqual([]);
  });
});

// ── role helpers ──────────────────────────────────────────────────────────────

describe('AuthService role checks', () => {
  test('isSntSuper returns true for SNT_SUPER role', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.isSntSuper()).toBe(true);
  });

  test('isSntSuper returns false for ADMIN role', () => {
    seedUser({ roles: ['ADMIN'] });
    expect(service.isSntSuper()).toBe(false);
  });

  test('isCompanyAdmin returns true for COMPANY_ADMIN role', () => {
    seedUser({ roles: ['COMPANY_ADMIN'] });
    expect(service.isCompanyAdmin()).toBe(true);
  });

  // ADMIN is the older name for the role; the API and the route guard both
  // read it as a company admin, so the buttons and widgets must as well
  test('legacy ADMIN role gets the company admin buttons and widgets', () => {
    seedUser({ roles: ['ADMIN'], permissions: [], company_permissions: [] });
    expect(service.isCompanyAdmin()).toBe(true);
    expect(service.hasAction('job', 'delete')).toBe(true);
    expect(service.hasWidget('charts', 'partwise-chart')).toBe(true);
  });

  test('legacy ADMIN is still limited to what the company was granted', () => {
    seedUser({ roles: ['ADMIN'], permissions: [], company_permissions: ['page:job', 'page:job:view'] });
    expect(service.hasAction('job', 'view')).toBe(true);
    expect(service.hasAction('job', 'delete')).toBe(false);
    expect(service.hasPermission('page:charts')).toBe(false);
  });

  test('MANAGER is not a company admin', () => {
    seedUser({ roles: ['MANAGER'] });
    expect(service.isCompanyAdmin()).toBe(false);
  });

  test('isAdmin returns true for SNT_SUPER', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns true for COMPANY_ADMIN', () => {
    seedUser({ roles: ['COMPANY_ADMIN'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns true for ADMIN role', () => {
    seedUser({ roles: ['ADMIN'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns false for plain VIEWER role', () => {
    seedUser({ roles: ['VIEWER'] });
    expect(service.isAdmin()).toBe(false);
  });
});

// ── hasPermission ─────────────────────────────────────────────────────────────

describe('AuthService.hasPermission', () => {
  test('SNT_SUPER always returns true', () => {
    seedUser({ roles: ['SNT_SUPER'], permissions: [] });
    expect(service.hasPermission('page:machines')).toBe(true);
  });

  test('exact match returns true for regular user', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:dashboard')).toBe(true);
  });

  test('prefix match returns true (page:machines matches page:machines:view)', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:machines:view'] });
    expect(service.hasPermission('page:machines')).toBe(true);
  });

  test('returns false when permission not in list', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:machines')).toBe(false);
  });

  test('COMPANY_ADMIN with empty company_permissions returns true (no restrictions)', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasPermission('page:anything')).toBe(true);
  });

  test('COMPANY_ADMIN checks company_permissions list', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:dashboard')).toBe(true);
    expect(service.hasPermission('page:machines')).toBe(false);
  });
});

// A regular role needs the page on the role AND on its company. The menu used
// to look at the role only, so it kept offering pages the company had lost —
// pages the API now refuses.
describe('AuthService.hasPermission — role and company together', () => {
  test('shows a page the role holds and the company was granted', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-oee:view'] });
    expect(service.hasPermission('page:analytics-oee')).toBe(true);
  });

  test('hides a page the role holds but the company was not granted', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-energy:view'] });
    expect(service.hasPermission('page:analytics-oee')).toBe(false);
  });

  test('hides a page the company has but the role does not', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-oee:view', 'page:analytics-energy:view'] });
    expect(service.hasPermission('page:analytics-energy')).toBe(false);
  });

  test('a company with no grants at all is fresh and unrestricted', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: [] });
    expect(service.hasPermission('page:analytics-oee')).toBe(true);
  });

  test('a company that lost one dashboard loses only that one', () => {
    const grants = ['page:analytics-oee:view', 'page:analytics-alarms:view'];
    seedUser({ roles: ['MANAGER'], permissions: [...grants, 'page:analytics-energy:view'], company_permissions: grants });
    expect(service.hasPermission('page:analytics-oee')).toBe(true);
    expect(service.hasPermission('page:analytics-alarms')).toBe(true);
    expect(service.hasPermission('page:analytics-energy')).toBe(false);
  });

  test('SNT_SUPER still sees everything regardless of grants', () => {
    seedUser({ roles: ['SNT_SUPER'], permissions: [], company_permissions: ['page:other:view'] });
    expect(service.hasPermission('page:analytics-oee')).toBe(true);
  });
});

// ── hasAction ─────────────────────────────────────────────────────────────────

describe('AuthService.hasAction', () => {
  test('SNT_SUPER can do any action', () => {
    seedUser({ roles: ['SNT_SUPER'], permissions: [] });
    expect(service.hasAction('machines', 'create')).toBe(true);
  });

  test('exact key match: page:machines:create', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:machines:create'], company_permissions: ['page:machines:create'] });
    expect(service.hasAction('machines', 'create')).toBe(true);
  });

  test('missing key returns false', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:machines:view'] });
    expect(service.hasAction('machines', 'create')).toBe(false);
  });

  test('COMPANY_ADMIN with no company_permissions can do all actions', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasAction('machines', 'delete')).toBe(true);
  });

  test('COMPANY_ADMIN restricted by company_permissions', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:machines:view'] });
    expect(service.hasAction('machines', 'view')).toBe(true);
    expect(service.hasAction('machines', 'create')).toBe(false);
  });
});

// ── hasWidget ─────────────────────────────────────────────────────────────────

describe('AuthService.hasAction — role and company together', () => {
  test('a regular role needs the action on the role AND on its company', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-energy:export'], company_permissions: ['page:analytics-energy:export'] });
    expect(service.hasAction('analytics-energy', 'export')).toBe(true);
  });

  test('view granted, export not: the Export button stays hidden', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:analytics-energy:view', 'page:analytics-energy:export'],
      company_permissions: ['page:analytics-energy:view']
    });
    expect(service.hasAction('analytics-energy', 'view')).toBe(true);
    expect(service.hasAction('analytics-energy', 'export')).toBe(false);
  });

  test('Tariff settings is separate from export', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:analytics-energy:export', 'page:analytics-energy:settings'],
      company_permissions: ['page:analytics-energy:export']
    });
    expect(service.hasAction('analytics-energy', 'export')).toBe(true);
    expect(service.hasAction('analytics-energy', 'settings')).toBe(false);
  });

  test('a company with no grants is fresh — the role decides', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-energy:export'], company_permissions: [] });
    expect(service.hasAction('analytics-energy', 'export')).toBe(true);
  });

  test('the role still has to hold it even when the company has it', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-energy:view'], company_permissions: ['page:analytics-energy:view', 'page:analytics-energy:export'] });
    expect(service.hasAction('analytics-energy', 'export')).toBe(false);
  });
});

describe('AuthService.hasWidget', () => {
  test('SNT_SUPER can see all widgets', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('COMPANY_ADMIN with no restrictions sees all widgets', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('regular user sees widget when company allows and user has permission', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:dashboard:partcount'],
      company_permissions: ['page:dashboard:partcount']
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('regular user blocked when company_permissions does not include widget', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:dashboard:partcount'],
      company_permissions: ['page:dashboard:oee']
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(false);
  });

  test('regular user blocked when they lack role permission', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:dashboard:oee'],
      company_permissions: []
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(false);
  });
});

// ── getCompanyId / getPlan ─────────────────────────────────────────────────────

describe('AuthService.getCompanyId / getPlan', () => {
  test('getCompanyId returns company_id from user', () => {
    seedUser({ company_id: 42 });
    expect(service.getCompanyId()).toBe(42);
  });

  test('getCompanyId returns null when no user', () => {
    clearSession();
    expect(service.getCompanyId()).toBeNull();
  });

  test('getPlan returns plan object', () => {
    seedUser({ plan: { plan_code: 'BASIC', tier: 1 } });
    expect(service.getPlan()).toEqual({ plan_code: 'BASIC', tier: 1 });
  });

  test('getPlan returns null when no plan', () => {
    seedUser({ plan: undefined });
    expect(service.getPlan()).toBeNull();
  });
});

// ── getFirstAccessibleRoute ───────────────────────────────────────────────────

describe('AuthService.getFirstAccessibleRoute', () => {
  test('SNT_SUPER always goes to /admin/companies', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.getFirstAccessibleRoute()).toBe('/admin/companies');
  });

  test('COMPANY_ADMIN with no restrictions goes to /dashboard', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.getFirstAccessibleRoute()).toBe('/dashboard');
  });

  test('COMPANY_ADMIN routes to first matching company permission', () => {
    seedUser({
      roles: ['COMPANY_ADMIN'],
      company_permissions: ['page:oee-reports:view']
    });
    expect(service.getFirstAccessibleRoute()).toBe('/reports');
  });

  test('regular user routes to first matching permission', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:machines:view']
    });
    expect(service.getFirstAccessibleRoute()).toBe('/machines');
  });

  test('regular user gets /no-access when no matching permissions', () => {
    seedUser({ roles: ['MANAGER'], permissions: [] });
    expect(service.getFirstAccessibleRoute()).toBe('/no-access');
  });

  test('COMPANY_ADMIN with no matching company_perms goes to /admin/users', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:unknown'] });
    expect(service.getFirstAccessibleRoute()).toBe('/admin/users');
  });

  test('returns /no-access when localStorage is corrupted', () => {
    localStorage.setItem('user', '{{bad json}}');
    expect(service.getFirstAccessibleRoute()).toBe('/no-access');
  });
});

/* The landing list used to stop at a handful of pages, so a role whose only
   page was further down the menu signed in to "Access Denied" although the
   menu offered it a page. These are the default roles as production holds
   them (company S AND T). */
describe('AuthService.getFirstAccessibleRoute — every default role lands on a page it has', () => {
  const company = ['page:programs:view', 'page:programs:upload', 'page:quality:view', 'page:quality:edit',
    'page:analytics-oee:view', 'page:analytics-operators:view', 'page:operators:view', 'page:maintenance:view'];

  test.each([
    ['SETTER — Program Transfer only', ['page:programs:view', 'page:programs:upload', 'machine.view'], '/programs'],
    ['QUALITY — OEE dashboard and Quality', ['page:analytics-oee:view', 'page:quality:view', 'line.view'], '/oee-dashboard'],
    ['a role with Quality alone', ['page:quality:view'], '/quality'],
    ['HR — Operator Performance and Operators', ['page:analytics-operators:view', 'page:operators:view', 'operator.view'], '/operator-performance'],
    ['a role with Maintenance tickets alone', ['page:maintenance:view'], '/maintenance'],
  ])('%s', (_label, permissions, landing) => {
    seedUser({ roles: ['CUSTOM'], permissions, company_permissions: company });
    expect(service.getFirstAccessibleRoute()).toBe(landing);
  });

  test('a page the company was not granted is skipped, not landed on', () => {
    seedUser({ roles: ['CUSTOM'], permissions: ['page:programs:view', 'page:quality:view'],
               company_permissions: ['page:quality:view'] });
    expect(service.getFirstAccessibleRoute()).toBe('/quality');
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('AuthService.getFirstAccessibleRoute — the nine dashboards', () => {
  test('a role with only OEE lands on the OEE dashboard, not on /no-access', () => {
    seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: [] });
    expect(service.getFirstAccessibleRoute()).toBe('/oee-dashboard');
  });

  test('a company admin whose company was granted only Alarms lands on Alarms', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:analytics-alarms:view'] });
    expect(service.getFirstAccessibleRoute()).toBe('/alarm-report');
  });

  test('skips a dashboard the role holds but the company was not granted', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:analytics-factory:view', 'page:analytics-oee:view'],
      company_permissions: ['page:analytics-oee:view']
    });
    expect(service.getFirstAccessibleRoute()).toBe('/oee-dashboard');
  });

  test('the live dashboard still comes first when the user has it', () => {
    seedUser({
      roles: ['MANAGER'],
      permissions: ['page:dashboard:view', 'page:analytics-oee:view'],
      company_permissions: []
    });
    expect(service.getFirstAccessibleRoute()).toBe('/dashboard');
  });
});

describe('AuthService.logout', () => {
  test('clears localStorage and navigates to /login', () => {
    const http = TestBed.inject(HttpTestingController);
    seedUser();

    service.logout();

    // drains the optional POST /logout call
    const req = http.match(r => r.url.includes('/auth/logout'));
    req.forEach(r => r.flush({}));

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('does not call logout API when no refreshToken stored', () => {
    const http = TestBed.inject(HttpTestingController);
    clearSession();

    service.logout();
    http.expectNone(r => r.url.includes('/auth/logout'));

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});

// ── getCompanyPermissions ─────────────────────────────────────────────────────

describe('AuthService.getCompanyPermissions', () => {
  test('returns company_permissions array from user', () => {
    seedUser({ company_permissions: ['page:dashboard', 'page:machines:view'] });
    expect(service.getCompanyPermissions()).toEqual(['page:dashboard', 'page:machines:view']);
  });

  test('returns [] when no user stored', () => {
    clearSession();
    expect(service.getCompanyPermissions()).toEqual([]);
  });
});

// ── refresh carries the current grants ────────────────────────────────────────

/*
 * hasPermission / hasAction / hasWidget read `permissions` and
 * `company_permissions` from the user object saved at login, and nothing ever
 * rewrote them — a page revoked in Manage Access stayed usable in the UI until
 * the person signed out and back in. The refresh response now carries both.
 */
describe('AuthService.refreshToken — grants', () => {
  /** A structurally valid JWT that expires in 30s, so scheduleRefresh sees
   *  refreshTime <= 0 and arms no timer. */
  const soonJwt = () => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 30 })}.sig`;
  };

  function refresh(body: Record<string, unknown>) {
    const http = TestBed.inject(HttpTestingController);
    localStorage.setItem('refreshToken', 'rt');
    service.refreshToken().subscribe();
    http.expectOne(r => r.url.includes('/auth/refresh')).flush({ accessToken: soonJwt(), ...body });
  }

  test('a page revoked since login disappears from the stored user', () => {
    // COMPANY_ADMIN is the role whose gating is decided by company_permissions
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:dashboard:view', 'page:reports:view'] });
    expect(service.hasPermission('page:reports')).toBe(true);

    refresh({ company_permissions: ['page:dashboard:view'] });

    expect(service.getCompanyPermissions()).toEqual(['page:dashboard:view']);
    expect(service.hasPermission('page:reports')).toBe(false);
  });

  test('role permissions are refreshed too', () => {
    seedUser({ roles: ['SUPERVISOR'], permissions: ['page:machines:view'] });
    refresh({ permissions: ['page:machines:view', 'page:quality:view'] });
    expect(service.getPermissions()).toContain('page:quality:view');
  });

  test('an older API that returns only a token leaves the lists alone', () => {
    // an empty company list reads as "unrestricted" — blanking it would
    // silently grant everything
    seedUser({ company_permissions: ['page:dashboard:view'], permissions: ['page:dashboard:view'] });
    refresh({});
    expect(service.getCompanyPermissions()).toEqual(['page:dashboard:view']);
    expect(service.getPermissions()).toEqual(['page:dashboard:view']);
  });

  test('other fields on the stored user survive the merge', () => {
    seedUser({ company_id: 4, username: 'admin1', plan: { plan_code: 'PRO' } });
    refresh({ company_permissions: ['page:dashboard:view'] });
    const u = service.getUser();
    expect(u.company_id).toBe(4);
    expect(u.username).toBe('admin1');
    expect(u.plan).toEqual({ plan_code: 'PRO' });
  });

  test('a stored token is replaced', () => {
    seedUser();
    refresh({});
    expect(localStorage.getItem('token')).not.toBe('fake-token');
  });

  describe('grantsChanged$ — what the header listens to', () => {
    test('fires when the grants differ', () => {
      seedUser({ company_permissions: ['page:a:view', 'page:b:view'] });
      const seen = vi.fn();
      service.grantsChanged$.subscribe(seen);
      refresh({ company_permissions: ['page:a:view'] });
      expect(seen).toHaveBeenCalledTimes(1);
    });

    test('does not fire when nothing changed', () => {
      seedUser({ company_permissions: ['page:a:view'], permissions: ['page:a:view'] });
      const seen = vi.fn();
      service.grantsChanged$.subscribe(seen);
      refresh({ company_permissions: ['page:a:view'], permissions: ['page:a:view'] });
      expect(seen).not.toHaveBeenCalled();
    });

    test('a reordered but identical list is not a change', () => {
      seedUser({ company_permissions: ['page:a:view', 'page:b:view'] });
      const seen = vi.fn();
      service.grantsChanged$.subscribe(seen);
      refresh({ company_permissions: ['page:b:view', 'page:a:view'] });
      expect(seen).not.toHaveBeenCalled();
    });
  });
});
