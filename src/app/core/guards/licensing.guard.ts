import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { LicensingService } from '../services/licensing.service';
export const licensingGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(LicensingService).available().pipe(map(enabled => enabled || router.createUrlTree(['/admin/companies'])));
};
