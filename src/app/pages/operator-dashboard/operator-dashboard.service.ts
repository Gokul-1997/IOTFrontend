import { Injectable } from '@angular/core';
import { MasterDataService } from '../../core/services/master-data.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 7 — Operator Performance. */
@Injectable({ providedIn: 'root' })
export class OperatorDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient, private master: MasterDataService) {}

  getMeta(): Observable<any> {
    return this.master.get('charts');
  }

  /** Only filters the user actually set — a blank one would otherwise
   *  narrow the query to rows with an empty value. */
  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'shift_id', 'operator_id', 'search', 'show', 'sort', 'dir', 'page', 'limit', 'part']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    // the table's header filters (shared/table: f_<column>=a,b)
    for (const k of Object.keys(f)) if (k.startsWith('f_') && f[k]) q[k] = f[k];
    return q;
  }

  getOperators(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/operators`, { params: this.toQuery(filters) });
  }

  /** responseType 'blob': a JSON parse would corrupt an xlsx body. */
  exportAs(format: 'xlsx' | 'csv', filters: any): Observable<Blob> {
    const { page, limit, part, ...rest } = this.toQuery(filters);   // sort and dir kept: the file matches the table
    return this.http.get(`${this.api}/dashboard/operators/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
