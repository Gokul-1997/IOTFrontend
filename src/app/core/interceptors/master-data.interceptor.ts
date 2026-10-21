import { HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MasterDataService } from '../services/master-data.service';

/** Successful edits invalidate shared reference lists, including edits from admin screens. */
export const MasterDataInterceptor: HttpInterceptorFn = (request, next) => {
  const prefix = environment.apiUrl + '/';
  const path = request.url.startsWith(prefix) ? request.url.slice(prefix.length).split('?')[0] : '';
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      !/^(machines|shifts|lines|plants|machine-shifts|companies|users|roles)(\/|$)/.test(path)) return next(request);
  const master = inject(MasterDataService);
  return next(request).pipe(tap(event => {
    if (event.type === HttpEventType.Response) master.invalidate();
  }));
};
