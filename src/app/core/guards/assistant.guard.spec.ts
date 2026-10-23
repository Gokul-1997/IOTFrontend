/**
 * assistantGuard — Mexa AI's full page (/assistant) opens on the same
 * rule as its corner button: never for S&T; only where the AI was given.
 */

import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { assistantGuard } from './assistant.guard';
import { AuthService } from '../services/auth.service';

const tree = (to: string) => ({ to } as unknown as UrlTree);
const user = (o: object) => localStorage.setItem('user', JSON.stringify({ id: 1, company_id: 4, permissions: [], company_permissions: [], ...o }));

function run() {
  TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { createUrlTree: (cmds: string[]) => tree(cmds.join('/')) } }] });
  return TestBed.runInInjectionContext(() => assistantGuard({} as ActivatedRouteSnapshot, { url: '/assistant' } as RouterStateSnapshot));
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('token', 't'); });
afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

test('the company admin of a company S&T gave the AI: the page opens', () => {
  user({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:reports:view', 'page:assistant:view'] });
  expect(run()).toBe(true);
});

test('a role its company admin gave the AI: the page opens; a role without it: no access', () => {
  user({ roles: ['OPERATOR'], permissions: ['page:assistant:view'], company_permissions: ['page:assistant:view'] });
  expect(run()).toBe(true);
  TestBed.resetTestingModule();
  user({ roles: ['OPERATOR'], permissions: ['page:reports:view'], company_permissions: ['page:reports:view', 'page:assistant:view'] });
  expect(run()).toEqual(tree('/no-access'));
});

test('a company with no grants at all does not have it: the AI is opt-in', () => {
  user({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
  expect(run()).toEqual(tree('/no-access'));
  expect(TestBed.inject(AuthService).hasPermission('page:reports')).toBe(true);   // everything else stays open
});

test('S&T: to its own pages, never the company assistant', () => {
  user({ roles: ['SNT_SUPER'], company_id: null });
  expect(run()).toEqual(tree('/admin/companies'));
});
