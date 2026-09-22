import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard that checks if the user has permission to access a page.
 *
 * Permission matching:
 * - `page:dashboard` matches exactly OR any `page:dashboard:*` action (view/create/edit/delete)
 * - SNT_SUPER and COMPANY_ADMIN bypass all checks
 *
 * Usage: canActivate: [permissionGuard('page:machines')]
 */
export function permissionGuard(requiredPermission: string): CanActivateFn {
  return (route, state) => {
    const router = inject(Router);

    try {
      const userJson = localStorage.getItem('user');
      if (!userJson) {
        router.navigate(['/login']);
        return false;
      }

      const user = JSON.parse(userJson);
      const roles: string[] = user.roles || [];

      // SNT_SUPER can only access admin pages, not regular pages
      if (roles.includes('SNT_SUPER')) {
        router.navigate(['/admin/companies']);
        return false;
      }

      // COMPANY_ADMIN: can access pages their company has been granted
      if (roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
        const companyPerms: string[] = user.company_permissions || [];
        // If no company permissions set yet, allow all (fresh company)
        if (companyPerms.length === 0) return true;
        // Check if company has access to this page
        if (companyPerms.includes(requiredPermission)) return true;
        if (companyPerms.some((p: string) => p.startsWith(requiredPermission + ':'))) return true;
        router.navigate(['/no-access']);
        return false;
      }

      const permissions: string[] = user.permissions || [];

      // Exact match, or any CRUD action on this page
      // e.g. requiredPermission='page:machines' → match 'page:machines:view'
      const roleAllows =
        permissions.includes(requiredPermission) ||
        permissions.some(p => p.startsWith(requiredPermission + ':'));

      /* And the company must have been granted the page. Only the role was
         checked, so a role kept opening a page its company no longer had —
         which the API now refuses, leaving a page that loads and then fails.
         No company grants at all is a fresh company: unrestricted. */
      const companyPerms: string[] = user.company_permissions || [];
      const companyAllows =
        companyPerms.length === 0 ||
        companyPerms.includes(requiredPermission) ||
        companyPerms.some(p => p.startsWith(requiredPermission + ':'));

      if (roleAllows && companyAllows) return true;

      router.navigate(['/no-access']);
      return false;
    } catch {
      router.navigate(['/login']);
      return false;
    }
  };
}

/**
 * A page more than one permission can open — the Reports page holds the
 * production reports (page:reports) and the OEE reports (page:oee-reports),
 * so either one lets a role in; the page then shows only the tabs it may use.
 * Same rule as everywhere else: the role holds it AND the company was granted it.
 */
export function anyPermissionGuard(keys: string[]): CanActivateFn {
  return () => {
    const router = inject(Router);
    const auth = inject(AuthService);
    if (!localStorage.getItem('user')) { router.navigate(['/login']); return false; }
    if (auth.isSntSuper()) { router.navigate(['/admin/companies']); return false; }
    if (keys.some(k => auth.hasPermission(k))) return true;
    router.navigate(['/no-access']);
    return false;
  };
}
