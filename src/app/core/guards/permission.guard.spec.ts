/**
 * Unit tests for permissionGuard (CanActivateFn factory).
 *
 * The guard used to check the role alone for everyone except a company admin,
 * so a role kept opening a page its company had since been refused — a page
 * that loaded and then failed on every API call the server now rejects. These
 * pin the rule the API applies: a regular role needs the page on the role AND
 * on its company; a company admin is governed by the company alone.
 */

import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { permissionGuard } from './permission.guard';

const fakeRoute = {} as ActivatedRouteSnapshot;
const fakeState = { url: '/dashboard/oee' } as RouterStateSnapshot;

function run(permission: string) {
  return TestBed.runInInjectionContext(() => permissionGuard(permission)(fakeRoute, fakeState));
}

function seedUser(user: Record<string, unknown>) {
  localStorage.setItem('user', JSON.stringify(user));
}

let routerSpy: { navigate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  localStorage.clear();
  routerSpy = { navigate: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: routerSpy }] });
});

afterEach(() => localStorage.clear());

describe('permissionGuard', () => {
  test('no session → login', () => {
    expect(run('page:analytics-oee')).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('corrupt session → login, not a crash', () => {
    localStorage.setItem('user', '{not json');
    expect(run('page:analytics-oee')).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('SNT_SUPER is sent to the admin area, not the tenant page', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(run('page:analytics-oee')).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/companies']);
  });

  describe('regular role', () => {
    test('allows a page on the role and on the company', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-oee:view'] });
      expect(run('page:analytics-oee')).toBe(true);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    test('refuses a page the role holds but the company does not', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-alarms:view'] });
      expect(run('page:analytics-oee')).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/no-access']);
    });

    test('refuses a page the company has but the role does not', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-alarms:view'], company_permissions: ['page:analytics-oee:view', 'page:analytics-alarms:view'] });
      expect(run('page:analytics-oee')).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/no-access']);
    });

    test('a company with no grants is fresh — the role decides', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: [] });
      expect(run('page:analytics-oee')).toBe(true);
    });

    test('a session with no company_permissions field at all behaves as fresh', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'] });
      expect(run('page:analytics-oee')).toBe(true);
    });

    test('a role with nothing is refused', () => {
      seedUser({ roles: ['MANAGER'], permissions: [], company_permissions: ['page:analytics-oee:view'] });
      expect(run('page:analytics-oee')).toBe(false);
    });

    test('one dashboard does not open another (prefix match is per page)', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:analytics-oee:view'], company_permissions: ['page:analytics-oee:view'] });
      // "page:analytics-oee" must not match "page:analytics-oee-something" or the reverse
      expect(run('page:analytics-energy')).toBe(false);
      expect(run('page:analytics')).toBe(false);
    });

    test('the classic dashboard key does not open the nine analytics screens', () => {
      seedUser({ roles: ['MANAGER'], permissions: ['page:dashboard:view'], company_permissions: ['page:dashboard:view'] });
      expect(run('page:dashboard')).toBe(true);
      expect(run('page:analytics-oee')).toBe(false);
      expect(run('page:analytics-energy')).toBe(false);
    });
  });

  describe('company admin', () => {
    test('is governed by the company grant alone', () => {
      seedUser({ roles: ['COMPANY_ADMIN'], permissions: [], company_permissions: ['page:analytics-oee:view'] });
      expect(run('page:analytics-oee')).toBe(true);
      expect(run('page:analytics-energy')).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/no-access']);
    });

    test('a fresh company (no grants) is unrestricted', () => {
      seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
      expect(run('page:analytics-energy')).toBe(true);
    });
  });
});
