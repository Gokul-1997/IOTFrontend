import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 6 — Downtime Reason Loss Analysis. */
@Injectable({ providedIn: 'root' })
export class DowntimeDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  /** Only filters the user actually set are sent — a blank one would
   *  otherwise narrow the query to rows with an empty value. */
  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'shift_id', 'operator_id',
                     'reason_id', 'category', 'search', 'page', 'limit', 'part']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getDowntime(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/downtime`, { params: this.toQuery(filters) });
  }

  /** responseType 'blob': the default JSON parse would corrupt an xlsx or
   *  pdf body before it reached the browser's save dialog. */
  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, part, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/downtime/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
