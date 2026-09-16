import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

/**
 * Guards the company-admin pages: Users and Roles.
 *
 * SNT_SUPER is allowed through. It used to be redirected to
 * /admin/companies, which left a capability the backend already supports
 * unreachable: user.service.create has an explicit "SNT_SUPER must specify
 * company_id" branch, user.service.list returns every company's users to a
 * super user, and POST /users lists SNT_SUPER among the permitted roles.
 * With the redirect in place a company admin could only ever be created
 * once — as a side effect of creating the company — so if that person left
 * or the invitation mail was lost, nobody could add another.
 */
export const companyAdminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      router.navigate(['/login']);
      return false;
    }

    const user = JSON.parse(userJson);
    const roles: string[] = user.roles || [];

    if (roles.includes('SNT_SUPER') || roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
      return true;
    }

    router.navigate(['/dashboard']);
    return false;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
