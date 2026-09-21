import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

/**
 * Guards the Users page: company admins, and S&T (who adds a company's admin).
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

/**
 * Guards the Roles page, which belongs to the company admin alone.
 *
 * Each company owns its roles and its admin manages them; S&T creates the
 * company and its admin and sets Manage Access, and takes no action on
 * roles. The page had nothing left for S&T to do, so S&T is sent to its own
 * landing page rather than shown an empty, read-only list.
 */
export const companyRolesGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      router.navigate(['/login']);
      return false;
    }

    const roles: string[] = JSON.parse(userJson).roles || [];

    if (roles.includes('SNT_SUPER')) {
      router.navigate(['/admin/companies']);
      return false;
    }
    if (roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
      return true;
    }

    router.navigate(['/dashboard']);
    return false;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
