import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ReportType = 'production' | 'oee-hourly' | 'shift-oee';

/** Mirrors MAX_DIRECT_DAYS in Backend report.limits.js; the server is the
 *  authority and re-states it on GET /reports/columns. */
export const MAX_DIRECT_DAYS = 92;

/** Inclusive, so a single day counts as one. */
export function rangeDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Where each report's file is downloaded from. */
const EXPORT_PATHS: Record<ReportType, string> = {
  'production': 'production',
  'oee-hourly': 'hourly-oee',
  'shift-oee':  'shift-oee'
};

export interface ReportFilters {
  date_from:   string;
  date_to:     string;
  machine_id:  string;
  shift_id:    string;
  operator_id: string;
}

@Injectable({ providedIn: 'root' })
export class ReportsService {

  private api = environment.apiUrl + '/reports';

  constructor(private http: HttpClient) {}

  getMachines(): Observable<any>  { return this.http.get(`${this.api}/machines`);  }
  getShifts(): Observable<any>    { return this.http.get(`${this.api}/shifts`);    }
  getOperators(machine_id?: string): Observable<any> {
    const params: Record<string, string> = {};
    if (machine_id) params['machine_id'] = machine_id;
    return this.http.get(`${this.api}/operators`, { params });
  }

  getProductionData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/production-data`, { params: this.toParams(f) });
  }

  getOeeHourlyData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/oee-hourly-data`, { params: this.toParams(f) });
  }

  getShiftOeeData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/shift-oee-data`, { params: this.toParams(f) });
  }

  /**
   * The report on screen as a file: its dates and filters, the columns
   * chosen, the order sorted — CSV or Excel, built by the server so the two
   * are the same report. A small one is the file (200); a large one is
   * emailed instead (202 and a message): see shared/report-file.ts.
   */
  exportFile(type: ReportType, format: 'csv' | 'xlsx', f: ReportFilters,
             columns: string[], sort?: string, dir?: 'asc' | 'desc'): Observable<HttpResponse<Blob>> {
    const params: Record<string, string> = { ...this.toParams(f), format, columns: columns.join(',') };
    if (sort) { params['sort'] = sort; params['dir'] = dir || 'asc'; }
    return this.http.get(`${this.api}/${EXPORT_PATHS[type]}`, { params, observe: 'response', responseType: 'blob' });
  }

  private toParams(f: ReportFilters): Record<string, string> {
    const p: Record<string, string> = {
      date_from: f.date_from,
      date_to:   f.date_to,
    };
    if (f.machine_id)  p['machine_id']  = f.machine_id;
    if (f.shift_id)    p['shift_id']    = f.shift_id;
    if (f.operator_id) p['operator_id'] = f.operator_id;
    return p;
  }
}
