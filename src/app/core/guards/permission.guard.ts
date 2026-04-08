import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

/**
 * Guard that checks if the user has permission to access a page.
 * Usage in routes: canActivate: [permissionGuard('page:dashboard')]
 *
 * ADMIN role always bypasses permission checks.
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

      // ADMIN always has full access
      if (user.roles?.includes('ADMIN')) {
        return true;
      }

      const permissions: string[] = user.permissions || [];

      if (permissions.includes(requiredPermission)) {
        return true;
      }

      // No permission — redirect to dashboard
      router.navigate(['/dashboard']);
      return false;
    } catch {
      router.navigate(['/login']);
      return false;
    }
  };
}
