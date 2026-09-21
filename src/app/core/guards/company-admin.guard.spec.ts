/**
 * Unit tests for companyAdminGuard (CanActivateFn).
 *
 * SNT_SUPER used to be redirected away from Users and Roles, which made
 * cross-company user management impossible even though the API supports it:
 * user.service.create has an explicit "SNT_SUPER must specify company_id"
 * branch and POST /users lists the role as permitted. With the redirect in
 * place a company admin could only ever be created once, as a side effect of
 * creating the company. These pin the roles that may pass so the redirect
 * cannot return by accident.
 */

import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { companyAdminGuard, companyRolesGuard } from './company-admin.guard';

const fakeRoute = {} as ActivatedRouteSnapshot;
const fakeState = { url: '/admin/users' } as RouterStateSnapshot;

function runGuard() {
  return TestBed.runInInjectionContext(() => companyAdminGuard(fakeRoute, fakeState));
}

function seedUser(roles: string[]) {
  localStorage.setItem('user', JSON.stringify({ roles }));
}

let routerSpy: { navigate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  localStorage.clear();
  routerSpy = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    providers: [{ provide: Router, useValue: routerSpy }]
  });
});

afterEach(() => localStorage.clear());

describe('companyAdminGuard', () => {
  test('allows SNT_SUPER — the capability the API already grants', () => {
    seedUser(['SNT_SUPER']);
    expect(runGuard()).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  test('allows COMPANY_ADMIN', () => {
    seedUser(['COMPANY_ADMIN']);
    expect(runGuard()).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  test('allows ADMIN', () => {
    seedUser(['ADMIN']);
    expect(runGuard()).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  test('blocks VIEWER → redirects to /dashboard', () => {
    seedUser(['VIEWER']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  test('blocks OPERATOR → redirects to /dashboard', () => {
    seedUser(['OPERATOR']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  test('no stored user → redirects to /login', () => {
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('corrupt stored user is treated as signed out, never as access', () => {
    localStorage.setItem('user', 'not json');
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('a user with no roles at all is blocked', () => {
    localStorage.setItem('user', JSON.stringify({ username: 'x' }));
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});

/*
 * The Roles page is the company admin's alone. Each company owns its roles;
 * S&T creates the company and its admin and sets Manage Access, and takes no
 * action on roles — so S&T is sent to its own landing page.
 */
describe('companyRolesGuard', () => {
  const runRoles = () => TestBed.runInInjectionContext(() => companyRolesGuard(fakeRoute, fakeState));

  test('allows COMPANY_ADMIN', () => {
    seedUser(['COMPANY_ADMIN']);
    expect(runRoles()).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  test('allows ADMIN', () => {
    seedUser(['ADMIN']);
    expect(runRoles()).toBe(true);
  });

  test('sends SNT_SUPER to /admin/companies — there is nothing for S&T to do here', () => {
    seedUser(['SNT_SUPER']);
    expect(runRoles()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/companies']);
  });

  test('blocks an ordinary role → /dashboard', () => {
    seedUser(['SUPERVISOR']);
    expect(runRoles()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  test('no stored user → /login', () => {
    expect(runRoles()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('corrupt stored user → /login, never access', () => {
    localStorage.setItem('user', '{not json');
    expect(runRoles()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});
