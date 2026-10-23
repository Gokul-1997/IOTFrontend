import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Mexa AI's full page (/assistant): the same rule as its corner button —
 * a company S&T gave the AI to, and a role its admin gave it to. Not
 * permissionGuard: there a company with no grants is unrestricted, and the
 * AI is opt-in (23 Oct 2026). S&T goes to its own pages, as everywhere.
 * The rule is AuthService's: the routes load first, the chat code only with the page.
 */
export const assistantGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  if (auth.isSntSuper()) return router.createUrlTree(['/admin/companies']);
  return auth.mayUseAssistant() ? true : router.createUrlTree(['/no-access']);
};
