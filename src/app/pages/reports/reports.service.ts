import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  /** Client-side CSV export using the already-fetched rows + active column selection */
  exportCsv(filename: string, cols: { key: string; label: string }[], rows: any[]): void {
    const header = cols.map(c => `"${c.label}"`).join(',');
    const body   = rows.map(r =>
      cols.map(c => {
        const v = r[c.key] ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');

    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Full Excel download (all columns, uses backend) */
  downloadExcel(type: ReportType, date: string): void {
    const pathMap: Record<ReportType, string> = {
      'production': `${this.api}/production?date=${date}`,
      'oee-hourly': `${this.api}/hourly-oee?date=${date}`,
      'shift-oee':  `${this.api}/shift-oee?date=${date}`,
    };
    this.http.get(pathMap[type], { responseType: 'blob' }).subscribe(blob => {
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      link.download = `${type}_${date}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  /** The column definitions the server will build the emailed file from. */
  getColumns(type: ReportType): Observable<any> {
    return this.http.get(`${this.api}/columns`, { params: { type } });
  }

  /**
   * Ask for the report to be emailed. Answers 202 immediately — the file is
   * built after the response, so a success here means "accepted", not "sent".
   */
  emailReport(body: {
    type: ReportType; columns: string[]; email?: string;
    labels?: Record<string, string>;
  } & ReportFilters): Observable<any> {
    return this.http.post(`${this.api}/email`, body);
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
