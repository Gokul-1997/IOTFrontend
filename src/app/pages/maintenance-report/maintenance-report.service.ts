import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Maintenance Report — the exportable ticket record the agreement asks for. */
@Injectable({ providedIn: 'root' })
export class MaintenanceReportService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  /** Only filters the user actually set — a blank one would otherwise
   *  narrow the query to rows with an empty value. */
  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'status', 'issue_type', 'priority', 'search', 'page', 'limit']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getReport(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/maintenance-report`, { params: this.toQuery(filters) });
  }

  /** responseType 'blob': a JSON parse would corrupt xlsx and pdf bodies. */
  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/maintenance-report/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
